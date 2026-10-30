import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCanvasServer } from '../canvas-server.mjs';
import { load } from '../module-model.mjs';
import { writePorts } from '../module-ports.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
async function fixture(run) {
  const temp = mkdtempSync(join(tmpdir(), 'framework-pack-')), root = join(temp, 'project');
  cpSync(new URL('../../', import.meta.url), root, { recursive: true, filter: path => !['runs', 'outputs', 'node_modules'].includes(basename(path)) });
  const server = createCanvasServer(root);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    const token = (await (await fetch(url)).text()).match(/const token='([^']+)'/)[1];
    const headers = { 'X-Canvas-Token': token, 'Content-Type': 'application/json' };
    const get = async () => (await fetch(url + '/api/project', { headers })).json();
    const post = (path, data) => fetch(url + '/api/' + path, { method: 'POST', headers, body: JSON.stringify(data) });
    const request = async (options = {}) => {
      const current = await get(), parent = current.nodes[0];
      return { id: parent.id, revision: parent.revision, layoutRevision: current.layoutRevision, members: parent.children, newId: 'packed', name: '组合测试', ...options };
    };
    const preview = async data => {
      const response = await post('pack-preview', data), body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body)); return body;
    };
    await run({ root, get, post, request, preview });
  } finally { await new Promise(r => server.close(r)); rmSync(temp, { recursive: true, force: true }); }
}
function files(root) {
  const result = {};
  function visit(dir) { for (const n of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, n.name); if (n.isDirectory()) visit(p); else result[relative(root, p)] = readFileSync(p).toString('base64');
  } }
  visit(root); return result;
}

test('打包预览不写文件；保存迁移组合和普通模块、接口、布局、引用、历史与成果', async () => fixture(async ({ root, get, post, request, preview }) => {
  const history = join(root, 'modules/_example_combo/runs'); mkdirSync(history, { recursive: true });
  writeFileSync(join(history, 'record.json'), '{"original":"untouched"}');
  const output = join(root, 'modules/framework_feedback/outputs'); mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'result.bin'), Buffer.from([0, 255, 1, 2]));
  const layoutPath = join(root, 'methodology/canvas-layout.json');
  writeFileSync(layoutPath, json({ 'project-example': { 'example-combo': { x: 100, y: 200 }, 'framework-feedback': { x: 500, y: 300 }, '$input': { x: 10, y: 10 } }, 'example-combo': { 'example-text-reorder': { x: 30, y: 40 } } }));
  const before = files(root), data = await request(), p = await preview(data);
  assert.deepEqual(files(root), before);
  assert.equal(p.inputs.length, 1); assert.equal(p.outputs.length, 1);
  assert.ok(p.updatedReferences.includes('implementation/run.mjs'));
  let response = await post('pack', { ...data, packRevision: p.revision });
  assert.equal(response.status, 200, await response.text());
  const state = await get(), packed = state.nodes.find(n => n.id === 'packed');
  assert.deepEqual(packed.children.sort(), ['example-combo', 'framework-feedback']);
  assert.equal(state.nodes[0].children.length, 1);
  assert.deepEqual(load(root).errors, []);
  assert.equal(JSON.parse(readFileSync(join(root, 'modules/packed/module.json'))).status, 'pending');
  assert.equal(readFileSync(join(root, 'modules/packed/modules/_example_combo/runs/record.json'), 'utf8'), '{"original":"untouched"}');
  assert.deepEqual(readFileSync(join(root, 'modules/packed/modules/framework_feedback/outputs/result.bin')), Buffer.from([0, 255, 1, 2]));
  assert.equal(existsSync(join(root, 'modules/_example_combo')), false);
  assert.deepEqual(state.layout.packed['example-combo'], { x: 100, y: 200 });
  assert.equal(state.layout['project-example']['example-combo'], undefined);
  assert.deepEqual(state.layout['project-example'].packed, { x: 100, y: 200 });
  assert.deepEqual(state.layout['example-combo'], { 'example-text-reorder': { x: 30, y: 40 } });
  assert.match(readFileSync(join(root, 'methodology/panorama.md'), 'utf8'), /组合测试/);
  const blocked = spawnSync(process.execPath, [join(root, 'implementation/run.mjs'), '一月。二月。三月。'], { encoding: 'utf8' });
  assert.equal(blocked.status, 1); assert.match(blocked.stderr, /待配置/);
  // Simulate an explicit configuration review in this disposable test fixture.
  const metaPath = join(root, 'modules/packed/module.json'), meta = JSON.parse(readFileSync(metaPath)); meta.status = 'ready'; writeFileSync(metaPath, json(meta));
  const run = spawnSync(process.execPath, [join(root, 'implementation/run.mjs'), '一月。二月。三月。'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr); assert.equal(run.stdout.trim(), '一月。三月。二月。');
}));

function basics(root, edges) {
  rmSync(join(root, 'modules'), { recursive: true }); mkdirSync(join(root, 'modules'));
  for (const id of ['a', 'b', 'c']) {
    const dir = join(root, 'modules', id); mkdirSync(join(dir, 'implementation'), { recursive: true }); mkdirSync(join(dir, 'settings'));
    writeFileSync(join(dir, 'module.json'), json({ id, name: id, status: 'ready', template: { id: 'project-framework', version: '2.0.0' } }));
    for (const file of ['README.md', 'PROCESS.md', 'VALIDATION.md', 'settings/DEFAULTS.md', 'settings/PREFERENCES.md']) writeFileSync(join(dir, file), '# 测试\n');
    for (const file of ['INPUT.md', 'OUTPUT.md']) writeFileSync(join(dir, file), writePorts('# 接口', [{ name: 'text', description: '文字' }]));
  }
  // Existing example documentation intentionally references the removed fixture modules.
  for (const file of ['AGENTS.md', 'README.md', 'VALIDATION.md']) writeFileSync(join(root, file), '# 测试\n');
  writeFileSync(join(root, 'connections.json'), json({ custom: '保留文档字段', connections: edges }));
}
const edge = (from, to, extra = {}) => ({ from: { module: from, port: 'text' }, to: { module: to, port: 'text' }, info: from + ' to ' + to, ...extra });

test('多个基础节点打包保留内部连接、条件及扩展字段；支持再次嵌套打包', async () => fixture(async ({ root, get, request, preview, post }) => {
  const edges = [edge('$self', 'a', { when: '任务一', tag: { keep: true } }), edge('a', 'b', { when: '处理成功' }), edge('b', 'c'), edge('c', '$self')];
  basics(root, edges);
  let data = await request({ members: ['a', 'b'] }), p = await preview(data);
  assert.deepEqual(p.inner.connections[1], edges[1]);
  assert.equal(p.outer.custom, '保留文档字段');
  assert.deepEqual(p.outer.connections[0].tag, { keep: true });
  assert.equal(p.inner.connections[0].when, '任务一');
  let response = await post('pack', { ...data, packRevision: p.revision });
  assert.equal(response.status, 200, await response.text());
  assert.deepEqual((await get()).layout['project-example'].c, { x: 895, y: 250 });
  data = await request({ members: ['packed', 'c'], newId: 'nested' }); p = await preview(data);
  response = await post('pack', { ...data, packRevision: p.revision });
  assert.equal(response.status, 200, await response.text());
  const state = await get();
  assert.equal(state.nodes.find(n => n.id === 'a').label, 'modules/nested/modules/packed/modules/a');
  assert.deepEqual(load(root).errors, []);
}));

test('打包支持无外部接口，并拒绝收缩产生的无停止条件回路', async () => fixture(async ({ root, request, preview, post }) => {
  basics(root, [edge('$self', 'c'), edge('c', '$self'), edge('a', 'b')]);
  let data = await request({ members: ['a', 'b'] }), p = await preview(data);
  assert.deepEqual(p.inputs, []); assert.deepEqual(p.outputs, []);
  const response = await post('pack', { ...data, packRevision: p.revision });
  assert.equal(response.status, 200, await response.text());
  basics(root, [edge('$self', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', '$self')]);
  data = await request({ members: ['a', 'c'], newId: 'cycle' });
  const invalid = await post('pack-preview', data); assert.equal(invalid.status, 400); assert.match(await invalid.text(), /反馈回路/);
  const path = join(root, 'connections.json'), document = JSON.parse(readFileSync(path)); document.stop = '最多五轮'; writeFileSync(path, json(document));
  data = await request({ members: ['a', 'c'], newId: 'cycle' }); p = await preview(data);
  assert.equal(p.inner.stop, '最多五轮'); assert.equal(p.outer.stop, '最多五轮');
}));

test('跨边界多条连线分别生成接口，不合并重复端口或丢失条件', async () => fixture(async ({ root, request, preview, post, get }) => {
  const edges = [edge('$self', 'a', { when: '任务一' }), edge('c', 'a', { when: '反馈', custom: 42 }), edge('a', 'b'), edge('b', 'c'), edge('b', '$self', { when: '完成' })];
  basics(root, edges);
  const path = join(root, 'connections.json'), document = JSON.parse(readFileSync(path));
  document.stop = '最多五轮'; writeFileSync(path, json(document));
  const data = await request({ members: ['a', 'b'] }), p = await preview(data);
  assert.equal(p.inputs.length, 2); assert.equal(p.outputs.length, 2);
  const reconstructed = p.outer.connections.map(e => {
    const input = e.to.module === 'packed';
    const port = input ? e.to.port : e.from.port;
    const internal = p.inner.connections.find(i => input ? i.from.module === '$self' && i.from.port === port : i.to.module === '$self' && i.to.port === port);
    return { ...e, [input ? 'to' : 'from']: input ? internal.to : internal.from };
  });
  assert.deepEqual(reconstructed, edges.filter(e => !(e.from.module === 'a' && e.to.module === 'b')));
  const response = await post('pack', { ...data, packRevision: p.revision });
  assert.equal(response.status, 200, await response.text());
  const current = await get(); assert.equal(current.nodes.find(n => n.id === 'packed').inputs.length, 2);
  assert.deepEqual(load(root).errors, []);
}));

test('非法打包不写入；接口或成员文件变化使预览过期；更新全景失败完整回滚', async () => fixture(async ({ root, request, preview, post }) => {
  let data = await request(), before = files(root);
  for (const bad of [{ members: ['example-combo'] }, { members: ['example-combo', 'missing'] }, { members: ['example-combo', 'example-combo'] }, { newId: '../escape' }, { newId: 'CON' }, { newId: 'example-combo' }, { name: '' }]) {
    assert.equal((await post('pack-preview', { ...data, ...bad })).status, 400); assert.deepEqual(files(root), before);
  }
  assert.equal((await post('pack', data)).status, 409);
  let p = await preview(data);
  const input = join(root, 'modules/_example_combo/INPUT.md'); writeFileSync(input, readFileSync(input, 'utf8') + '\n外部修改\n');
  assert.equal((await post('pack', { ...data, packRevision: p.revision })).status, 409);
  data = await request(); p = await preview(data);
  const impl = join(root, 'modules/_example_combo/implementation/run.mjs'); writeFileSync(impl, readFileSync(impl, 'utf8') + '\n// 外部修改\n');
  assert.equal((await post('pack', { ...data, packRevision: p.revision })).status, 409);
  writeFileSync(join(root, 'scripts/panorama.mjs'), "import {writeFileSync} from 'node:fs';writeFileSync(new URL('../methodology/overview.svg',import.meta.url),'partial');process.exit(1);");
  data = await request(); p = await preview(data); before = files(root);
  const response = await post('pack', { ...data, packRevision: p.revision }); assert.equal(response.status, 400);
  assert.deepEqual(files(root), before);
  assert.equal(existsSync(join(root, 'modules/packed')), false);
}));
