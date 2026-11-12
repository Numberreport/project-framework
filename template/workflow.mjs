// 保存一次任务的执行记录；恢复时重建调度状态，不重复调用已完成的本体和判断。
import { mkdirSync, lstatSync, realpathSync, existsSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy = value => {
  const seen = new Set();
  const visit = v => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return;
    if (typeof v !== 'object' || seen.has(v) || (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype)) throw Error('可恢复任务的输入输出必须是普通 JSON 数据');
    seen.add(v);
    if (Array.isArray(v) && Object.keys(v).length !== v.length) throw Error('任务数据不能包含稀疏数组');
    Object.values(v).forEach(visit); seen.delete(v);
  };
  visit(value); return JSON.parse(JSON.stringify(value));
};
const within = (base, path) => { const r = relative(base,path); return r && !isAbsolute(r) && r !== '..' && !r.startsWith('../') && !r.startsWith('..\\'); };
export class WorkflowPause extends Error {}

export function openWorkflow(root, version, inputs, ioInputs, options) {
  if (options.confirmationMode !== undefined && !['none','key','all'].includes(options.confirmationMode)) throw Error('确认方式须为 none、key 或 all');
  if (!options.taskDirectory) {
    if (options.resume || options.decision || (options.confirmationMode !== undefined && options.confirmationMode !== 'none')) throw Error('流程引导需要 taskDirectory 任务目录');
    return null;
  }
  const base = realpathSync(root), workspace = join(base,'workspace'), directory = resolve(options.taskDirectory);
  if (!within(workspace,directory)) throw Error('任务目录须位于当前项目 workspace/ 下');
  // 先逐级核对已有目录链接，不能在越界链接下面创建文件。
  let current = base;
  for (const part of relative(base,directory).split(/[\\/]/)) {
    current = join(current,part);
    if (existsSync(current) && !within(base,realpathSync(current))) throw Error('任务目录链接越界');
  }
  mkdirSync(directory,{recursive:true});
  if (!within(realpathSync(workspace),realpathSync(directory))) throw Error('任务目录链接越界');
  const file = join(directory,'workflow-state.json'), lock = join(directory,'workflow.lock');
  if (existsSync(file) && (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile())) throw Error('任务存档须为本目录的普通文件');
  let fd;
  try { fd = openSync(lock,'wx'); } catch { throw Error('任务正在执行或遗留运行锁；请核对运行进程和外部操作后处理'); }
  const close = () => { closeSync(fd); unlinkSync(lock); };
  try {
    const mode = options.confirmationMode;
    const identity = copy({version, inputs, ioInputs, mode:mode ?? null});
    let state;
    if (options.resume) {
      if (!existsSync(file)) throw Error('任务存档缺失，不能恢复');
      const envelope = JSON.parse(readFileSync(file,'utf8'));
      state = envelope.state;
      if (!state || envelope.digest !== digest(state) || state.schema !== 1 || !Array.isArray(state.events)) throw Error('任务存档损坏或被修改，不能恢复');
      if (digest(state.identity) !== digest(identity)) throw Error('正式版本、输入或确认设置已变化，不能沿用旧任务');
      if (state.events.some(e => e.status !== 'done')) throw Error('存在结果不明的操作，请核对外部操作后处理，不能自动重试');
    } else {
      if (existsSync(file)) throw Error('任务已存在；继续时须使用 resume，另做任务请换目录');
      if (options.decision) throw Error('新任务不能附带旧确认');
      state = {schema:1, identity, events:[], overrides:{}, pending:null, status:'running'};
    }
    const save = () => {
      const temp = join(directory,'workflow-state-'+randomUUID()+'.tmp');
      writeFileSync(temp,JSON.stringify({state,digest:digest(state)},null,2),{flag:'wx'}); renameSync(temp,file);
    };
    if (options.decision) {
      const d = options.decision, p = state.pending;
      if (!p || d.token !== p.token || !['approve','revise'].includes(d.action)) throw Error('确认已失效或决定无效，请读取当前待确认成果');
      if (d.action === 'approve') {
        state.events.push({key:p.eventKey, input:p.fingerprint, status:'done', result:null});
      } else {
        const values = copy(d.inputs);
        if (!values || Array.isArray(values) || typeof values !== 'object' || JSON.stringify(Object.keys(values).sort()) !== JSON.stringify(p.inputNames.slice().sort())) throw Error('修改后的输入须符合原模块接口');
        state.events.length = p.start;
        // 被退回组合的内部确认和修改输入一并作废。
        for (const key of Object.keys(state.overrides)) if (key === p.path || key.startsWith(p.path+'/')) delete state.overrides[key];
        state.overrides[p.path] = values;
      }
      state.pending = null; state.status = 'running';
    }
    save();
    let cursor = 0;
    return {
      close, position:() => cursor,
      values:(path,values) => copy(Object.hasOwn(state.overrides,path) ? state.overrides[path] : values),
      async event(key, data, action) {
        const input = digest(copy(data)), old = state.events[cursor];
        if (old) {
          if (old.key !== key || old.input !== input) throw Error('恢复轨迹不一致，已停止');
          cursor++; return copy(old.result);
        }
        const event = {key,input,status:'started'};
        state.events.push(event); save();
        const result = copy(await action());
        event.result = result; event.status = 'done'; cursor++; save();
        return copy(result);
      },
      gate(details) {
        const eventKey = 'confirm:'+details.path, fingerprint = digest(copy(details));
        const old = state.events[cursor];
        if (old) {
          if (old.key !== eventKey || old.input !== fingerprint) throw Error('成果版本已变化，旧确认失效');
          cursor++; return;
        }
        if (state.pending && (state.pending.eventKey !== eventKey || state.pending.fingerprint !== fingerprint)) throw Error('待确认成果与存档不一致');
        state.pending ||= {...copy(details),eventKey,fingerprint,token:randomUUID()};
        state.status = 'waiting'; save(); throw new WorkflowPause();
      },
      paused:() => ({status:'waiting', pending:copy(state.pending), stateFile:file, version}),
      finish(result) {
        if (cursor !== state.events.length || state.pending) throw Error('存档仍有未处理步骤，不能交付');
        state.status = 'completed'; save(); return {...result,status:'completed',stateFile:file};
      },
    };
  } catch (error) { close(); throw error; }
}
