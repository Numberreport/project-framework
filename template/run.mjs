// 所有接力关系都从正式项目读取；调用方只能接入执行方式，不能另传一张流程图。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { readProject, projectVersion } from './structure.mjs';

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function contract(value, ports, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(label + '必须是按接口名填写的对象');
  const names = ports.map(p => p.name);
  for (const name of names) if (!own(value,name) || value[name] === undefined) throw Error(label + '缺少接口：' + name);
  for (const name of Object.keys(value)) if (!names.includes(name)) throw Error(label + '包含未定义的接口：' + name);
}
const participants = node => {
  const used = new Set(node.links.flatMap(e => [e.from.module,e.to.module]));
  return node.children.filter(n => used.has(n.id));
};
function cyclic(node) {
  const graph = new Map(), active = new Set(), done = new Set();
  for (const edge of node.links) {
    if (edge.from.module === '$self' || edge.to.module === '$self') continue;
    if (!graph.has(edge.from.module)) graph.set(edge.from.module,[]);
    graph.get(edge.from.module).push(edge.to.module);
  }
  const visit = id => {
    if (active.has(id)) return true;
    if (done.has(id)) return false;
    active.add(id);
    if ((graph.get(id) || []).some(visit)) return true;
    active.delete(id); done.add(id); return false;
  };
  return [...graph.keys()].some(visit);
}

export function executionPlan(rootDir) {
  const tree = readProject(rootDir);
  const describe = node => ({ id:node.id, name:node.name, path:node.label, status:node.meta.status,
    implementation:node.meta.implementation || null, inputs:node.inputs, outputs:node.outputs,
    ...(node.isCombo ? {connections:node.links, ioNodes:node.ioNodes, stop:node.stop, members:participants(node).map(describe)} : {}) });
  return {version:projectVersion(tree), project:describe(tree)};
}

// 每次程序执行使用独立环境，避免改了被导入的文件后继续运行旧缓存。
function nativeProgram(entry, inputs, context, timeoutMs) {
  return new Promise((resolve,reject) => {
    const worker = new Worker(`
      const {parentPort,workerData}=require('node:worker_threads');
      const {pathToFileURL}=require('node:url');
      (async()=>{
        const module=await import(pathToFileURL(workerData.entry).href);
        if(typeof module.run!=='function')throw Error('程序入口须导出 run(inputs, context)');
        parentPort.postMessage({result:await module.run(workerData.inputs,workerData.context)});
      })().catch(error=>parentPort.postMessage({error:error.message}));
    `, {eval:true, workerData:{entry, inputs, context}});
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      worker.terminate().then(() => error ? reject(error) : resolve(result),reject);
    };
    const timer = setTimeout(() => finish(Error('程序执行超时：' + context.id)),timeoutMs);
    worker.once('message', message => finish(message.error ? Error(message.error) : null,message.result));
    worker.once('error',error => finish(error));
    worker.once('exit',code => finish(Error('程序未交付结果即退出：' + context.id + ' (' + code + ')')));
  });
}

export async function runProject(rootDir, inputs, options = {}) {
  const tree = readProject(rootDir), version = projectVersion(tree);
  const {executeAI, executeProgram, evaluateWhen, shouldStop, ioInputs = {}, expectedVersion,
    maxSteps = 1000, timeoutMs = 60000} = options;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw Error('执行次数和超时必须是正整数');
  if (expectedVersion && expectedVersion !== version) throw Error('正式项目已变化，请重新读取执行计划');
  if (tree.dir.split(/[\\/]/).includes('.canvas-drafts')) throw Error('草稿不能作为正式项目执行');
  const unchanged = () => {
    if (projectVersion(readProject(rootDir)) !== version) throw Error('执行期间正式项目已变化，已停止接力，请重新核对后运行');
  };
  const prepared = new Set(), ioIds = new Set();
  // 先检查完整接力链，再执行第一个模块，避免做到一半才发现后面没有入口。
  const prepare = node => {
    if (node.meta.status !== 'ready') throw Error('模块尚未完成，不得运行：' + node.label);
    if (!node.isCombo) {
      const entry = node.meta.implementation;
      if (!entry) throw Error('模块缺少执行入口：' + node.label);
      const ai = node.meta.processor === 'ai' || (!node.meta.processor && /\.md$/i.test(entry));
      if (ai && typeof executeAI !== 'function') throw Error('AI 模块需要接入执行方式：' + node.label);
      if (!ai && !entry.endsWith('.mjs') && typeof executeProgram !== 'function') throw Error('此程序需要接入执行方式：' + node.label);
      prepared.add(node.id); return;
    }
    if (node.meta.implementation) throw Error('组合不能另设执行入口绕开连接：' + node.label);
    if (node.links.some(e => e.when !== undefined) && typeof evaluateWhen !== 'function') throw Error('条件连线需要接入条件判断：' + node.label);
    if (cyclic(node) && (typeof node.stop !== 'string' || !node.stop.trim() || typeof shouldStop !== 'function')) throw Error('反馈回路需要停止条件和停止判断：' + node.label);
    const targets = new Set();
    for (const edge of node.links) {
      const target = JSON.stringify([edge.to.module,edge.to.port]);
      targets.add(target);
    }
    for (const io of node.ioNodes) if (io.type === 'input' && node.links.some(e => e.from.module === io.id)) ioIds.add(io.id);
    for (const member of participants(node)) {
      for (const port of member.inputs) if (!targets.has(JSON.stringify([member.id,port.name]))) throw Error('模块输入没有来源：' + member.label + '.' + port.name);
      prepare(member);
    }
  };
  prepare(tree);
  for (const id of Object.keys(ioInputs)) if (!ioIds.has(id)) throw Error('未定义的独立输入节点：' + id);
  for (const id of ioIds) if (!own(ioInputs,id) || ioInputs[id] === undefined) throw Error('缺少独立输入节点的材料：' + id);
  let steps = 0;
  const ioOutputs = {};
  const bounded = async action => {
    let timer;
    try { return await Promise.race([Promise.resolve().then(action),new Promise((_,reject) => { timer = setTimeout(() => reject(Error('执行方式响应超时')),timeoutMs); })]); }
    finally { clearTimeout(timer); }
  };
  const execute = async (node, data) => {
    unchanged(); contract(data,node.inputs,node.label + ' 输入');
    if (node.isCombo) return combination(node,data);
    if (!prepared.has(node.id)) throw Error('模块未经执行检查：' + node.id);
    const entry = join(node.dir,node.meta.implementation);
    const context = {id:node.id, directory:node.dir, entry, version, inputs:structuredClone(node.inputs), outputs:structuredClone(node.outputs)};
    const ai = node.meta.processor === 'ai' || (!node.meta.processor && /\.md$/i.test(entry));
    const result = ai
      ? await bounded(() => executeAI({ ...context, prompt:readFileSync(entry,'utf8'), values:data }))
      : typeof executeProgram === 'function'
        ? await bounded(() => executeProgram({...context, values:data}))
        : await nativeProgram(entry,data,context,timeoutMs);
    unchanged(); contract(result,node.outputs,node.label + ' 输出');
    return result;
  };
  const tick = () => { if (++steps > maxSteps) throw Error('超过允许的执行次数，已停止'); };
  const combination = async (node, data) => {
    const members = participants(node), queues = new Map(), outputs = {}, ranSources = new Set();
    let stopped = false;
    const queue = (id,port) => { const key = JSON.stringify([id,port]); if (!queues.has(key)) queues.set(key,[]); return queues.get(key); };
    const route = async (id, values) => {
      for (const edge of node.links.filter(e => e.from.module === id)) {
        if (!own(values,edge.from.port)) continue;
        if (edge.when !== undefined) {
          const allowed = await bounded(() => evaluateWhen({condition:edge.when, edge:structuredClone(edge), value:structuredClone(values[edge.from.port]), levelId:node.id, version}));
          unchanged();
          if (typeof allowed !== 'boolean') throw Error('条件判断必须返回 true 或 false');
          if (!allowed) continue;
        }
        const value = structuredClone(values[edge.from.port]);
        if (edge.to.module === '$self') outputs[edge.to.port] = value;
        else {
          const io = node.ioNodes.find(n => n.id === edge.to.module);
          if (io) ioOutputs[io.id] = value;
          else queue(edge.to.module,edge.to.port).push(value);
        }
      }
    };
    await route('$self',data);
    for (const io of node.ioNodes.filter(n => n.type === 'input' && own(ioInputs,n.id))) await route(io.id,{value:ioInputs[io.id]});
    while (true) {
      unchanged();
      const next = members.find(n => n.inputs.length ? n.inputs.every(p => queue(n.id,p.name).length) : !ranSources.has(n.id));
      if (!next) break;
      tick(); ranSources.add(next.id);
      const values = Object.fromEntries(next.inputs.map(p => [p.name,queue(next.id,p.name).shift()]));
      await route(next.id,await execute(next,values));
      if (node.stop && typeof shouldStop === 'function') {
        const stop = await bounded(() => shouldStop({condition:node.stop, levelId:node.id, steps, outputs:structuredClone(outputs), version}));
        unchanged();
        if (typeof stop !== 'boolean') throw Error('停止判断必须返回 true 或 false');
        if (stop) { stopped = true; break; }
      }
    }
    if (!stopped && [...queues.values()].some(q => q.length)) throw Error('部分输入尚未凑齐，不能交付：' + node.label);
    contract(outputs,node.outputs,node.label + ' 输出');
    return outputs;
  };
  const outputs = await execute(tree,inputs);
  unchanged();
  return {outputs, ioOutputs, steps, version};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const root = dirname(fileURLToPath(import.meta.url));
    if (process.argv[2] === '--plan') console.log(JSON.stringify(executionPlan(root),null,2));
    else {
      const input = process.argv[2];
      if (!input) throw Error('用法：node run.mjs --plan，或 node run.mjs <输入.json>');
      console.log(JSON.stringify(await runProject(root,JSON.parse(readFileSync(input,'utf8'))),null,2));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
