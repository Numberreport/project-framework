#!/usr/bin/env node
// 项目画布：在浏览器里拖线建连接、把几个模块打成一个组合、查看模块说明书。
//
//   node canvas.mjs
//
// 画布只负责显示和编辑。真实连接始终以各层的 connections.json 为准；
// 节点位置存在根目录的 canvas-layout.json，删掉不影响连接，只是重新布局。
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, cpSync, rmSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';

// 默认检查画布所在的目录；createCanvas(某个目录) 可以指到别处，测试和复用都靠这个。
let ROOT = dirname(fileURLToPath(import.meta.url));
const LAYOUT = 'canvas-layout.json';
const DOCS = ['README.md', 'VALIDATION.md', 'module.json'];
const filesOf = n => [...new Set([...DOCS, n.meta.implementation, n.meta.verify].filter(f => typeof f === 'string' && f && !isAbsolute(f) && !f.split(/[\\/]/).includes('..') && existsSync(join(n.dir,f)) && statSync(join(n.dir,f)).isFile() && inside(realpathSync(n.dir), realpathSync(join(n.dir,f)))) )];
const hash = (text) => createHash('sha256').update(text).digest('hex');
const inside = (base, target) => { const r = relative(base, target); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const rel = (path) => relative(ROOT, path).split(sep).join('/') || '.';
const readText = (path) => existsSync(path) ? readFileSync(path, 'utf8').replace(/^\uFEFF/, '') : '';
const readJson = (path) => { try { return JSON.parse(readText(path)); } catch { return null; } };

// ---- 读取项目结构 -----------------------------------------------------------

// 读一个模块；有 modules/ 就是组合，接着读它的成员。
export function scan(dir) {
  const meta = readJson(join(dir, 'module.json'));
  if (!meta || typeof meta.id !== 'string') throw Error('模块缺少有效的 module.json：' + rel(dir));
  const node = { dir, label: rel(dir), meta, id: meta.id, name: String(meta.name || meta.id), children: [], links: [], stop: '', isCombo: false, inputs: [], outputs: [] };
  // 接口只来自 README：接收的在「输入」小节，交出的在「输出」小节。根目录和模块一样。
  const text = readText(join(dir, 'README.md'));
  const parse = (json) => { try { return JSON.parse(json); } catch { return []; } };
  const blockIn = (scope) => { const b = /```interfaces[ \t]*\r?\n([^]*?)\r?\n```/.exec(scope); return b ? parse(b[1]) : []; };
  const sect = (title) => new RegExp('^##[ \\t]*' + title + '[ \\t]*\\r?\\n([^]*?)(?=^## |$(?![^]))', 'm').exec(text)?.[1] || '';
  node.inputs = blockIn(sect('输入'));
  node.outputs = blockIn(sect('输出'));
  const members = join(dir, 'modules');
  if (existsSync(members) && statSync(members).isDirectory()) {
    node.isCombo = true;
    for (const item of readdirSync(members, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name.startsWith('.') || !statSync(join(members, item.name)).isDirectory()) continue;
      node.children.push(scan(join(members, item.name)));
    }
    const data = readJson(join(dir, 'connections.json'));
    if (!data || !Array.isArray(data.connections)) throw Error('组合缺少 connections.json：' + rel(dir));
    node.ioNodes = data.ioNodes || [];
    validateIO(node.ioNodes);
    const occupied = new Set(node.children.map(c => c.id));
    if (node.ioNodes.some(n => occupied.has(n.id))) throw Error('输入输出节点标识与模块重复');
    node.links = data.connections;
    node.stop = typeof data.stop === 'string' ? data.stop : '';
  }
  return node;
}

const flatten = (node) => [node, ...node.children.flatMap(flatten)];
const findNode = (tree, id) => flatten(tree).find(n => n.id === id);

function loadTree() { return scan(ROOT); }
function readLayout() {
  const data = readJson(join(ROOT, LAYOUT));
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

// 根目录和模块的说明都在各自的 README.md。
function duties(node) {
  const file = 'README.md';
  const body = readText(join(node.dir, file)).match(/^##[ \t]*职责[ \t]*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1].trim() || '';
  return body;
}

// 发给页面的一层数据。
function viewOf(combo) {
  const documents = {};
  for (const file of DOCS) if (existsSync(join(combo.dir, file))) documents[file] = readText(join(combo.dir, file));
  const responsibility = duties(combo);
  return {
    id: combo.id, name: combo.name, label: combo.label, isCombo: combo.isCombo,
    documents, responsibility, summary: responsibility.split(/\r?\n\s*\r?\n/)[0] || '',
    ioNodes: combo.ioNodes || [], inputs: combo.inputs, outputs: combo.outputs, links: combo.links, stop: combo.stop,
    members: combo.children.map(c => ({ id: c.id, name: c.name, label: c.label, isCombo: c.isCombo, responsibility:duties(c), summary: duties(c).split(/\r?\n\s*\r?\n/)[0] || '', inputs: c.inputs, outputs: c.outputs })),
  };
}

// ---- 打包 -------------------------------------------------------------------

// 只算不写。预览和确认用同一份计划。
export function planPack(tree, { parentId, memberIds, id, name, fileRevisions }) {
  if (fileRevisions) assertRevisions(fileRevisions);
  const parent = findNode(tree, parentId);
  if (!parent || !parent.isCombo) throw Error('只能在组合里打包');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id || '')) throw Error('组合标识只能用字母、数字、下划线和短横线');
  if (!String(name || '').trim()) throw Error('请填组合名称');
  const wanted = new Set(memberIds || []);
  const picked = parent.children.filter(c => wanted.has(c.id));
  const pickedIO = (parent.ioNodes || []).filter(n => wanted.has(n.id));
  const totalPicked = picked.length + pickedIO.length;
  if (totalPicked < 2) throw Error('至少选两个模块');
  if (totalPicked !== wanted.size) throw Error('所选模块须是同一层的成员，且不能重复');
  if (flatten(tree).some(n => n.id === id)) throw Error('标识已被占用：' + id);

  const ids = new Set([...picked, ...pickedIO].map(c => c.id));
  const isInner = (e) => ids.has(e.from.module) && ids.has(e.to.module);
  const touching = (e) => ids.has(e.from.module) || ids.has(e.to.module);
  const crossing = parent.links.filter(e => touching(e) && !isInner(e));

  const inputs = [], outputs = [], boundary = [], names = { input: new Map(), output: new Map() };
  const outer = crossing.map(edge => {
    const e = structuredClone(edge), incoming = !ids.has(e.from.module);
    const side = incoming ? 'input' : 'output', ports = incoming ? inputs : outputs;
    const key = JSON.stringify(edge.from);
    let name = names[side].get(key);
    if (!name) {
      const base = incoming ? edge.to.port : edge.from.port;
      name = base; let suffix = 2;
      while (ports.some(p => p.name === name)) name = base + '_' + suffix++;
      names[side].set(key, name); ports.push({ name, description: edge.info });
    }
    const inner = structuredClone(edge);
    if (incoming) { e.to = { module: id, port: name }; inner.from = { module: '$self', port: name }; }
    else { e.from = { module: id, port: name }; inner.to = { module: '$self', port: name }; }
    if (!boundary.some(x => sameEnds(x, inner))) boundary.push(inner);
    return e;
  });

  const targetDir = join(parent.dir, 'modules', id);
  return {
    parentId: parent.id, parentDir: parent.dir, targetDir, id, name: String(name).trim(), stop: parent.stop,
    ioNodes: pickedIO,
    members: picked.map(c => ({ id: c.id, name: c.name, from: rel(join(parent.dir, 'modules', c.id)), to: rel(join(targetDir, 'modules', c.id)) })),
    inner: [...parent.links.filter(isInner), ...boundary], outer, inputs, outputs,
    revisions: { parent: hash(readText(join(parent.dir, 'connections.json'))) },
  };
}

export function describe(plan) {
  return {
    combo: plan.name + '（' + plan.id + '）', location: rel(plan.targetDir),
    ioNodes: plan.ioNodes || [],
    move: plan.members.map(m => ({ name: m.name, id: m.id, from: m.from, to: m.to })),
    inputs: plan.inputs, outputs: plan.outputs,
    inner: plan.inner.length, outer: plan.outer.length,
  };
}

// 打包后，被移动模块里的 Markdown 相对链接会断——不管它指向模块里面还是外面。
// moves 是 [(旧绝对路径, 新绝对路径)]。从「文档的新位置」出发重新算，结果才准。
function rewriteMarkdown(moves) {
  const changes = [];
  const relocated = (path) => {
    const hit = moves.find(([from]) => inside(from, path));
    return hit ? join(hit[1], relative(hit[0], path)) : null;
  };
  for (const [oldDir, newDir] of moves) {
    for (const path of markdownFiles(newDir)) {
      const text = readFileSync(path, 'utf8');
      // 这份文档搬家前在哪：把新路径里属于本模块的前缀换回旧路径。
      const oldPath = join(oldDir, relative(newDir, path));
      let touched = false;
      const next = text.replace(/(\[[^\]]*\]\()([^)#\s]+)(#[^)]*)?(\))/g, (all, open, link, anchor = '', close) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('/')) return all;
        const absolute = join(dirname(oldPath), link);
        // 目标落在被移动的模块里，就跟着一起搬；落在外面（项目根、别的模块），位置不变。
        const target = relocated(absolute) || absolute;
        if (!existsSync(join(ROOT, rel(target))) && !existsSync(target)) return all;
        const fixed = relative(dirname(path), target).split(sep).join('/');
        if (fixed === link) return all;
        touched = true;
        changes.push({ file: rel(path), from: link, to: fixed });
        return open + fixed + anchor + close;
      });
      if (touched) writeFileSync(path, next);
    }
  }
  return changes;
}

// 模块里所有 Markdown，跳过运行记录和成果。
function markdownFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      if (item.name.startsWith('.') || ['node_modules', 'workspace'].includes(item.name)) continue;
      const path = join(current, item.name);
      if (item.isDirectory()) walk(path);
      else if (item.name.endsWith('.md')) found.push(path);
    }
  };
  walk(dir);
  return found;
}

const writeAtomic = (path, content) => { const tmp = path + '.tmp-' + process.pid; writeFileSync(tmp, content); renameSync(tmp, path); };

// 真正写盘。任何一步失败就把已做的改动退回去。
export function applyPack(tree, plan) {
  const parentFile = join(plan.parentDir, 'connections.json');
  if (hash(readText(parentFile)) !== plan.revisions.parent) throw Error('connections.json 已变化，请重新预览');

  const parentBefore = readText(parentFile);
  const parentData = readJson(parentFile);
  const ids = new Set([...plan.members, ...(plan.ioNodes || [])].map(m => m.id));
  // 碰到成员的所有旧线都删掉；跨边界的那几条，外层用改写成经过新组合的版本补回来。
  const newParentLinks = parentData.connections.filter(e => !ids.has(e.from.module) && !ids.has(e.to.module));
  for (const e of plan.outer) {
    if (!newParentLinks.some(x => sameEnds(x, e))) newParentLinks.push(e);
  }

  const moves = plan.members.map(m => [join(ROOT, m.from), join(ROOT, m.to)]);
  if (existsSync(plan.targetDir)) throw Error('目标目录已存在：' + rel(plan.targetDir));

  try {
    // 1. 先复制成员到新位置，再删旧的；复制失败时原目录还在。
    for (const [from, to] of moves) {
      cpSync(from, to, { recursive: true });
      if (!existsSync(join(to, 'module.json'))) throw Error('复制失败：' + rel(from));
    }
    // 2. 新组合的说明书与内部连接。
    mkdirSync(join(plan.targetDir, 'modules'), { recursive: true });
    writeCombo(plan);
    writeAtomic(join(plan.targetDir, 'connections.json'), JSON.stringify({ connections: plan.inner, ...(plan.ioNodes?.length ? { ioNodes: plan.ioNodes } : {}), ...(plan.stop ? { stop: plan.stop } : {}) }, null, 2) + '\n');
    // 3. 父层连接换成经过新组合。
    writeAtomic(parentFile, JSON.stringify({ ...parentData, ...(parentData.ioNodes ? { ioNodes:parentData.ioNodes.filter(n => !ids.has(n.id)) } : {}), connections: newParentLinks }, null, 2) + '\n');
    // 4. 修 Markdown 链接。必须在删旧目录之前做，链接要对照旧位置才解析得出来。
    const links = rewriteMarkdown(moves);
    // 5. 删掉旧目录。
    for (const [from] of moves) rmSync(from, { recursive: true, force: true });
    return { links };
  } catch (e) {
    writeAtomic(parentFile, parentBefore);
    for (const [from, to] of moves) if (!existsSync(from) && existsSync(to)) cpSync(to, from, { recursive: true });
    rmSync(plan.targetDir, { recursive: true, force: true });
    throw e;
  }
}

const e_from_key = (e) => e.from.module + '.' + e.from.port;
const sameEnds = (a, b) => e_from_key(a) === e_from_key(b) && a.to.module + '.' + a.to.port === b.to.module + '.' + b.to.port;

// 新组合的说明书和检查标准。打包能确定的是成员和连接；职责和检查标准留给人补。
// 写成「待补充」而不是 `<待填写>`，检查脚本认后者是在建的样子，前者是能跑的初稿。
function writeCombo(plan) {
  const portBlock = (ports) => '```interfaces\n' + JSON.stringify(ports, null, 2) + '\n```';
  const memberList = plan.members.map(m => '- ' + m.name + '（' + m.id + '）').join('\n');
  const flow = plan.inner.map(e => '- ' + e.from.module + '.' + e.from.port + ' → ' + e.to.module + '.' + e.to.port).join('\n') || '- 暂无内部连接';
  const list = (ports, empty) => ports.length ? ports.map(p => '- ' + p.name + '：' + p.description).join('\n') : empty;
  const files = {
    'module.json': JSON.stringify({ id: plan.id, name: plan.name, template: { id: 'project-framework', version: '3.0.0' }, status: 'pending' }, null, 2) + '\n',
    'README.md': '# ' + plan.name + '\n\n## 职责\n\n由画布打包生成，负责组织以下模块完成一项任务；具体职责请补充一句话说明。\n\n' +
      '成员：\n\n' + memberList + '\n\n' +
      '## 输入\n\n' + list(plan.inputs, '本组合不接收外部输入。') + '\n\n' + portBlock(plan.inputs) + '\n\n' +
      '## 输出\n\n' + list(plan.outputs, '本组合不对外输出。') + '\n\n' + portBlock(plan.outputs) + '\n\n' +
      '## 处理流程\n\n按 connections.json 把输入交给成员，收集成员的交付后对外输出。\n\n内部连接：\n\n' + flow +
      '\n\n## 没完成时\n',
    'VALIDATION.md': '# 检查标准\n\n组合整体的交付怎样算合格，请结合成员各自的 VALIDATION.md 补充。\n\n' +
      '完成后把 module.json 的状态从 pending 改成 ready。\n',
  };
  for (const [name, content] of Object.entries(files)) writeAtomic(join(plan.targetDir, name), content);
}

// ---- 保存连接 ---------------------------------------------------------------

// 保存一层的连接和节点位置。先整体校验，通过了才写盘。
function saveLevel({ levelId, links, stop, positions, revision, fileRevisions }) {
  if (fileRevisions) assertRevisions(fileRevisions);
  const tree = loadTree();
  const level = findNode(tree, levelId);
  if (!level || !level.isCombo) throw Error('只能保存组合层的连接');
  const file = join(level.dir, 'connections.json');
  if (hash(readText(file)) !== revision) throw Error('文件已被其他操作修改，请重新加载后再保存');

  const ids = new Set(level.children.map(c => c.id));
  const ports = new Map([['$self', { outputs: level.inputs, inputs: level.outputs }], ...level.children.map(c => [c.id, { outputs: c.outputs, inputs: c.inputs }])]);
  for (const n of level.ioNodes || []) ports.set(n.id, ioPorts(n));
  for (const e of links) {
    for (const side of ['from', 'to']) {
      const end = e[side];
      if (!end || !ports.has(end.module)) throw Error('连接端点须是本层成员或 $self');
      const owner = ports.get(end.module);
      const want = side === 'from' ? owner.outputs : owner.inputs;
      if (!want.some(p => p.name === end.port)) throw Error('接口不存在：' + end.module + '.' + end.port);
    }
    if (e.kind !== undefined && !['support','return'].includes(e.kind)) throw Error('连接类型无效');
    if (!String(e.info || '').trim()) throw Error('每条连接都要写传的是什么');
  }
  const next = { ...readJson(file), connections: links };
  delete next.stop;
  if (String(stop || '').trim()) next.stop = String(stop).trim();
  const changes = new Map([[file, JSON.stringify(next, null, 2) + '\n']]);

  if (positions && typeof positions === 'object') {
    const layout = readLayout();
    layout[levelId] = positions;
    changes.set(join(ROOT, LAYOUT), JSON.stringify(layout, null, 2) + '\n');
  }
  transaction(changes);
  return snapshot();
}

function snapshot() {
  const tree = loadTree();
  const layout = readLayout();
  const identifiers = new Set();
  for (const n of flatten(tree)) { if (identifiers.has(n.id)) throw Error('重复模块标识：' + n.id); identifiers.add(n.id); }
  for (const n of flatten(tree)) for (const io of n.ioNodes || []) { if (identifiers.has(io.id)) throw Error('重复节点标识：' + io.id); identifiers.add(io.id); }
  const levels = {};
  const collect = (node) => { if (node.isCombo) { levels[node.id] = viewOf(node); node.children.forEach(collect); } };
  collect(tree);
  const pick = (path) => existsSync(path) ? readText(path) : '';
  return {
    fileRevisions: revisions(tree),
    root: { id: tree.id, name: tree.name, label: tree.label },
    levels, layout,
    revisions: Object.fromEntries(Object.keys(levels).map(id => [id, hash(pick(join(findNode(tree, id).dir, 'connections.json')))])),
    docs: Object.fromEntries(flatten(tree).map(n => [n.id, { name: n.name, label: n.label, files: filesOf(n) }])),
  };
}


const validId = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(x);
function validateIO(nodes) {
  if (!Array.isArray(nodes)) throw Error('ioNodes 必须是数组');
  const ids = new Set();
  for (const n of nodes) {
    if (!validId(n.id) || ids.has(n.id) || !['input', 'output'].includes(n.type) || !n.name?.trim() || !n.description?.trim()) throw Error('输入输出节点定义无效或重复');
    ids.add(n.id);
  }
}
const ioPorts = n => ({ inputs: n.type === 'output' ? [{ name: 'value', description: n.description }] : [], outputs: n.type === 'input' ? [{ name: 'value', description: n.description }] : [] });
function revisions(tree) {
  return Object.fromEntries(flatten(tree).flatMap(n => ['README.md', 'module.json', ...(n.isCombo ? ['connections.json'] : [])].map(f => { const path = join(n.dir, f); return [rel(path), hash(readText(path))]; })));
}
function assertRevisions(expected) {
  const current = revisions(loadTree());
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw Error('项目文件已变化，请先核对外部修改；没有覆盖文件');
}
function transaction(changes) {
  const before = new Map([...changes.keys()].map(p => [p, existsSync(p) ? readFileSync(p) : null]));
  try { for (const [p, body] of changes) writeAtomic(p, body); }
  catch (error) { for (const [p, body] of before) { if (body === null) rmSync(p, { force: true }); else writeAtomic(p, body); } throw error; }
}
function validatePorts(ports) {
  if (!Array.isArray(ports)) throw Error('接口必须是数组');
  const seen = new Set();
  for (const p of ports) {
    if (!validId(p.name) || seen.has(p.name) || !p.description?.trim()) throw Error('接口标识须唯一，只能用字母、数字、下划线、短横线，说明不能为空');
    seen.add(p.name);
  }
}
function replacePorts(text, title, ports) {
  const re = new RegExp('(^##[ \t]*' + title + '[ \t]*\r?\n)([^]*?)(?=^## |$(?![^]))', 'm');
  if (!re.test(text)) throw Error('README 缺少' + title + '小节');
  return text.replace(re, (_, head, body) => {
    const block = '```interfaces\n' + JSON.stringify(ports, null, 2) + '\n```';
    return head + (/```interfaces[^]*?```/.test(body) ? body.replace(/```interfaces[^]*?```/, () => block) : body.trimEnd() + '\n\n' + block + '\n\n');
  });
}
export function editStructure(data) {
  if (!data.fileRevisions) throw Error('缺少文件版本');
  assertRevisions(data.fileRevisions);
  const tree = loadTree(), owner = findNode(tree, data.levelId);
  if (!owner?.isCombo) throw Error('层不存在');
  const changes = new Map(), records = new Map();
  let createdDirectory = null;
  const record = n => { if (!records.has(n.id)) records.set(n.id, { node: n, data: readJson(join(n.dir, 'connections.json')) }); return records.get(n.id).data; };
  const setPorts = (n, inputs, outputs) => {
    validatePorts(inputs); validatePorts(outputs);
    let text = readText(join(n.dir, 'README.md'));
    text = replacePorts(replacePorts(text, '输入', inputs), '输出', outputs);
    changes.set(join(n.dir, 'README.md'), text);
  };
  const rewrite = (n, map) => {
    const r = record(n);
    r.connections = r.connections.flatMap(edge => {
      const e = structuredClone(edge);
      for (const side of ['from', 'to']) { const next = map(e[side], side); if (next === null) return []; if (next) e[side] = next; }
      return [e];
    });
  };
  if (data.action === 'createModule') {
    const { id = 'node_' + randomBytes(6).toString('hex'), name = '未命名节点', description = '待补充：说明本节点负责什么。' } = data.node || {};
    if (!validId(id) || typeof name !== 'string' || !name.trim() || typeof description !== 'string' || !description.trim()) throw Error('请填写有效标识、名称和职责');
    if (flatten(tree).some(n => n.id === id || (n.ioNodes || []).some(io => io.id === id))) throw Error('节点标识已被占用');
    const dir = join(owner.dir, 'modules', id);
    if (!inside(realpathSync(ROOT), dir) || existsSync(dir)) throw Error('目标模块目录不可用');
    const block = '```interfaces\n[]\n```';
    const files = {
      'module.json': JSON.stringify({ id, name:name.trim(), template:{id:'project-framework',version:'3.0.0'}, status:'pending' },null,2) + '\n',
      'README.md': '# ' + name.trim() + '\n\n## 职责\n\n' + description.trim() + '\n\n## 输入\n\n' + block + '\n\n## 输出\n\n' + block + '\n\n## 处理流程\n\n待补充：说明如何处理输入并交付输出。\n\n## 没完成时\n\n缺少材料或处理规则时停止，说明缺少什么。\n',
      'VALIDATION.md': '# 检查标准\n\n待补充：说明怎样判断本模块的交付合格。完成后将 module.json 的 status 改为 ready。\n',
    };
    for (const [file, content] of Object.entries(files)) changes.set(join(dir,file),content);
    if (data.position && Number.isFinite(data.position.x) && Number.isFinite(data.position.y)) {
      const layout = readLayout(); layout[owner.id] ||= {};
      layout[owner.id][id] = { x:Math.max(0,data.position.x),y:Math.max(0,data.position.y) };
      changes.set(join(ROOT,LAYOUT),JSON.stringify(layout,null,2)+'\n');
    }
    createdDirectory = dir;
  } else if (data.action === 'ports') {
    const n = findNode(tree, data.nodeId);
    if (!n || !(n.id === owner.id || owner.children.some(c => c.id === n.id))) throw Error('节点不属于当前层');
    setPorts(n, data.inputs, data.outputs);
    if (data.name !== undefined || data.description !== undefined) {
      if (typeof data.name !== 'string' || !data.name.trim() || typeof data.description !== 'string' || !data.description.trim()) throw Error('名称和职责不能为空');
      const meta = { ...n.meta, name:data.name.trim() };
      changes.set(join(n.dir,'module.json'), JSON.stringify(meta,null,2)+'\n');
      const path = join(n.dir,'README.md');
      let text = changes.get(path);
      text = text.replace(/^# [^\r\n]*/m, () => '# ' + data.name.trim());
      text = text.replace(/(^##[ \t]*职责[ \t]*\r?\n)([^]*?)(?=^## |$(?![^]))/m, (_,head) => head + '\n' + data.description.trim() + '\n\n');
      changes.set(path,text);
    }
    const remap = (end, side, self) => {
      if (end.module !== (self ? '$self' : n.id)) return;
      const direction = self ? (side === 'from' ? 'inputs' : 'outputs') : (side === 'from' ? 'outputs' : 'inputs');
      if (data.removals?.[direction]?.includes(end.port)) return null;
      const rename = data.renames?.[direction] || {};
      const name = rename[end.port] || end.port;
      if (!data[direction].some(p => p.name === name)) return null;
      return { ...end, port: name };
    };
    const parent = flatten(tree).find(p => p.children.some(c => c.id === n.id));
    if (parent) rewrite(parent, (end, side) => remap(end, side, false));
    if (n.isCombo) rewrite(n, (end, side) => remap(end, side, true));
  } else {
    const r = record(owner); r.ioNodes ||= [];
    if (data.action === 'io') {
      const n = data.node;
      const existing = r.ioNodes.find(x => x.id === n.id);
      if (existing && existing.type !== n.type) throw Error('不能更改节点方向，请新建另一类节点');
      if (!existing && flatten(tree).some(x => x.id === n.id || (x.ioNodes || []).some(io => io.id === n.id))) throw Error('标识已被模块占用');
      r.ioNodes = r.ioNodes.filter(x => x.id !== n.id); r.ioNodes.push(n); validateIO(r.ioNodes);
    } else if (data.action === 'deleteIO') {
      if (!r.ioNodes.some(n => n.id === data.nodeId)) throw Error('节点不存在');
      r.ioNodes = r.ioNodes.filter(n => n.id !== data.nodeId);
      r.connections = r.connections.filter(e => e.from.module !== data.nodeId && e.to.module !== data.nodeId);
    } else if (data.action === 'expose') {
      const n = r.ioNodes.find(n => n.id === data.nodeId); if (!n) throw Error('节点不存在');
      const inputs = structuredClone(owner.inputs), outputs = structuredClone(owner.outputs);
      const list = n.type === 'input' ? inputs : outputs;
      if (list.some(p => p.name === data.port)) throw Error('外层已有同名接口');
      list.push({ name: data.port, description: n.description }); setPorts(owner, inputs, outputs);
      rewrite(owner, end => end.module === n.id ? { module: '$self', port: data.port } : undefined);
      r.ioNodes = r.ioNodes.filter(x => x.id !== n.id);
    } else if (data.action === 'detach') {
      const list = data.type === 'input' ? owner.inputs : owner.outputs, port = list.find(p => p.name === data.port);
      if (!port) throw Error('接口不存在');
      const node = { id: data.nodeId, type: data.type, name: port.name, description: port.description };
      if (flatten(tree).some(n => n.id === node.id || (n.ioNodes || []).some(io => io.id === node.id)) || r.ioNodes.some(n => n.id === node.id)) throw Error('标识重复');
      r.ioNodes.push(node); validateIO(r.ioNodes);
      setPorts(owner, data.type === 'input' ? owner.inputs.filter(p => p !== port) : owner.inputs, data.type === 'output' ? owner.outputs.filter(p => p !== port) : owner.outputs);
      rewrite(owner, (end, side) => end.module === '$self' && end.port === data.port && side === (data.type === 'input' ? 'from' : 'to') ? { module: node.id, port: 'value' } : undefined);
      const parent = flatten(tree).find(p => p.children.some(c => c.id === owner.id));
      if (parent) rewrite(parent, (end, side) => end.module === owner.id && end.port === data.port && side === (data.type === 'input' ? 'to' : 'from') ? null : undefined);
    } else throw Error('未知结构操作');
  }
  for (const { node, data: r } of records.values()) changes.set(join(node.dir, 'connections.json'), JSON.stringify(r, null, 2) + '\n');
  assertRevisions(data.fileRevisions);
  if (createdDirectory) mkdirSync(createdDirectory);
  try { transaction(changes); }
  catch (error) { if (createdDirectory) rmSync(createdDirectory, {recursive:true,force:true}); throw error; }
  return snapshot();
}

// ---- HTTP 服务 --------------------------------------------------------------

export function createCanvas(rootDir = ROOT) {
  ROOT = rootDir;
  const token = randomBytes(24).toString('hex');
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = 'http://127.0.0.1:' + req.socket.localPort;
    if (req.headers.host !== origin.slice(7) || (req.headers.origin && req.headers.origin !== origin)) { res.writeHead(403).end(); return; }
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(PAGE().replace('__TOKEN__', token));
        return;
      }
      if (req.headers['x-canvas-token'] !== token) { res.writeHead(403).end(); return; }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (req.method === 'GET' && req.url === '/api/project') { res.end(JSON.stringify(snapshot())); return; }
      if (req.method === 'GET' && req.url.startsWith('/api/doc?')) {
        const url = new URL(req.url, origin);
        const id = url.searchParams.get('id'), name = url.searchParams.get('file');
        const node = findNode(loadTree(), id);
        if (!node || !filesOf(node).includes(name)) throw Error('没有这个文件');
        res.end(JSON.stringify({ name, path: rel(join(node.dir, name)), content: readText(join(node.dir, name)) }));
        return;
      }
      if (req.method !== 'POST') { res.writeHead(404).end(); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2e6) throw Error('内容过大'); }
      const data = body ? JSON.parse(body) : {};
      if (req.url === '/api/settings') { res.end(JSON.stringify(editStructure(data))); return; }
      if (req.url === '/api/save') { res.end(JSON.stringify(saveLevel(data))); return; }
      if (req.url === '/api/pack-preview') {
        res.end(JSON.stringify(describe(planPack(loadTree(), data))));
        return;
      }
      if (req.url === '/api/pack') {
        const plan = planPack(loadTree(), data);
        const result = applyPack(loadTree(), plan);
        res.end(JSON.stringify({ done: describe(plan), ...result }));
        return;
      }
      res.writeHead(404).end();
    } catch (e) { res.writeHead(400).end(JSON.stringify({ error: e.message })); }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createCanvas();
  server.listen(0, '127.0.0.1', () => {
    console.log('项目画布：http://127.0.0.1:' + server.address().port);
    console.log('停止这个进程就关闭画布。');
  });
}


// 页面单独放 canvas.html，读一次缓存在内存里，改了重启服务即可生效。
const PAGE_PATH = join(ROOT, 'canvas.html');
const PAGE = () => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'canvas.html'), 'utf8');
