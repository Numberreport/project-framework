import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { applyPack, combinationFiles, planPack } from '../canvas.mjs';
import { readProject } from '../../structure.mjs';
import { runProject } from '../../run.mjs';

const source = join(dirname(fileURLToPath(import.meta.url)), '../..');
const edge = (from, to, when) => ({
  from: { module: from, port: 'text' }, to: { module: to, port: to === '$self' ? 'result' : 'text' },
  info: '传递文字', ...(when ? { when } : {}),
});
const document = (id, root = false) => `# ${id}

## 职责

处理文字并交付。

## 输入

\`\`\`interfaces
[{"name":"text","description":"输入文字"}]
\`\`\`

## 输出

\`\`\`interfaces
[{"name":"${root ? 'result' : 'text'}","description":"处理结果"}]
\`\`\`

## 处理流程

按接口处理后交付。

## 没完成时

缺少材料时停止并说明。
`;

function filesAt(root) {
  const result = {};
  const walk = (dir, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name, path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, name + '/');
      else result[name] = readFileSync(path).toString('base64');
    }
  };
  walk(root);
  return result;
}

async function fixture(run) {
  const workspace = join(source, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const root = mkdtempSync(join(workspace, 'framework-pack-'));
  try {
    const moduleAt = (path, id, combo = false) => {
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, 'module.json'), JSON.stringify({
        id, name: id, template: { id: 'project-framework', version: '3.0.0' }, status: 'ready',
        ...(!combo ? { implementation: 'README.md' } : {}),
      }));
      writeFileSync(join(path, 'README.md'), document(id, combo));
      writeFileSync(join(path, 'VALIDATION.md'), '# 检查标准\n\n输出符合接口要求。\n');
    };
    moduleAt(root, 'root', true);
    for (const id of ['a', 'b', 'c', 'd']) moduleAt(join(root, 'modules', id), id);
    writeFileSync(join(root, 'AGENTS.md'), '# 项目\n\n按正式模块和连接执行。\n');
    writeFileSync(join(root, 'connections.json'), JSON.stringify({ connections: [edge('$self', 'a'), edge('a', 'b'), edge('b', '$self')] }));
    for (const entry of readdirSync(source)) if (entry.endsWith('.mjs')) cpSync(join(source, entry), join(root, entry));
    await run(root);
  } finally {
    assert.ok(root.startsWith(join(workspace, 'framework-pack-')));
    rmSync(root, { recursive: true, force: true });
  }
}

const selection = { parentId: 'root', memberIds: ['a', 'b'], id: 'flow', name: '处理组合' };

test('涉及输入、输出或内部条件边的选区在写盘前拒绝，项目文件完全不变', () => fixture(root => {
  const variants = [
    [edge('$self', 'a', 'alpha'), edge('$self', 'b', 'beta'), edge('a', '$self'), edge('b', '$self')],
    [edge('$self', 'a'), edge('a', 'b', '继续处理'), edge('b', '$self')],
    [edge('$self', 'a'), edge('a', 'b'), edge('b', '$self', '允许交付')],
  ];
  for (const connections of variants) {
    writeFileSync(join(root, 'connections.json'), JSON.stringify({ connections }));
    const before = filesAt(root);
    assert.throws(() => planPack(readProject(root), selection), /包含条件连线的选区暂不支持自动组成组合/);
    assert.deepEqual(filesAt(root), before);
    assert.equal(existsSync(join(root, 'modules/flow')), false);
  }
}));

test('无关条件边不阻止打包，正常接力结果保持一致', () => fixture(async root => {
  const file = join(root, 'connections.json'), record = JSON.parse(readFileSync(file));
  record.connections.push(edge('$self', 'c', '无关分支'), edge('c', 'd'));
  writeFileSync(file, JSON.stringify(record));
  const options = { executeAI: async ({ id, values }) => ({ text: values.text + ':' + id }), evaluateWhen: async () => false };
  const before = await runProject(root, { text: '材料' }, options);
  const tree = readProject(root), plan = planPack(tree, selection);
  applyPack(tree, plan);
  const afterRecord = JSON.parse(readFileSync(file));
  assert.deepEqual(afterRecord.connections.find(e => e.when), record.connections.find(e => e.when));
  const metadata = join(root, 'modules/flow/module.json'), meta = JSON.parse(readFileSync(metadata));
  meta.status = 'ready';
  writeFileSync(metadata, JSON.stringify(meta));
  const after = await runProject(root, { text: '材料' }, options);
  assert.deepEqual(after.outputs, before.outputs);
  assert.deepEqual(after.outputs, { result: '材料:a:b' });
}));

test('生成的待配置组合通过真实结构检查并明确缺项处理', () => fixture(root => {
  const tree = readProject(root), plan = planPack(tree, selection);
  const files = combinationFiles(plan);
  assert.match(files['README.md'], /## 没完成时\s+当前组合为待配置状态，不得运行/);
  applyPack(tree, plan);
  const result = spawnSync(process.execPath, [join(root, 'check.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(readFileSync(join(root, 'modules/flow/module.json'))).status, 'pending');
}));

function linkedFixture(root) {
  const append = (file, text) => writeFileSync(file, readFileSync(file, 'utf8') + '\n' + text + '\n');
  append(join(root, 'README.md'), '[模块 A](modules/a/README.md#职责)');
  append(join(root, 'AGENTS.md'), '[模块 B](modules/b/README.md)');
  append(join(root, 'modules/c/README.md'), '[模块 A](../a/README.md)');
  append(join(root, 'modules/a/README.md'), '[根说明](../../README.md)\n[模块 B](../b/README.md)');
  mkdirSync(join(root, 'workspace'), { recursive: true });
  writeFileSync(join(root, 'workspace/record.md'), '[旧记录](../modules/a/README.md)');
}

test('打包同步内外文档的双向引用，保留锚点并排除运行数据', () => fixture(root => {
  linkedFixture(root);
  for (const directory of ['runs', 'outputs', 'venv']) {
    mkdirSync(join(root, directory));
    writeFileSync(join(root, directory, 'record.md'), '[旧记录](../modules/a/README.md)');
  }
  const tree = readProject(root), result = applyPack(tree, planPack(tree, selection));
  const read = file => readFileSync(join(root, file), 'utf8');
  assert.match(read('README.md'), /\(modules\/flow\/modules\/a\/README\.md#职责\)/);
  assert.match(read('AGENTS.md'), /\(modules\/flow\/modules\/b\/README\.md\)/);
  assert.match(read('modules/c/README.md'), /\(\.\.\/flow\/modules\/a\/README\.md\)/);
  assert.match(read('modules/flow/modules/a/README.md'), /\(\.\.\/\.\.\/\.\.\/\.\.\/README\.md\)/);
  assert.match(read('modules/flow/modules/a/README.md'), /\(\.\.\/b\/README\.md\)/);
  for (const directory of ['workspace', 'runs', 'outputs', 'venv']) {
    assert.equal(read(directory + '/record.md'), '[旧记录](../modules/a/README.md)');
  }
  assert.equal(result.links.length, 4);
  // 旧运行目录不是模板登记文件。单独核对跳过行为后，检查正式组合结构。
  for (const directory of ['runs', 'outputs', 'venv']) {
    rmSync(join(root, directory, 'record.md'));
    rmdirSync(join(root, directory));
  }
  const check = spawnSync(process.execPath, [join(root, 'check.mjs')], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stdout + check.stderr);
}));

test('外部文档改写中途失败，已改文档、连接和模块目录全部恢复', () => fixture(root => {
  linkedFixture(root);
  const before = filesAt(root), tree = readProject(root), plan = planPack(tree, selection);
  let failed = false, externalWrites = 0;
  const write = (path, contents) => {
    if (!failed && [join(root, 'AGENTS.md'), join(root, 'README.md'), join(root, 'modules/c/README.md')].includes(path)) {
      if (++externalWrites === 3) { failed = true; throw Error('模拟外部文档写入失败'); }
    }
    writeFileSync(path, contents);
  };
  assert.throws(() => applyPack(tree, plan, { write }), /模拟外部文档写入失败/);
  assert.equal(externalWrites, 3);
  assert.deepEqual(filesAt(root), before);
  assert.equal(existsSync(join(root, 'modules/flow')), false);
}));
