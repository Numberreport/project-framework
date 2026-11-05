import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../canvas.html',import.meta.url),'utf8');
function setup(api){
 const status={textContent:''};
 const state={dirty:false,levelId:'root',draft:[],stop:'',positions:{},data:{revisions:{root:'r1'},fileRevisions:{a:'v1'}}};
 let scheduled;
 const context=vm.createContext({editable:true,state,api,structuredClone,window:{},$:()=>status,toast:()=>{},setTimeout:fn=>{scheduled=fn;return 1;},clearTimeout:()=>{scheduled=null;}});
 vm.runInContext(html.slice(html.indexOf('let autoSaveTimer'),html.indexOf('function renderSide()')),context);
 vm.runInContext(html.slice(html.indexOf('async function save()'),html.indexOf('function selected()')),context);
 return {state,status,run:code=>vm.runInContext(code,context),scheduled:()=>scheduled};
}
test('画布改动安排自动保存，成功后清除草稿状态',async()=>{
 let calls=0; const h=setup(async()=>{calls++;return {revisions:{root:'r2'},fileRevisions:{a:'v2'}};});
 h.run('markDirty(true)');assert.equal(typeof h.scheduled(),'function');await h.scheduled()();
 assert.equal(calls,1);assert.equal(h.state.dirty,false);assert.equal(h.status.textContent,'草稿已保存');
});
test('保存中继续编辑，按顺序补存新改动，不覆盖当前画布',async()=>{
 const pending=[],payloads=[];const h=setup((url,payload)=>{payloads.push(payload);return new Promise(resolve=>pending.push(resolve));});
 h.run('markDirty(true)');const done=h.run('save()');
 h.state.positions={n:{x:40,y:50}};h.run('markDirty(true)');
 pending.shift()({revisions:{root:'r2'},fileRevisions:{a:'v2'}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(payloads.length,2);assert.equal(payloads[1].positions.n.x,40);assert.equal(payloads[1].revision,'r2');
 pending.shift()({revisions:{root:'r3'},fileRevisions:{a:'v3'}});await done;assert.equal(h.state.positions.n.x,40);assert.equal(h.state.dirty,false);
});
test('冲突失败保留草稿，停止自动重试，允许手动重试',async()=>{
 let fail=true;const h=setup(async()=>{if(fail)throw Error('版本冲突');return {revisions:{root:'r2'},fileRevisions:{a:'v2'}};});
 h.run('markDirty(true)');assert.equal(await h.run('save()'),false);assert.equal(h.state.dirty,true);
 h.run('markDirty(true)');assert.equal(h.scheduled(),null);fail=false;assert.equal(await h.run('save()'),true);assert.equal(h.state.dirty,false);
});
