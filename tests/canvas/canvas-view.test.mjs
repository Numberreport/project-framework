import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../../lib/canvas/canvas.html',import.meta.url),'utf8');

test('连续改变视角不重建连线或移动节点，缩放锚点保持在同一画布位置',()=>{
  const state={positions:{a:{x:500,y:800},$view:{zoom:1,panX:70,panY:-50}}};
  const elements={board:{style:{}},edges:{style:{},dataset:{width:6000,height:17000},innerHTML:'existing routes'},zoomValue:{},
    stage:{scrollLeft:300,scrollTop:1500,clientWidth:1440,clientHeight:900,getBoundingClientRect:()=>({left:0,top:0})}};
  let redraws=0,saves=0;
  const ctx=vm.createContext({state,$:id=>elements[id],drawEdges:()=>redraws++,markDirty:()=>saves++});
  vm.runInContext(html.slice(html.indexOf('function applyZoom()'),html.indexOf("$('zoomIn').onclick")),ctx);
  const anchor={clientX:720,clientY:450},before={...ctx.canvasPoint(anchor.clientX,anchor.clientY)};
  for(let i=0;i<12;i++){ctx.changeZoom(i%2?.1:-.1,anchor);}
  const after=ctx.canvasPoint(anchor.clientX,anchor.clientY);
  assert.ok(Math.abs(before.x-after.x)<1e-8&&Math.abs(before.y-after.y)<1e-8);
  for(let i=0;i<20;i++){state.positions.$view.panX+=5;ctx.applyZoom();}
  assert.equal(redraws,0);assert.equal(saves,12);assert.equal(elements.edges.innerHTML,'existing routes');
  assert.deepEqual(state.positions.a,{x:500,y:800});
  assert.equal(elements.edges.style.width,'6000px');
});

test('直接打开组合没有目录上级，进入和返回只沿实际访问路径',async()=>{
  // Structural root also lists child, but the user entered it from flow.
  const levels={root:{name:'全部模块',members:[{id:'flow'},{id:'child'}]},flow:{name:'制作流程',members:[{id:'child',name:'处理'}]},
    child:{name:'处理',members:[{id:'nested',name:'内部'}]},nested:{name:'内部',members:[]}};
  const state={data:{levels},levelId:'flow',path:[]};
  const ctx=vm.createContext({state,flushCanvas:async()=>true,openLevel:id=>{state.levelId=id;}});
  vm.runInContext(html.slice(html.indexOf('function parentLevelId()'),html.indexOf('function renderSide()')),ctx);
  vm.runInContext(html.slice(html.indexOf('async function enterCombo('),html.indexOf('let docReadSequence')),ctx);
  assert.equal(ctx.parentLevelId(),undefined);
  await ctx.enterCombo('child');assert.equal(ctx.parentLevelId(),'flow');
  await ctx.enterCombo('nested');assert.equal(ctx.parentLevelId(),'child');
  await ctx.goTo('root');assert.equal(state.levelId,'nested','不能跳到入口之外');
  await ctx.goTo('child');assert.equal(state.levelId,'child');assert.equal(ctx.parentLevelId(),'flow');
  await ctx.goTo('flow');assert.equal(state.levelId,'flow');assert.equal(ctx.parentLevelId(),undefined);
});
