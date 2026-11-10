import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProject, projectVersion } from '../structure.mjs';
import { executionPlan, runProject } from '../run.mjs';
import { createCanvas } from '../canvas/canvas.mjs';

const json = (path,value) => writeFileSync(path,JSON.stringify(value,null,2));
const doc = (inputs,outputs) => '# 模块\n\n## 职责\n\n处理材料。\n\n## 输入\n\n```interfaces\n' + JSON.stringify(inputs.map(name=>({name,description:name}))) + '\n```\n\n## 输出\n\n```interfaces\n' + JSON.stringify(outputs.map(name=>({name,description:name}))) + '\n```\n\n## 处理流程\n\n按连接接力。\n\n## 没完成时\n\n说明原因。\n';
const edge = (from,to,fromPort='text',toPort='text') => ({from:{module:from,port:fromPort},to:{module:to,port:toPort},info:'文字'});
function moduleAt(root,id,body) {
  const dir = join(root,'modules',id); mkdirSync(dir,{recursive:true});
  json(join(dir,'module.json'),{id,name:id,status:'ready',template:{id:'project-framework',version:'3.0.0'},implementation:'run.mjs'});
  writeFileSync(join(dir,'README.md'),doc(['text'],['text']));
  writeFileSync(join(dir,'VALIDATION.md'),'输出正确。');
  writeFileSync(join(dir,'run.mjs'),body);
  return dir;
}
async function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(),'framework-binding-'));
  try {
    json(join(root,'module.json'),{id:'project',name:'项目',status:'ready'});
    writeFileSync(join(root,'README.md'),doc(['text'],['result']));
    moduleAt(root,'a',"export const run = ({text}) => ({text:text+'A'});");
    moduleAt(root,'b',"export const run = ({text}) => ({text:text+'B'});");
    json(join(root,'connections.json'),{connections:[edge('$self','a'),edge('a','b'),edge('b','$self','text','result')]});
    await fn(root);
  } finally {
    assert.equal(join(root,'..'),tmpdir());
    assert.match(root.split(/[\\/]/).at(-1),/^framework-binding-/);
    rmSync(root,{recursive:true,force:true});
  }
}
const updateMeta = (root,id,change) => {
  const path = join(root,'modules',id,'module.json');
  const meta = JSON.parse(readFileSync(path,'utf8')); change(meta); json(path,meta);
};

for (const checkerId of ['project_consistency', 'prompt_readability']) {
  test(`模板检查模块 ${checkerId} 可单独接入 AI，不参与根项目业务调度`, async () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const moduleDir = join(root, 'modules', checkerId);
    const plan = executionPlan(root);
    assert.ok(!plan.project.members.some(member => member.id === checkerId));
    const tree = readProject(root);
    assert.ok(tree.children.some(member => member.id === checkerId));
    assert.ok(!tree.links.some(edge => [edge.from.module, edge.to.module].includes(checkerId)));
    const request = { project:root, scope:'修改后检查', changes:['AGENTS.md'], taskDirectory:join(root,'workspace','consistency-test') };
    let calls = 0;
    const result = await runProject(moduleDir, {request}, {
      executeAI: async ({prompt, values, outputs}) => {
        calls++;
        assert.equal(prompt,readFileSync(join(moduleDir,'implementation','prompt.md'),'utf8'));
        assert.deepEqual(values,{request});
        assert.deepEqual(outputs.map(port=>port.name),['report']);
        return {report:'受控接力结果，仅验证调用关系'};
      },
    });
    assert.equal(calls,1);
    assert.equal(result.outputs.report,'受控接力结果，仅验证调用关系');
  });

}

test('正式画布和实际执行共用同一份连线，改线立即改变接力顺序',()=>fixture(async root=>{
  const server=createCanvas(root);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base='http://127.0.0.1:'+server.address().port;
    const token=(await (await fetch(base)).text()).match(/const TOKEN = '([^']+)'/)[1];
    const snapshot=async()=> (await fetch(base+'/api/project',{headers:{'x-canvas-token':token}})).json();
    const first=await snapshot();
    assert.equal(first.sourceVersion,executionPlan(root).version);
    assert.equal((await runProject(root,{text:'开始'})).outputs.result,'开始AB');
    json(join(root,'connections.json'),{connections:[edge('$self','b'),edge('b','a'),edge('a','$self','text','result')]});
    const second=await snapshot();
    assert.notEqual(first.sourceVersion,second.sourceVersion);
    assert.equal(second.levels.project.links[0].to.module,'b');
    assert.equal((await runProject(root,{text:'开始'})).outputs.result,'开始BA');
    json(join(root,'connections.json'),{connections:[edge('$self','ghost')]});
    const response=await fetch(base+'/api/project',{headers:{'x-canvas-token':token}});
    assert.equal(response.status,400);
    assert.match((await response.json()).error,/连接端点/);
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
}));

test('改接口未改连接时，画布读取和执行同时拒绝',()=>fixture(async root=>{
  writeFileSync(join(root,'modules/a/README.md'),doc(['renamed'],['text']));
  assert.throws(()=>readProject(root),/未定义的接口/);
  await assert.rejects(runProject(root,{text:'x'}),/未定义的接口/);
}));

test('模块输出不符合接口时，下游不能执行',()=>fixture(async root=>{
  writeFileSync(join(root,'modules/a/run.mjs'),"export const run = () => ({wrong:'x'});");
  await assert.rejects(runProject(root,{text:'x'}),/输出缺少接口/);
}));

test('项目漏接任一输出时，在程序写文件前拒绝',()=>fixture(async root=>{
  writeFileSync(join(root,'README.md'),doc(['text'],['result','extra']));
  const marker=join(root,'workspace','written.txt');
  writeFileSync(join(root,'modules/a/run.mjs'),
    "import {writeFileSync,mkdirSync} from 'node:fs'; import {join} from 'node:path'; export const run=({text},c)=>{const p=join(c.directory,'../../workspace');mkdirSync(p,{recursive:true});writeFileSync(join(p,'written.txt'),'changed');return {text};};");
  assert.throws(()=>readProject(root),/输出没有来源/);
  await assert.rejects(runProject(root,{text:'x'}),/输出没有来源/);
  assert.equal(existsSync(marker),false);
}));

test('后续模块缺入口或未完成时，在执行任何本体前拒绝',()=>fixture(async root=>{
  let called=false;
  updateMeta(root,'b',m=>delete m.implementation);
  await assert.rejects(runProject(root,{text:'x'},{executeProgram:()=>{called=true;}}),/缺少执行入口/);
  assert.equal(called,false);
  updateMeta(root,'b',m=>m.status='pending');
  await assert.rejects(runProject(root,{text:'x'}),/尚未完成/);
}));

test('输入必须按正式接口提供，拒绝缺项和额外接口',()=>fixture(async root=>{
  await assert.rejects(runProject(root,{}),/输入缺少接口/);
  await assert.rejects(runProject(root,{text:'x',extra:1}),/未定义的接口/);
}));

test('程序依赖改变后，新的运行读取新代码并使旧计划失效',()=>fixture(async root=>{
  writeFileSync(join(root,'modules/a/part.mjs'),"export const suffix='旧';");
  writeFileSync(join(root,'modules/a/run.mjs'),"import {suffix} from './part.mjs'; export const run=({text})=>({text:text+suffix});");
  const old=executionPlan(root);
  assert.equal((await runProject(root,{text:''})).outputs.result,'旧B');
  writeFileSync(join(root,'modules/a/part.mjs'),"export const suffix='新';");
  await assert.rejects(runProject(root,{text:''},{expectedVersion:old.version}),/已变化/);
  assert.equal((await runProject(root,{text:''})).outputs.result,'新B');
}));

test('运行中底层变化时停止接力，不把旧结果传给下游',()=>fixture(async root=>{
  const called=[];
  await assert.rejects(runProject(root,{text:'x'},{executeProgram:({id,values})=>{
    called.push(id); writeFileSync(join(root,'modules/a/run.mjs'),'// changed'); return values;
  }}),/执行期间正式项目已变化/);
  assert.deepEqual(called,['a']);
}));

test('AI 接入收到正式提示词和接口，不能另传流程',()=>fixture(async root=>{
  updateMeta(root,'a',m=>{m.processor='ai';m.implementation='prompt.md';});
  writeFileSync(join(root,'modules/a/prompt.md'),'把输入加上 AI。');
  const result=await runProject(root,{text:'x'},{executeAI:({prompt,values,outputs})=>{
    assert.equal(prompt,'把输入加上 AI。'); assert.equal(outputs[0].name,'text'); return {text:values.text+'AI'};
  }});
  assert.equal(result.outputs.result,'xAIB');
  await assert.rejects(runProject(root,{text:'x'}),/AI 模块需要接入执行方式/);
}));

test('条件须提供判断，false 不执行该分支，不能忽略条件',()=>fixture(async root=>{
  const links=[edge('$self','$self','text','result'),{...edge('$self','a'),when:'需要处理'}];
  json(join(root,'connections.json'),{connections:links});
  await assert.rejects(runProject(root,{text:'x'}),/条件连线需要/);
  let called=false;
  const result=await runProject(root,{text:'x'},{evaluateWhen:()=>false,executeProgram:()=>{called=true;}});
  assert.equal(result.outputs.result,'x'); assert.equal(called,false);
}));

test('反馈按正式回路重跑，停止条件和次数限制均生效',()=>fixture(async root=>{
  const connections=[edge('$self','a'),edge('a','b'),edge('b','a'),edge('b','$self','text','result')];
  json(join(root,'connections.json'),{connections,stop:'结果长度达到 4'});
  await assert.rejects(runProject(root,{text:''}),/停止条件和停止判断/);
  const result=await runProject(root,{text:''},{shouldStop:({outputs})=>(outputs.result?.length || 0)>=4});
  assert.equal(result.outputs.result,'ABAB');
  await assert.rejects(runProject(root,{text:''},{shouldStop:()=>false,maxSteps:3}),/超过允许的执行次数/);
}));

test('组合按内部连接执行，拒绝组合另设入口绕过成员',()=>fixture(async root=>{
  const combo=join(root,'modules/c'); mkdirSync(combo,{recursive:true});
  json(join(combo,'module.json'),{id:'c',name:'组合',status:'ready'});
  writeFileSync(join(combo,'README.md'),doc(['text'],['text']));
  moduleAt(combo,'inner',"export const run=({text})=>({text:text+'C'});");
  json(join(combo,'connections.json'),{connections:[edge('$self','inner'),edge('inner','$self')]});
  json(join(root,'connections.json'),{connections:[edge('$self','c'),edge('c','b'),edge('b','$self','text','result')]});
  assert.equal((await runProject(root,{text:''})).outputs.result,'CB');
  writeFileSync(join(combo,'alternate.mjs'),'export const run=()=>({text:"bypass"});');
  updateMeta(root,'c',m=>m.implementation='alternate.mjs');
  await assert.rejects(runProject(root,{text:''}),/组合不能另设执行入口/);
}));

test('独立输入输出也通过正式连接传递',()=>fixture(async root=>{
  writeFileSync(join(root,'README.md'),doc([],[]));
  json(join(root,'connections.json'),{ioNodes:[
    {id:'in',type:'input',name:'输入',description:'材料'},
    {id:'out',type:'output',name:'输出',description:'成果'}],
    connections:[edge('in','a','value','text'),edge('a','out','text','value')]});
  const result=await runProject(root,{},{ioInputs:{in:'x'}});
  assert.equal(result.ioOutputs.out,'xA');
  await assert.rejects(runProject(root,{}),/缺少独立输入节点的材料/);
  await assert.rejects(runProject(root,{},{ioInputs:{unknown:'x'}}),/未定义的独立输入节点/);
}));

test('布局和运行数据不改变正式执行版本，本体改变则改变版本',()=>fixture(async root=>{
  const version=projectVersion(readProject(root));
  json(join(root,'canvas-layout.json'),{a:{x:99}});
  mkdirSync(join(root,'workspace')); writeFileSync(join(root,'workspace/result.txt'),'运行数据');
  assert.equal(projectVersion(readProject(root)),version);
  writeFileSync(join(root,'modules/a/run.mjs'),'// changed');
  assert.notEqual(projectVersion(readProject(root)),version);
}));

test('草稿不能绕过正式执行入口',()=>fixture(async root=>{
  const draft=join(root,'.canvas-drafts','sample'); mkdirSync(draft,{recursive:true});
  json(join(draft,'module.json'),{id:'draft',status:'ready',implementation:'run.mjs'});
  writeFileSync(join(draft,'README.md'),doc([],[])); writeFileSync(join(draft,'run.mjs'),'export const run=()=>({});');
  await assert.rejects(runProject(draft,{}),/草稿不能/);
}));

test('本体不返回结果或无限运行时拒绝交付',()=>fixture(async root=>{
  writeFileSync(join(root,'modules/a/run.mjs'),'export const run=()=>{while(true){}};');
  await assert.rejects(runProject(root,{text:'x'},{timeoutMs:200}),/执行超时/);
  writeFileSync(join(root,'modules/a/run.mjs'),'export const run=()=>{process.exit(0)};');
  await assert.rejects(runProject(root,{text:'x'}),/未交付结果即退出/);
}));

test('正式读取拒绝 ready 空壳，pending 可展示但不能执行',()=>fixture(async root=>{
  updateMeta(root,'a',m=>delete m.implementation);
  assert.throws(()=>readProject(root),/缺少执行入口/);
  updateMeta(root,'a',m=>m.status='pending');
  assert.equal(readProject(root).children.find(n=>n.id==='a').meta.status,'pending');
  await assert.rejects(runProject(root,{text:'x'}),/尚未完成/);
}));

test('正式删除清除目录与连线，不再执行被删本体，去掉布局仍能重建画布',()=>fixture(async root=>{
  const workspace=join(root,'workspace'); mkdirSync(workspace);
  const calls=join(workspace,'calls.txt');
  writeFileSync(join(root,'modules/b/run.mjs'),
    "import {appendFileSync} from 'node:fs'; import {join} from 'node:path'; export const run=({text},context)=>{appendFileSync(join(context.directory,'../../workspace/calls.txt'),'B');return {text:text+'B'};};");
  const input={text:'相同材料'};
  assert.equal((await runProject(root,input)).outputs.result,'相同材料AB');
  assert.equal(readFileSync(calls,'utf8'),'B');

  const deleted=join(root,'modules','b');
  assert.equal(deleted,join(root,'modules/b'));
  assert.match(root.split(/[\\/]/).at(-1),/^framework-binding-/);
  rmSync(deleted,{recursive:true});
  // 漏删连线时不能把被删模块当作正常正式版本。
  assert.throws(()=>readProject(root),/连接端点/);
  json(join(root,'connections.json'),{connections:[edge('$self','a'),edge('a','$self','text','result')]});
  json(join(root,'canvas-layout.json'),{project:{a:{x:20,y:20},b:{x:500,y:20}}});

  const server=createCanvas(root);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base='http://127.0.0.1:'+server.address().port;
    const token=(await (await fetch(base)).text()).match(/const TOKEN = '([^']+)'/)[1];
    const snapshot=async()=>{
      const response=await fetch(base+'/api/project',{headers:{'x-canvas-token':token}});
      assert.equal(response.status,200); return response.json();
    };
    const before=await snapshot();
    rmSync(join(root,'canvas-layout.json'));
    const rebuilt=await snapshot();
    assert.deepEqual(rebuilt.levels,before.levels);
    assert.deepEqual(rebuilt.layout,{});
    assert.equal(rebuilt.levels.project.members.some(n=>n.id==='b'),false);
    assert.equal(rebuilt.levels.project.links.some(e=>e.from.module==='b'||e.to.module==='b'),false);
    assert.equal(rebuilt.docs.b,undefined);
    assert.equal(existsSync(deleted),false);
    assert.equal(executionPlan(root).project.members.some(n=>n.id==='b'),false);
    assert.equal((await runProject(root,input)).outputs.result,'相同材料A');
    assert.equal(readFileSync(calls,'utf8'),'B','正式运行不能再次调用被删本体');
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
}));
