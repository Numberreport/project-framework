import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { arrange, POSITION_LIMIT, boundaryId, endpointId, displayIds, initialPositions } from '../canvas-layout.mjs';

// Execute the actual page handlers against a minimal DOM, not source-text assertions.
class Element {
  constructor() { this.children=[]; this.dataset={}; this.style={}; this.classes=new Set(); this.classList={add:(...xs)=>xs.forEach(x=>this.classes.add(x)),remove:x=>this.classes.delete(x),toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x),contains:x=>this.classes.has(x)}; }
  set className(value) { this.classes=new Set(value.split(' ')); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children=nodes; }
  setAttribute(name,value) { this[name]=value; }
  showModal() {}
  close() {}
  addEventListener() {}
  setPointerCapture() {}
  getBoundingClientRect() { return { x:0,y:0,width:12,height:12 }; }
  querySelectorAll(selector) { return this.children.flatMap(n=>[...(n.classes.has(selector.slice(1))?[n]:[]),...n.querySelectorAll(selector)]); }
  querySelector(selector) { return selector==='span:last-child'?this.children.at(-1):this.querySelectorAll(selector)[0]; }
}
function page() {
  const elements=new Map(), document={getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:()=>new Element(),createElementNS:()=>new Element(),createTextNode:()=>new Element(),addEventListener(){}};
  let source=readFileSync(new URL('../canvas.html',import.meta.url),'utf8').match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  source=source.replace(/^import .*;$/m,'');
  source=source.slice(0,source.lastIndexOf('try{install('));
  const context={document,arrange,POSITION_LIMIT,boundaryId,endpointId,displayIds,initialPositions,URLSearchParams,location:{hash:''},window:{addEventListener(){}},requestAnimationFrame:fn=>fn()};
  runInNewContext(source+'\n globalThis.control={install,positions:()=>positions,focus:()=>focus,openPorts,render,interfaces:()=>interfaces,draft:()=>draft};',context);
  return { ...context, get:id=>document.getElementById(id) };
}
const node=(id,children=[],document=null)=>({id,name:id,label:id,children,document,inputs:[{name:'text'}],outputs:[{name:'text'}],documents:Object.fromEntries(['README.md','INPUT.md','PROCESS.md','OUTPUT.md','VALIDATION.md'].map(name=>[name,{path:'/project/'+id+'/'+name,actualPath:'/real/'+id+'/'+name,content:'content '+name}])),implementation:{path:'/entry',actualPath:'/real-entry'},verify:{path:'/verify',actualPath:'/real-verify'},settings:[]});
const edge=(a,b)=>({from:{module:a,port:'text'},to:{module:b,port:'text'},info:'material'});
test('真实节点点击显示五份说明与实现路径，分别高亮输入和输出边界',()=>{
  const p=page(), edges=[edge('$self','a'),edge('a','$self')];
  p.control.install({layout:{},nodes:[node('root',['a','other'],{connections:edges}),node('a'),node('other')]});
  const cards=p.get('nodes').children;
  cards.find(n=>n.dataset.id==='a').onclick();
  const details=p.get('details').children[0].textContent;
  for(const name of ['README.md','INPUT.md','PROCESS.md','OUTPUT.md','VALIDATION.md','/real-entry','/real-verify'])assert.ok(details.includes(name),name);
  assert.equal(p.get('wires').children.filter(n=>n.classList.contains('related')).length,2);
  assert.equal(cards.find(n=>n.dataset.id==='other').classList.contains('related'),false);
  cards.find(n=>n.dataset.id==='$input:text').onclick();
  assert.equal(p.control.focus().node,'$input:text');
  assert.deepEqual(p.get('wires').children.map(n=>n.classList.contains('related')),[true,false]);
  cards.find(n=>n.dataset.id==='$output:text').onclick();
  assert.equal(p.control.focus().node,'$output:text');
  assert.deepEqual(p.get('wires').children.map(n=>n.classList.contains('related')),[false,true]);
});
test('长链布局后实际拖动不跳回旧边界，撤销恢复坐标',()=>{
  const p=page(),ids=Array.from({length:70},(_,i)=>'n'+i),edges=[edge('$self',ids[0]),...ids.slice(1).map((id,i)=>edge(ids[i],id)),edge(ids.at(-1),'$self')];
  p.control.install({layout:{},nodes:[node('root',ids,{connections:edges}),...ids.map(id=>node(id))]});
  const id=ids.at(-1);p.control.positions()[id].y=23500;const before={...p.control.positions()[id]};assert.ok(before.x>20000);
  const title=p.get('nodes').children.find(n=>n.dataset.id===id).children[0];
  title.onpointerdown({button:0,clientX:100,clientY:100,pointerId:1});
  title.onpointermove({clientX:110,clientY:120});
  assert.equal(p.control.positions()[id].x,before.x+10);assert.equal(p.control.positions()[id].y,before.y+20);
  p.get('undo').onclick();assert.equal(p.control.positions()[id].x,before.x);
});

test('多输入输出逐端口定位、旧布局迁移、拖动撤销和高亮均独立',()=>{
  const p=page(),root=node('root',['a'],{connections:[edge('$self','a'),edge('a','$self'),{from:{module:'$self',port:'second'},to:{module:'a',port:'text'},info:'second'}]});
  root.inputs.push({name:'second',description:'第二输入'},{name:'unused',description:'未连接输入'});
  root.outputs.push({name:'second',description:'第二输出'});
  p.control.install({layout:{root:{$input:{x:50,y:70},$output:{x:1000,y:70}}},nodes:[root,node('a')]});
  const cards=p.get('nodes').children,ids=cards.map(n=>n.dataset.id);
  assert.equal(ids.filter(id=>id.startsWith('$input:')).length,3);
  assert.equal(ids.filter(id=>id.startsWith('$output:')).length,2);
  assert.equal(new Set(Object.values(p.control.positions()).map(p=>JSON.stringify(p))).size,6);
  for(const card of cards.filter(n=>n.dataset.id.startsWith('$'))){
    assert.equal(card.querySelectorAll('.port').length,1);
    assert.equal(card.querySelectorAll('.summary').length,0);
    assert.equal(card.children.some(n=>n.textContent==='配套文件'),false);
  }
  cards.find(n=>n.dataset.id==='$input:second').onclick();
  assert.deepEqual(p.get('wires').children.map(n=>n.classList.contains('related')),[false,false,true]);
  const before=JSON.stringify(p.control.positions()),title=cards.find(n=>n.dataset.id==='$output:second').children[0];
  title.onpointerdown({button:0,clientX:0,clientY:0,pointerId:1});title.onpointermove({clientX:30,clientY:40});
  p.get('undo').onclick();assert.equal(JSON.stringify(p.control.positions()),before);
  p.get('layout').onclick();
  const pos=p.control.positions();
  for(const id of ids.filter(id=>id.startsWith('$input:')))assert.ok(pos[id].x<pos.a.x);
  for(const id of ids.filter(id=>id.startsWith('$output:')))assert.ok(pos[id].x>pos.a.x);
  assert.equal(p.get('wires').children.length,3);
});
test('接口改名删除保留悬空引用、移除旧位置，撤销及展开快照保留草稿',()=>{
  const p=page(),root=node('root',['nested'],{connections:[]}),nested=node('nested',['a'],{connections:[edge('$self','a'),edge('a','$self')]});
  p.control.install({layout:{},nodes:[root,nested,node('a')]});
  p.control.openPorts(nested);
  p.get('inputRows').children[0].children[0].value='renamed';
  p.get('inputRows').children[0].children[1].value='新要求';
  p.get('outputRows').children[0].children[1].value='输出要求';
  p.get('applyPorts').onclick();
  const snapshot=p.window.canvasSnapshot();assert.equal(snapshot.nodes[1].inputs[0].name,'renamed');
  const child=page();child.control.install(snapshot,'nested');
  assert.ok(child.get('nodes').children.some(n=>n.dataset.id==='$input:renamed'));
  assert.ok(child.get('nodes').children.some(n=>n.dataset.id==='$input:text'));
  assert.equal(child.get('wires').children.length,2);
  child.control.draft().splice(0,1);child.control.render();
  assert.equal(Object.hasOwn(child.control.positions(),'$input:text'),false);
  p.get('undo').onclick();assert.equal(p.window.canvasSnapshot().nodes[1].inputs[0].name,'text');
});
