#!/usr/bin/env node
// 项目画布：在浏览器里拖线建连接、把几个模块打成一个组合、查看模块配套文件。
//
//   node canvas.mjs
//
// 画布只负责显示和编辑。真实连接始终以各层的 connections.json 为准；
// 节点位置存在根目录的 canvas-layout.json，删掉不影响连接，只是重新布局。
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, renameSync, cpSync, rmSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// 默认检查画布所在的目录；createCanvas(某个目录) 可以指到别处，测试和复用都靠这个。
let ROOT = dirname(fileURLToPath(import.meta.url));
const LAYOUT = 'canvas-layout.json';
const DOCS = ['README.md', 'INPUT.md', 'OUTPUT.md', 'PROCESS.md', 'VALIDATION.md', 'SETTINGS.md'];
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
  for (const [side, file] of [['inputs', 'INPUT.md'], ['outputs', 'OUTPUT.md']]) {
    const block = readText(join(dir, file)).match(/```interfaces\s*\r?\n([\s\S]*?)\r?\n```/);
    try { node[side] = block ? JSON.parse(block[1]) : []; } catch { node[side] = []; }
  }
  const members = join(dir, 'modules');
  if (existsSync(members) && statSync(members).isDirectory()) {
    node.isCombo = true;
    for (const item of readdirSync(members, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name.startsWith('.') || !statSync(join(members, item.name)).isDirectory()) continue;
      node.children.push(scan(join(members, item.name)));
    }
    const data = readJson(join(dir, 'connections.json'));
    if (!data || !Array.isArray(data.connections)) throw Error('组合缺少 connections.json：' + rel(dir));
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

function duties(node) {
  const body = readText(join(node.dir, 'README.md')).match(/^##[ \t]*职责[ \t]*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1].trim() || '';
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
    inputs: combo.inputs, outputs: combo.outputs, links: combo.links, stop: combo.stop,
    members: combo.children.map(c => ({ id: c.id, name: c.name, label: c.label, isCombo: c.isCombo, summary: duties(c).split(/\r?\n\s*\r?\n/)[0] || '', inputs: c.inputs, outputs: c.outputs })),
  };
}

// ---- 打包 -------------------------------------------------------------------

// 只算不写。预览和确认用同一份计划。
export function planPack(tree, { parentId, memberIds, id, name }) {
  const parent = findNode(tree, parentId);
  if (!parent || !parent.isCombo) throw Error('只能在组合里打包');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id || '')) throw Error('组合标识只能用字母、数字、下划线和短横线');
  if (!String(name || '').trim()) throw Error('请填组合名称');
  const wanted = new Set(memberIds || []);
  const picked = parent.children.filter(c => wanted.has(c.id));
  if (picked.length < 2) throw Error('至少选两个模块');
  if (picked.length !== wanted.size) throw Error('所选模块须是同一层的成员，且不能重复');
  if (flatten(tree).some(n => n.id === id)) throw Error('标识已被占用：' + id);

  const ids = new Set(picked.map(c => c.id));
  const isInner = (e) => ids.has(e.from.module) && ids.has(e.to.module);
  const touching = (e) => ids.has(e.from.module) || ids.has(e.to.module);
  const crossing = parent.links.filter(e => touching(e) && !isInner(e));

  // 跨边界的线变成新组合的同名接口，并改写成经过新组合。
  const inputs = [], outputs = [];
  const outer = crossing.map((edge) => {
    const e = JSON.parse(JSON.stringify(edge));
    const fromInside = ids.has(e.from.module);
    const toInside = ids.has(e.to.module);
    if (!fromInside && toInside) {
      if (!inputs.some(p => p.name === e.to.port)) inputs.push({ name: e.to.port, description: e.info || '来自组合外部' });
      e.to = { module: id, port: e.to.port };
    } else {
      if (!outputs.some(p => p.name === e.from.port)) outputs.push({ name: e.from.port, description: e.info || '交给组合外部' });
      e.from = { module: id, port: e.from.port };
    }
    return e;
  });

  const targetDir = join(parent.dir, 'modules', id);
  return {
    parentId: parent.id, parentDir: parent.dir, targetDir, id, name: String(name).trim(), stop: parent.stop,
    members: picked.map(c => ({ id: c.id, name: c.name, from: rel(join(parent.dir, 'modules', c.id)), to: rel(join(targetDir, 'modules', c.id)) })),
    inner: parent.links.filter(isInner), outer, inputs, outputs,
    revisions: { parent: hash(readText(join(parent.dir, 'connections.json'))) },
  };
}

export function describe(plan) {
  return {
    combo: plan.name + '（' + plan.id + '）', location: rel(plan.targetDir),
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
      if (item.name.startsWith('.') || ['runs', 'outputs', 'node_modules', 'knowledge'].includes(item.name)) continue;
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

  const parentData = readJson(parentFile);
  const ids = new Set(plan.members.map(m => m.id));
  // 碰到成员的所有旧线都删掉；跨边界的那几条，外层用改写成经过新组合的版本补回来。
  const newParentLinks = parentData.connections.filter(e => !ids.has(e.from.module) && !ids.has(e.to.module));
  for (const e of plan.outer) {
    if (!newParentLinks.some(x => sameEnds(x, e))) newParentLinks.push(e);
  }

  const oldBase = join(plan.parentDir, 'modules');
  const moves = plan.members.map(m => [join(oldBase, m.id), join(plan.targetDir, 'modules', m.id)]);
  if (existsSync(plan.targetDir)) throw Error('目标目录已存在：' + rel(plan.targetDir));

  try {
    // 1. 先复制成员到新位置，再删旧的；复制失败时原目录还在。
    for (const [from, to] of moves) {
      cpSync(from, to, { recursive: true });
      if (!existsSync(join(to, 'module.json'))) throw Error('复制失败：' + rel(from));
    }
    // 2. 新组合的配套文件与内部连接。
    writeCombo(plan);
    writeAtomic(join(plan.targetDir, 'connections.json'), JSON.stringify({ connections: plan.inner, ...(plan.stop ? { stop: plan.stop } : {}) }, null, 2) + '\n');
    // 3. 父层连接换成经过新组合。
    writeAtomic(parentFile, JSON.stringify({ ...parentData, connections: newParentLinks }, null, 2) + '\n');
    // 4. 修 Markdown 链接。必须在删旧目录之前做，链接要对照旧位置才解析得出来。
    const links = rewriteMarkdown(moves);
    // 5. 删掉旧目录。
    for (const [from] of moves) rmSync(from, { recursive: true, force: true });
    return { links };
  } catch (e) {
    rmSync(plan.targetDir, { recursive: true, force: true });
    throw e;
  }
}

const e_from_key = (e) => e.from.module + '.' + e.from.port;
const sameEnds = (a, b) => e_from_key(a) === e_from_key(b) && a.to.module + '.' + a.to.port === b.to.module + '.' + b.to.port;

// 新组合的配套文件。打包能确定的是成员和连接；职责和检验标准留给人补。
// 这些文件写成「待补充」而不是 `<待填写>`，检查脚本认后者是在建的样子，前者是能跑的初稿。
function writeCombo(plan) {
  const portBlock = (ports) => '```interfaces\n' + JSON.stringify(ports, null, 2) + '\n```';
  const memberList = plan.members.map(m => '- ' + m.name + '（' + m.id + '）').join('\n');
  const flow = plan.inner.map(e => '- ' + e.from.module + '.' + e.from.port + ' → ' + e.to.module + '.' + e.to.port).join('\n') || '- 暂无内部连接';
  const files = {
    'module.json': JSON.stringify({ id: plan.id, name: plan.name, template: { id: 'project-framework', version: '3.0.0' }, status: 'pending' }, null, 2) + '\n',
    'README.md': '# ' + plan.name + '\n\n## 职责\n\n由画布打包生成，负责组织以下模块完成一项任务；具体职责请补充一句话说明。\n\n' +
      '成员：\n\n' + memberList + '\n\n完成后把 module.json 的状态从 pending 改成 ready。\n',
    'INPUT.md': '# 输入要求\n\n' + (plan.inputs.length ? plan.inputs.map(p => '- ' + p.name + '：' + p.description).join('\n') + '\n' : '本组合不接收外部输入。\n') + '\n' + (plan.inputs.length ? portBlock(plan.inputs) + '\n' : ''),
    'OUTPUT.md': '# 输出要求\n\n' + (plan.outputs.length ? plan.outputs.map(p => '- ' + p.name + '：' + p.description).join('\n') + '\n' : '本组合不对外输出。\n') + '\n' + (plan.outputs.length ? portBlock(plan.outputs) + '\n' : ''),
    'PROCESS.md': '# 处理流程\n\n按 connections.json 把输入交给成员，收集成员的交付后对外输出。\n\n内部连接：\n\n' + flow +
      '\n\n补充：交接的条件和需要停下来的情况请写在这里。\n',
    'VALIDATION.md': '# 检验标准\n\n组合整体的交付怎样算合格，请结合成员各自的 VALIDATION.md 补充。\n',
  };
  for (const [name, content] of Object.entries(files)) writeAtomic(join(plan.targetDir, name), content);
}

// ---- 保存连接 ---------------------------------------------------------------

// 保存一层的连接和节点位置。先整体校验，通过了才写盘。
function saveLevel({ levelId, links, stop, positions, revision }) {
  const tree = loadTree();
  const level = findNode(tree, levelId);
  if (!level || !level.isCombo) throw Error('只能保存组合层的连接');
  const file = join(level.dir, 'connections.json');
  if (hash(readText(file)) !== revision) throw Error('文件已被其他操作修改，请重新加载后再保存');

  const ids = new Set(level.children.map(c => c.id));
  const ports = new Map([['$self', { outputs: level.inputs, inputs: level.outputs }], ...level.children.map(c => [c.id, { outputs: c.outputs, inputs: c.inputs }])]);
  for (const e of links) {
    for (const side of ['from', 'to']) {
      const end = e[side];
      if (!end || !ports.has(end.module)) throw Error('连接端点须是本层成员或 $self');
      const owner = ports.get(end.module);
      const want = side === 'from' ? owner.outputs : owner.inputs;
      if (!want.some(p => p.name === end.port)) throw Error('接口不存在：' + end.module + '.' + end.port);
    }
    if (!String(e.info || '').trim()) throw Error('每条连接都要写传的是什么');
  }
  const next = { connections: links };
  if (String(stop || '').trim()) next.stop = String(stop).trim();
  writeAtomic(file, JSON.stringify(next, null, 2) + '\n');

  if (positions && typeof positions === 'object') {
    const layout = readLayout();
    layout[levelId] = positions;
    writeAtomic(join(ROOT, LAYOUT), JSON.stringify(layout, null, 2) + '\n');
  }
  return snapshot();
}

function snapshot() {
  const tree = loadTree();
  const layout = readLayout();
  const levels = {};
  const collect = (node) => { if (node.isCombo) { levels[node.id] = viewOf(node); node.children.forEach(collect); } };
  collect(tree);
  const pick = (path) => existsSync(path) ? readText(path) : '';
  return {
    root: { id: tree.id, name: tree.name, label: tree.label },
    levels, layout,
    revisions: Object.fromEntries(Object.keys(levels).map(id => [id, hash(pick(join(findNode(tree, id).dir, 'connections.json')))])),
    docs: Object.fromEntries(flatten(tree).map(n => [n.id, { name: n.name, label: n.label, files: DOCS.filter(f => existsSync(join(n.dir, f))) }])),
  };
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
        if (!node || !DOCS.includes(name)) throw Error('没有这个文件');
        res.end(JSON.stringify({ name, path: rel(join(node.dir, name)), content: readText(join(node.dir, name)) }));
        return;
      }
      if (req.method !== 'POST') { res.writeHead(404).end(); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2e6) throw Error('内容过大'); }
      const data = body ? JSON.parse(body) : {};
      if (req.url === '/api/save') { res.end(JSON.stringify(saveLevel(data))); return; }
      if (req.url === '/api/pack-preview') {
        res.end(JSON.stringify(describe(planPack(loadTree(), data))));
        return;
      }
      if (req.url === '/api/pack') {
        const plan = planPack(loadTree(), data);
        const result = applyPack(loadTree(), plan);
        spawnSync(process.execPath, [join(ROOT, 'check.mjs'), '--panorama'], { cwd: ROOT, encoding: 'utf8' });
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
