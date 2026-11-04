import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = join(dirname(fileURLToPath(import.meta.url)), '..');

// 画布服务持有模块级状态（当前项目的根目录），同一进程里反复创建会互相干扰。
// 所以每个用例复制一份项目，在独立子进程里起服务、跑断言、退出。
const runner = `
import { pathToFileURL } from 'node:url';
const project = process.argv[2];
const { createCanvas } = await import(pathToFileURL(project + '/canvas.mjs').href);
const server = createCanvas(project);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const token = (await (await fetch(base + '/')).text()).match(/const TOKEN = '([^']+)'/)[1];
const headers = { 'x-canvas-token': token, 'Content-Type': 'application/json', Origin: base };
const call = async (path, body) => (await fetch(base + path, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers })).json();
const plain = async (path, opts) => { const r = await fetch(base + path, opts); return { status: r.status, text: await r.text() }; };
const cases = (await import(pathToFileURL(project + '/tests/case.mjs').href)).default;
try { await cases({ call, plain, base, token, project }); }
finally { server.closeAllConnections?.(); server.close(); }
`;

function withCanvas(name, cases) {
  const dir = mkdtempSync(join(tmpdir(), 'framework-canvas-'));
  const project = join(dir, 'project');
  try {
    cpSync(source, project, { recursive: true, filter: path => !['runs', 'outputs', 'node_modules', 'tests', '.git'].includes(basename(path)) });
    mkdirSync(join(project, 'tests'), { recursive: true }); writeFileSync(join(project, 'tests/case.mjs'), 'export default ' + cases.toString() + ';\n');
    writeFileSync(join(project, 'tests/run-canvas.mjs'), runner);
    const result = spawnSync(process.execPath, [join(project, 'tests/run-canvas.mjs'), project], { encoding: 'utf8', timeout: 120000 });
    if (result.status !== 0) throw new Error(result.stdout + result.stderr);
    return project;
  } finally {
    assert.ok(dir.split(/[\\/]/).at(-1).startsWith('framework-canvas-'));
    rmSync(dir, { recursive: true, force: true });
  }
}

const read = (project, path) => readFileSync(join(project, path), 'utf8');

test('页面能打开，根目录作为一层显示三个成员', () => withCanvas('open', async ({ call }) => {
  const data = await call('/api/project');
  if (!data.levels[data.root.id]) throw Error('根目录应作为一层');
  const count = data.levels[data.root.id].members.length;
  if (count !== 3) throw Error('成员数应为 3，实际 ' + count);
}));

test('能读到模块配套文件，读不到模块外', () => withCanvas('doc', async ({ call }) => {
  const doc = await call('/api/doc?id=text_reorder&file=README.md');
  if (!/文字重排/.test(doc.content)) throw Error('内容不对');
  if (doc.path !== 'modules/text_reorder/README.md') throw Error('路径不对：' + doc.path);
  const bad = await call('/api/doc?id=text_reorder&file=../../check.mjs');
  if (!bad.error) throw Error('不能读到模块外的文件');
}));

test('没有令牌或来自别的站点时拒绝', () => withCanvas('auth', async ({ base, token, plain }) => {
  if ((await plain('/api/project')).status !== 403) throw Error('无令牌应拒绝');
  const foreign = await plain('/api/project', { headers: { 'x-canvas-token': token, Origin: 'http://evil.example' } });
  if (foreign.status !== 403) throw Error('跨站应拒绝');
}));

test('保存连接、条件和节点位置', () => withCanvas('save', async ({ call }) => {
  const before = await call('/api/project');
  const root = before.root.id;
  const links = JSON.parse(JSON.stringify(before.levels[root].links));
  links[0].when = '收到文字时';
  const saved = await call('/api/save', { levelId: root, links, stop: before.levels[root].stop, positions: { text_reorder: { x: 10, y: 20 } }, revision: before.revisions[root] });
  if (saved.error) throw Error(saved.error);
  const after = await call('/api/project');
  if (after.levels[root].links[0].when !== '收到文字时') throw Error('条件没写进去');
  const pos = after.layout[root] && after.layout[root].text_reorder;
  if (!pos || pos.x !== 10 || pos.y !== 20) throw Error('位置没存');
}));

test('文件被别的操作改过时拒绝覆盖', () => withCanvas('conflict', async ({ call }) => {
  const before = await call('/api/project');
  const root = before.root.id;
  const stale = before.revisions[root];
  await call('/api/save', { levelId: root, links: before.levels[root].links, stop: '', positions: {}, revision: stale });
  const again = await call('/api/save', { levelId: root, links: before.levels[root].links, stop: '', positions: {}, revision: stale });
  if (!/重新加载/.test(again.error || '')) throw Error('应拒绝覆盖，实际：' + (again.error || '通过了'));
}));

test('连接不存在的接口会被拒绝', () => withCanvas('badport', async ({ call }) => {
  const before = await call('/api/project');
  const root = before.root.id;
  const links = JSON.parse(JSON.stringify(before.levels[root].links));
  links[0].to.port = 'nope';
  const result = await call('/api/save', { levelId: root, links, stop: '', positions: {}, revision: before.revisions[root] });
  if (!/接口不存在/.test(result.error || '')) throw Error('应拒绝，实际：' + (result.error || '通过了'));
}));

test('打包：预览不写盘，确认后搬家、生成组合、改链接', () => withCanvas('pack', async ({ call, project }) => {
  const fs = await import('node:fs'); const pjoin = (await import('node:path')).join;
  const before = await call('/api/project');
  const body = { parentId: before.root.id, memberIds: ['text_reorder', 'text_checker'], id: 'text_flow', name: '文字处理组合' };
  const preview = await call('/api/pack-preview', body);
  if (preview.error) throw Error(preview.error);
  if (preview.move.length !== 2) throw Error('应移动两个模块');
  if (preview.inputs.map(p => p.name).join() !== 'text,original') throw Error('输入接口不对');
  if (preview.outputs.map(p => p.name).join() !== 'result') throw Error('输出接口不对');
  if (!fs.existsSync(pjoin(project, 'modules/text_reorder/run.mjs'))) throw Error('预览不该动文件');
  if (fs.existsSync(pjoin(project, 'modules/text_flow'))) throw Error('预览不该建目录');

  const done = await call('/api/pack', body);
  if (done.error) throw Error(done.error);
  if (done.links.length !== 3) throw Error('应改 3 处链接，实际 ' + done.links.length);
  if (fs.existsSync(pjoin(project, 'modules/text_reorder'))) throw Error('旧目录应已移走');
  const readme = fs.readFileSync(pjoin(project, 'modules/text_flow/modules/text_reorder/README.md'), 'utf8');
  if (!readme.includes('../../../../METHOD.md')) throw Error('链接没改对：' + readme.match(/\]\(([^)]+METHOD[^)]*)\)/));

  const after = await call('/api/project');
  const root = after.levels[after.root.id];
  if (!root.members.some(m => m.id === 'text_flow')) throw Error('根目录应有新组合');
  if (root.members.some(m => m.id === 'text_reorder')) throw Error('成员应已移入组合');
  if (after.levels.text_flow.links.length !== 1) throw Error('内部连接应保留 1 条');
}));

test('打包后通过结构检查', () => withCanvas('packcheck', async ({ call, project }) => {
  const before = await call('/api/project');
  const done = await call('/api/pack', { parentId: before.root.id, memberIds: ['text_reorder', 'text_checker'], id: 'text_flow', name: '文字处理组合' });
  if (done.error) throw Error(done.error);
  const { spawnSync } = await import('node:child_process');
  const pjoin = (await import('node:path')).join;
  const check = pjoin(project, 'check.mjs');
  spawnSync(process.execPath, [check, '--panorama'], { cwd: project });
  const result = spawnSync(process.execPath, [check, '--verify'], { cwd: project, encoding: 'utf8' });
  const report = (result.stdout || '') + (result.stderr || '');
  // 新组合是 pending，依赖它的根目录验收跳过，这是对的。
  if (/✗/.test(report)) throw Error(report);
}));

test('选不够或标识撞名时不做改动', () => withCanvas('refuse', async ({ call, project }) => {
  const fs = await import('node:fs'); const pjoin = (await import('node:path')).join;
  const before = await call('/api/project');
  const conflict = await call('/api/pack-preview', { parentId: before.root.id, memberIds: ['text_reorder', 'text_checker'], id: 'framework_feedback', name: '撞名' });
  if (!/已被占用/.test(conflict.error || '')) throw Error('应拒绝撞名');
  const one = await call('/api/pack-preview', { parentId: before.root.id, memberIds: ['text_reorder'], id: 'x', name: '一个' });
  if (!/至少选两个/.test(one.error || '')) throw Error('应拒绝只选一个');
  if (!fs.existsSync(pjoin(project, 'modules/text_reorder/run.mjs'))) throw Error('不该动文件');
}));
