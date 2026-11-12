import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProject, projectVersion } from '../structure.mjs';
import { executionPlan, runProject } from '../run.mjs';
import { spawnSync } from 'node:child_process';
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


const settings = (root,mode='key',checkpoints=['a']) => {
  const path=join(root,'module.json'),meta=JSON.parse(readFileSync(path,'utf8'));
  json(path,{...meta,guidance:{mode,checkpoints}});
};
const task = root => ({taskDirectory:join(root,'workspace','task')});
const approve = pending => ({action:'approve',token:pending.token});

test('暂停阻断下游；重复读取、确认恢复与完成后恢复均不重跑本体',()=>fixture(async root=>{
  settings(root); const calls=[];
  const options={...task(root),executeProgram:({id,values})=>{calls.push(id);return {text:values.text+id};}};
  const first=await runProject(root,{text:'x'},options);
  assert.equal(first.status,'waiting');assert.equal(first.pending.outputs.text,'xa');assert.deepEqual(calls,['a']);
  const again=await runProject(root,{text:'x'},{...options,resume:true});
  assert.equal(again.pending.token,first.pending.token);assert.deepEqual(calls,['a']);
  const done=await runProject(root,{text:'x'},{...options,resume:true,decision:approve(first.pending)});
  assert.equal(done.status,'completed');assert.equal(done.outputs.result,'xab');assert.deepEqual(calls,['a','b']);
  assert.equal((await runProject(root,{text:'x'},{...options,resume:true})).outputs.result,'xab');
  assert.deepEqual(calls,['a','b']);
  await assert.rejects(runProject(root,{text:'x'},{...options,resume:true,decision:approve(first.pending)}),/失效/);
}));

test('退回当前成果时重做该步、换确认标识，先前步骤不会重跑',()=>fixture(async root=>{
  settings(root,'key',['b']);const calls=[];
  const options={...task(root),executeProgram:({id,values})=>{calls.push(id);return {text:values.text+id};}};
  const first=await runProject(root,{text:'x'},options);
  const revised=await runProject(root,{text:'x'},{...options,resume:true,decision:{action:'revise',token:first.pending.token,inputs:{text:'new'}}});
  assert.deepEqual(calls,['a','b','b']);assert.equal(revised.pending.outputs.text,'newb');assert.notEqual(revised.pending.token,first.pending.token);
  await assert.rejects(runProject(root,{text:'x'},{...options,resume:true,decision:approve(first.pending)}),/失效/);
  const done=await runProject(root,{text:'x'},{...options,resume:true,decision:approve(revised.pending)});
  assert.equal(done.outputs.result,'newb');assert.deepEqual(calls,['a','b','b']);
}));

test('任务、模式、输入与正式版本隔离；存档丢失、篡改和错误接口拒绝恢复',()=>fixture(async root=>{
  settings(root); const options=task(root), input={text:'x'};
  const first=await runProject(root,input,options);
  await assert.rejects(runProject(root,input,options),/任务已存在/);
  await assert.rejects(runProject(root,input,{...options,resume:true,confirmationMode:'none'}),/已变化/);
  await assert.rejects(runProject(root,{text:'different'},{...options,resume:true}),/已变化/);
  await assert.rejects(runProject(root,input,{...options,resume:true,decision:{action:'revise',token:first.pending.token,inputs:{wrong:1}}}),/接口/);
  await assert.rejects(runProject(root,input,{taskDirectory:join(root,'workspace','missing'),resume:true}),/缺失/);
  const another=await runProject(root,input,{taskDirectory:join(root,'workspace','another')});
  assert.notEqual(another.pending.token,first.pending.token);
  const state=JSON.parse(readFileSync(first.stateFile,'utf8'));state.state.pending.outputs.text='changed';json(first.stateFile,state);
  await assert.rejects(runProject(root,input,{...options,resume:true}),/损坏/);
  writeFileSync(join(root,'modules/a/run.mjs'),'// changed');
  await assert.rejects(runProject(root,input,{taskDirectory:join(root,'workspace','another'),resume:true}),/已变化/);
}));

test('三种确认模式可选；未配置仍保持原返回值；配置无效时启动前拒绝',()=>fixture(async root=>{
  const legacy=await runProject(root,{text:''});assert.equal(legacy.status,undefined);
  settings(root,'none',[]);assert.equal((await runProject(root,{text:''},task(root))).status,'completed');
  settings(root,'all',[]);
  assert.equal((await runProject(root,{text:''},{confirmationMode:'none'})).outputs.result,'AB');
  await assert.rejects(runProject(root,{text:''}),/taskDirectory/);
  let result=await runProject(root,{text:''},{taskDirectory:join(root,'workspace','all')});
  assert.equal(result.pending.module,'a');
  result=await runProject(root,{text:''},{taskDirectory:join(root,'workspace','all'),resume:true,decision:approve(result.pending)});
  assert.equal(result.pending.module,'b');
  result=await runProject(root,{text:''},{taskDirectory:join(root,'workspace','all'),resume:true,decision:approve(result.pending)});
  assert.equal(result.status,'completed');
  settings(root,'key',['missing']);assert.throws(()=>readProject(root),/流程引导设置无效/);
}));

test('结果不明、超时与执行失败均停止，不重复外部操作；同一任务不能并发',()=>fixture(async root=>{
  settings(root);let calls=0,release;
  const options={...task(root),executeProgram:async({values})=>{calls++;await new Promise(r=>release=r);return values;}};
  const running=runProject(root,{text:'x'},options);
  await new Promise(r=>setImmediate(r));
  await assert.rejects(runProject(root,{text:'x'},{...options,resume:true}),/任务正在执行/);
  release();const first=await running;assert.equal(first.status,'waiting');assert.equal(calls,1);
  const broken={taskDirectory:join(root,'workspace','broken'),executeProgram:()=>{calls++;throw Error('外部操作之后断开');}};
  await assert.rejects(runProject(root,{text:'x'},broken),/断开/);
  await assert.rejects(runProject(root,{text:'x'},{...broken,resume:true}),/结果不明/);assert.equal(calls,2);
  const timed={taskDirectory:join(root,'workspace','timed'),timeoutMs:10,executeProgram:()=>new Promise(()=>{})};
  await assert.rejects(runProject(root,{text:'x'},timed),/超时/);
  await assert.rejects(runProject(root,{text:'x'},{...timed,resume:true}),/结果不明/);
}));

test('嵌套组合内先生成再检查，组合确认后才交下游；内部确认可单独恢复',()=>fixture(async root=>{
  const combo=join(root,'modules','c');mkdirSync(combo,{recursive:true});
  json(join(combo,'module.json'),{id:'c',status:'ready',guidance:{mode:'key',checkpoints:['producer']}});
  writeFileSync(join(combo,'README.md'),doc(['text'],['text']));
  moduleAt(combo,'producer','export const run=({text})=>({text});');
  moduleAt(combo,'checker','export const run=({text})=>({text});');
  json(join(combo,'connections.json'),{connections:[edge('$self','producer'),edge('producer','checker'),edge('checker','$self')]});
  json(join(root,'connections.json'),{connections:[edge('$self','c'),edge('c','b'),edge('b','$self','text','result')]});
  settings(root,'key',['c']);const calls=[];
  const options={...task(root),executeProgram:({id,values})=>{calls.push(id);return {text:values.text+'-'+id};}};
  let r=await runProject(root,{text:'x'},options);assert.equal(r.pending.module,'producer');
  r=await runProject(root,{text:'x'},{...options,resume:true,decision:approve(r.pending)});
  assert.equal(r.pending.module,'c');assert.deepEqual(calls,['producer','checker']);
  r=await runProject(root,{text:'x'},{...options,resume:true,decision:approve(r.pending)});
  assert.equal(r.outputs.result,'x-producer-checker-b');assert.deepEqual(calls,['producer','checker','b']);
}));

test('条件、反馈回路和停止判断恢复时不重复调用；每轮确认独立',()=>fixture(async root=>{
  settings(root,'key',['b']);
  json(join(root,'connections.json'),{connections:[edge('$self','a'),{...edge('a','b'),when:'继续'},edge('b','a'),edge('b','$self','text','result')],stop:'两轮'});
  const calls=[],conditions=[],stops=[];
  const options={...task(root),executeProgram:({id,values})=>{calls.push(id);return {text:values.text+id};},evaluateWhen:({value})=>{conditions.push(value);return true;},shouldStop:({steps})=>{stops.push(steps);return steps>=4;}};
  let r=await runProject(root,{text:''},options);assert.equal(r.pending.outputs.text,'ab');
  r=await runProject(root,{text:''},{...options,resume:true,decision:approve(r.pending)});assert.equal(r.pending.outputs.text,'abab');
  r=await runProject(root,{text:''},{...options,resume:true,decision:approve(r.pending)});
  assert.equal(r.outputs.result,'abab');assert.deepEqual(calls,['a','b','a','b']);assert.equal(conditions.length,2);assert.deepEqual(stops,[1,2,3,4]);
}));

test('不同进程从磁盘恢复，原生模块写出的执行记录没有重复',()=>fixture(async root=>{
  settings(root);const marker=join(root,'workspace','calls.txt');mkdirSync(join(root,'workspace'));
  for (const id of ['a','b']) writeFileSync(join(root,'modules',id,'run.mjs'),`import {appendFileSync} from 'node:fs';export const run=({text})=>{appendFileSync(${JSON.stringify(marker)},'${id}');return {text:text+'${id}'};};`);
  const runner=join(root,'workspace','runner.mjs');
  const url=new URL('../run.mjs',import.meta.url).href;
  writeFileSync(runner,`import {runProject} from ${JSON.stringify(url)}; console.log(JSON.stringify(await runProject(process.argv[2],{text:'x'},JSON.parse(process.argv[3]))));`);
  const run=options=>{const p=spawnSync(process.execPath,[runner,root,JSON.stringify(options)],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);};
  const first=run(task(root));assert.equal(readFileSync(marker,'utf8'),'a');
  const done=run({...task(root),resume:true,decision:approve(first.pending)});
  assert.equal(done.outputs.result,'xab');assert.equal(readFileSync(marker,'utf8'),'ab');
}));

test('流程引导 AI 模块独立调用，不进入默认反馈业务线',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  assert.ok(!executionPlan(root).project.members.some(m=>m.id==='workflow_guidance'));
  const request={state:{status:'waiting'},userReply:null};
  const result=await runProject(join(root,'modules/workflow_guidance'),{request},{executeAI:({prompt,values,outputs})=>{
    assert.match(prompt,/没有答复/);assert.deepEqual(values.request,request);assert.equal(outputs[0].name,'guidance');
    return {guidance:{message:'请查看成果',question:'是否同意？',decision:null}};
  }});
  assert.equal(result.outputs.guidance.decision,null);
});


for (const checker of ['project_consistency','prompt_readability','project_overall']) {
  test('现有 '+checker+' 检查模块交付后暂停，同意后才进入后续模块',()=>fixture(async root=>{
    const source=fileURLToPath(new URL('../modules/'+checker,import.meta.url));
    cpSync(source,join(root,'modules',checker),{recursive:true});
    writeFileSync(join(root,'modules/a/README.md'),doc(['text'],['request']));
    json(join(root,'connections.json'),{connections:[edge('$self','a'),edge('a',checker,'request','request'),edge(checker,'b','report','text'),edge('b','$self','text','result')]});
    settings(root,'key',[checker]);const called=[];
    const options={...task(root),executeProgram:({id,values})=>{
      called.push(id);return id==='a'?{request:{scope:'受控接力',text:values.text}}:{text:values.text+'-交付'};
    },executeAI:({id,prompt,values,outputs})=>{
      called.push(id);assert.equal(id,checker);assert.match(prompt,/检查/);assert.equal(values.request.text,'材料');assert.equal(outputs[0].name,'report');
      return {report:'受控报告，仅验证接力'};
    }};
    const waiting=await runProject(root,{text:'材料'},options);
    assert.deepEqual(called,['a',checker]);assert.equal(waiting.pending.outputs.report,'受控报告，仅验证接力');
    const done=await runProject(root,{text:'材料'},{...options,resume:true,decision:approve(waiting.pending)});
    assert.equal(done.outputs.result,'受控报告，仅验证接力-交付');assert.deepEqual(called,['a',checker,'b']);
  }));
}

test('人工等待不计入执行超时，未答复时不会自动放行',()=>fixture(async root=>{
  settings(root);const called=[];
  const options={...task(root),timeoutMs:10,executeProgram:({id,values})=>{called.push(id);return values;}};
  const waiting=await runProject(root,{text:'x'},options);
  await new Promise(resolve=>setTimeout(resolve,40));
  const stillWaiting=await runProject(root,{text:'x'},{...options,resume:true});
  assert.equal(stillWaiting.pending.token,waiting.pending.token);assert.deepEqual(called,['a']);
}));

test('退回已完成的组合时，组合内旧确认全部失效且重新执行检查',()=>fixture(async root=>{
  const combo=join(root,'modules','c');mkdirSync(combo,{recursive:true});
  json(join(combo,'module.json'),{id:'c',status:'ready',guidance:{mode:'key',checkpoints:['producer']}});
  writeFileSync(join(combo,'README.md'),doc(['text'],['text']));
  for(const id of ['producer','checker']) moduleAt(combo,id,'export const run=({text})=>({text});');
  json(join(combo,'connections.json'),{connections:[edge('$self','producer'),edge('producer','checker'),edge('checker','$self')]});
  json(join(root,'connections.json'),{connections:[edge('$self','c'),edge('c','b'),edge('b','$self','text','result')]});settings(root,'key',['c']);
  const calls=[], options={...task(root),executeProgram:({id,values})=>{calls.push(id);return values;}};
  let r=await runProject(root,{text:'x'},options);const original=r.pending.token;
  r=await runProject(root,{text:'x'},{...options,resume:true,decision:approve(r.pending)});assert.equal(r.pending.module,'c');
  r=await runProject(root,{text:'x'},{...options,resume:true,decision:{action:'revise',token:r.pending.token,inputs:{text:'changed'}}});
  assert.equal(r.pending.module,'producer');assert.notEqual(r.pending.token,original);
  r=await runProject(root,{text:'x'},{...options,resume:true,decision:approve(r.pending)});
  r=await runProject(root,{text:'x'},{...options,resume:true,decision:approve(r.pending)});
  assert.equal(r.outputs.result,'changed');assert.deepEqual(calls,['producer','checker','producer','checker','b']);
}));


test('执行方式原地修改输入时，待确认成果仍可重复读取并恢复',()=>fixture(async root=>{
  settings(root);const calls=[];
  const options={...task(root),executeProgram:({id,values})=>{
    calls.push(id);values.text += id;return values;
  }};
  const first=await runProject(root,{text:'x'},options);
  const again=await runProject(root,{text:'x'},{...options,resume:true});
  assert.equal(again.pending.token,first.pending.token);
  assert.deepEqual(first.pending.inputs,{text:'x'});
  const done=await runProject(root,{text:'x'},{...options,resume:true,decision:approve(first.pending)});
  assert.equal(done.outputs.result,'xab');assert.deepEqual(calls,['a','b']);
}));

test('未连接的辅助组合开启确认，不应阻止当前业务入口运行',()=>fixture(async root=>{
  const dir=join(root,'modules','unused');mkdirSync(join(dir,'modules'),{recursive:true});
  json(join(dir,'module.json'),{id:'unused',status:'ready',guidance:{mode:'all',checkpoints:[]}});
  writeFileSync(join(dir,'README.md'),doc([],[]));
  json(join(dir,'connections.json'),{connections:[]});
  assert.equal((await runProject(root,{text:'x'})).outputs.result,'xAB');
}));
