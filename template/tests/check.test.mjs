import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = join(dirname(fileURLToPath(import.meta.url)), '..');
const leaf = 'modules/text_reorder';

// 每个用例在独立临时目录里跑，不碰模板本体。
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'framework-check-'));
  const project = join(dir, 'project');
  try {
    cpSync(source, project, { recursive: true, filter: path => !['runs', 'outputs', 'node_modules', 'tests', '.git'].includes(basename(path)) });
    fn(project);
  } finally {
    assert.equal(dirname(dir), tmpdir());
    assert.ok(dir.split(/[\\/]/).at(-1).startsWith('framework-check-'));
    rmSync(dir, { recursive: true, force: true });
  }
}
const run = (p, args = []) => {
  const result = spawnSync(process.execPath, [join(p, 'check.mjs'), ...args], { encoding: 'utf8', timeout: 20000 });
  assert.ifError(result.error);
  return { code: result.status, text: result.stdout + result.stderr };
};
const edit = (p, file, change) => {
  const path = join(p, file);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  change(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
};
const bad = (p, pattern, args = []) => {
  const result = run(p, args);
  assert.notEqual(result.code, 0, result.text);
  assert.match(result.text, pattern);
};

test('完整示例通过，两个模块各验收一次', () => fixture(p => {
  const r = run(p, ['--verify']);
  assert.equal(r.code, 0, r.text);
  assert.equal((r.text.match(/✓ 验收通过/g) || []).length, 2);
}));

test('配套文件缺失', () => fixture(p => {
  unlinkSync(join(p, leaf, 'INPUT.md'));
  bad(p, /缺少配套文件/);
}));

test('配套文件留有待填写占位', () => fixture(p => {
  writeFileSync(join(p, leaf, 'OUTPUT.md'), '# 输出要求\n\n<待填写>\n');
  bad(p, /没写完/);
}));

test('标识重复', () => fixture(p => {
  edit(p, leaf + '/module.json', d => d.id = 'text_checker');
  bad(p, /标识重复/);
}));

test('连接指向未定义接口', () => fixture(p => {
  edit(p, 'connections.json', d => d.connections[0].to.port = 'nope');
  bad(p, /未定义的接口/);
}));

test('连接端点不是本层成员', () => fixture(p => {
  edit(p, 'connections.json', d => d.connections[0].to.module = 'ghost');
  bad(p, /连接端点须是本层成员/);
}));

test('漏掉最终输出连接', () => fixture(p => {
  edit(p, 'connections.json', d => d.connections.pop());
  bad(p, /交付没有接回本层/);
}));

test('反馈回路缺停止条件，补上后通过', () => fixture(p => {
  edit(p, 'connections.json', d => {
    delete d.stop;
    d.connections.push({ from: { module: 'text_checker', port: 'result' }, to: { module: 'text_reorder', port: 'text' }, info: '退回重做', kind: 'return' });
  });
  bad(p, /没写停止条件/);
  edit(p, 'connections.json', d => d.stop = '连续不通过 3 次就停');
  assert.equal(run(p, ['--panorama']).code, 0);
  assert.equal(run(p).code, 0);
}));

test('连接 kind 非法', () => fixture(p => {
  edit(p, 'connections.json', d => d.connections[0].kind = 'main');
  bad(p, /kind 只能取 support 或 return/);
}));

test('verify 路径越界', () => fixture(p => {
  edit(p, leaf + '/module.json', d => d.verify = '../escape.mjs');
  bad(p, /verify 须填本模块内的相对路径/);
}));

test('verify 指向不存在的文件', () => fixture(p => {
  edit(p, leaf + '/module.json', d => d.verify = 'missing.mjs');
  bad(p, /verify 指向的文件不存在/);
}));

test('未知模板版本', () => fixture(p => {
  edit(p, 'module.json', d => d.template.version = '99.0.0');
  bad(p, /模板版本不受支持/);
}));

test('坏 JSON 给出说明', () => fixture(p => {
  writeFileSync(join(p, 'module.json'), '{');
  bad(p, /JSON 无效/);
}));

test('没有 verify 的模块跳过验收，不报错', () => fixture(p => {
  edit(p, leaf + '/module.json', d => delete d.verify);
  const r = run(p, ['--verify']);
  assert.equal(r.code, 0, r.text);
  assert.equal((r.text.match(/✓ 验收通过/g) || []).length, 1);
}));

test('验收脚本失败会让检查失败', () => fixture(p => {
  writeFileSync(join(p, leaf, 'verify.mjs'), 'process.exit(1);');
  bad(p, /验收失败/, ['--verify']);
}));

test('待配置模块被跳过，依赖它的成员和组合也跳过', () => fixture(p => {
  edit(p, leaf + '/module.json', d => d.status = 'pending');
  const r = run(p, ['--verify']);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /跳过验收：modules\/text_reorder（待配置/);
  assert.match(r.text, /跳过验收：\.（待配置/);
  assert.equal((r.text.match(/✓ 验收通过/g) || []).length, 0);
}));

test('全景过期，重新生成后通过', () => fixture(p => {
  edit(p, 'module.json', d => d.name = '改名了');
  bad(p, /项目全景已过期/);
  assert.equal(run(p, ['--panorama']).code, 0);
  assert.equal(run(p).code, 0);
}));

test('README 缺全景时提示生成', () => fixture(p => {
  const path = join(p, 'README.md');
  writeFileSync(path, readFileSync(path, 'utf8').split('## 项目全景')[0]);
  bad(p, /缺项目全景/);
}));

test('文档坏链接', () => fixture(p => {
  writeFileSync(join(p, 'README.md'), readFileSync(join(p, 'README.md'), 'utf8').replace('## 项目全景', '[坏链接](missing.md)\n\n## 项目全景'));
  bad(p, /文档链接缺失/);
}));

test('根目录出现未登记文件', () => fixture(p => {
  writeFileSync(join(p, 'secrets.txt'), 'token');
  bad(p, /未登记的文件或目录：secrets\.txt/);
}));

test('目录联接不能把外部目录当成员', () => fixture(p => {
  const outside = join(dirname(p), 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(p, 'modules/outside'), 'junction');
  bad(p, /路径越界|JSON 无效/);
}));

test('成员不能通过目录联接包含祖先', () => fixture(p => {
  symlinkSync(p, join(p, 'modules/ancestor'), 'junction');
  bad(p, /重复包含/);
}));

test('implementation 不能越过模块目录', () => fixture(p => {
  symlinkSync(join(p, 'modules/text_checker'), join(p, leaf, 'outside'), 'junction');
  edit(p, leaf + '/module.json', d => d.implementation = 'outside/run.mjs');
  bad(p, /implementation 指向的文件不存在或越界/);
}));
