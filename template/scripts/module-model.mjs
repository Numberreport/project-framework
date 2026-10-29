import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { readPorts } from './module-ports.mjs';
export const REQUIRED = ['README.md', 'INPUT.md', 'OUTPUT.md', 'PROCESS.md', 'VALIDATION.md', 'settings/DEFAULTS.md', 'settings/PREFERENCES.md'];
export const inside = (base, target) => { const r = relative(base, target); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
export function load(root, overrides = new Map(), sources = new Map()) {
  const errors = [], nodes = [], ids = new Set(), paths = new Set();
  const fail = (message) => errors.push(message);
  const text = p => (sources.has(p) ? sources.get(p) : readFileSync(p, 'utf8')).replace(/^\uFEFF/, '');
  const json = p => { try { return JSON.parse(text(p)); } catch { fail('JSON 无效或缺失：' + relative(root, p)); return null; } };
  function visit(dir) {
    const label = relative(root, dir).replaceAll('\\', '/') || '.';
    const real = realpathSync(dir);
    if (!inside(realpathSync(root), real) || paths.has(real)) { fail('模块路径越界或重复包含：' + label); return null; }
    paths.add(real);
    const meta = json(join(dir, 'module.json'));
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) { fail('模块信息必须是对象：' + label); return null; }
    for (const field of ['id', 'name']) if (typeof meta[field] !== 'string' || !meta[field].trim()) fail('模块信息缺 ' + field + '：' + label);
    if (typeof meta.id === 'string' && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(meta.id)) fail('模块标识格式无效：' + label);
    if (ids.has(meta.id)) fail('模块标识重复：' + meta.id);
    ids.add(meta.id);
    if (meta.template?.id !== 'project-framework' || meta.template?.version !== '2.0.0') fail('模板版本不支持：' + label + '（需明确迁移，不能猜格式）');
    if (!['ready', 'pending'].includes(meta.status)) fail('配置状态无效：' + label);
    for (const file of REQUIRED) {
      const target = join(dir, file);
      if (!existsSync(target) || !statSync(target).isFile() || !inside(real, realpathSync(target))) fail('配套文件缺失或越界：' + label + '/' + file);
      else if (!text(target).trim() || /<待填写>/.test(text(target))) fail('配套内容未完成：' + label + '/' + file);
    }
    const hasMembers = existsSync(join(dir, 'modules'));
    const hasLinks = existsSync(join(dir, 'connections.json'));
    if (hasMembers !== hasLinks) fail('组合须同时具备 modules/ 和 connections.json：' + label);
    const node = { dir, label, meta, children: [], links: [] };
    for (const [side, file] of [['inputs', 'INPUT.md'], ['outputs', 'OUTPUT.md']]) {
      try { node[side] = readPorts(text(join(dir, file))); }
      catch (e) { fail('接口定义无效：' + label + '/' + file + '：' + e.message); }
    }
    nodes.push(node);
    const impl = join(dir, 'implementation');
    if (!existsSync(impl) || !statSync(impl).isDirectory() || !inside(real, realpathSync(impl))) fail('缺少或越界的 implementation/：' + label);
    if (hasMembers) {
      const membersDir = join(dir, 'modules');
      if (!statSync(membersDir).isDirectory() || !inside(real, realpathSync(membersDir))) { fail('成员目录越界或无效：' + label); return node; }
      for (const item of readdirSync(membersDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (item.name === '.gitkeep') continue;
        if (item.name.startsWith('.') || !(item.isDirectory() || item.isSymbolicLink())) { fail('成员目录只能放模块：' + label + '/' + item.name); continue; }
        const path = join(membersDir, item.name);
        if (!statSync(path).isDirectory()) { fail('成员不是目录：' + path); continue; }
        const child = visit(path);
        if (child) node.children.push(child);
      }
      const links = overrides.has(label) ? overrides.get(label) : json(join(dir, 'connections.json'));
      if (!Array.isArray(links?.connections)) fail('connections.json 缺 connections 数组：' + label);
      else node.links = links.connections;
      const children = new Set(node.children.map(n => n.meta.id));
      const adjacency = new Map();
      for (const edge of node.links) {
        if (!edge || typeof edge !== 'object') { fail('连接必须是对象：' + label); continue; }
        for (const side of ['from', 'to']) {
          const end = edge[side];
          if (!end || typeof end.module !== 'string' || (end.module !== '$self' && !children.has(end.module))) fail('连接端点不在直接成员里：' + label + '/' + side);
          if (typeof end?.port !== 'string' || !end.port.trim()) fail('连接缺命名输入输出项：' + label + '/' + side);
          const owner = end?.module === '$self' ? node : node.children.find(n => n.meta.id === end?.module);
          const direction = end?.module === '$self' ? (side === 'from' ? 'inputs' : 'outputs') : (side === 'from' ? 'outputs' : 'inputs');
          if (owner?.[direction] && !owner[direction].some(p => p.name === end?.port)) fail('连接引用未定义接口：' + label + '/' + end.module + '.' + end.port);
        }
        if (typeof edge.info !== 'string' || !edge.info.trim()) fail('连接未说明传递信息：' + label);
        if (edge.when !== undefined && (typeof edge.when !== 'string' || !edge.when.trim())) fail('连接条件无效：' + label);
        if (edge.from?.module !== '$self' && edge.to?.module !== '$self') {
          const source = edge.from?.module, target = edge.to?.module;
          if (!adjacency.has(source)) adjacency.set(source, []);
          adjacency.get(source).push(target);
        }
      }
      const active = new Set(), done = new Set();
      let cyclic = false;
      function dfs(id) { if (active.has(id)) { cyclic = true; return; } if (done.has(id)) return; active.add(id); for (const to of adjacency.get(id) || []) dfs(to); active.delete(id); done.add(id); }
      for (const id of children) dfs(id);
      if (cyclic && (typeof links?.stop !== 'string' || !links.stop.trim())) fail('反馈回路缺停止条件：' + label);
      if ((node.inputs?.length !== 0 && !node.links.some(e => e?.from?.module === '$self')) || (node.outputs?.length !== 0 && !node.links.some(e => e?.to?.module === '$self'))) fail('组合缺外部输入或最终输出连接：' + label);
    }
    return node;
  }
  try { visit(root); } catch (e) { fail('无法读取模块：' + e.message); }
  return { nodes, errors };
}
