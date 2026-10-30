import { existsSync, readFileSync, readdirSync, lstatSync, realpathSync, mkdirSync, renameSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, dirname, basename, relative, resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { load, inside } from './module-model.mjs';
import { writePorts } from './module-ports.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const slash = path => path.replaceAll('\\', '/');
const digest = value => createHash('sha256').update(value).digest('hex');

// A pack relocates existing modules; their IDs, settings and artifacts remain theirs.
// Only the new container is a new, pending module.
export function planPack(root, data, current) {
  const model = load(root);
  if (model.errors.length) throw Error(model.errors.join('\n'));
  const parent = model.nodes.find(n => n.meta.id === data.id);
  if (!parent || !current.nodes.find(n => n.id === data.id)?.document) throw Error('请选择组合模块');
  if (!Array.isArray(data.members) || data.members.length < 2 || new Set(data.members).size !== data.members.length) throw Error('请选择至少两个不同的直接成员');
  const selected = new Set(data.members);
  const members = parent.children.filter(n => selected.has(n.meta.id));
  if (members.length !== selected.size) throw Error('只能打包当前组合的直接成员');
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100 || /[\r\n\x00-\x1f]/.test(data.name)) throw Error('请填写组合名称（不超过 100 字）');
  if (typeof data.newId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(data.newId) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(data.newId)) throw Error('组合标识须为 1–80 位字母、数字、下划线或短横线，且不能是系统保留名');
  if (model.nodes.some(n => n.meta.id.toLowerCase() === data.newId.toLowerCase())) throw Error('组合标识已存在');
  const destination = join(parent.dir, 'modules', data.newId);
  if (existsSync(destination) || readdirSync(dirname(destination)).some(n => n.toLowerCase() === data.newId.toLowerCase())) throw Error('组合目录已存在');
  const moves = members.map(n => ({ from: n.dir, to: join(destination, 'modules', basename(n.dir)) }));
  const relocated = path => {
    const move = moves.find(m => inside(m.from, path));
    return move ? join(move.to, relative(move.from, path)) : path;
  };
  for (const move of moves) {
    if (lstatSync(move.from).isSymbolicLink() || realpathSync(move.from) !== resolve(move.from)) throw Error('含链接的模块目录不能打包，请先处理真实目录');
    const checkLinks = dir => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, item.name);
        if (item.isSymbolicLink()) throw Error('模块中含符号链接，不能自动移动：' + slash(relative(root, path)));
        if (item.isDirectory()) checkLinks(path);
      }
    };
    checkLinks(move.from);
  }
  const oldDocument = current.nodes.find(n => n.id === data.id).document;
  const outer = [], inner = [], inputs = [], outputs = [];
  for (const edge of oldDocument.connections) {
    const from = selected.has(edge.from.module), to = selected.has(edge.to.module);
    if (from && to) { inner.push(edge); continue; }
    if (!from && !to) { outer.push(edge); continue; }
    const side = to ? inputs : outputs, endpoint = to ? edge.to : edge.from;
    const owner = current.nodes.find(n => n.id === endpoint.module);
    const port = (to ? owner.inputs : owner.outputs).find(p => p.name === endpoint.port);
    const name = (to ? 'input_' : 'output_') + (side.length + 1);
    side.push({ name, description: owner.name + ' / ' + endpoint.port + '：' + (port?.description || edge.info) });
    outer.push({ ...edge, [to ? 'to' : 'from']: { ...endpoint, module: data.newId, port: name } });
    inner.push({ ...edge, [to ? 'from' : 'to']: { module: '$self', port: name } });
  }
  // Contraction can create an outer feedback loop even if the original graph was acyclic.
  function hasCycle(edges) {
    const active = new Set(), done = new Set();
    const visit = id => {
      if (active.has(id)) return true;
      if (done.has(id)) return false;
      active.add(id);
      for (const e of edges) if (e.from.module === id && e.to.module !== '$self' && visit(e.to.module)) return true;
      active.delete(id); done.add(id); return false;
    };
    return edges.some(e => e.from.module !== '$self' && visit(e.from.module));
  }
  if ((hasCycle(outer) || hasCycle(inner)) && !oldDocument.stop?.trim()) throw Error('打包后会形成反馈回路，请先在当前组合填写并保存停止条件，或调整选择');
  const document = { connections: inner, ...(oldDocument.stop ? { stop: oldDocument.stop } : {}) };
  const writes = new Map(), originals = new Map(), manifest = [];
  const add = (path, content) => { writes.set(path, content); };
  const localLink = (value, file, base = dirname(file)) => {
    const match = value.match(/^([^#?]*)([?#].*)?$/), targetText = match?.[1];
    if (!targetText || /^[a-z]+:/i.test(targetText) || targetText.startsWith('/') || targetText.includes('${')) return value;
    const target = resolve(base, targetText);
    if (!inside(root, target) || !existsSync(target)) return value;
    const newBase = relocated(base), newTarget = relocated(target);
    if (newBase === base && newTarget === target) return value;
    let next = slash(relative(newBase, newTarget)) || '.';
    if (targetText.startsWith('./') && !next.startsWith('.')) next = './' + next;
    if (targetText.endsWith('/')) next += '/';
    return next + (match[2] || '');
  };
  function scan(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, item.name);
      if (item.isSymbolicLink()) {
        if (moves.some(m => inside(m.from, path))) throw Error('模块中含符号链接，不能自动移动：' + slash(relative(root, path)));
        continue;
      }
      if (item.name.startsWith('.') || ['node_modules', 'runs', 'outputs', 'knowledge', 'dist', 'build', '__pycache__', 'venv'].includes(item.name)) continue;
      if (item.isDirectory()) { scan(path); continue; }
      if (!['.md', '.mjs', '.js', '.cjs', '.ts', '.json'].includes(extname(path))) continue;
      const original = readFileSync(path, 'utf8');
      manifest.push([slash(relative(root, path)), digest(original)]);
      let content = original;
      if (extname(path) === '.md') {
        content = content.replace(/(\[[^\]]*\]\()(<[^>]+>|[^)]+)(\))/g, (_, a, link, b) => {
          const angled = link.startsWith('<');
          const next = localLink(angled ? link.slice(1, -1) : link, path);
          return a + (angled ? '<' + next + '>' : next) + b;
        });
      } else if (['.mjs', '.js', '.cjs', '.ts'].includes(extname(path)) && !inside(join(root, 'scripts'), path)) {
        // Rewrite only module imports and URLs explicitly based on import.meta.url.
        // Computed paths and application-specific configuration still require review.
        content = content.replace(/(\b(?:from\s*|import\s*(?:\(\s*)?|require\(\s*))(['"])(\.{1,2}\/[^'"\r\n]+)\2/g,
          (_, prefix, quote, value) => prefix + quote + localLink(value, path) + quote);
        content = content.replace(/(\bnew\s+URL\(\s*)(['"])(\.{1,2}\/[^'"\r\n]+)\2(\s*,\s*import\.meta\.url\s*\))/g,
          (_, prefix, quote, value, suffix) => prefix + quote + localLink(value, path) + quote + suffix);
      }
      if (content !== original) { add(relocated(path), content); originals.set(path, original); }
    }
  }
  scan(root);
  const name = data.name.trim();
  add(join(parent.dir, 'connections.json'), json({ ...oldDocument, connections: outer }));
  add(join(destination, 'module.json'), json({ id: data.newId, name, template: { id: 'project-framework', version: '2.0.0' }, status: 'pending' }));
  add(join(destination, 'connections.json'), json(document));
  add(join(destination, 'README.md'), '# ' + name + '\n\n由画布打包已有模块形成，成员及连接见 modules/ 和 connections.json。当前待配置：核对流程、路径引用、接口条件和检验标准后，才可改为 ready。画布不生成运行入口。\n');
  add(join(destination, 'INPUT.md'), writePorts('# 输入\n\n按 connections.json 交给内部成员；要求沿用对应成员接口。\n', inputs));
  add(join(destination, 'OUTPUT.md'), writePorts('# 输出\n\n按 connections.json 接收内部成员输出；要求沿用对应成员接口。\n', outputs));
  add(join(destination, 'PROCESS.md'), '# 处理流程\n\n按 connections.json 传递输入和输出，保留各连线的适用条件。成员失败时暂停依赖项。存在反馈时遵守 connections.json 的 stop。\n\n运行前须核对原入口、计算路径、任务选择和人工确认步骤；补齐实际调用方式。打包不会授予额外权限，也不会执行成员。\n');
  add(join(destination, 'VALIDATION.md'), '# 检验标准\n\n核对对外接口与原连线一一对应，内部连接和条件完整；用相同输入对照打包前后的结果，确认依赖路径及失败停止行为。完成这些核对并补齐业务标准后，才能设为 ready。\n');
  add(join(destination, 'settings', 'DEFAULTS.md'), '# 默认设置\n\n不新增执行设置，不自动向成员下传设置。成员继续使用自己的配置。\n');
  add(join(destination, 'settings', 'PREFERENCES.md'), '# 用户偏好\n\n暂无本组合的已确认偏好或候选偏好。\n');
  add(join(destination, 'implementation', '.gitkeep'), '');
  const layout = structuredClone(current.layout), childLayout = {};
  const parentLayout = Object.hasOwn(layout, parent.meta.id) ? layout[parent.meta.id] : (layout[parent.meta.id] = {});
  // Persist the same defaults the canvas displays, so unselected nodes do not jump
  // when their sibling indices change after packing.
  ['$input', ...parent.children.map(n => n.meta.id), '$output'].forEach((id, index) => {
    if (!Object.hasOwn(parentLayout, id)) parentLayout[id] = { x: 40 + index * 285, y: 100 + (index % 2) * 150 };
  });
  const points = members.map(n => parentLayout[n.meta.id]).filter(Boolean);
  for (const n of members) { if (parentLayout[n.meta.id]) childLayout[n.meta.id] = parentLayout[n.meta.id]; delete parentLayout[n.meta.id]; }
  parentLayout[data.newId] = points.length ? { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)) } : { x: 325, y: 250 };
  layout[data.newId] = childLayout;
  add(join(root, 'methodology', 'canvas-layout.json'), json(layout));
  const revision = digest(JSON.stringify({ manifest, current, id: data.id, members: data.members, newId: data.newId, name }));
  return { revision, moves, writes, originals, destination, summary: {
    revision, name, id: data.newId, members: members.map(n => ({ id: n.meta.id, name: n.meta.name, from: slash(relative(root, n.dir)), to: slash(relative(root, relocated(n.dir))) })),
    inputs, outputs, inner: document, outer: { ...oldDocument, connections: outer },
    updatedReferences: [...originals.keys()].map(p => slash(relative(root, p))),
    notice: '保存会移动所选模块及其原有设置、记录和成果。新组合为待配置，不生成执行入口；请核对计算路径、命令、配置及业务行为。可识别的本地文档链接和代码相对路径会同步修改。'
  } };
}

export function applyPack(root, plan) {
  const backups = new Map(), createdDirs = [], moved = [];
  const ensure = dir => {
    if (existsSync(dir)) return;
    ensure(dirname(dir)); mkdirSync(dir); createdDirs.push(dir);
  };
  const safe = path => {
    if (!inside(resolve(root), resolve(path))) throw Error('文件路径越界');
    let ancestor = path;
    while (!existsSync(ancestor)) ancestor = dirname(ancestor);
    if (!inside(realpathSync(root), realpathSync(ancestor)) || lstatSync(ancestor).isSymbolicLink()) throw Error('文件路径越界或含链接');
  };
  // Save all existing write targets at their original locations before moving anything.
  for (const path of plan.writes.keys()) {
    safe(path);
    const move = plan.moves.find(m => inside(m.to, path));
    const original = move ? join(move.from, relative(move.to, path)) : path;
    backups.set(original, existsSync(original) ? readFileSync(original) : null);
  }
  for (const file of ['overview.svg', 'panorama.md']) {
    const path = join(root, 'methodology', file); safe(path);
    backups.set(path, existsSync(path) ? readFileSync(path) : null);
  }
  try {
    ensure(join(plan.destination, 'modules'));
    ensure(join(plan.destination, 'implementation'));
    for (const move of plan.moves) { safe(move.from); safe(move.to); renameSync(move.from, move.to); moved.push(move); }
    for (const [path, content] of plan.writes) { ensure(dirname(path)); safe(path); writeFileSync(path, content); }
    const checked = load(root);
    if (checked.errors.length) throw Error(checked.errors.join('\n'));
    for (const script of ['panorama.mjs', 'check.mjs']) {
      const result = spawnSync(process.execPath, [join(root, 'scripts', script)], { encoding: 'utf8', timeout: 60000 });
      if (result.status !== 0 || result.error) throw Error(result.stderr || result.error?.message || '打包后检查失败');
    }
  } catch (error) {
    // Remove only files/directories created by this transaction, never recursively delete a module.
    for (const move of [...moved].reverse()) renameSync(move.to, move.from);
    for (const [path, content] of backups) {
      if (content !== null) writeFileSync(path, content);
      else if (existsSync(path)) unlinkSync(path);
    }
    for (const dir of createdDirs.reverse()) if (existsSync(dir)) rmdirSync(dir);
    throw error;
  }
}
