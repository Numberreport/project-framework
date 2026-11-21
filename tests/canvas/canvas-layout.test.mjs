import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../../lib/canvas/canvas.html',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function cardsOverlap('),html.indexOf('function layoutCards(')),context);
vm.runInContext(html.slice(html.indexOf('function roundedRoute('),html.indexOf('function highlightNodeEdges(')),context);
const node=(id,height=240,type)=>({id,width:340,height,type});
const edge=(a,b,kind)=>({from:{module:a,port:'value'},to:{module:b,port:'value'},kind});
function arrange(nodes,links) {
  const positions=context.arrangeNodes(nodes,links);
  const boxes=nodes.map(n=>({...n,...positions[n.id]}));
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)
    assert.equal(context.cardsOverlap(boxes[i],boxes[j]),false,boxes[i].id+' overlaps '+boxes[j].id);
  return positions;
}

test('按真实尺寸安排长卡片、组合、边界接口及独立工具，保持流程从左向右',()=>{
  const nodes=[node('$input:value',290,'input'),node('a',900),node('b',360),node('c',1250),
    node('$output:value',300,'output'),node('utility1',350),node('utility2',280),node('late',450,'input')];
  nodes[2].width=1100;
  const links=[edge('$self','a'),edge('a','b'),edge('b','c'),edge('c','$self'),edge('late','c')];
  const p=arrange(nodes,links);
  assert.ok(p['$input:value'].x<p.a.x && p.a.x<p.b.x && p.b.x<p.c.x && p.c.x<p['$output:value'].x);
  assert.equal(p.late.x,p.b.x);
  assert.ok(p.utility1.y>p.c.y+1250);
  assert.deepEqual(context.arrangeNodes(nodes,links),p,'布局应可重复生成');
});

test('反馈、无类型循环、多来源及独立分支均能结束排版且不遮挡',()=>{
  for(const kind of ['return',undefined]) {
    const nodes=Array.from({length:28},(_,i)=>node('n'+i,150+i%5*160));
    const links=[edge('n0','n1'),edge('n1','n2'),edge('n2','n0',kind),edge('n3','n2'),
      edge('n4','n5'),edge('n4','n6'),edge('n5','n7'),edge('n6','n7')];
    arrange(nodes,links);
  }
});

test('保留完整人工位置；新增节点和展开大卡片后重新测量，保留缩放与展开信息',()=>{
  const nodes=[node('a'),node('b')],links=[edge('a','b')];
  const positions={a:{x:50,y:100,expanded:true,width:1100},b:{x:600,y:100},$view:{zoom:.6,panX:80}};
  const elements=nodes.map((n,i)=>({dataset:{id:n.id},offsetLeft:positions[n.id].x,offsetTop:100,
    offsetWidth:n.width,offsetHeight:n.height,style:{}}));
  const state={data:{levels:{level:{members:nodes}}},levelId:'level',draft:links,positions};
  const ctx=vm.createContext({state,nodesOf:l=>l.members,$:()=>({querySelectorAll:()=>elements})});
  vm.runInContext(html.slice(html.indexOf('function cardsOverlap('),html.indexOf("$('arrangeLayout').onclick")),ctx);
  const original=JSON.stringify(positions);
  assert.equal(ctx.layoutCards(),false);
  assert.equal(JSON.stringify(positions),original);
  delete positions.b;
  assert.equal(ctx.layoutCards(),true);
  assert.equal(positions.a.expanded,true);assert.equal(positions.a.width,1100);
  assert.deepEqual(positions.$view,{zoom:.6,panX:80});
  elements.forEach(el=>{el.offsetLeft=positions[el.dataset.id].x;el.offsetTop=positions[el.dataset.id].y;});
  elements[0].offsetWidth=1100;
  assert.equal(ctx.layoutCards(),true);
  assert.ok(positions.b.x>=positions.a.x+1100+24);
});

function assertClear(route,boxes,source,target) {
  assert.equal(route.unresolved,false);
  for(let i=1;i<route.points.length;i++) {
    const a=route.points[i-1],b=route.points[i];
    assert.ok(a.x===b.x||a.y===b.y);
    for(const r of boxes) {
      if((i===1&&r.id===source)||(i===route.points.length-1&&r.id===target))continue;
      const hit=a.y===b.y ? a.y>r.y&&a.y<r.y+r.height&&Math.max(a.x,b.x)>r.x&&Math.min(a.x,b.x)<r.x+r.width :
        a.x>r.x&&a.x<r.x+r.width&&Math.max(a.y,b.y)>r.y&&Math.min(a.y,b.y)<r.y+r.height;
      assert.equal(hit,false,'连线穿过 '+r.id);
    }
  }
}

test('跨列连线沿交错卡片的空隙拐弯，不绕到整张画布底部',()=>{
  const boxes=[{id:'a',x:40,y:100,width:340,height:500},{id:'b',x:1600,y:100,width:340,height:500},
    {id:'block1',x:560,y:0,width:340,height:380},{id:'block2',x:1080,y:260,width:340,height:900}];
  for(const scale of [.4,1,1.5]) {
    const scaled=boxes.map(r=>({...r,x:r.x*scale,y:r.y*scale,width:r.width*scale,height:r.height*scale}));
    const route=context.connectionRoute({x:368*scale,y:200*scale},{x:1612*scale,y:200*scale},{boxes:scaled,source:'a',target:'b'});
    assertClear(route,scaled,'a','b');
    assert.ok(Math.max(...route.points.map(p=>p.y))<700*scale);
    assert.deepEqual({...route.points[0]},{x:368*scale,y:200*scale});
    assert.deepEqual({...route.points.at(-1)},{x:1612*scale,y:200*scale});
  }
});

test('同列回线和多条共享来源保持端点，所有可解路线避开卡片',()=>{
  const boxes=[{id:'a',x:40,y:100,width:340,height:300},{id:'b',x:40,y:600,width:340,height:300},
    {id:'c',x:620,y:100,width:340,height:1000}];
  const used=[];
  for(let i=0;i<12;i++) {
    const route=context.connectionRoute({x:368,y:700},{x:52,y:200+i*10},{boxes,source:'b',target:'a',index:i,used});
    assertClear(route,boxes,'b','a');
  }
});
