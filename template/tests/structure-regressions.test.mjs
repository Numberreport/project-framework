import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readProject, projectVersion } from '../structure.mjs';
import { executionPlan, runProject } from '../run.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2));
const metadata = id => ({ id, name:id, status:'ready', template:{ id:'project-framework', version:'3.0.0' } });
const doc = (output = 'text') => '# 模块\n\n## 职责\n\n处理材料。\n\n' +
  '## 输入\n\n```interfaces\n[{"name":"text","description":"待处理材料"}]\n```\n\n' +
  '## 输出\n\n```interfaces\n[{"name":' + JSON.stringify(output) + ',"description":"处理结果"}]\n```\n\n' +
  '## 处理流程\n\n处理后交付。\n\n## 没完成时\n\n说明缺项。\n';
const edge = (from, to, toPort = 'text') => ({ from:{module:from,port:'text'}, to:{module:to,port:toPort}, info:'材料' });

async function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'framework-structure-regression-'));
  try {
    for (const file of ['check.mjs', 'structure.mjs', 'run.mjs', 'workflow.mjs']) copyFileSync(join(source,file),join(root,file));
    writeFileSync(join(root,'AGENTS.md'),'# 项目规则\n\n按登记接口执行。\n');
    writeFileSync(join(root,'VALIDATION.md'),'# 检查标准\n\n交付处理结果。\n');
    writeFileSync(join(root,'README.md'),doc('result'));
    json(join(root,'module.json'),metadata('project'));
    for (const id of ['a','b']) {
      const dir = join(root,'modules',id); mkdirSync(dir,{recursive:true});
      json(join(dir,'module.json'),{...metadata(id),implementation:'run.mjs'});
      writeFileSync(join(dir,'README.md'),doc());
      writeFileSync(join(dir,'VALIDATION.md'),'# 检查标准\n\n输出正确。\n');
      writeFileSync(join(dir,'run.mjs'),`export const run=({text})=>({text:text+'${id.toUpperCase()}'});`);
    }
    json(join(root,'connections.json'),{connections:[edge('$self','a'),edge('a','b'),edge('b','$self','result')]});
    await fn(root);
  } finally {
    assert.equal(dirname(root),tmpdir());
    assert.ok(basename(root).startsWith('framework-structure-regression-'));
    rmSync(root,{recursive:true,force:true});
  }
}

function check(root) {
  const result = spawnSync(process.execPath,[join(root,'check.mjs')],{encoding:'utf8',timeout:20000});
  assert.ifError(result.error);
  assert.equal(result.status,0,result.stdout + result.stderr);
}

function compiledEntry(root, directory) {
  const moduleDir = join(root,'modules/a');
  const dir = join(moduleDir,directory); mkdirSync(dir,{recursive:true});
  json(join(moduleDir,'module.json'),{...metadata('a'),implementation:directory + '/run.mjs'});
  writeFileSync(join(dir,'part.mjs'),"export const suffix='旧';");
  writeFileSync(join(dir,'run.mjs'),"import {suffix} from './part.mjs'; export const run=({text})=>({text:text+suffix});");
  return dir;
}

const markdownCases = [
  ['制表符标题', text => text.replaceAll('## ','##\t')],
  ['围栏中的伪标题', text => text.replace('## 输入', '~~~markdown\n## 输入\n~~~\n\n## 输入\n\n```markdown\n## 输出\n```')],
  ['注释中的伪标题', text => text.replace('## 输入', '<!--\n## 输入\n-->\n\n## 输入\n\n<!--\n## 输出\n-->')],
];
for (const [name, rewrite] of markdownCases) {
  test(name + '在结构检查、共用读取和实际执行中保持一致',()=>fixture(async root=>{
    for (const dir of [root,join(root,'modules/a')]) {
      const path = join(dir,'README.md');writeFileSync(path,rewrite(readFileSync(path,'utf8')));
    }
    check(root);
    const tree = readProject(root);
    assert.deepEqual(tree.inputs.map(port=>port.name),['text']);
    assert.deepEqual(tree.outputs.map(port=>port.name),['result']);
    assert.equal((await runProject(root,{text:'输入'})).outputs.result,'输入AB');
  }));
}

for (const directory of ['dist','build']) {
  test(directory + ' 中已登记本体及其依赖改变后拒绝旧计划',()=>fixture(async root=>{
    const dir = compiledEntry(root,directory);
    check(root);
    const old = executionPlan(root);
    assert.equal((await runProject(root,{text:'输入'})).outputs.result,'输入旧B');
    writeFileSync(join(dir,'part.mjs'),"export const suffix='新';");
    await assert.rejects(runProject(root,{text:'输入'},{expectedVersion:old.version}),/已变化/);
    assert.equal((await runProject(root,{text:'输入'})).outputs.result,'输入新B');
    const current = executionPlan(root);
    writeFileSync(join(dir,'run.mjs'),"export const run=({text})=>({text:text+'更新本体'});");
    await assert.rejects(runProject(root,{text:'输入'},{expectedVersion:current.version}),/已变化/);
  }));
}

test('运行中构建目录内依赖改变时阻断下游',()=>fixture(async root=>{
  const dir = compiledEntry(root,'dist');
  const calls = [];
  await assert.rejects(runProject(root,{text:'输入'},{executeProgram:({id,values})=>{
    calls.push(id);
    writeFileSync(join(dir,'part.mjs'),"export const suffix='运行中改动';");
    return values;
  }}),/执行期间正式项目已变化/);
  assert.deepEqual(calls,['a']);
}));

test('本体目录内的嵌套构建依赖仍参与版本，普通构建目录保持排除',()=>fixture(async root=>{
  const dir = compiledEntry(root,'dist');
  mkdirSync(join(dir,'build'));
  writeFileSync(join(dir,'build/part.mjs'),"export const suffix='嵌套旧';");
  writeFileSync(join(dir,'run.mjs'),"import {suffix} from './build/part.mjs'; export const run=({text})=>({text:text+suffix});");
  const old = executionPlan(root);
  writeFileSync(join(dir,'build/part.mjs'),"export const suffix='嵌套新';");
  await assert.rejects(runProject(root,{text:'输入'},{expectedVersion:old.version}),/已变化/);
  const current = executionPlan(root);
  mkdirSync(join(root,'build'));writeFileSync(join(root,'build/report.txt'),'普通构建输出');
  assert.equal(executionPlan(root).version,current.version);
}));

test('普通 venv、构建目录和运行数据不改变版本，也不会中断接力',()=>fixture(async root=>{
  const old = executionPlan(root);
  for (const directory of ['venv','.venv','dist','build','workspace']) {
    mkdirSync(join(root,directory));writeFileSync(join(root,directory,'state.txt'),'初始环境');
  }
  assert.equal(projectVersion(readProject(root)),old.version);
  const calls = [];
  const result = await runProject(root,{text:'输入'},{expectedVersion:old.version,executeProgram:({id,values})=>{
    calls.push(id);
    writeFileSync(join(root,'venv/state.txt'),id);
    return {text:values.text + id.toUpperCase()};
  }});
  assert.deepEqual(calls,['a','b']);
  assert.equal(result.outputs.result,'输入AB');
}));
