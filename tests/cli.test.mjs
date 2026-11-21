import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repoRoot, 'bin', 'pf.mjs');

function runCli(args, cwd = repoRoot) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 20000 });
  assert.ifError(result.error);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('pf init 创建精简项目骨架且不含引擎代码，pf check 和 pf plan 均通过', () => {
  const base = mkdtempSync(join(tmpdir(), 'pf-cli-'));
  const project = join(base, 'demo');
  try {
    const init = runCli(['init', project]);
    assert.equal(init.code, 0, init.stderr);
    assert.equal(existsSync(join(project, 'AGENTS.md')), true);
    assert.equal(existsSync(join(project, 'modules/project_check/module.json')), true);
    assert.equal(existsSync(join(project, 'modules/workflow_guidance/module.json')), true);
    assert.equal(existsSync(join(project, 'modules/framework_feedback/module.json')), true);
    assert.equal(existsSync(join(project, 'check.mjs')), false);
    assert.equal(existsSync(join(project, 'run.mjs')), false);
    assert.equal(existsSync(join(project, 'canvas')), false);

    const checked = runCli(['check', '--tree'], project);
    assert.equal(checked.code, 0, checked.stdout + checked.stderr);
    assert.match(checked.stdout, /project_check/);
    assert.match(checked.stdout, /结构检查通过/);

    const planned = runCli(['plan'], project);
    assert.equal(planned.code, 0, planned.stderr);
    const plan = JSON.parse(planned.stdout);
    assert.equal(plan.project.id, 'project');
    assert.ok(plan.version);

    const secondInit = runCli(['init', project]);
    assert.notEqual(secondInit.code, 0);
    assert.match(secondInit.stderr, /非空/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('pf run 可执行原生程序模块项目', () => {
  const base = mkdtempSync(join(tmpdir(), 'pf-cli-run-'));
  const project = join(base, 'app');
  try {
    assert.equal(runCli(['init', project]).code, 0);
    const modDir = join(project, 'modules/echo');
    mkdirSync(modDir, { recursive: true });
    writeFileSync(join(modDir, 'module.json'), JSON.stringify({
      id: 'echo', name: '回声', template: { id: 'project-framework', version: '3.0.0' }, status: 'ready', implementation: 'index.mjs',
    }, null, 2));
    writeFileSync(join(modDir, 'README.md'), '# 回声\n\n## 职责\n\n原样返回并加叹号。\n\n## 输入\n\n```interfaces\n[{"name":"text","description":"文字"}]\n```\n\n## 输出\n\n```interfaces\n[{"name":"text","description":"结果"}]\n```\n\n## 处理流程\n\n运行脚本。\n\n## 没完成时\n\n报错。\n');
    writeFileSync(join(modDir, 'VALIDATION.md'), '# 检查标准\n\n- 非空。\n');
    writeFileSync(join(modDir, 'index.mjs'), 'export async function run({ text }) { return { text: text + "!" }; }\n');
    writeFileSync(join(project, 'README.md'), '# 应用\n\n## 职责\n\n测试运行。\n\n## 输入\n\n```interfaces\n[{"name":"text","description":"文字"}]\n```\n\n## 输出\n\n```interfaces\n[{"name":"result","description":"结果"}]\n```\n\n## 处理流程\n\n调用回声。\n\n## 没完成时\n\n报错。\n');
    writeFileSync(join(project, 'connections.json'), JSON.stringify({
      connections: [
        { from: { module: '$self', port: 'text' }, to: { module: 'echo', port: 'text' }, info: '文字' },
        { from: { module: 'echo', port: 'text' }, to: { module: '$self', port: 'result' }, info: '结果' },
      ],
    }, null, 2));

    assert.equal(runCli(['check'], project).code, 0);
    const inputFile = join(base, 'in.json');
    writeFileSync(inputFile, JSON.stringify({ text: 'hello' }));
    const res = runCli(['run', inputFile], project);
    assert.equal(res.code, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.outputs.result, 'hello!');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
