import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = join(dirname(fileURLToPath(import.meta.url)), '../..');

// 每个用例在临时项目中建立独立草稿。
const runner = `
import { pathToFileURL } from 'node:url';
const formal = process.argv[2];
let project = formal;
const { createCanvas } = await import(pathToFileURL(project + '/canvas/canvas.mjs').href);
const server = createCanvas(project);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const token = (await (await fetch(base + '/')).text()).match(/const TOKEN = '([^']+)'/)[1];
const headers = { 'x-canvas-token': token, 'Content-Type': 'application/json', Origin: base };
const request = async (path, body, id, scopedToken = token) => {
  const url = new URL(path,base);
  if(id)url.searchParams.set('draft',id);
  const auth={...headers,'x-canvas-token':scopedToken};
  return (await fetch(url,body ? {method:'POST',headers:auth,body:JSON.stringify(body)} : {headers:auth})).json();
};
const open = async name => {
  const draft=await request('/api/drafts/create',{name});
  if(draft.error)throw Error(draft.error);
  const html=await (await fetch(base+'/?draft='+draft.id)).text();
  return {...draft,token:html.match(/const TOKEN = '([^']+)'/)[1]};
};
const primary=await open('测试草稿');
project=primary.path;
const call=(path,body)=>request(path,body,primary.id,primary.token);
const plain = async (path, opts) => { const r = await fetch(base + path, opts); return { status: r.status, text: await r.text() }; };
const cases = (await import(pathToFileURL(project + '/tests/case.mjs').href)).default;
try { await cases({ call, plain, base, token, project, formal, primary, open, request }); }
finally { server.closeAllConnections?.(); server.close(); }
`;

// 模板不带示例模块；每个用例先建两个最小模块和连好它们，界面才有东西可看。
// 模块写 README（四段，接口分两条）和 VALIDATION.md。
const README = '# 模块\n\n## 职责\n\n处理一段文字，交给下一个模块。\n\n' +
  '## 输入\n\n接收 text：待处理的文字。\n\n```interfaces\n[{ "name": "text", "description": "待处理的文字" }]\n```\n\n' +
  '## 输出\n\n交付 text：处理后的文字。\n\n```interfaces\n[{ "name": "text", "description": "处理后的文字" }]\n```\n\n' +
  '## 处理流程\n\n1. 读取输入，处理一次，交出结果。\n\n## 没完成时\n\n缺材料就停下来问，说清卡在哪。\n';
const VALIDATION = '# 检查标准\n\n- 输出非空。\n';
// 根目录的 README 和模块一样五段齐全，接口分「输入」「输出」两块。
const ROOT_README = '# 项目\n\n## 职责\n\n把输入经两个模块处理后交回。\n\n' +
  '## 输入\n\n接收 text：待处理的文字。\n\n```interfaces\n[{ "name": "text", "description": "待处理的文字" }]\n```\n\n' +
  '## 输出\n\n交付 result：处理结果。\n\n```interfaces\n[{ "name": "result", "description": "处理结果" }]\n```\n\n' +
  '## 处理流程\n\n先生成，后处理。\n\n## 没完成时\n\n缺材料就停下来问。\n';
function seed(project) {
  for (const id of ['a', 'b']) {
    const dir = join(project, 'modules', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'module.json'), JSON.stringify({ id, name: id === 'a' ? '甲' : '乙', template: { id: 'project-framework', version: '3.0.0' }, status: 'ready', implementation:'README.md' }, null, 2) + '\n');
    writeFileSync(join(dir, 'README.md'), README);
    writeFileSync(join(dir, 'VALIDATION.md'), VALIDATION);
  }
  writeFileSync(join(project, 'README.md'), ROOT_README);
  writeFileSync(join(project, 'connections.json'), JSON.stringify({
    connections: [
      { from: { module: '$self', port: 'text' }, to: { module: 'a', port: 'text' }, info: '原始文字' },
      { from: { module: 'a', port: 'text' }, to: { module: 'b', port: 'text' }, info: '中间结果' },
      { from: { module: 'b', port: 'text' }, to: { module: '$self', port: 'result' }, info: '最终结果' },
    ],
  }, null, 2) + '\n');
}

function withCanvas(name, cases) {
  const dir = mkdtempSync(join(tmpdir(), 'framework-canvas-'));
  const project = join(dir, 'project');
  try {
    cpSync(source, project, { recursive: true, filter: path => !['runs', 'outputs', 'node_modules', 'tests', '.git', '.canvas-drafts'].includes(basename(path)) && (dirname(path) !== join(source, 'modules') || ['framework_feedback', 'ai_example', 'project_consistency', 'prompt_readability'].includes(basename(path))) });
    seed(project);
    mkdirSync(join(project, 'tests'), { recursive: true }); writeFileSync(join(project, 'tests/case.mjs'), 'export default ' + cases.toString() + ';\n');
    writeFileSync(join(project, 'tests/run-canvas.mjs'), runner);
    const result = spawnSync(process.execPath, [join(project, 'tests/run-canvas.mjs'), project], { encoding: 'utf8', timeout: 120000 });
    if (result.status !== 0) throw new Error(result.stdout + result.stderr);
    return project;
  } finally {
    assert.ok(dir.split(/[\\/]/).at(-1).startsWith('framework-canvas-'));
    rmSync(dir, { recursive: true, force: true });
  }
}

const read = (project, path) => readFileSync(join(project, path), 'utf8');

test('页面能打开，根目录显示内置模块与样本成员', () => withCanvas('open', async ({ call }) => {
  const data = await call('/api/project');
  if (!data.levels[data.root.id]) throw Error('根目录应作为一层');
  const count = data.levels[data.root.id].members.length;
  if (count !== 6) throw Error('成员数应为 6（框架反馈 + AI 示例 + 两个检查模块 + 两个样本），实际 ' + count);
}));

test('能读到模块配套文件，读不到模块外', () => withCanvas('doc', async ({ call }) => {
  const doc = await call('/api/doc?id=a&file=README.md');
  if (!/职责/.test(doc.content)) throw Error('内容不对');
  if (doc.path !== 'modules/a/README.md') throw Error('路径不对：' + doc.path);
  const bad = await call('/api/doc?id=a&file=../../check.mjs');
  if (!bad.error) throw Error('不能读到模块外的文件');
}));

test('没有令牌或来自别的站点时拒绝', () => withCanvas('auth', async ({ base, token, plain }) => {
  if ((await plain('/api/project')).status !== 403) throw Error('无令牌应拒绝');
  const foreign = await plain('/api/project', { headers: { 'x-canvas-token': token, Origin: 'http://evil.example' } });
  if (foreign.status !== 403) throw Error('跨站应拒绝');
}));

test('保存连接、条件和节点位置', () => withCanvas('save', async ({ call }) => {
  const before = await call('/api/project');
  const root = before.root.id;
  const links = JSON.parse(JSON.stringify(before.levels[root].links));
  links[0].when = '收到文字时';
  const saved = await call('/api/save', { levelId: root, links, stop: before.levels[root].stop, positions: { a: { x: 10, y: 20 } }, revision: before.revisions[root] });
  if (saved.error) throw Error(saved.error);
  const after = await call('/api/project');
  if (after.levels[root].links[0].when !== '收到文字时') throw Error('条件没写进去');
  const pos = after.layout[root] && after.layout[root].a;
  if (!pos || pos.x !== 10 || pos.y !== 20) throw Error('位置没存');
}));

test('文件被别的操作改过时拒绝覆盖', () => withCanvas('conflict', async ({ call }) => {
  const before = await call('/api/project');
  const root = before.root.id;
  const stale = before.revisions[root];
  // 第一次保存改了文件，传入的 revision 就过期了；再拿它保存必须被拒绝。
  const links = JSON.parse(JSON.stringify(before.levels[root].links));
  links[0].when = '第一次';
  await call('/api/save', { levelId: root, links, stop: '', positions: {}, revision: stale });
  const again = await call('/api/save', { levelId: root, links: before.levels[root].links, stop: '', positions: {}, revision: stale });
  if (!/重新加载/.test(again.error || '')) throw Error('应拒绝覆盖，实际：' + (again.error || '通过了'));
}));

test('连接不存在的接口会被拒绝', () => withCanvas('badport', async ({ call }) => {
  const before = await call('/api/project');
  const root = before.root.id;
  const links = JSON.parse(JSON.stringify(before.levels[root].links));
  links[0].to.port = 'nope';
  const result = await call('/api/save', { levelId: root, links, stop: '', positions: {}, revision: before.revisions[root] });
  if (!/接口不存在/.test(result.error || '')) throw Error('应拒绝，实际：' + (result.error || '通过了'));
}));

test('打包：预览不写盘，确认后搬家、生成组合、改链接', () => withCanvas('pack', async ({ call, project }) => {
  const fs = await import('node:fs'); const pjoin = (await import('node:path')).join;
  const before = await call('/api/project');
  const body = { parentId: before.root.id, memberIds: ['a', 'b'], id: 'flow', name: '组合' };
  const preview = await call('/api/pack-preview', body);
  if (preview.error) throw Error(preview.error);
  if (preview.move.length !== 2) throw Error('应移动两个模块');
  if (preview.inputs.map(p => p.name).join() !== 'text') throw Error('输入接口不对');
  if (preview.outputs.map(p => p.name).join() !== 'text') throw Error('输出接口不对');
  if (!fs.existsSync(pjoin(project, 'modules/a/README.md'))) throw Error('预览不该动文件');
  if (fs.existsSync(pjoin(project, 'modules/flow'))) throw Error('预览不该建目录');

  const done = await call('/api/pack', body);
  if (done.error) throw Error(done.error);
  // 两个模块一起搬进新组合，它们之间的相对位置没变，链接原样保留，不用改。
  if (done.links.length !== 0) throw Error('不该改链接，实际 ' + JSON.stringify(done.links));
  if (fs.existsSync(pjoin(project, 'modules/a'))) throw Error('旧目录应已移走');
  const readme = fs.readFileSync(pjoin(project, 'modules/flow/modules/b/README.md'), 'utf8');
  if (!readme.includes('## 输出')) throw Error('内容被改坏了');
  if (!fs.existsSync(pjoin(project, 'modules/flow/modules/a/README.md'))) throw Error('成员应在组合里');

  const after = await call('/api/project');
  const root = after.levels[after.root.id];
  if (!root.members.some(m => m.id === 'flow')) throw Error('根目录应有新组合');
  if (root.members.some(m => m.id === 'a')) throw Error('成员应已移入组合');
  if (after.levels.flow.links.length !== 3) throw Error('内部应包含原连接及两个边界交接');
}));

test('打包后通过结构检查', () => withCanvas('packcheck', async ({ call, project }) => {
  const before = await call('/api/project');
  const done = await call('/api/pack', { parentId: before.root.id, memberIds: ['a', 'b'], id: 'flow', name: '组合' });
  if (done.error) throw Error(done.error);
  const { spawnSync } = await import('node:child_process');
  const pjoin = (await import('node:path')).join;
  const check = pjoin(project, 'check.mjs');
  const result = spawnSync(process.execPath, [check, '--verify'], { cwd: project, encoding: 'utf8' });
  const report = (result.stdout || '') + (result.stderr || '');
  // 新组合是 pending，依赖它的根目录验收跳过，这是对的。
  if (/✗/.test(report)) throw Error(report);
}));

test('选不够或标识撞名时不做改动', () => withCanvas('refuse', async ({ call, project }) => {
  const fs = await import('node:fs'); const pjoin = (await import('node:path')).join;
  const before = await call('/api/project');
  const conflict = await call('/api/pack-preview', { parentId: before.root.id, memberIds: ['a', 'b'], id: 'framework_feedback', name: '撞名' });
  if (!/已被占用/.test(conflict.error || '')) throw Error('应拒绝撞名');
  const one = await call('/api/pack-preview', { parentId: before.root.id, memberIds: ['a'], id: 'x', name: '一个' });
  if (!/至少选两个/.test(one.error || '')) throw Error('应拒绝只选一个');
  if (!fs.existsSync(pjoin(project, 'modules/a/README.md'))) throw Error('不该动文件');
}));


test('接口改名同步内外连接，冲突不覆盖，保留 README 正文', () => withCanvas('ports', async ({call,project}) => {
  const {readFileSync,writeFileSync} = await import('node:fs');
  let snap = await call('/api/project');
  const before = readFileSync(project+'/modules/a/README.md','utf8');
  const next = await call('/api/settings', {action:'ports',levelId:snap.root.id,nodeId:'a',fileRevisions:snap.fileRevisions,inputs:[{name:'source',description:'原料'}],outputs:[{name:'text',description:'结果'}],renames:{inputs:{text:'source'}}});
  if (next.error) throw Error(next.error);
  if (next.levels[next.root.id].links[0].to.port !== 'source') throw Error('引用未更新');
  const text = readFileSync(project+'/modules/a/README.md','utf8');
  if (!text.includes('## 职责') || !text.includes('处理一段文字')) throw Error('正文丢失');
  if (!next.levels[next.root.id].members.find(n=>n.id==='a').inputs.some(p=>p.name==='source')) throw Error('接口未读回');
  const stale = await call('/api/settings',{action:'ports',levelId:snap.root.id,nodeId:'a',fileRevisions:snap.fileRevisions,inputs:[],outputs:[]});
  if (!stale.error || readFileSync(project+'/modules/a/README.md','utf8') !== text) throw Error('冲突覆盖');
}));

test('独立输入输出、建立对应、取消对应、刷新及结构检查', () => withCanvas('io', async ({call,project}) => {
  const {spawnSync} = await import('node:child_process');
  let s = await call('/api/project');
  const edit = async body => { s = await call('/api/settings',{...body,levelId:s.root.id,fileRevisions:s.fileRevisions}); if(s.error)throw Error(s.error); };
  await edit({action:'io',node:{id:'upload',type:'input',name:'上传文件',description:'用户提供的文件'}});
  await edit({action:'io',node:{id:'deliver',type:'output',name:'交付',description:'交付给用户'}});
  let l=s.levels[s.root.id];
  s=await call('/api/save',{levelId:s.root.id,revision:s.revisions[s.root.id],fileRevisions:s.fileRevisions,links:[...l.links.filter(e=>e.to.module!=='a'||e.to.port!=='text'),{from:{module:'upload',port:'value'},to:{module:'a',port:'text'},info:'上传文件'}]});
  if(s.error)throw Error(s.error);
  await edit({action:'expose',nodeId:'upload',port:'file'});
  if(!s.levels[s.root.id].links.some(e=>e.from.module==='$self'&&e.from.port==='file'))throw Error('没有改写内部连接');
  await edit({action:'detach',type:'input',port:'file',nodeId:'local_file'});
  if(!s.levels[s.root.id].ioNodes.some(n=>n.id==='local_file'))throw Error('没有保留独立节点');
  const fresh=await call('/api/project');
  if(fresh.levels[fresh.root.id].ioNodes.length!==2)throw Error('刷新不一致');
  const check=spawnSync(process.execPath,[project+'/check.mjs'],{encoding:'utf8'});
  if(check.status)throw Error(check.stdout+check.stderr);
  await edit({action:'deleteIO',nodeId:'local_file'});
  if(s.levels[s.root.id].links.some(e=>e.from.module==='local_file'))throw Error('残留连接');
}));


test('保存布局失败时连接回退', () => withCanvas('rollback', async ({call,project}) => {
  const {readFileSync,rmSync,mkdirSync} = await import('node:fs');
  const s=await call('/api/project'), file=project+'/connections.json', before=readFileSync(file,'utf8');
  mkdirSync(project+'/canvas-layout.json.tmp-'+process.pid);
  const failed=await call('/api/save',{levelId:s.root.id,revision:s.revisions[s.root.id],fileRevisions:s.fileRevisions,links:[],positions:{}});
  if(!failed.error || readFileSync(file,'utf8')!==before)throw Error('失败后连接未恢复');
}));

test('同名不同来源不合并，同源分支共用接口，两层组合仍保留边界', () => withCanvas('nested', async ({call,project}) => {
  const {readFileSync,writeFileSync,mkdirSync,cpSync}=await import('node:fs');
  for(const id of ['c','d']) { cpSync(project+'/modules/a',project+'/modules/'+id,{recursive:true}); const f=project+'/modules/'+id+'/module.json'; const m=JSON.parse(readFileSync(f));m.id=id;writeFileSync(f,JSON.stringify(m)); }
  const f=project+'/connections.json'; const r=JSON.parse(readFileSync(f));
  r.connections=[
    {from:{module:'c',port:'text'},to:{module:'a',port:'text'},info:'来源一'},
    {from:{module:'d',port:'text'},to:{module:'b',port:'text'},info:'来源二'},
    {from:{module:'a',port:'text'},to:{module:'c',port:'text'},info:'输出一'},
    {from:{module:'b',port:'text'},to:{module:'d',port:'text'},info:'输出二'}];r.stop='人工确认后停止';writeFileSync(f,JSON.stringify(r));
  let s=await call('/api/project');
  s=await call('/api/pack',{parentId:s.root.id,memberIds:['a','b'],id:'flow',name:'组合',fileRevisions:s.fileRevisions});if(s.error)throw Error(s.error);
  s=await call('/api/project');if(s.levels.flow.inputs.length!==2||s.levels.flow.outputs.length!==2)throw Error('同名来源被合并');
  if(s.levels.flow.links.length!==4)throw Error('边界不完整');
  const nested=await call('/api/pack',{parentId:s.root.id,memberIds:['flow','c'],id:'outer',name:'外层',fileRevisions:s.fileRevisions});if(nested.error)throw Error(nested.error);
  s=await call('/api/project');if(!s.levels.flow||!s.levels.outer)throw Error('嵌套丢失');
  const io=await call('/api/settings',{action:'ports',levelId:'outer',nodeId:'flow',fileRevisions:s.fileRevisions,inputs:[{name:'renamed',description:'改名'},{name:'text_2',description:'二'}],outputs:s.levels.flow.outputs,renames:{inputs:{text:'renamed'}}});if(io.error)throw Error(io.error);
  if(!io.levels.flow.links.some(e=>e.from.module==='$self'&&e.from.port==='renamed'))throw Error('内部改名未同步');
  if(!io.levels.outer.links.some(e=>e.to.module==='flow'&&e.to.port==='renamed'))throw Error('外部改名未同步');
}));

test('同一个外部输出连接多个内部节点时共用输入', () => withCanvas('branch', async ({call,project}) => {
  const {readFileSync,writeFileSync}=await import('node:fs');const f=project+'/connections.json';const r=JSON.parse(readFileSync(f));r.connections.push({from:{module:'$self',port:'text'},to:{module:'b',port:'text'},info:'同一份原料'});writeFileSync(f,JSON.stringify(r));
  let s=await call('/api/project');const result=await call('/api/pack',{parentId:s.root.id,memberIds:['a','b'],id:'flow',name:'分支',fileRevisions:s.fileRevisions});if(result.error)throw Error(result.error);
  s=await call('/api/project');if(s.levels.flow.inputs.length!==1||s.levels.flow.links.filter(e=>e.from.module==='$self').length!==2)throw Error('同源分支不正确');
}));


test('添加通用节点生成真实模块，可设置多接口，重复和写入失败不留残缺目录', () => withCanvas('create-module',async({call,project})=>{
 const {readFileSync,mkdirSync,existsSync}=await import('node:fs');const {spawnSync}=await import('node:child_process');
 let s=await call('/api/project');
 const create=async(id,extra={})=>call('/api/settings',{action:'createModule',levelId:s.root.id,fileRevisions:s.fileRevisions,node:{id,name:'通用处理',description:'负责处理用户材料'},position:{x:420,y:300},...extra});
 s=await create('generic');if(s.error)throw Error(s.error);
 const dir=project+'/modules/generic';
 for(const file of ['README.md','module.json','VALIDATION.md'])if(!existsSync(dir+'/'+file))throw Error('缺少配套文件');
 if(JSON.parse(readFileSync(dir+'/module.json')).status!=='pending')throw Error('状态应为待配置');
 if(!s.levels[s.root.id].members.some(n=>n.id==='generic'))throw Error('未读回节点');
 if(s.layout[s.root.id].generic.x!==420)throw Error('未保存创建位置');
 const duplicate=await create('generic');if(!duplicate.error)throw Error('重复标识被接受');
 const ports=await call('/api/settings',{action:'ports',levelId:s.root.id,nodeId:'generic',fileRevisions:s.fileRevisions,inputs:[{name:'a',description:'甲'},{name:'b',description:'乙'}],outputs:[{name:'out',description:'结果'}]});if(ports.error)throw Error(ports.error);s=ports;
 const check=spawnSync(process.execPath,[project+'/check.mjs'],{encoding:'utf8'});if(check.status)throw Error(check.stdout+check.stderr);
 mkdirSync(project+'/canvas-layout.json.tmp-'+process.pid);
 const failure=await create('failure');if(!failure.error||existsSync(project+'/modules/failure'))throw Error('失败后残留模块目录');
 const invalid=await create('../escape');if(!invalid.error)throw Error('越界标识被接受');
}));


test('一键创建自动标识，名称职责稍后设置并写回底层',()=>withCanvas('quick-create',async({call,project})=>{
 const {readFileSync}=await import('node:fs');let s=await call('/api/project');const initial=s.levels[s.root.id].members.map(n=>n.id);
 s=await call('/api/settings',{action:'createModule',levelId:s.root.id,fileRevisions:s.fileRevisions,position:{x:500,y:220}});if(s.error)throw Error(s.error);
 const node=s.levels[s.root.id].members.find(n=>!initial.includes(n.id));if(!node||node.name!=='未命名节点'||!node.id.startsWith('node_'))throw Error('未自动创建');
 if(node.inputs.length!==1||node.inputs[0].name!=='input'||node.outputs.length!==1||node.outputs[0].name!=='output')throw Error('新节点缺少默认连线端口');
 const before=s.fileRevisions;
 s=await call('/api/settings',{action:'ports',nodeId:node.id,levelId:s.root.id,fileRevisions:before,name:'材料整理',description:'整理材料。\n\n保留关键条件。',inputs:[{name:'source',description:'原料'}],outputs:[]});if(s.error)throw Error(s.error);
 const updated=s.levels[s.root.id].members.find(n=>n.id===node.id);
 if(updated.name!=='材料整理'||updated.inputs.length!==1||!updated.responsibility.includes('关键条件'))throw Error('设置未同步');
 const meta=JSON.parse(readFileSync(project+'/modules/'+node.id+'/module.json'));if(meta.name!=='材料整理'||meta.status!=='pending')throw Error('登记表不一致');
}));
test('拖线创建节点同时保存位置和连线，端口失效时不创建',()=>withCanvas('create-connected',async({call})=>{
 let s=await call('/api/project');
 const levelId=s.root.id;
 const target=s.levels[levelId].members.find(n=>n.inputs.length);
 const create=(endpoint)=>call('/api/settings',{action:'createModule',levelId,fileRevisions:s.fileRevisions,
   node:{id:'new_source'},position:{x:500,y:220},connect:{direction:'in',endpoint}});
 const invalid=await create({module:target.id,port:'missing'});
 if(!invalid.error)throw Error('无效接口被接受');
 const endpoint={module:target.id,port:target.inputs[0].name};
 const occupied=await create(endpoint);
 if(!occupied.error?.includes('已有来源'))throw Error('允许重复输入来源');
 const links=s.levels[levelId].links.filter(e=>e.to.module!==endpoint.module||e.to.port!==endpoint.port);
 s=await call('/api/save',{levelId,revision:s.revisions[levelId],fileRevisions:s.fileRevisions,links});
 if(s.error)throw Error(s.error);
 s=await create(endpoint);
 if(s.error)throw Error(s.error);
 if(s.layout[levelId].new_source.x!==500 || !s.levels[levelId].links.some(e=>e.from.module==='new_source'&&e.from.port==='output'&&e.to.module===endpoint.module&&e.to.port===endpoint.port))throw Error('未保存节点位置或连线');
 const io=await call('/api/settings',{action:'io',levelId,fileRevisions:s.fileRevisions,node:{id:'new_sink',type:'output',name:'输出',description:'结果'},connect:{direction:'out',endpoint:{module:'new_source',port:'output'}}});
 if(io.error || !io.levels[levelId].links.some(e=>e.from.module==='new_source'&&e.to.module==='new_sink'&&e.to.port==='value'))throw Error(io.error||'未连接输出节点');
}));


test('显示只读，多份草稿隔离，支持重命名、旧版提示和删除',()=>withCanvas('drafts',async({call,formal,primary,open,request,plain,base,token})=>{
 const {readFileSync,writeFileSync,existsSync}=await import('node:fs');
 const before=readFileSync(formal+'/connections.json','utf8');
 const {readdirSync}=await import('node:fs');
 const {createHash}=await import('node:crypto');
 const inventory=dir=>readdirSync(dir,{withFileTypes:true}).filter(e=>e.name!=='.canvas-drafts').flatMap(e=>{
   const path=dir+'/'+e.name;
   return e.isDirectory()?inventory(path):[[path,createHash('sha256').update(readFileSync(path)).digest('hex')]];
 });
 const formalBefore=JSON.stringify(inventory(formal));
 const a=await call('/api/project');
 const body={action:'createModule',levelId:a.root.id,fileRevisions:a.fileRevisions,node:{id:'draft_only'}};
 const blocked=await request('/api/settings',body);
 if(!blocked.error?.includes('只读'))throw Error('正式项目可写');
 const second=await open('另一份草稿');
 const cross=await plain('/api/settings?draft='+second.id,{method:'POST',headers:{'x-canvas-token':primary.token,Origin:base},body:JSON.stringify(body)});
 if(cross.status!==403)throw Error('草稿令牌可以跨草稿写入');
 const edited=await call('/api/settings',body);
 if(edited.error)throw Error(edited.error);
 if(!existsSync(primary.path+'/modules/draft_only')||existsSync(second.path+'/modules/draft_only')||existsSync(formal+'/modules/draft_only')||before!==readFileSync(formal+'/connections.json','utf8'))throw Error('草稿写入越界');
 if(formalBefore!==JSON.stringify(inventory(formal)))throw Error('正式项目文件被草稿操作改变');
 await request('/api/drafts/rename',{id:second.id,name:'另一方案'});
 writeFileSync(formal+'/connections.json',before+' ');
 const list=await request('/api/drafts');
 if(!list.find(d=>d.id===second.id&&d.stale&&d.name==='另一方案'))throw Error('草稿列表状态不正确');
 const old=await request('/api/project',null,second.id,second.token);
 if(old.error||old.levels[old.root.id].members.some(n=>n.id==='draft_only'))throw Error('旧草稿无法继续查看');
 await request('/api/drafts/delete',{id:second.id});
 if(existsSync(second.path)||!existsSync(primary.path))throw Error('删除草稿范围不正确');
}));
test('新草稿为组合空输入创建外部输入节点，已有来源不重复',()=>withCanvas('combo-source',async({call,open,request,formal})=>{
 const {mkdirSync,writeFileSync,readFileSync}=await import('node:fs');
 const dir=formal+'/modules/group';
 mkdirSync(dir+'/modules',{recursive:true});
 writeFileSync(dir+'/module.json',JSON.stringify({id:'group',name:'组合',status:'pending'}));
 writeFileSync(dir+'/README.md','# 组合\n\n## 输入\n\n```interfaces\n[{"name":"material","description":"材料"}]\n```\n\n## 输出\n\n```interfaces\n[]\n```\n');
 writeFileSync(dir+'/connections.json','{"connections":[]}');
 const before=readFileSync(formal+'/connections.json','utf8');
 const draft=await open('组合输入方案');
 let s=await request('/api/project',null,draft.id,draft.token);
 const level=s.levels[s.root.id],edge=level.links.find(e=>e.to.module==='group');
 if(!edge||edge.to.port!=='material'||!level.ioNodes.some(n=>n.id===edge.from.module&&n.type==='input'))throw Error('没有自动创建外部输入');
 s=await request('/api/settings',{action:'ports',levelId:s.root.id,nodeId:'group',fileRevisions:s.fileRevisions,inputs:[{name:'material',description:'材料'}],outputs:[]},draft.id,draft.token);
 if(s.error||s.levels[s.root.id].links.filter(e=>e.to.module==='group').length!==1)throw Error('重复创建来源');
 if(before!==readFileSync(formal+'/connections.json','utf8'))throw Error('修改了正式项目');
}));
test('批量删除节点同时清除连线与布局，正式节点保留',()=>withCanvas('delete-nodes',async({call,formal,project})=>{
 const {existsSync}=await import('node:fs');
 let s=await call('/api/project');
 s=await call('/api/settings',{action:'deleteNodes',levelId:s.root.id,fileRevisions:s.fileRevisions,nodeIds:['a','b']});
 if(s.error)throw Error(s.error);
 if(s.levels[s.root.id].members.some(n=>['a','b'].includes(n.id))||s.levels[s.root.id].links.length)throw Error('删除后残留节点或连线');
 if(existsSync(project+'/modules/a')||!existsSync(formal+'/modules/a'))throw Error('删除范围不正确');
 const {pathToFileURL}=await import('node:url');
 const {readProject}=await import(pathToFileURL(project+'/structure.mjs').href);
 let rejected=false;
 try { readProject(project); } catch(error) { if(!/输出没有来源/.test(error.message))throw error; rejected=true; }
 if(!rejected)throw Error('正式读取放过未接回的输出');
 readProject(formal);
 // 草稿仍可继续接线；补齐输出后不再需要放宽读取。
 s=await call('/api/save',{levelId:s.root.id,revision:s.revisions[s.root.id],fileRevisions:s.fileRevisions,
   links:[{from:{module:'$self',port:'text'},to:{module:'$self',port:'result'},info:'直接交付'}],positions:{}});
 if(s.error)throw Error(s.error);
 readProject(project);
}));
