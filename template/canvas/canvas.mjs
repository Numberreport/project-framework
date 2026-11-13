#!/usr/bin/env node
// 项目画布：在浏览器里拖线建连接、把几个模块打成一个组合、查看模块说明书。
//
//   node canvas/canvas.mjs
//
// 画布只负责显示和编辑。真实连接始终以各层的 connections.json 为准；
// 节点位置存在根目录的 canvas-layout.json，删掉不影响连接，只是重新布局。
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, cpSync, rmSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { readProject, projectVersion, projectFileFilter, headingsOf, sectionOf, validateGuidance } from '../structure.mjs';

// 默认读取画布目录的上一级项目；createCanvas(某个目录) 可以指到别处，测试和复用都靠这个。
let ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LAYOUT = 'canvas-layout.json';
const DOCS = ['README.md', 'VALIDATION.md', 'module.json'];
function filesOf(node) {
  const files = new Set();
  const allowed = new Set(['.md','.json','.py','.js','.mjs','.cjs','.ts','.tsx','.jsx','.css','.html','.txt','.yaml','.yml','.toml','.ps1','.sh']);
  const skip = new Set(['modules','workspace','node_modules','__pycache__','preferences','history']);
  const add = file => {
    if (typeof file !== 'string' || !file || isAbsolute(file) || file.split(/[\\/]/).includes('..')) return;
    const path = join(node.dir,file);
    if (!existsSync(path) || !inside(realpathSync(node.dir),realpathSync(path))) return;
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 800000 || readFileSync(path).includes(0)) return;
    files.add(file.split('\\').join('/'));
  };
  [...DOCS,node.meta.implementation,node.meta.verify].forEach(add);
  const walk = (dir, depth = 0) => {
    if (depth > 8) return;
    for (const item of readdirSync(join(node.dir,dir),{withFileTypes:true})) {
      if (item.isSymbolicLink() || item.name.startsWith('.') || skip.has(item.name)) continue;
      const file = dir ? dir + '/' + item.name : item.name;
      const path = join(node.dir,file);
      if (!inside(realpathSync(node.dir),realpathSync(path))) continue;
      if (item.isDirectory()) walk(file,depth+1);
      else if (allowed.has(item.name.slice(item.name.lastIndexOf('.')).toLowerCase())) add(file);
    }
  };
  walk('');
  return [...files];
}
const hash = (text) => createHash('sha256').update(text).digest('hex');
const inside = (base, target) => { const r = relative(base, target); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const rel = (path) => relative(ROOT, path).split(sep).join('/') || '.';
const readText = (path) => existsSync(path) ? readFileSync(path, 'utf8').replace(/^\uFEFF/, '') : '';
const readJson = (path) => { try { return JSON.parse(readText(path)); } catch { return null; } };

// ---- 读取项目结构 -----------------------------------------------------------

// 读一个模块；有 modules/ 就是组合，接着读它的成员。
export const scan = readProject;

const flatten = (node) => [node, ...node.children.flatMap(flatten)];
const findNode = (tree, id) => flatten(tree).find(n => n.id === id);

function loadTree() {
  // 草稿允许先拆线再重接；正式读取和执行仍逐项检查输出来源。
  return scan(ROOT, { allowIncompleteOutputs: ROOT.split(/[\\/]/).includes('.canvas-drafts') });
}
function readLayout() {
  const data = readJson(join(ROOT, LAYOUT));
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

// 根目录和模块的说明都在各自的 README.md。
function duties(node) {
  const file = 'README.md';
  return sectionOf(readText(join(node.dir, file)), '职责')?.trim() || '';
}

// 发给页面的一层数据。
function viewOf(combo) {
  const documents = {};
  for (const file of DOCS) if (existsSync(join(combo.dir, file))) documents[file] = readText(join(combo.dir, file));
  const responsibility = duties(combo);
  return {
    id: combo.id, name: combo.name, label: combo.label, isCombo: combo.isCombo, guidance:combo.meta.guidance || null,
    documents, responsibility, summary: responsibility.split(/\r?\n\s*\r?\n/)[0] || '',
    ioNodes: combo.ioNodes || [], inputs: combo.inputs, outputs: combo.outputs, links: combo.links, stop: combo.stop,
    members: combo.children.map(c => ({ id: c.id, name: c.name, label: c.label, isCombo: c.isCombo, guidance:c.meta.guidance || null, confirmation:combo.links.some(e=>e.from.module===c.id || e.to.module===c.id) && (combo.meta.guidance?.mode === 'all' || (combo.meta.guidance?.mode === 'key' && combo.meta.guidance.checkpoints.includes(c.id))), responsibility:duties(c), summary: duties(c).split(/\r?\n\s*\r?\n/)[0] || '', inputs: c.inputs, outputs: c.outputs })),
  };
}

// ---- 打包 -------------------------------------------------------------------

// 只算不写。预览和确认用同一份计划。
export function planPack(tree, { parentId, memberIds, id, name, fileRevisions }) {
  if (fileRevisions) inProject(tree.dir, () => assertRevisions(fileRevisions));
  const projectPath = path => relative(tree.dir, path).split(sep).join('/') || '.';
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
  if (parent.meta.guidance && (parent.meta.guidance.mode === 'all' || parent.meta.guidance.checkpoints.some(id=>ids.has(id)))) throw Error('所选节点涉及确认设置，请先调整所属组合的流程引导设置再打包');
  const isInner = (e) => ids.has(e.from.module) && ids.has(e.to.module);
  const touching = (e) => ids.has(e.from.module) || ids.has(e.to.module);
  if (parent.links.some(e => touching(e) && e.when !== undefined)) {
    throw Error('包含条件连线的选区暂不支持自动组成组合，需先明确组合接口与条件流程；项目文件未修改');
  }
  const crossing = parent.links.filter(e => touching(e) && !isInner(e));
  const incomingTargets = new Map();
  for (const edge of crossing.filter(e => ids.has(e.to.module))) {
    const source = JSON.stringify([edge.from.module, edge.from.port]);
    const targets = incomingTargets.get(source) || [];
    targets.push(JSON.stringify([edge.to.module, edge.to.port]));
    incomingTargets.set(source, targets);
  }
  const inputGroups = new Map(), groupsByTarget = new Map();
  for (const [source, targets] of incomingTargets) {
    const group = JSON.stringify(targets.sort());
    for (const target of targets) {
      if (groupsByTarget.has(target) && groupsByTarget.get(target) !== group) {
        throw Error('外部来源的接收接口部分重叠，自动组成组合会改变材料的交接，请先调整连线；项目文件未修改');
      }
      groupsByTarget.set(target, group);
    }
    inputGroups.set(source, group);
  }

  const inputs = [], outputs = [], boundary = [], names = { input: new Map(), output: new Map() };
  const outer = crossing.map(edge => {
    const e = structuredClone(edge), incoming = !ids.has(e.from.module);
    const side = incoming ? 'input' : 'output', ports = incoming ? inputs : outputs;
    const source = JSON.stringify([edge.from.module, edge.from.port]);
    const key = incoming ? inputGroups.get(source) : source;
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
    rootDir: tree.dir, parentId: parent.id, parentDir: parent.dir, targetDir, id, name: String(name).trim(), stop: parent.stop,
    ioNodes: pickedIO,
    members: picked.map(c => ({ id: c.id, name: c.name, from: projectPath(c.dir), to: projectPath(join(targetDir, 'modules', c.id)) })),
    inner: [...parent.links.filter(isInner), ...boundary], outer, inputs, outputs,
    revisions: { parent: hash(readText(join(parent.dir, 'connections.json'))) },
  };
}

export function describe(plan) {
  return {
    combo: plan.name + '（' + plan.id + '）', location: relative(plan.rootDir, plan.targetDir).split(sep).join('/'),
    ioNodes: plan.ioNodes || [],
    move: plan.members.map(m => ({ name: m.name, id: m.id, from: m.from, to: m.to })),
    inputs: plan.inputs, outputs: plan.outputs,
    inner: plan.inner.length, outer: plan.outer.length,
  };
}

// 在移动前计算全文档的引用变化，同时覆盖移出、移入及未移动文件中的反向链接。
function planMarkdownChanges(tree, moves) {
  const root = tree.dir;
  const changes = [];
  const relocated = (path) => {
    const hit = moves.find(([from]) => inside(from, path));
    return hit ? join(hit[1], relative(hit[0], path)) : null;
  };
  for (const originalPath of markdownFiles(tree)) {
    const path = relocated(originalPath) || originalPath;
    const before = readFileSync(originalPath, 'utf8'), links = [];
    const after = before.replace(/(\[[^\]]*\]\()(<[^>]+>|[^)\s]+)(\))/g, (all, open, destination, close) => {
      const angled = destination.startsWith('<');
      const raw = angled ? destination.slice(1, -1) : destination;
      const split = raw.indexOf('#'), link = split < 0 ? raw : raw.slice(0, split), anchor = split < 0 ? '' : raw.slice(split);
      if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('/')) return all;
      const originalTarget = join(dirname(originalPath), link);
      if (!existsSync(originalTarget) || !inside(root, realpathSync(originalTarget))) return all;
      const target = relocated(originalTarget) || originalTarget;
      const fixed = relative(dirname(path), target).split(sep).join('/');
      if (fixed === link) return all;
      links.push({ file: relative(root, path).split(sep).join('/'), from: link, to: fixed });
      return open + (angled ? '<' : '') + fixed + anchor + (angled ? '>' : '') + close;
    });
    if (links.length) changes.push({ originalPath, path, before, after, links });
  }
  return changes;
}

// 项目里的 Markdown，跳过运行记录、草稿、依赖及链接目录。
function markdownFiles(tree) {
  const include = projectFileFilter(tree);
  const found = [];
  const walk = (current) => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, item.name);
      if (item.isSymbolicLink() || item.name === '.canvas-trash' || !include(path)) continue;
      if (item.isDirectory()) walk(path);
      else if (item.name.endsWith('.md')) found.push(path);
    }
  };
  walk(tree.dir);
  return found;
}

const writeAtomic = (path, content) => { const tmp = path + '.tmp-' + process.pid; writeFileSync(tmp, content, {flag:'wx'}); try { renameSync(tmp, path); } catch (error) { rmSync(tmp,{force:true}); throw error; } };

// 真正写盘。任何一步失败就把已做的改动退回去。
export function applyPack(tree, plan, { write = writeAtomic } = {}) {
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

  const moves = plan.members.map(m => [join(tree.dir, m.from), join(tree.dir, m.to)]);
  if (existsSync(plan.targetDir)) throw Error('目标目录已存在：' + rel(plan.targetDir));
  const markdown = planMarkdownChanges(tree, moves);
  const writtenMarkdown = [];
  let parentWritten = false, removingMembers = false;

  try {
    // 1. 先复制成员到新位置，再删旧的；复制失败时原目录还在。
    for (const [from, to] of moves) {
      cpSync(from, to, { recursive: true });
      if (!existsSync(join(to, 'module.json'))) throw Error('复制失败：' + rel(from));
    }
    // 2. 新组合的说明书与内部连接。
    mkdirSync(join(plan.targetDir, 'modules'), { recursive: true });
    for (const [name, content] of Object.entries(combinationFiles(plan))) write(join(plan.targetDir, name), content);
    write(join(plan.targetDir, 'connections.json'), JSON.stringify({ connections: plan.inner, ...(plan.ioNodes?.length ? { ioNodes: plan.ioNodes } : {}), ...(plan.stop ? { stop: plan.stop } : {}) }, null, 2) + '\n');
    // 3. 父层连接换成经过新组合。
    write(parentFile, JSON.stringify({ ...parentData, ...(parentData.ioNodes ? { ioNodes:parentData.ioNodes.filter(n => !ids.has(n.id)) } : {}), connections: newParentLinks }, null, 2) + '\n');
    parentWritten = true;
    // 4. 更新内外文档引用；失败时未移动文档也须恢复。
    for (const change of markdown) {
      write(change.path, change.after);
      writtenMarkdown.push(change);
    }
    // 5. 删掉旧目录。
    removingMembers = true;
    for (const [from] of moves) rmSync(from, { recursive: true, force: true });
    return { links: markdown.flatMap(change => change.links) };
  } catch (e) {
    if (parentWritten) write(parentFile, parentBefore);
    if (removingMembers) {
      for (const [from, to] of moves) if (existsSync(to)) cpSync(to, from, { recursive: true });
    }
    for (const change of writtenMarkdown) {
      if (change.path === change.originalPath || removingMembers) write(change.originalPath, change.before);
    }
    rmSync(plan.targetDir, { recursive: true, force: true });
    throw e;
  }
}

const connectionKey = ({ from, to }) => JSON.stringify([from.module, from.port, to.module, to.port]);
const sameEnds = (a, b) => connectionKey(a) === connectionKey(b);

// 新组合的说明书和检查标准。打包能确定的是成员和连接；职责和检查标准留给人补。
// 新组合保持 pending；补齐说明和检查标准并自查通过后，才能改为 ready。
export function combinationFiles(plan) {
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
      '\n\n## 没完成时\n\n当前组合为待配置状态，不得运行。缺少职责、处理规则、连接或检查标准时停止并说明缺项；补齐并自检后再改为 ready。\n',
    'VALIDATION.md': '# 检查标准\n\n组合整体的交付怎样算合格，请结合成员各自的 VALIDATION.md 补充。\n\n' +
      '完成后把 module.json 的状态从 pending 改成 ready。\n',
  };
  return files;
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
  const stored = readJson(file);
  // 保留已有的同端点条件线，防止本次保存意外新增重复连线。
  const existingCounts = new Map(), counts = new Map();
  for (const edge of stored.connections) {
    const key = connectionKey(edge);
    existingCounts.set(key, (existingCounts.get(key) || 0) + 1);
  }
  for (const edge of links) {
    const key = connectionKey(edge);
    const count = (counts.get(key) || 0) + 1;
    if (count > (existingCounts.get(key) || 1)) throw Error('同一对接口不能新增重复连线');
    counts.set(key, count);
  }
  const next = { ...stored, connections: links };
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

function addCombinationSources() {
  const tree = loadTree();
  const layout = readLayout();
  const changes = new Map();
  for (const parent of flatten(tree).filter(node => node.isCombo)) {
    const record = readJson(join(parent.dir,'connections.json'));
    let changed = false;
    for (const combination of parent.children.filter(node => node.isCombo)) {
      for (const [index, port] of combination.inputs.entries()) {
        if (record.connections.some(edge => edge.to.module === combination.id && edge.to.port === port.name)) continue;
        const id = 'input_' + randomBytes(8).toString('hex');
        record.ioNodes ||= [];
        record.ioNodes.push({id,type:'input',name:port.name,description:port.description});
        record.connections.push({from:{module:id,port:'value'},to:{module:combination.id,port:port.name},info:port.description});
        layout[parent.id] ||= {};
        const position = layout[parent.id][combination.id] || {x:370,y:70};
        layout[parent.id][id] = {x:position.x-400,y:position.y+index*190};
        changed = true;
      }
    }
    if (changed) changes.set(join(parent.dir,'connections.json'),JSON.stringify(record,null,2)+'\n');
  }
  if (changes.size) {
    changes.set(join(ROOT,LAYOUT),JSON.stringify(layout,null,2)+'\n');
    transaction(changes);
  }
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
    sourceVersion: projectVersion(tree),
    fileRevisions: revisions(tree),
    root: { id: tree.id, name: tree.name, label: tree.label },
    levels, layout,
    revisions: Object.fromEntries(Object.keys(levels).map(id => [id, hash(pick(join(findNode(tree, id).dir, 'connections.json')))])),
    docs: Object.fromEntries(flatten(tree).map(n => [n.id, { name: n.name, label: n.label, implementation:n.meta.implementation || null, verify:n.meta.verify || null, files: filesOf(n) }])),
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
function replaceSection(text, title, replace) {
  const headings = headingsOf(text), index = headings.findIndex(match => match[1] === title);
  if (index < 0) throw Error('README 缺少' + title + '小节');
  const start = headings[index].index + headings[index][0].length;
  const end = headings[index + 1]?.index ?? text.length;
  return text.slice(0, start) + replace(text.slice(start, end)) + text.slice(end);
}
export function replacePorts(text, title, ports) {
  return replaceSection(text, title, body => {
    const block = '```interfaces\n' + JSON.stringify(ports, null, 2) + '\n```';
    const pattern = /```interfaces[ \t]*\r?\n[^]*?\r?\n```/;
    return pattern.test(body) ? body.replace(pattern, () => block) : body.trimEnd() + '\n\n' + block + '\n\n';
  });
}
export function editStructure(data) {
  if (!data.fileRevisions) throw Error('缺少文件版本');
  assertRevisions(data.fileRevisions);
  const tree = loadTree(), owner = findNode(tree, data.levelId);
  if (!owner?.isCombo) throw Error('层不存在');
  if (data.action === 'deleteNodes') {
    const ids = new Set(data.nodeIds);
    const members = owner.children.filter(node => ids.has(node.id));
    const io = (owner.ioNodes || []).filter(node => ids.has(node.id));
    if (!ids.size || members.length + io.length !== ids.size) throw Error('只能删除当前层的节点');
    const record = readJson(join(owner.dir,'connections.json'));
    record.ioNodes = (record.ioNodes || []).filter(node => !ids.has(node.id));
    record.connections = record.connections.filter(edge => !ids.has(edge.from.module) && !ids.has(edge.to.module));
    const layout = readLayout();
    for (const id of ids) if (layout[owner.id]) delete layout[owner.id][id];
    for (const node of members.flatMap(flatten)) delete layout[node.id];
    const trash = join(ROOT,'.canvas-trash',randomBytes(12).toString('hex'));
    mkdirSync(trash,{recursive:true});
    const moved = [];
    try {
      for (const member of members) {
        const target = join(trash,member.id);
        renameSync(member.dir,target);
        moved.push([member.dir,target]);
      }
      transaction(new Map([
        [join(owner.dir,'module.json'),JSON.stringify({...owner.meta,...(owner.meta.guidance ? {guidance:{...owner.meta.guidance,checkpoints:owner.meta.guidance.checkpoints.filter(id=>!ids.has(id))}} : {})},null,2)+'\n'],
        [join(owner.dir,'connections.json'),JSON.stringify(record,null,2)+'\n'],
        [join(ROOT,LAYOUT),JSON.stringify(layout,null,2)+'\n'],
      ]));
    } catch (error) {
      for (const [original,target] of moved.reverse()) renameSync(target,original);
      throw error;
    }
    return snapshot();
  }
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
  const placeNode = id => {
    const position = data.position;
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    const layout = readLayout();
    layout[owner.id] ||= {};
    layout[owner.id][id] = { x:position.x, y:position.y };
    changes.set(join(ROOT,LAYOUT),JSON.stringify(layout,null,2)+'\n');
  };
  const attachNewNode = (id, newPorts) => {
    if (!data.connect) return;
    const { endpoint, direction } = data.connect;
    if (!['in','out'].includes(direction) || !endpoint) throw Error('连接端点无效');
    const member = owner.children.find(n => n.id === endpoint.module);
    const io = owner.ioNodes?.find(n => n.id === endpoint.module);
    const ports = endpoint.module === '$self' ? { inputs:owner.outputs, outputs:owner.inputs } : member || (io && ioPorts(io));
    const existingPort = ports?.[direction === 'out' ? 'outputs' : 'inputs']?.find(p => p.name === endpoint.port);
    const newPort = newPorts[direction === 'out' ? 'inputs' : 'outputs']?.[0];
    if (!existingPort || !newPort) throw Error('接口不存在或方向不匹配');
    const existing = { module:endpoint.module, port:endpoint.port };
    const fresh = { module:id, port:newPort.name };
    const source = direction === 'out' ? existingPort : newPort;
    const target = direction === 'out' ? fresh : existing;
    record(owner).connections.push({
      from:direction === 'out' ? existing : fresh,
      to:target,
      info:source.description?.trim() || source.name,
    });
  };
  if (data.action === 'createModule') {
    const { id = 'node_' + randomBytes(6).toString('hex'), name = '未命名节点', description = '待补充：说明本节点负责什么。' } = data.node || {};
    if (!validId(id) || typeof name !== 'string' || !name.trim() || typeof description !== 'string' || !description.trim()) throw Error('请填写有效标识、名称和职责');
    if (flatten(tree).some(n => n.id === id || (n.ioNodes || []).some(io => io.id === id))) throw Error('节点标识已被占用');
    const dir = join(owner.dir, 'modules', id);
    if (!inside(realpathSync(ROOT), dir) || existsSync(dir)) throw Error('目标模块目录不可用');
    const inputBlock = '```interfaces\n[{ "name": "input", "description": "待处理的材料" }]\n```';
    const outputBlock = '```interfaces\n[{ "name": "output", "description": "处理后的结果" }]\n```';
    const files = {
      'module.json': JSON.stringify({ id, name:name.trim(), template:{id:'project-framework',version:'3.0.0'}, status:'pending' },null,2) + '\n',
      'README.md': '# ' + name.trim() + '\n\n## 职责\n\n' + description.trim() + '\n\n## 输入\n\n' + inputBlock + '\n\n## 输出\n\n' + outputBlock + '\n\n## 处理流程\n\n待补充：说明如何处理输入并交付输出。\n\n## 没完成时\n\n缺少材料或处理规则时停止，说明缺少什么。\n',
      'VALIDATION.md': '# 检查标准\n\n待补充：说明怎样判断本模块的交付合格。完成后将 module.json 的 status 改为 ready。\n',
    };
    for (const [file, content] of Object.entries(files)) changes.set(join(dir,file),content);
    placeNode(id);
    attachNewNode(id, { inputs:[{name:'input'}], outputs:[{name:'output',description:'处理后的结果'}] });
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
      text = replaceSection(text, '职责', () => '\n\n' + data.description.trim() + '\n\n');
      changes.set(path,text);
    }
    if (data.guidance !== undefined) {
      validateGuidance({...n,meta:{...n.meta,guidance:data.guidance}});
      const path = join(n.dir,'module.json');
      const meta = changes.has(path) ? JSON.parse(changes.get(path)) : n.meta;
      changes.set(path,JSON.stringify({...meta,guidance:data.guidance},null,2)+'\n');
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
      if (!existing) {
        placeNode(n.id);
        attachNewNode(n.id,ioPorts(n));
      }
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

function inProject(root, operation) {
  const previous = ROOT;
  ROOT = root;
  try { return operation(); } finally { ROOT = previous; }
}

// 草稿与正式版本采用相同文件范围，另保留布局；凭据与链接文件始终不复制。
export function copyProjectFiles(tree, target) {
  const include = projectFileFilter(tree);
  const allowed = source => (include(source) || source === join(tree.dir, LAYOUT)) && realpathSync(source) === source;
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(tree.dir, { withFileTypes: true })) {
    const source = join(tree.dir, entry.name);
    if (entry.isSymbolicLink() || !allowed(source)) continue;
    cpSync(source, join(target, entry.name), { recursive: true, filter: allowed });
  }
}

export function createCanvas(rootDir = ROOT) {
  const formal = realpathSync(rootDir);
  const drafts = join(formal, '.canvas-drafts');
  const secret = randomBytes(24).toString('hex');
  const tokenFor = id => hash(secret + ':' + (id || 'display'));
  const formalVersion = () => inProject(formal, () => projectVersion(loadTree()));
  const folder = id => {
    if (!/^[a-f0-9]{24}$/.test(id || '')) throw Error('草稿标识无效');
    if (realpathSync(drafts) !== drafts) throw Error('草稿目录不可用');
    const path = join(drafts,id);
    if (!existsSync(path) || realpathSync(path) !== path) throw Error('草稿不存在');
    return path;
  };
  const metadata = path => readJson(join(path,'.draft.json'));
  const writeMetadata = (path, meta) => writeAtomic(join(path,'.draft.json'), JSON.stringify(meta,null,2)+'\n');
  const draftName = name => {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw Error('请填写草稿名称（最多 80 字）');
    return name.trim();
  };
  const list = () => {
    if (!existsSync(drafts)) return [];
    if (realpathSync(drafts) !== drafts) throw Error('草稿目录不可用');
    const version = formalVersion();
    return readdirSync(drafts,{withFileTypes:true}).filter(e=>e.isDirectory() && /^[a-f0-9]{24}$/.test(e.name))
      .map(e=>{const path=folder(e.name), meta=metadata(path);return meta && {...meta,id:e.name,path,stale:meta.base!==version};})
      .filter(Boolean).sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
  };
  const copyDraft = name => {
    const id = randomBytes(12).toString('hex');
    const tree = inProject(formal, loadTree), base = projectVersion(tree);
    mkdirSync(drafts,{recursive:true});
    if (realpathSync(drafts) !== drafts) throw Error('草稿目录不可用');
    const path = join(drafts,id);
    mkdirSync(path);
    try {
      copyProjectFiles(tree, path);
      if (formalVersion() !== base || inProject(path,()=>projectVersion(loadTree())) !== base) throw Error('项目在复制期间发生变化，请重试');
      inProject(path,addCombinationSources);
      writeMetadata(path,{name,base,savedAt:new Date().toISOString()});
      return {id,path};
    } catch (error) {
      rmSync(path,{recursive:true,force:true});
      throw error;
    }
  };
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = 'http://127.0.0.1:' + req.socket.localPort;
    if (req.headers.host !== origin.slice(7) || (req.headers.origin && req.headers.origin !== origin)) { res.writeHead(403).end(); return; }
    try {
      const url = new URL(req.url,origin);
      const route = url.pathname;
      const id = url.searchParams.get('draft');
      const token = tokenFor(id);
      if (req.method === 'GET' && route === '/') {
        if (id) folder(id);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(PAGE().replace('__TOKEN__',token));
        return;
      }
      if (req.headers['x-canvas-token'] !== token) { res.writeHead(403).end(); return; }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (req.method === 'GET' && route === '/api/drafts') { res.end(JSON.stringify(list())); return; }
      if (req.method === 'GET') {
        const root = id ? folder(id) : formal;
        const result = inProject(root,()=>{
          if (route === '/api/project') return {...snapshot(),draftId:id};
          if (route !== '/api/doc') return;
          const node = findNode(loadTree(),url.searchParams.get('id'));
          const name = url.searchParams.get('file');
          if (!node || !filesOf(node).includes(name)) throw Error('没有这个文件');
          return {name,path:rel(join(node.dir,name)),content:readText(join(node.dir,name))};
        });
        if (result === undefined) { res.writeHead(404).end(); return; }
        res.end(JSON.stringify(result));
        return;
      }
      if (req.method !== 'POST') { res.writeHead(404).end(); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2e6) throw Error('内容过大'); }
      const data = body ? JSON.parse(body) : {};
      if (route === '/api/drafts/create') { res.end(JSON.stringify(copyDraft(draftName(data.name)))); return; }
      if (route === '/api/drafts/rename') {
        const path=folder(data.id);
        writeMetadata(path,{...metadata(path),name:draftName(data.name)});
        res.end(JSON.stringify({ok:true})); return;
      }
      if (route === '/api/drafts/delete') {
        rmSync(folder(data.id),{recursive:true,force:true});
        res.end(JSON.stringify({ok:true})); return;
      }
      if (!['/api/settings','/api/save','/api/pack-preview','/api/pack'].includes(route)) { res.writeHead(404).end(); return; }
      if (!id) { res.writeHead(403).end(JSON.stringify({error:'显示模式只读，请打开草稿编辑'})); return; }
      const root = folder(id);
      const verifyDirectories = dir => {
        for (const entry of readdirSync(dir,{withFileTypes:true})) {
          const path = join(dir,entry.name);
          if (entry.isSymbolicLink()) throw Error('草稿包含链接文件，请移除后重试');
          if (entry.isDirectory()) verifyDirectories(path);
        }
      };
      verifyDirectories(root);
      const result = inProject(root,()=>{
        if (route === '/api/settings') {
          editStructure(data);
          if (['ports','expose','createModule','io'].includes(data.action)) addCombinationSources();
          return snapshot();
        }
        if (route === '/api/save') return saveLevel(data);
        const tree=loadTree(), plan=planPack(tree,data);
        if (route === '/api/pack-preview') return describe(plan);
        const applied = applyPack(tree,plan);
        addCombinationSources();
        return {done:describe(plan),...applied,...snapshot()};
      });
      if (route !== '/api/pack-preview') {
        try { writeMetadata(root,{...metadata(root),savedAt:new Date().toISOString()}); }
        catch { /* 草稿内容已经保存，保留原时间。 */ }
      }
      res.end(JSON.stringify(result));
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
const PAGE = () => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'canvas.html'), 'utf8');
