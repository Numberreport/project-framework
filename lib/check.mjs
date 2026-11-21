#!/usr/bin/env node
// 项目结构与连接检查。只查能机械判断的部分，不评价业务内容质量。
//
//   pf check [目录]              结构检查
//   pf check [目录] --verify     结构检查 + 各模块 verify 指定的维护验收
//   pf check [目录] --tree       打印模块清单
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, isAbsolute, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readProject, ignoredHiddenEntry, headingsOf, sectionOf, headingText } from './structure.mjs';

const VERSION = '3.0.0';
const REQUIRED = ['README.md', 'VALIDATION.md', 'module.json'];
const SECTIONS = ['职责', '输入', '输出', '处理流程', '没完成时'];
const inside = (base, target) => { const r = relative(base, target); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const read = (path) => readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
const walkAll = (node) => node ? node.children.flatMap(child => [child, ...walkAll(child)]) : [];
const blocksOf = (text) => [...text.matchAll(/```interfaces[ \t]*\r?\n([^]*?)\r?\n```/g)];

export function checkProject(rootDir, { verify = false, tree: showTree = false } = {}) {
  const root = realpathSync(rootDir);
  const errors = [];
  const output = [];
  const fail = (message) => errors.push(message);
  const readJson = (path) => { try { return JSON.parse(read(path)); } catch { fail('JSON 无效或缺失：' + relative(root, path)); return null; } };

  function section(text, title, label) {
    const body = sectionOf(text, title);
    if (body === null) fail('README 缺标题「' + title + '」：' + label);
    return body;
  }

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

  function checkHeadings(text, label) {
    const cleaned = headingText(text);
    const matches = [...cleaned.matchAll(/^(#{1,6})[ \t]+([^\r\n]*?)[ \t]*\r?$/gm)];
    const h1Count = matches.filter(m => m[1].length === 1).length;
    if (h1Count !== 1) fail('文档须有且仅有一个一级标题：' + label);
    let prev = 0;
    for (const match of matches) {
      const level = match[1].length;
      if (prev > 0 && level > prev + 1) {
        fail('文档标题跳级（从 ' + prev + ' 级跳到 ' + level + ' 级「' + match[2] + '」）：' + label);
        break;
      }
      prev = level;
    }
  }

  function visit(dir, ids, seen, parentLinks = []) {
    const label = relative(root, dir).replaceAll('\\', '/') || '.';
    const real = realpathSync(dir);
    if (!inside(root, real) || seen.has(real)) { fail('模块路径越界或重复包含：' + label); return null; }
    seen.add(real);

    const meta = readJson(join(dir, 'module.json'));
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) { fail('模块信息必须是对象：' + label); return null; }
    if (typeof meta.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(meta.id)) fail('模块标识缺失或格式无效：' + label);
    if (typeof meta.name !== 'string' || !meta.name.trim()) fail('模块名称缺失：' + label);
    if (ids.has(meta.id)) fail('模块标识重复：' + meta.id);
    ids.add(meta.id);
    if (meta.template?.id !== 'project-framework' || meta.template?.version !== VERSION) fail('模板版本不受支持：' + label + '（需要确认迁移，不能猜格式）');
    if (!['ready', 'pending'].includes(meta.status)) fail('配置状态须为 ready 或 pending：' + label);

    for (const file of REQUIRED) {
      const path = join(dir, file);
      if (!existsSync(path) || !statSync(path).isFile() || !inside(real, realpathSync(path))) fail('缺少配套文件或路径越界：' + label + '/' + file);
      else if (!read(path).trim() || read(path).includes('<待填写>')) fail('配套文件没写完：' + label + '/' + file);
    }

    const docPath = join(dir, 'README.md');
    const readable = existsSync(docPath) && inside(real, realpathSync(docPath));
    const docText = readable ? read(docPath) : '';
    if (readable) {
      checkHeadings(docText, label + '/README.md');
      const headings = headingsOf(docText);
      for (const title of SECTIONS) {
        const body = section(docText, title, label + '/README.md');
        if (headings.filter(match => match[1] === title).length > 1) fail('README 固定标题重复「' + title + '」：' + label);
        if (body !== null && !body.replace(/<!--[\s\S]*?-->/g, '').trim()) fail('README 章节为空「' + title + '」：' + label);
      }
      const portCount = ['输入', '输出'].reduce((count, title) => count + blocksOf(sectionOf(docText, title) || '').length, 0);
      if (blocksOf(docText).length !== portCount) fail('接口定义只能写在 README 的「输入」「输出」中：' + label);
    }

    const valPath = join(dir, 'VALIDATION.md');
    if (existsSync(valPath) && statSync(valPath).isFile() && inside(real, realpathSync(valPath))) {
      const valText = read(valPath);
      if (valText.trim()) checkHeadings(valText, label + '/VALIDATION.md');
    }

    for (const field of ['implementation', 'verify']) {
      const entry = meta[field];
      if (entry === undefined) continue;
      if (typeof entry !== 'string' || !entry.trim() || isAbsolute(entry) || entry.split(/[\\/]/).includes('..')) { fail(field + ' 须填本模块内的相对路径：' + label); continue; }
      const target = join(dir, entry);
      if (!existsSync(target) || !statSync(target).isFile() || !inside(real, realpathSync(target))) fail(field + ' 指向的文件不存在或越界：' + label);
      else if (field === 'verify' && !entry.endsWith('.mjs')) fail('verify 只支持 .mjs 脚本：' + label);
    }
    if (meta.processor !== undefined && !['program', 'ai', 'mixed'].includes(meta.processor)) fail('processor 只能取 program、ai、mixed：' + label);

    const portsOf = (title) => { const body = sectionOf(docText, title); return body === null ? [] : readPorts(body, label + '/README.md 的「' + title + '」'); };
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
    const ioNodes = data.ioNodes || [];
    if (!Array.isArray(ioNodes)) fail('ioNodes 必须是数组：' + label);
    else for (const io of ioNodes) {
      if (!io || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(io.id || '') || ids.has(io.id) || !['input', 'output'].includes(io.type) || !io.name?.trim() || !io.description?.trim()) { fail('输入输出节点无效或标识重复：' + label); continue; }
      ids.add(io.id);
      const port = { name: 'value', description: io.description };
      node.children.push({ dir, label: label + '/' + io.id, meta: { id: io.id, name: io.name, status: 'ready' }, children: [], links: [], inputs: io.type === 'output' ? [port] : [], outputs: io.type === 'input' ? [port] : [], virtual: true });
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

    const active = new Set(), done = new Set();
    let cyclic = false;
    const dfs = (id) => { if (active.has(id)) { cyclic = true; return; } if (done.has(id)) return; active.add(id); for (const to of adjacency.get(id) || []) dfs(to); active.delete(id); done.add(id); };
    for (const id of childIds) dfs(id);
    if (cyclic && (typeof data.stop !== 'string' || !data.stop.trim())) fail('组合有反馈回路但没写停止条件（connections.json 的 stop）：' + label);

    if (parentLinks && parentLinks.some(e => e?.from?.module === meta.id || e?.to?.module === meta.id)) {
      if (node.inputs.length && !parentLinks.some(e => e?.to?.module === meta.id)) fail('组合声明了输入，但父层没有接进来的连接：' + label);
      if (node.outputs.length && !parentLinks.some(e => e?.from?.module === meta.id)) fail('组合声明了输出，但父层没有接出去的连接：' + label);
    }
    return node;
  }

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
        if (!existsSync(target) || !inside(root, realpathSync(target))) fail('文档链接缺失或越界：' + relative(root, path) + ' / ' + link);
      }
    }
  }

  const ids = new Set();
  const tree = visit(root, ids, new Set(), null);
  try { readProject(root); } catch (error) { fail(error.message); }
  const all = tree ? [tree, ...walkAll(tree)] : [];

  // 根目录只放框架文件和登记过的文件；兼容旧项目根目录自带引擎脚本的情况。
  const ROOT_ALLOWED = new Set(['structure.mjs', 'run.mjs', 'workflow.mjs', 'README.md', 'AGENTS.md', 'VALIDATION.md', 'canvas', 'module.json', 'connections.json', 'modules', 'check.mjs', 'canvas-layout.json', 'tests', 'workspace']);
  const ROOT_IGNORED = new Set(['node_modules', 'dist', 'build', '__pycache__', 'venv', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'tsconfig.json', 'pyproject.toml', 'requirements.txt', 'Makefile', 'Thumbs.db', 'desktop.ini']);
  const rootFiles = tree?.meta.rootFiles === undefined ? [] : tree.meta.rootFiles;
  if (!Array.isArray(rootFiles)) fail('rootFiles 必须是根目录文件或目录名称的数组');
  else {
    const registered = new Set();
    for (const entry of rootFiles) {
      if (typeof entry !== 'string' || !entry.trim() || entry !== entry.trim() || entry.startsWith('.') || /[\\/:*?"<>|]/.test(entry) || registered.has(entry)) {
        fail('rootFiles 名称无效或重复，只能填写根目录下的单个名称'); continue;
      }
      registered.add(entry);
      const path = join(root, entry);
      if (!existsSync(path) || !inside(root, realpathSync(path))) fail('rootFiles 指向的文件或目录不存在或越界：' + entry);
      else ROOT_ALLOWED.add(entry);
    }
  }
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('.') || ROOT_ALLOWED.has(entry) || ROOT_IGNORED.has(entry)) continue;
    fail('根目录有未登记的文件或目录：' + entry + '（项目自身内容在根 module.json 的 rootFiles 中登记，模块内容放进对应模块；不得登记密钥）');
  }

  const SCAN_IGNORED = new Set(['workspace', 'node_modules', 'dist', 'build', '__pycache__', 'venv', '.venv']);
  const formalDirs = new Set(all.filter(n => !n.virtual).map(n => realpathSync(n.dir)));
  function checkModulePlacement(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (ignoredHiddenEntry(item.name) || SCAN_IGNORED.has(item.name)) continue;
      if (item.isSymbolicLink()) { fail('模块层级扫描无法核对符号链接：' + relative(root, join(dir, item.name))); continue; }
      const path = join(dir, item.name);
      if (!item.isDirectory()) continue;
      if (existsSync(join(path, 'module.json')) && !formalDirs.has(realpathSync(path))) {
        fail('模块未纳入正式 modules/ 层级：' + relative(root, path));
      }
      checkModulePlacement(path);
    }
  }
  checkModulePlacement(root);
  checkLinks(root);

  const agentsPath = join(root, 'AGENTS.md');
  if (!existsSync(agentsPath) || !statSync(agentsPath).isFile() || !inside(root, realpathSync(agentsPath)) || !read(agentsPath).trim()) {
    fail('框架文件缺失、为空或越界：AGENTS.md');
  } else {
    checkHeadings(read(agentsPath), 'AGENTS.md');
  }

  if (showTree) {
    for (const n of all) output.push((n.label === '.' ? '根目录' : n.label) + ' [' + n.meta.id + '] ' + n.meta.name);
  }

  if (errors.length) return { ok: false, errors, output, tree, all };

  let ran = 0, skipped = 0;
  const failed = new Set();
  const parents = new Map(all.flatMap(node => node.children.map(child => [child, node])));
  const upstreamOf = (node, port) => {
    const scope = parents.get(node);
    if (!scope) return [];
    return scope.links
      .filter(edge => edge.to.module === node.meta.id && (port === undefined || edge.to.port === port))
      .flatMap(({ from }) => from.module === '$self'
        ? upstreamOf(scope, from.port)
        : scope.children.filter(child => child.meta.id === from.module));
  };
  const isBlocked = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return false;
    if (failed.has(node) || node.meta.status !== 'ready') return true;
    seen.add(node);
    return upstreamOf(node).some(up => isBlocked(up, seen));
  };
  const order = [];
  const placed = new Set();
  const put = (node) => { if (!placed.has(node)) { placed.add(node); order.push(node); } };
  const placeMembers = (node) => {
    if (!node) return;
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

  if (verify) {
    for (const node of order) {
      if (node.meta.status !== 'ready' || node.children.some(n => failed.has(n)) || isBlocked(node)) {
        failed.add(node); skipped++;
        output.push('跳过验收：' + node.label + '（待配置或上游未通过）');
        if (node.meta.verify) fail('验收未完成：' + node.label + '（已声明的验收脚本被跳过）');
        continue;
      }
      if (!node.meta.verify) { skipped++; continue; }
      const result = spawnSync(process.execPath, [join(node.dir, node.meta.verify)], { cwd: node.dir, encoding: 'utf8', timeout: 60000 });
      if (result.status !== 0 || result.error) { failed.add(node); fail('验收失败：' + node.label + '\n' + (result.stderr || result.stdout || result.error?.message || '超时或异常退出')); }
      else { ran++; output.push('✓ 验收通过：' + node.label); }
    }
  }
  if (errors.length) return { ok: false, errors, output, tree, all };

  const pending = all.filter(n => n.meta.status === 'pending').length;
  output.push('结构检查通过：' + all.length + ' 个模块' + (pending ? '；其中 ' + pending + ' 个待配置，不得运行' : ''));
  output.push('检查范围：模块层级、模板版本、配套文件、标题层级、接口、连接及本地链接；业务内容须另行检查。');
  if (verify) output.push('维护验收：脚本通过 ' + ran + ' 项，跳过 ' + skipped + ' 项；仅已执行且通过的脚本有验收结果。');
  return { ok: true, errors, output, tree, all };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const verify = args.includes('--verify');
  const tree = args.includes('--tree');
  const target = args.find(arg => !arg.startsWith('--')) || process.cwd();
  const result = checkProject(resolve(target), { verify, tree });
  for (const line of result.output) console.log(line);
  if (!result.ok) {
    for (const err of result.errors) console.error('✗ ' + err);
    process.exit(1);
  }
}
