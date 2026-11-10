import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = join(dirname(fileURLToPath(import.meta.url)), '..');
const leaf = 'modules/a';

// 模板不带示例模块，每个用例先建两个最小模块和连好它们。
// 模块写 README（四段，接口分两条）和 VALIDATION.md。
const README = '# 模块\n\n## 职责\n\n处理一段文字，交给下一个模块。\n\n' +
  '## 输入\n\n接收 text：待处理的文字。\n\n```interfaces\n[{ "name": "text", "description": "待处理的文字" }]\n```\n\n' +
  '## 输出\n\n交付 text：处理后的文字。\n\n```interfaces\n[{ "name": "text", "description": "处理后的文字" }]\n```\n\n' +
  '## 处理流程\n\n1. 读取输入，处理一次，交出结果。\n\n' +
  '## 没完成时\n\n缺材料就停下来问，说清卡在哪。\n';
const VALIDATION = '# 检查标准\n\n- 输出非空。\n';
// 根目录的 README 按五段写，接口放在「输入」「输出」里，和模块一样。
const ROOT_README = '# 项目\n\n## 职责\n\n把输入经两个模块处理后交回。\n\n' +
  '## 输入\n\n接收 text：待处理的文字。\n\n```interfaces\n[{ "name": "text", "description": "待处理的文字" }]\n```\n\n' +
  '## 输出\n\n交付 result：处理结果。\n\n```interfaces\n[{ "name": "result", "description": "处理结果" }]\n```\n\n' +
  '## 处理流程\n\n先生成，后处理。\n\n## 没完成时\n\n缺材料就停下来问。\n';
const FILES = { 'README.md': README, 'VALIDATION.md': VALIDATION };
const addModule = (p, id, name, extra = {}) => {
  const dir = join(p, 'modules', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'module.json'), JSON.stringify({ id, name, template: { id: 'project-framework', version: '3.0.0' }, status: 'ready', implementation:'README.md', ...extra }, null, 2) + '\n');
  for (const [file, text] of Object.entries(FILES)) writeFileSync(join(dir, file), text);
};
const seed = (p) => {
  addModule(p, 'a', '甲');
  addModule(p, 'b', '乙');
  // 根目录的 README 换成用例自己的五段和接口。
  writeFileSync(join(p, 'README.md'), ROOT_README);
  writeFileSync(join(p, 'connections.json'), JSON.stringify({
    connections: [
      { from: { module: '$self', port: 'text' }, to: { module: 'a', port: 'text' }, info: '原始文字' },
      { from: { module: 'a', port: 'text' }, to: { module: 'b', port: 'text' }, info: '中间结果' },
      { from: { module: 'b', port: 'text' }, to: { module: '$self', port: 'result' }, info: '最终结果' },
    ],
  }, null, 2) + '\n');
};

// 每个用例在独立临时目录里跑，不碰模板本体。
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'framework-check-'));
  const project = join(dir, 'project');
  try {
    cpSync(source, project, { recursive: true, filter: path => !['runs', 'outputs', 'node_modules', 'tests', '.git', '.canvas-drafts'].includes(basename(path)) && (dirname(path) !== join(source, 'modules') || ['framework_feedback', 'ai_example', 'project_consistency', 'prompt_readability'].includes(basename(path))) });
    seed(project);
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

test('两个模块各验收一次', () => fixture(p => {
  for (const id of ['a', 'b']) {
    edit(p, 'modules/' + id + '/module.json', d => d.verify = 'verify.mjs');
    writeFileSync(join(p, 'modules', id, 'verify.mjs'), 'process.exit(0);');
  }
  const r = run(p, ['--verify']);
  assert.equal(r.code, 0, r.text);
  assert.equal((r.text.match(/✓ 验收通过/g) || []).length, 2);
}));

test('配套文件缺失', () => fixture(p => {
  unlinkSync(join(p, leaf, 'README.md'));
  bad(p, /缺少配套文件.*README\.md/);
}));

test('缺检查标准文件', () => fixture(p => {
  unlinkSync(join(p, leaf, 'VALIDATION.md'));
  bad(p, /缺少配套文件.*VALIDATION\.md/);
}));

test('README 缺一段', () => fixture(p => {
  const path = join(p, leaf, 'README.md');
  writeFileSync(path, readFileSync(path, 'utf8').split('## 输出')[0] + '## 处理流程\n\n一次。\n');
  bad(p, /README 缺标题「输出」/);
}));

test('输入里写了两块接口', () => fixture(p => {
  const path = join(p, leaf, 'README.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace('## 输出', '```interfaces\n[{ "name": "x", "description": "多写一块" }]\n```\n\n## 输出'));
  bad(p, /接口定义只能有一块/);
}));

test('把输出接口写到「输入」里就接不上', () => fixture(p => {
  // 去掉「输出」里那块接口，a 就没有对外交出的 text，a → b 的连接接不上。
  const path = join(p, leaf, 'README.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace(/```interfaces\n\[\{ "name": "text", "description": "处理后的文字" \}\]\n```\n/, ''));
  bad(p, /未定义的接口/);
}));

test('配套文件留有待填写占位', () => fixture(p => {
  writeFileSync(join(p, leaf, 'VALIDATION.md'), '# 检查标准\n\n<待填写>\n');
  bad(p, /没写完/);
}));

test('标识重复', () => fixture(p => {
  edit(p, leaf + '/module.json', d => d.id = 'b');
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
    d.connections.push({ from: { module: 'b', port: 'text' }, to: { module: 'a', port: 'text' }, info: '退回重做', kind: 'return' });
  });
  bad(p, /没写停止条件/);
  edit(p, 'connections.json', d => d.stop = '连续不通过 3 次就停');
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
  const r = run(p, ['--verify']);
  assert.equal(r.code, 0, r.text);
  assert.equal((r.text.match(/✓ 验收通过/g) || []).length, 0);
}));

test('验收脚本失败会让检查失败', () => fixture(p => {
  edit(p, leaf + '/module.json', d => d.verify = 'verify.mjs');
  writeFileSync(join(p, leaf, 'verify.mjs'), 'process.exit(1);');
  bad(p, /验收失败/, ['--verify']);
}));

test('待配置模块被跳过，依赖它的成员和组合也跳过', () => fixture(p => {
  edit(p, leaf + '/module.json', d => d.status = 'pending');
  const r = run(p, ['--verify']);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /跳过验收：modules\/a（待配置/);
  assert.match(r.text, /跳过验收：\.（待配置/);
  assert.equal((r.text.match(/✓ 验收通过/g) || []).length, 0);
}));

test('文档坏链接', () => fixture(p => {
  writeFileSync(join(p, 'AGENTS.md'), readFileSync(join(p, 'AGENTS.md'), 'utf8') + '\n[坏链接](missing.md)\n');
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
  symlinkSync(join(p, 'modules/b'), join(p, leaf, 'outside'), 'junction');
  edit(p, leaf + '/module.json', d => d.implementation = 'outside/run.mjs');
  bad(p, /implementation 指向的文件不存在或越界/);
}));
