// 画布与执行入口共用的项目结构。这里不保存第二份节点、接口或连线。
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

const inside = (base, path) => { const r = relative(base, path); return !isAbsolute(r) && r !== '..' && !r.startsWith('../') && !r.startsWith('..\\'); };
const read = path => readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
export const flatten = node => [node, ...node.children.flatMap(flatten)];

export function readPorts(text, title, label = '') {
  const section = new RegExp('^##[ \\t]*' + title + '[ \\t]*\\r?\\n([^]*?)(?=^## |$(?![^]))', 'm').exec(text)?.[1] || '';
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

export function readProject(rootDir) {
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
  validateConnections(tree);
  Object.defineProperty(tree,'assertCurrent',{value:() => {
    for (const [path,text] of files) if (read(path) !== text) throw Error('读取期间项目结构已变化，请重试');
    for (const [dir,value] of directories) if (shape(dir) !== value) throw Error('读取期间模块目录已变化，请重试');
  }});
  tree.assertCurrent();
  return tree;
}

export function validateConnections(tree) {
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
  }
}

// 包含模块本体，代码或提示词改变也会使旧执行计划失效；运行数据和画布布局不参与。
export function projectVersion(tree) {
  const hash = createHash('sha256'), base = realpathSync(tree.dir), seen = new Set();
  const walk = dir => {
    const real = realpathSync(dir);
    if (!inside(base, real) || seen.has(real)) throw Error('项目文件路径越界或重复：' + dir);
    seen.add(real);
    for (const entry of readdirSync(dir, {withFileTypes:true}).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || ['workspace','node_modules','__pycache__','dist','build','canvas-layout.json'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (!inside(base, realpathSync(path))) throw Error('项目文件路径越界：' + path);
      if (statSync(path).isDirectory()) walk(path);
      else { hash.update(JSON.stringify(relative(base,path))); hash.update(readFileSync(path)); }
    }
  };
  walk(tree.dir);
  tree.assertCurrent();
  return hash.digest('hex');
}
