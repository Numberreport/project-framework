#!/usr/bin/env node
// 项目结构与连接检查。只查能机械判断的部分，不评价内容和业务质量。
//
//   node check.mjs              结构检查
//   node check.mjs --verify     结构检查 + 各模块 module.json 里 verify 指定的维护验收
//   node check.mjs --tree       打印模块清单
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, isAbsolute, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '3.0.0';
const REQUIRED = ['README.md', 'VALIDATION.md', 'module.json'];
const SECTIONS = ['职责', '输入', '输出', '处理流程', '没完成时'];
const root = dirname(fileURLToPath(import.meta.url));
const errors = [];
const fail = (message) => errors.push(message);
const inside = (base, target) => { const r = relative(base, target); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const read = (path) => readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
const readJson = (path) => { try { return JSON.parse(read(path)); } catch { fail('JSON 无效或缺失：' + relative(root, path)); return null; } };
const walkAll = (node) => node ? node.children.flatMap(child => [child, ...walkAll(child)]) : [];

// 按 README 的二级标题切开，取指定小节；标题必须写，缺了报错。
function sectionOf(text, title) {
  return new RegExp('^##[ \\t]*' + title + '[ \\t]*\\r?\\n([^]*?)(?=^## |$(?![^]))', 'm').exec(text)?.[1] ?? null;
}
function section(text, title, label) {
  const body = sectionOf(text, title);
  if (body === null) fail('README 缺标题「' + title + '」：' + label);
  return body;
}

// 接口只来自 README：接收的写在「输入」，交出的写在「输出」，各一块代码块；没有按空处理。
const blocksOf = (text) => [...text.matchAll(/```interfaces[ \t]*\r?\n([^]*?)\r?\n```/g)];
function readPorts(text, label) {
  const blocks = blocksOf(text);
  if (blocks.length > 1) { fail('接口定义只能有一块：' + label); return []; }
  if (!blocks.length) return [];
  let ports;
  try { ports = JSON.parse(blocks[0][1]); } catch { fail('接口定义不是有效 JSON：' + label); return []; }
  if (!Array.isArray(ports)) { fail('接口定义必须是数组：' + label); return []; }
  const names = new Set();
  for (const port of ports) {
    if (!port || typeof port.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(port.name)) fail('接口名称只能用字母、数字、下划线和短横线：' + label);
    else if (names.has(port.name)) fail('接口名称重复：' + label + '/' + port.name);
    else names.add(port.name);
    if (typeof port.description !== 'string' || !port.description.trim()) fail('接口须填写要求：' + label + '/' + (port?.name || '?'));
  }
  return ports;
}

// 读一个模块及其 modules/ 下的直接成员；根目录也按模块读取。
// parentLinks 是父层碰到本模块的连线，用来核对组合的输入输出有没有接上。
function visit(dir, ids, seen, parentLinks = []) {
  const label = relative(root, dir).replaceAll('\\', '/') || '.';
  const real = realpathSync(dir);
  if (!inside(realpathSync(root), real) || seen.has(real)) { fail('模块路径越界或重复包含：' + label); return null; }
  seen.add(real);

  const meta = readJson(join(dir, 'module.json'));
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) { fail('模块信息必须是对象：' + label); return null; }
  if (typeof meta.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(meta.id)) fail('模块标识缺失或格式无效：' + label);
  if (typeof meta.name !== 'string' || !meta.name.trim()) fail('模块名称缺失：' + label);
  if (ids.has(meta.id)) fail('模块标识重复：' + meta.id);
  ids.add(meta.id);
  if (meta.template?.id !== 'project-framework' || meta.template?.version !== VERSION) fail('模板版本不受支持：' + label + '（需要确认迁移，不能猜格式）');
  if (!['ready', 'pending'].includes(meta.status)) fail('配置状态须为 ready 或 pending：' + label);

  // 项目自己的说明和模块一样写在 README.md 里。
  const isRoot = real === realpathSync(root);
  const doc = 'README.md';
  const required = REQUIRED;
  for (const file of required) {
    const path = join(dir, file);
    if (!existsSync(path) || !statSync(path).isFile() || !inside(real, realpathSync(path))) fail('缺少配套文件或路径越界：' + label + '/' + file);
    else if (!read(path).trim() || read(path).includes('<待填写>')) fail('配套文件没写完：' + label + '/' + file);
  }
  // README 的五段是固定的：职责、输入、输出、处理流程、没完成时。检查标准另在 VALIDATION.md。
  const docPath = join(dir, doc);
  const readable = existsSync(docPath) && inside(real, realpathSync(docPath));
  const docText = readable ? read(docPath) : '';
  if (readable) for (const title of SECTIONS) section(docText, title, label + '/' + doc);

  // implementation、verify 可选；填了就必须指向本模块内的真实文件。
  for (const field of ['implementation', 'verify']) {
    const entry = meta[field];
    if (entry === undefined) continue;
    if (typeof entry !== 'string' || !entry.trim() || isAbsolute(entry) || entry.split(/[\\/]/).includes('..')) { fail(field + ' 须填本模块内的相对路径：' + label); continue; }
    const target = join(dir, entry);
    if (!existsSync(target) || !statSync(target).isFile() || !inside(real, realpathSync(target))) fail(field + ' 指向的文件不存在或越界：' + label);
    else if (field === 'verify' && !entry.endsWith('.mjs')) fail('verify 只支持 .mjs 脚本：' + label);
  }
  if (meta.processor !== undefined && !['program', 'ai', 'mixed'].includes(meta.processor)) fail('processor 只能取 program、ai、mixed：' + label);

  // 配套文件缺失时上面已经记过错误，这里只读能读到的，不再重复报。
  // 输入看 README 的「输入」，输出看「输出」，根目录和模块一样。
  const portsOf = (title) => { const body = sectionOf(docText, title); return body === null ? [] : readPorts(body, label + '/' + doc + ' 的「' + title + '」'); };
  const inputs = readable ? portsOf('输入') : [];
  const outputs = readable ? portsOf('输出') : [];
  const node = { dir, label, meta, children: [], links: [], inputs, outputs };

  const hasMembers = existsSync(join(dir, 'modules'));
  const hasLinks = existsSync(join(dir, 'connections.json'));
  if (hasMembers !== hasLinks) fail('组合须同时有 modules/ 和 connections.json：' + label);
  if (!hasMembers) return node;

  const data = readJson(join(dir, 'connections.json'));
  if (!Array.isArray(data?.connections)) { fail('connections.json 缺 connections 数组：' + label); return node; }
  node.links = data.connections;

  const membersDir = join(dir, 'modules');
  if (!statSync(membersDir).isDirectory() || !inside(real, realpathSync(membersDir))) { fail('成员目录无效或越界：' + label); return node; }
  for (const item of readdirSync(membersDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (item.name === '.gitkeep') continue;
    const path = join(membersDir, item.name);
    if (item.name.startsWith('.') || !statSync(path).isDirectory()) { fail('modules/ 下只能放模块目录：' + label + '/' + item.name); continue; }
    const child = visit(path, ids, seen, node.links);
    if (child) node.children.push(child);
  }
  const childIds = new Set(node.children.map(n => n.meta.id));
  const adjacency = new Map();
  for (const edge of node.links) {
    if (!edge || typeof edge !== 'object') { fail('连接必须是对象：' + label); continue; }
    for (const side of ['from', 'to']) {
      const end = edge[side];
      const isSelf = end?.module === '$self';
      if (!end || typeof end.module !== 'string' || (!isSelf && !childIds.has(end.module))) fail('连接端点须是本层成员或 $self：' + label + '/' + side);
      if (typeof end?.port !== 'string' || !end.port.trim()) { fail('连接没写接口名：' + label + '/' + side); continue; }
      const owner = isSelf ? node : node.children.find(n => n.meta.id === end.module);
      const direction = isSelf ? (side === 'from' ? 'inputs' : 'outputs') : (side === 'from' ? 'outputs' : 'inputs');
      // 输入看「输入」那块代码块，输出看「输出」那块。
      if (owner && !owner[direction].some(p => p.name === end.port)) fail('连接引用了未定义的接口：' + label + '/' + end.module + '.' + end.port + '（' + (direction === 'inputs' ? '接收的接口写在「输入」里' : '交出的接口写在「输出」里') + '）');
    }
    if (typeof edge.info !== 'string' || !edge.info.trim()) fail('连接没写传的是什么：' + label);
    if (edge.when !== undefined && (typeof edge.when !== 'string' || !edge.when.trim())) fail('连接条件留空：' + label);
    if (edge.kind !== undefined && !['support', 'return'].includes(edge.kind)) fail('连接 kind 只能取 support 或 return：' + label);
    if (edge.from?.module !== '$self' && edge.to?.module !== '$self') {
      if (!adjacency.has(edge.from?.module)) adjacency.set(edge.from?.module, []);
      adjacency.get(edge.from?.module).push(edge.to?.module);
    }
  }

  // 有反馈回路就必须写停止条件。
  const active = new Set(), done = new Set();
  let cyclic = false;
  const dfs = (id) => { if (active.has(id)) { cyclic = true; return; } if (done.has(id)) return; active.add(id); for (const to of adjacency.get(id) || []) dfs(to); active.delete(id); done.add(id); };
  for (const id of childIds) dfs(id);
  if (cyclic && (typeof data.stop !== 'string' || !data.stop.trim())) fail('组合有反馈回路但没写停止条件（connections.json 的 stop）：' + label);

  // 模块声明的输入输出，外面要接得上。
  // 组合看父层的线；根目录本身就是最外层，只看自己有没有把成员的交付接回 $self。
  if (parentLinks) {
    if (node.inputs.length && !parentLinks.some(e => e?.to?.module === meta.id)) fail('组合声明了输入，但父层没有接进来的连接：' + label);
    if (node.outputs.length && !parentLinks.some(e => e?.from?.module === meta.id)) fail('组合声明了输出，但父层没有接出去的连接：' + label);
  } else if (node.outputs.length && !node.children.some(c => node.links.some(e => e?.from?.module === c.meta.id && e?.to?.module === '$self'))) {
    fail('项目的交付没有接回本层：没有任何成员的输出连到 $self');
  }
  return node;
}

// 文档里的本地链接必须指向真实文件。
function checkLinks(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith('.') || ['node_modules', 'workspace'].includes(item.name)) continue;
    const path = join(dir, item.name);
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) { checkLinks(path); continue; }
    if (!item.name.endsWith('.md')) continue;
    const text = read(path).replace(/```[^]*?```/g, '');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].replace(/^<|>$/g, '').split('#')[0];
      if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
      const target = join(dirname(path), link);
      if (!existsSync(target) || !inside(realpathSync(root), realpathSync(target))) fail('文档链接缺失或越界：' + relative(root, path) + ' / ' + link);
    }
  }
}

const ids = new Set();
const tree = visit(root, ids, new Set(), null);
const all = tree ? [tree, ...walkAll(tree)] : [];

// 根目录只放登记过的文件，防止临时文件、密钥混进来。
const ROOT_ALLOWED = new Set(['README.md', 'AGENTS.md', 'VALIDATION.md', 'CANVAS.md', 'module.json', 'connections.json', 'modules', 'check.mjs', 'canvas.mjs', 'canvas.html', 'canvas-layout.json', 'tests', 'workspace']);
const ROOT_IGNORED = new Set(['node_modules', 'dist', 'build', '__pycache__', 'venv', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'tsconfig.json', 'pyproject.toml', 'requirements.txt', 'Makefile', 'Thumbs.db', 'desktop.ini']);
for (const entry of readdirSync(root)) {
  if (entry.startsWith('.') || ROOT_ALLOWED.has(entry) || ROOT_IGNORED.has(entry)) continue;
  fail('根目录有未登记的文件或目录：' + entry + '（先确认不是密钥；是项目文件就放进对应模块）');
}
checkLinks(root);

if (!existsSync(join(root, 'AGENTS.md'))) fail('AGENTS.md 缺失');

if (process.argv.includes('--tree')) for (const n of all) console.log((n.label === '.' ? '根目录' : n.label) + ' [' + n.meta.id + '] ' + n.meta.name);

if (errors.length) { for (const e of errors) console.error('✗ ' + e); process.exit(1); }

let ran = 0, skipped = 0;
const failed = new Set();
// 上游待配置或验收没过时，下游拿到的产物还是未定稿的，一并跳过。
// 上游按连接判断：to.module 是我、from.module 是别的成员的，那个成员就是我的上游。不看目录嵌套。
const upstreamOf = (node) => {
  const found = [];
  for (const scope of [tree, ...walkAll(tree)]) {
    for (const e of scope.links) {
      if (e?.to?.module !== node.meta.id || e?.from?.module === '$self') continue;
      const source = scope.children.find(c => c.meta.id === e.from.module);
      if (source) found.push(source);
    }
  }
  return found;
};
const isBlocked = (node, seen = new Set()) => {
  if (!node || seen.has(node)) return false;
  if (failed.has(node) || node.meta.status !== 'ready') return true;
  seen.add(node);
  return upstreamOf(node).some(up => isBlocked(up, seen));
};
// 先验上游再验下游。连接关系只在本层可见，所以逐层算：成员按本层连接排序，组合排在其成员之后。
const order = [];
const placed = new Set();
const put = (node) => { if (!placed.has(node)) { placed.add(node); order.push(node); } };
const placeMembers = (node) => {
  if (!node) return;
  // 成员之间存在同层连接时，先排来源模块，再排目标模块。
  const pending = [...node.children];
  while (pending.length) {
    const ready = pending.find(child => !node.links.some(e => e?.to?.module === child.meta.id && e?.from?.module !== '$self' && e.from.module !== node.meta.id && pending.some(n => n.meta.id === e.from.module)));
    const next = ready || pending[0];
    pending.splice(pending.indexOf(next), 1);
    if (!next.children.length && next.meta.verify === undefined) { put(next); continue; }
    placeMembers(next);
    put(next);
  }
  put(node);
};
placeMembers(tree);
if (process.argv.includes('--verify')) {
  for (const node of order) {
    if (node.meta.status !== 'ready' || node.children.some(n => failed.has(n)) || isBlocked(node)) { failed.add(node); skipped++; console.log('跳过验收：' + node.label + '（待配置或上游未通过）'); continue; }
    if (!node.meta.verify) { skipped++; continue; }
    const result = spawnSync(process.execPath, [join(node.dir, node.meta.verify)], { cwd: node.dir, encoding: 'utf8', timeout: 60000 });
    if (result.status !== 0 || result.error) { failed.add(node); fail('验收失败：' + node.label + '\n' + (result.stderr || result.stdout || result.error?.message || '超时或异常退出')); }
    else { ran++; console.log('✓ 验收通过：' + node.label); }
  }
}
if (errors.length) { for (const e of errors) console.error(e); process.exit(1); }

const pending = all.filter(n => n.meta.status === 'pending').length;
console.log('结构检查通过：' + all.length + ' 个模块' + (pending ? '；其中 ' + pending + ' 个待配置，不得运行' : ''));
if (process.argv.includes('--verify')) console.log('维护验收通过 ' + ran + ' 项，跳过 ' + skipped + ' 项；这只说明示例能跑，不代表业务内容合格。');
