// 画布与执行入口共用的项目结构。这里不保存第二份节点、接口或连线。
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

const inside = (base, path) => { const r = relative(base, path); return !isAbsolute(r) && r !== '..' && !r.startsWith('../') && !r.startsWith('..\\'); };
const read = path => readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
export const flatten = node => [node, ...node.children.flatMap(flatten)];

// 代码示例和注释中的标题不参与说明书分节；保留位置以读取原文。
function headingText(text) {
  let fence = null;
  return text.replace(/<!--[\s\S]*?-->/g, value => value.replace(/[^\r\n]/g, ' ')).split('\n').map(line => {
    const mark = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ''));
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = null;
      return line.replace(/[^\r]/g, ' ');
    }
    if (mark) { fence = mark[1]; return line.replace(/[^\r]/g, ' '); }
    return line;
  }).join('\n');
}
export const headingsOf = text => [...headingText(text).matchAll(/^##[ \t]+([^\r\n]*?)[ \t]*\r?$/gm)];
export function sectionOf(text, title) {
  const headings = headingsOf(text);
  const index = headings.findIndex(match => match[1] === title);
  if (index < 0) return null;
  const match = headings[index];
  return text.slice(match.index + match[0].length, headings[index + 1]?.index ?? text.length);
}

export function readPorts(text, title, label = '') {
  const section = sectionOf(text, title) || '';
  const blocks = [...section.matchAll(/```interfaces[ \t]*\r?\n([^]*?)\r?\n```/g)];
  if (blocks.length > 1) throw Error('接口定义只能有一块：' + label + '/' + title);
  if (!blocks.length) return [];
  let ports;
  try { ports = JSON.parse(blocks[0][1]); } catch { throw Error('接口定义不是有效 JSON：' + label + '/' + title); }
  if (!Array.isArray(ports)) throw Error('接口定义必须是数组：' + label + '/' + title);
  const seen = new Set();
  for (const port of ports) {
    if (!identifier(port?.name) || seen.has(port.name) || typeof port.description !== 'string' || !port.description.trim()) throw Error('接口名称或说明无效、重复：' + label + '/' + title);
    seen.add(port.name);
  }
  return ports;
}

export function readProject(rootDir, { allowIncompleteOutputs = false } = {}) {
  const root = realpathSync(rootDir), ids = new Set(), paths = new Set();
  const files = new Map(), directories = new Map();
  const source = path => { const text = read(path); files.set(path,text); return text; };
  const shape = dir => JSON.stringify([existsSync(join(dir,'modules')), existsSync(join(dir,'connections.json')),
    ...(existsSync(join(dir,'modules')) && statSync(join(dir,'modules')).isDirectory() ? readdirSync(join(dir,'modules')).sort() : [])]);
  const load = dir => {
    const real = realpathSync(dir), label = relative(root, dir).replaceAll('\\', '/') || '.';
    if (!inside(root, real) || paths.has(real)) throw Error('模块路径越界或重复包含：' + label);
    paths.add(real);
    directories.set(dir,shape(dir));
    const json = name => {
      const path = join(dir, name);
      if (!inside(real, realpathSync(path))) throw Error('文件路径越界：' + label + '/' + name);
      try { return JSON.parse(source(path)); } catch { throw Error('JSON 无效或缺失：' + label + '/' + name); }
    };
    const meta = json('module.json');
    if (!identifier(meta?.id) || ids.has(meta.id)) throw Error('模块标识无效或重复：' + label);
    if (!['ready','pending'].includes(meta.status)) throw Error('模块状态须为 ready 或 pending：' + label);
    if (meta.processor !== undefined && !['ai','program','mixed'].includes(meta.processor)) throw Error('processor 只能取 program、ai、mixed：' + label);
    ids.add(meta.id);
    const doc = join(dir, 'README.md');
    if (!inside(real, realpathSync(doc))) throw Error('README 路径越界：' + label);
    const text = source(doc);
    const node = { dir, label, meta, id:meta.id, name:String(meta.name || meta.id), children:[], links:[], ioNodes:[], stop:'', isCombo:false,
      inputs:readPorts(text, '输入', label), outputs:readPorts(text, '输出', label) };
    for (const key of ['implementation', 'verify']) {
      if (meta[key] === undefined) continue;
      const entry = meta[key];
      if (typeof entry !== 'string' || !entry.trim() || isAbsolute(entry) || entry.split(/[\\/]/).includes('..')) throw Error(key + ' 须填本模块内的相对路径：' + label);
      const path = join(dir, entry);
      if (!existsSync(path) || !statSync(path).isFile() || !inside(real, realpathSync(path))) throw Error(key + ' 指向的文件不存在或越界：' + label);
    }
    const members = join(dir, 'modules');
    if (existsSync(members) !== existsSync(join(dir, 'connections.json'))) throw Error('组合须同时有 modules/ 和 connections.json：' + label);
    if (existsSync(members)) {
      if (!statSync(members).isDirectory() || !inside(real, realpathSync(members))) throw Error('成员目录无效或越界：' + label);
      node.isCombo = true;
      for (const entry of readdirSync(members, {withFileTypes:true}).sort((a,b) => a.name.localeCompare(b.name))) {
        if (entry.name === '.gitkeep') continue;
        if (entry.name.startsWith('.') || !statSync(join(members, entry.name)).isDirectory()) throw Error('modules/ 下只能放模块目录：' + label);
        node.children.push(load(join(members, entry.name)));
      }
      const data = json('connections.json');
      if (!Array.isArray(data?.connections) || (data.ioNodes !== undefined && !Array.isArray(data.ioNodes))) throw Error('连接或输入输出节点必须是数组：' + label);
      node.links = data.connections; node.ioNodes = data.ioNodes || []; node.stop = data.stop || '';
      for (const io of node.ioNodes) {
        if (!identifier(io?.id) || ids.has(io.id) || !['input','output'].includes(io.type) || typeof io.name !== 'string' || !io.name.trim() || typeof io.description !== 'string' || !io.description.trim()) throw Error('输入输出节点无效或标识重复：' + label);
        ids.add(io.id);
      }
    }
    if (!node.isCombo && meta.status === 'ready' && !meta.implementation) throw Error('模块缺少执行入口：' + label + '（正文就是本体时填写 README.md）');
    return node;
  };
  const tree = load(root);
  validateConnections(tree, { allowIncompleteOutputs });
  for (const node of flatten(tree)) validateGuidance(node);
  Object.defineProperty(tree,'assertCurrent',{value:() => {
    for (const [path,text] of files) if (read(path) !== text) throw Error('读取期间项目结构已变化，请重试');
    for (const [dir,value] of directories) if (shape(dir) !== value) throw Error('读取期间模块目录已变化，请重试');
  }});
  tree.assertCurrent();
  return tree;
}

export function validateConnections(tree, { allowIncompleteOutputs = false } = {}) {
  for (const level of flatten(tree).filter(n => n.isCombo)) {
    const endpoints = new Map([['$self', {outputs:level.inputs, inputs:level.outputs}], ...level.children.map(n => [n.id,n]),
      ...level.ioNodes.map(n => [n.id, {inputs:n.type === 'output' ? [{name:'value'}] : [], outputs:n.type === 'input' ? [{name:'value'}] : []}])]);
    for (const edge of level.links) {
      for (const side of ['from','to']) {
        const end = edge?.[side], owner = endpoints.get(end?.module);
        if (!owner) throw Error('连接端点须是本层成员或 $self：' + level.label);
        if (!owner[side === 'from' ? 'outputs' : 'inputs'].some(p => p.name === end.port)) throw Error('连接引用了未定义的接口：' + level.label + '/' + end.module + '.' + end.port);
      }
      if (typeof edge.info !== 'string' || !edge.info.trim()) throw Error('连接没写传的是什么：' + level.label);
      if (edge.when !== undefined && (typeof edge.when !== 'string' || !edge.when.trim())) throw Error('连接条件留空：' + level.label);
      if (edge.kind !== undefined && !['support','return'].includes(edge.kind)) throw Error('连接 kind 只能取 support 或 return：' + level.label);
    }
    for (const port of !allowIncompleteOutputs && level.meta.status === 'ready' ? level.outputs : []) {
      if (!level.links.some(edge => edge.to.module === '$self' && edge.to.port === port.name)) {
        throw Error('组合交付没有接回本层，输出没有来源：' + level.label + '.' + port.name);
      }
    }
  }
}

// 隐藏代码同样参与正式版本；只排除明确的本地配置与运行目录。
export const ignoredHiddenEntry = name => ['.git', '.canvas-drafts', '.draft.json', '.venv'].includes(name) || name === '.env' || name.startsWith('.env.');

// 版本检查和项目复制共用的正式文件范围；调用方仍负责核对真实路径是否越界。
export function projectFileFilter(tree) {
  const excluded = name => ['.git', '.canvas-drafts', '.draft.json', 'credentials.json', 'secrets.json'].includes(name) ||
    name === '.env' || name.startsWith('.env.') || /\.(pem|key)$/i.test(name);
  const ignored = name => ignoredHiddenEntry(name) || ['workspace','node_modules','__pycache__','dist','build','venv','canvas-layout.json'].includes(name);
  const protectedRoots = new Set();
  // 登记入口所在的排除目录已是本体，连同其中的依赖参与版本，不能只散列入口文件。
  for (const node of flatten(tree)) {
    for (const target of [node.dir, ...['implementation','verify'].filter(key => node.meta[key]).map(key => join(node.dir,node.meta[key]))]) {
      let path = tree.dir;
      for (const name of relative(tree.dir,target).split(/[\\/]/).filter(Boolean)) {
        path = join(path,name);
        if (ignored(name)) { protectedRoots.add(path); break; }
      }
    }
  }
  const protectedPaths = [...protectedRoots];
  const rootFiles = Array.isArray(tree.meta.rootFiles) ? tree.meta.rootFiles : [];
  return path => {
    const parts = relative(tree.dir,path).split(/[\\/]/);
    if (parts.some(excluded)) return false;
    if (['runs', 'outputs'].includes(parts[0]) && !rootFiles.includes(parts[0])) return false;
    return protectedPaths.some(root => inside(root,path)) || parts.every(name => !ignored(name));
  };
}

// 包含模块本体，代码或提示词改变也会使旧执行计划失效；运行数据和画布布局不参与。
export function projectVersion(tree) {
  const hash = createHash('sha256'), base = realpathSync(tree.dir), seen = new Set();
  const include = projectFileFilter(tree);
  const walk = dir => {
    const real = realpathSync(dir);
    if (!inside(base, real) || seen.has(real)) throw Error('项目文件路径越界或重复：' + dir);
    seen.add(real);
    for (const entry of readdirSync(dir, {withFileTypes:true}).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (!include(path)) continue;
      if (!inside(base, realpathSync(path))) throw Error('项目文件路径越界：' + path);
      if (statSync(path).isDirectory()) walk(path);
      else { hash.update(JSON.stringify(relative(base,path))); hash.update(readFileSync(path)); }
    }
  };
  walk(tree.dir);
  tree.assertCurrent();
  return hash.digest('hex');
}

// 引导只引用正式成员，不提供第二套顺序。
export function validateGuidance(node) {
  const g = node.meta.guidance;
  if (g === undefined) return;
  if (!node.isCombo || !g || typeof g !== 'object' || Array.isArray(g) ||
      Object.keys(g).some(k => !['mode','checkpoints'].includes(k)) ||
      !['none','key','all'].includes(g.mode) || !Array.isArray(g.checkpoints) ||
      new Set(g.checkpoints).size !== g.checkpoints.length ||
      g.checkpoints.some(id => !node.children.some(c => c.id === id) || !node.links.some(e => e.from.module === id || e.to.module === id))) {
    throw Error('流程引导设置无效：须在组合登记确认方式和已连接的本层成员，不能另设顺序：'+node.label);
  }
}
