import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const source = join(dirname(fileURLToPath(import.meta.url)), '../..');
const leaf = 'modules/_example_combo/modules/_example';
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'framework-v2-test-'));
  const project = join(dir, 'project');
  try { cpSync(source, project, { recursive: true }); fn(project); }
  finally {
    // dir 是本测试刚创建的专用临时目录，绝不对来源目录操作。
    assert.equal(dirname(dir), tmpdir());
    assert.ok(dir.split(/[\\/]/).at(-1).startsWith('framework-v2-test-'));
    rmSync(dir, { recursive: true, force: true });
  }
}
const run = (p, script = 'scripts/check.mjs', args = []) => {
  const result = spawnSync(process.execPath, [join(p, script), ...args], { encoding: 'utf8', timeout: 20000 });
  assert.ifError(result.error);
  return { code: result.status, text: result.stdout + result.stderr };
};
function edit(p, file, change) { const path = join(p, file); const data = JSON.parse(readFileSync(path, 'utf8')); change(data); writeFileSync(path, JSON.stringify(data, null, 2) + '\n'); }
const bad = (p, pattern) => { const result = run(p); assert.notEqual(result.code, 0, result.text); assert.match(result.text, pattern); };
test('完整示例通过，成员及组合各验收一次', () => fixture(p => { const r = run(p, 'scripts/check.mjs', ['--verify']); assert.equal(r.code, 0, r.text); assert.equal((r.text.match(/✓ 验收通过/g) || []).length, 3); }));
test('配套文件缺失', () => fixture(p => { unlinkSync(join(p, leaf, 'INPUT.md')); bad(p, /配套文件缺失/); }));
test('重复标识', () => fixture(p => { edit(p, leaf + '/module.json', d => d.id = 'example-combo'); bad(p, /标识重复/); }));
test('跨层连接端点', () => fixture(p => { edit(p, 'connections.json', d => d.connections[0].to.module = 'example-text'); bad(p, /连接端点不在直接成员/); }));
test('组合漏最终输出', () => fixture(p => { edit(p, 'connections.json', d => d.connections.pop()); bad(p, /最终输出连接/); }));
test('反馈缺停止条件及补上后的结构检查', () => fixture(p => {
  edit(p, 'modules/_example_combo/connections.json', d => d.connections.push({ from: { module: 'example-text', port: 'text' }, to: { module: 'example-text', port: 'text' }, info: '修正', when: '不通过' }));
  bad(p, /反馈回路缺停止条件/);
  edit(p, 'modules/_example_combo/connections.json', d => d.stop = '完成最多 5 次修正后暂停');
  assert.equal(run(p, 'scripts/panorama.mjs').code, 0);
  const r = run(p); assert.equal(r.code, 0, r.text);
}));
test('验收路径越界', () => fixture(p => { edit(p, leaf + '/module.json', d => d.verify = 'implementation/../../escape.mjs'); bad(p, /验收路径须/); }));
test('未知模板版本', () => fixture(p => { edit(p, 'module.json', d => d.template.version = '99.0.0'); bad(p, /模板版本不支持/); }));
test('坏 JSON 清楚报错', () => fixture(p => { writeFileSync(join(p, 'module.json'), '{'); bad(p, /JSON 无效/); }));
test('普通模块无维护验收不强制补测试', () => fixture(p => { edit(p, leaf + '/module.json', d => delete d.verify); const r = run(p, 'scripts/check.mjs', ['--verify']); assert.equal(r.code, 0, r.text); assert.match(r.text, /跳过 1 项/); }));
test('待配置成员阻止依赖组合验收', () => fixture(p => { edit(p, leaf + '/module.json', d => d.status = 'pending'); const r = run(p, 'scripts/check.mjs', ['--verify']); assert.equal(r.code, 0, r.text); assert.equal((r.text.match(/✓ 验收通过/g) || []).length, 0); assert.match(r.text, /跳过 3 项/); }));
test('成员验收失败不执行组合验收', () => fixture(p => { writeFileSync(join(p, leaf, 'implementation/verify.mjs'), 'process.exit(1);'); const r = run(p, 'scripts/check.mjs', ['--verify']); assert.notEqual(r.code, 0); assert.match(r.text, /跳过验收：modules\/_example_combo/); }));
test('全景变旧与文件缺失', () => fixture(p => { edit(p, 'module.json', d => d.name = '改名'); bad(p, /全景未同步/); assert.equal(run(p, 'scripts/panorama.mjs').code, 0); assert.equal(run(p).code, 0); unlinkSync(join(p, 'methodology/overview.svg')); bad(p, /全景未同步/); }));
test('没有全景声明只提示，不伪造或写入', () => fixture(p => { const path = join(p, 'TREE.md'); writeFileSync(path, readFileSync(path, 'utf8').split('## 项目全景')[0]); const r = run(p); assert.equal(r.code, 0, r.text); assert.match(r.text, /建议.*全景/); }));
test('文档坏链接', () => fixture(p => { writeFileSync(join(p, 'README.md'), '[坏链接](missing.md)'); bad(p, /文档链接缺失/); }));
test('待配置模块直接启动也会拒绝', () => fixture(p => { edit(p, leaf + '/module.json', d => d.status = 'pending'); const r = run(p, 'implementation/run.mjs', ['文字。']); assert.notEqual(r.code, 0); assert.match(r.text, /待配置，不得运行/); }));
test('目录联接不能把外部目录当成员', () => fixture(p => {
  const external = join(dirname(p), 'outside');
  mkdirSync(external);
  symlinkSync(external, join(p, 'modules/outside'), 'junction');
  bad(p, /路径越界/);
}));
test('成员不能通过目录联接包含祖先', () => fixture(p => {
  symlinkSync(p, join(p, 'modules/ancestor'), 'junction');
  bad(p, /重复包含/);
}));
test('验收脚本链接不能越过模块目录', () => fixture(p => {
  symlinkSync(join(p, 'implementation'), join(p, leaf, 'implementation/outside'), 'junction');
  edit(p, leaf + '/module.json', d => d.verify = 'implementation/outside/verify.mjs');
  bad(p, /验收脚本缺失或越界/);
}));
test('旧格式仍使用原校验器', () => fixture(p => {
  // 从新版夹具清理成独立最小旧格式项目；旧版结构规则不被新版解释。
  unlinkSync(join(p, 'module.json'));
  const write = (name, text) => { mkdirSync(dirname(join(p, name)), {recursive:true}); writeFileSync(join(p, name), text); };
  // 旧检查允许的根目录以位置表登记；旧根专用文件作为明确项目文档保留不参与模块解析。
  for (const name of ['INPUT.md','OUTPUT.md','PROCESS.md','VALIDATION.md','connections.json']) unlinkSync(join(p, name));
  rmSync(join(p, 'modules'), {recursive:true,force:true});
  write('AGENTS.md', '# 旧项目\n');
  write('state/tasks.json', '{"tasks":[]}');
  write('TREE.md', '# 模块清单\n\n## 位置\n\n| 职责 | 目录 |\n| --- | --- |\n| 模块 | modules |\n| 状态 | state |\n| 文档 | methodology |\n| 方法 | methodology |\n| 实现 | implementation |\n| 设置 | settings |\n\n## 模块\n\n| 模块 | 状态 |\n| --- | --- |\n| old | 实验中 |\n');
  write('modules/old/README.md', '# old\n\n## 输入\n文字。\n从哪来：外部\n\n## 输出\n文字。\n\n## 谁处理\n程序：implementation/verify.mjs\n\n## 什么时候跑\n手动。\n\n## 怎么算做对\n保持文字。\n验收命令：node modules/old/verify.mjs\n\n## 失败怎么办\n停止。\n');
  write('modules/old/verify.mjs', 'console.log("旧版通过");');
  const r = run(p, 'scripts/check.mjs', ['--verify']); assert.equal(r.code, 0, r.text); assert.match(r.text, /验收 1 条/);
}));
