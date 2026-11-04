import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = join(dirname(fileURLToPath(import.meta.url)), '..');

// 画布服务持有模块级状态（当前项目的根目录），同一进程里反复创建会互相干扰。
// 所以每个用例复制一份项目，在独立子进程里起服务、跑断言、退出。
const runner = `
import { pathToFileURL } from 'node:url';
const project = process.argv[2];
const { createCanvas } = await import(pathToFileURL(project + '/canvas.mjs').href);
const server = createCanvas(project);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const token = (await (await fetch(base + '/')).text()).match(/const TOKEN = '([^']+)'/)[1];
const headers = { 'x-canvas-token': token, 'Content-Type': 'application/json', Origin: base };
const call = async (path, body) => (await fetch(base + path, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers })).json();
const plain = async (path, opts) => { const r = await fetch(base + path, opts); return { status: r.status, text: await r.text() }; };
const cases = (await import(pathToFileURL(project + '/tests/case.mjs').href)).default;
try { await cases({ call, plain, base, token, project }); }
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
    writeFileSync(join(dir, 'module.json'), JSON.stringify({ id, name: id === 'a' ? '甲' : '乙', template: { id: 'project-framework', version: '3.0.0' }, status: 'ready' }, null, 2) + '\n');
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
    cpSync(source, project, { recursive: true, filter: path => !['runs', 'outputs', 'node_modules', 'tests', '.git'].includes(basename(path)) && (dirname(path) !== join(source, 'modules') || basename(path) === 'framework_feedback') });
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

test('页面能打开，根目录作为一层显示三个成员', () => withCanvas('open', async ({ call }) => {
  const data = await call('/api/project');
  if (!data.levels[data.root.id]) throw Error('根目录应作为一层');
  const count = data.levels[data.root.id].members.length;
  if (count !== 3) throw Error('成员数应为 3（框架反馈 + 两个样本），实际 ' + count);
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
  s=await call('/api/save',{levelId:s.root.id,revision:s.revisions[s.root.id],fileRevisions:s.fileRevisions,links:[...l.links,{from:{module:'upload',port:'value'},to:{module:'a',port:'text'},info:'上传文件'}]});
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
 const before=s.fileRevisions;
 s=await call('/api/settings',{action:'ports',nodeId:node.id,levelId:s.root.id,fileRevisions:before,name:'材料整理',description:'整理材料。\n\n保留关键条件。',inputs:[{name:'source',description:'原料'}],outputs:[]});if(s.error)throw Error(s.error);
 const updated=s.levels[s.root.id].members.find(n=>n.id===node.id);
 if(updated.name!=='材料整理'||updated.inputs.length!==1||!updated.responsibility.includes('关键条件'))throw Error('设置未同步');
 const meta=JSON.parse(readFileSync(project+'/modules/'+node.id+'/module.json'));if(meta.name!=='材料整理'||meta.status!=='pending')throw Error('登记表不一致');
}));
