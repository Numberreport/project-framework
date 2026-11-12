import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyProjectFiles, replacePorts } from '../canvas.mjs';
import { projectVersion, readPorts, readProject } from '../../structure.mjs';

const doc = '# 模块\n\n## 职责\n\n处理输入。\n\n## 输入\n\n```interfaces\n[{"name":"text","description":"文字"}]\n```\n\n## 输出\n\n```interfaces\n[]\n```\n\n## 处理流程\n\n执行处理。\n\n## 没完成时\n\n停止并说明。\n';

test('编辑接口使用真实章节，保留围栏、注释中的伪标题及 tab 标题', () => {
  const examples = '~~~markdown\n## 输入\n~~~\n\n<!--\n## 输入\n-->\n\n';
  const before = doc.replace('## 输入', examples + '##\t输入').replace('## 输出', '##\t输出');
  const after = replacePorts(before, '输入', [{ name: 'changed', description: '改名后的文字' }]);
  assert.deepEqual(readPorts(after, '输入'), [{ name: 'changed', description: '改名后的文字' }]);
  assert.ok(after.includes(examples));
  assert.ok(after.includes('##\t输入'));
  assert.equal(after.slice(after.indexOf('##\t输出')), before.slice(before.indexOf('##\t输出')));
  assert.equal(after.slice(0, after.indexOf('##\t输入')), before.slice(0, before.indexOf('##\t输入')));
});

async function fixture(run) {
  const workspace = join(dirname(fileURLToPath(import.meta.url)), '../../workspace');
  mkdirSync(workspace, { recursive: true });
  const directory = mkdtempSync(join(workspace, 'framework-copy-'));
  try {
    const root = join(directory, 'formal'), target = join(directory, 'draft');
    mkdirSync(root);
    writeFileSync(join(root, 'README.md'), doc);
    writeFileSync(join(root, 'VALIDATION.md'), '# 检查标准\n\n输出符合接口。');
    writeFileSync(join(root, 'module.json'), JSON.stringify({ id: 'root', name: '模块', status: 'ready', implementation: 'README.md' }));
    await run(root, target);
  } finally {
    assert.ok(directory.startsWith(join(workspace, 'framework-copy-')));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('草稿保留登记在 dist 或 build 的本体与依赖，排除普通环境目录且版本一致', () => fixture((root, target) => {
  for (const entryDirectory of ['dist', 'build']) {
    const main = join(root, entryDirectory);
    mkdirSync(main, { recursive: true });
    writeFileSync(join(main, 'run.mjs'), 'export async function run() { return {}; }');
    writeFileSync(join(main, 'helper.mjs'), 'export const value = 1;');
    mkdirSync(join(root, 'venv'), { recursive: true });
    writeFileSync(join(root, 'venv/environment.txt'), 'local environment');
    writeFileSync(join(root, 'canvas-layout.json'), '{"root":{"x":10}}');
    const metadata = JSON.parse(readFileSync(join(root, 'module.json')));
    metadata.implementation = entryDirectory + '/run.mjs';
    writeFileSync(join(root, 'module.json'), JSON.stringify(metadata));
    const tree = readProject(root), destination = join(target, entryDirectory);
    copyProjectFiles(tree, destination);
    assert.ok(existsSync(join(destination, entryDirectory, 'run.mjs')));
    assert.equal(readFileSync(join(destination, entryDirectory, 'helper.mjs'), 'utf8'), 'export const value = 1;');
    assert.equal(existsSync(join(destination, 'venv')), false);
    assert.equal(readFileSync(join(destination, 'canvas-layout.json'), 'utf8'), '{"root":{"x":10}}');
    assert.equal(projectVersion(readProject(destination)), projectVersion(tree));
  }
}));

test('凭据与旧运行目录均不复制，也不造成正式项目和草稿的版本差异', () => fixture((root, target) => {
  const sensitive = ['credentials.json', 'secrets.json', '.env', 'local.pem', 'local.key'];
  for (const file of sensitive) writeFileSync(join(root, file), 'fixture only');
  for (const directory of ['runs', 'outputs']) {
    mkdirSync(join(root, directory));
    writeFileSync(join(root, directory, 'record.txt'), 'fixture only');
  }
  copyProjectFiles(readProject(root), target);
  for (const file of [...sensitive, 'runs', 'outputs']) assert.equal(existsSync(join(target, file)), false, file);
  assert.equal(projectVersion(readProject(target)), projectVersion(readProject(root)));
  const manifest = join(root, 'module.json');
  const metadata = JSON.parse(readFileSync(manifest, 'utf8'));
  writeFileSync(manifest, JSON.stringify({...metadata, rootFiles: ['outputs']}));
  const registeredDraft = join(target, '..', 'registered-draft');
  copyProjectFiles(readProject(root), registeredDraft);
  assert.equal(readFileSync(join(registeredDraft, 'outputs/record.txt'), 'utf8'), 'fixture only');
  assert.equal(projectVersion(readProject(registeredDraft)), projectVersion(readProject(root)));
  assert.ok(existsSync(join(target, 'README.md')));
}));


test('Windows 换行的说明书编辑输入后仍能编辑输出，兼容混合换行',()=>{
  const before=doc.replaceAll('\n','\r\n');
  const updated=replacePorts(replacePorts(before,'输入',[{name:'new_input',description:'新材料'}]),'输出',[{name:'result',description:'结果'}]);
  assert.deepEqual(readPorts(updated,'输入'),[{name:'new_input',description:'新材料'}]);
  assert.deepEqual(readPorts(updated,'输出'),[{name:'result',description:'结果'}]);
});
