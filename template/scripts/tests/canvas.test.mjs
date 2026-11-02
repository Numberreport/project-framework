import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createCanvasServer } from '../canvas-server.mjs';
import { readPorts, writePorts } from '../module-ports.mjs';
import { arrange } from '../canvas-layout.mjs';
import { load } from '../module-model.mjs';

test('画布保存、冲突、非法连接及回滚', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'framework-canvas-'));
  const root = join(temp, 'project');
  cpSync(new URL('../../', import.meta.url), root, { recursive: true, filter: path => !['runs', 'outputs', 'node_modules'].includes(basename(path)) });
  const server = createCanvasServer(root);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(url + '/api/project')).status, 403);
    const html = await (await fetch(url)).text();
    const token = html.match(/const token='([^']+)'/)[1];
    const headers = { 'X-Canvas-Token': token, 'Content-Type': 'application/json' };
    assert.equal((await fetch(url + '/api/project', { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
    const get = async () => (await fetch(url + '/api/project', { headers })).json();
    let project = await get();
    const node = project.nodes[0];
    assert.equal(node.processor, null); assert.equal(node.summary, '');
    assert.deepEqual(Object.keys(node.documents), ['README.md', 'INPUT.md', 'PROCESS.md', 'OUTPUT.md', 'VALIDATION.md']);
    assert.ok(node.documents['README.md'].actualPath);
    assert.equal(node.implementation, null); assert.ok(node.verify.path.endsWith('verify.mjs'));
    const readme = join(root, 'README.md');
    writeFileSync(readme, readFileSync(readme, 'utf8') + `
## 职责

职责首段。
续行。

边界全文。

## 其他
不是职责。
`);
    const withDuty = (await get()).nodes[0];
    assert.equal(withDuty.summary, `职责首段。
续行。`);
    assert.match(withDuty.responsibility, /边界全文/);
    assert.doesNotMatch(withDuty.responsibility, /不是职责/);
    const data = { id: node.id, revision: node.revision, layoutRevision: project.layoutRevision, connections: structuredClone(node.document.connections), positions: { '$input': { x: 24500, y: 23500 } }, stop: '' };
    const post = body => fetch(url + '/api/save', { method: 'POST', headers, body: JSON.stringify(body) });
    const original = readFileSync(join(root, 'connections.json'), 'utf8');
    const invalid = structuredClone(data); invalid.connections[0].to.module = 'missing';
    assert.equal((await post(invalid)).status, 400);
    assert.equal(readFileSync(join(root, 'connections.json'), 'utf8'), original);
    const badPosition=structuredClone(data); badPosition.positions.$input.x=Number.MAX_SAFE_INTEGER+1;
    assert.equal((await post(badPosition)).status,400);
    data.connections[0].info = '画布编辑测试';
    data.connections[0].kind = 'support';
    data.connections[0].custom = { keep: true };
    const badKind = structuredClone(data); badKind.connections[0].kind = 'custom-old-kind';
    assert.equal((await post(badKind)).status, 400);
    assert.equal(readFileSync(join(root, 'connections.json'), 'utf8'), original);
    let response = await post(data); assert.equal(response.status, 200, await response.text());
    assert.equal(JSON.parse(readFileSync(join(root, 'connections.json'), 'utf8')).connections[0].info, '画布编辑测试');
    assert.match(readFileSync(join(root, 'methodology/panorama.md'), 'utf8'), /画布编辑测试/);
    assert.equal((await post(data)).status, 409);
    assert.equal(JSON.parse(readFileSync(join(root, 'connections.json'), 'utf8')).connections[0].kind, 'support');
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'connections.json'), 'utf8')).connections[0].custom, { keep: true });
    project = await get(); data.revision = project.nodes[0].revision; data.layoutRevision = project.layoutRevision;
    const cycle = structuredClone(data); cycle.connections.push({ from: { module: 'example-combo', port: 'text' }, to: { module: 'example-combo', port: 'text' }, info: '循环' });
    assert.equal((await post(cycle)).status, 400);
    const before = readFileSync(join(root, 'connections.json'), 'utf8');
    writeFileSync(join(root, 'scripts/panorama.mjs'), 'process.exit(1);');
    data.connections[0].info = '不应写入';
    assert.equal((await post(data)).status, 400);
    assert.equal(readFileSync(join(root, 'connections.json'), 'utf8'), before);
  } finally { await new Promise(r => server.close(r)); rmSync(temp, { recursive: true, force: true }); }
});

test('多个输入输出、零接口、连接约束、冲突与接口回滚', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'framework-ports-')), root = join(temp, 'project');
  cpSync(new URL('../../', import.meta.url), root, { recursive: true, filter: path => !['runs', 'outputs', 'node_modules'].includes(basename(path)) });
  const server = createCanvasServer(root);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    const token = (await (await fetch(url)).text()).match(/const token='([^']+)'/)[1];
    const headers = { 'X-Canvas-Token': token, 'Content-Type': 'application/json' };
    const get = async () => (await fetch(url + '/api/project', { headers })).json();
    const post = body => fetch(url + '/api/save', { method: 'POST', headers, body: JSON.stringify(body) });
    let project = await get();
    const body = () => {
      const group = project.nodes[0];
      return { id: group.id, revision: group.revision, layoutRevision: project.layoutRevision, connections: group.document.connections, positions: {}, stop: '', interfaces: [] };
    };
    const rootNode = project.nodes[0], multi = body();
    multi.interfaces = [{id:rootNode.id,revision:rootNode.interfaceRevision,inputs:[...rootNode.inputs,{name:'unused',description:'未接线输入'}],outputs:[...rootNode.outputs,{name:'report',description:'未接线输出'}]}];
    multi.positions = {'$input:text':{x:40,y:60},'$input:unused':{x:40,y:580},'$output:text':{x:1060,y:60},'$output:report':{x:1060,y:580}};
    const saved = await post(multi); assert.equal(saved.status,200,await saved.text());
    project = await get(); assert.deepEqual(project.layout[rootNode.id],multi.positions);
    const wrong = body(); wrong.positions={'$input:missing':{x:0,y:0}};
    assert.equal((await post(wrong)).status,400);
    const combo = project.nodes.find(n => n.id === 'example-combo');
    let data = body();
    data.interfaces = [{ id: combo.id, revision: combo.interfaceRevision, inputs: [...combo.inputs, { name: 'options', description: '可选处理设置' }], outputs: [...combo.outputs, { name: 'report', description: '检查报告' }] }];
    let response = await post(data); assert.equal(response.status, 200, await response.text());
    const inputPath = join(root, 'modules/_example_combo/INPUT.md');
    assert.equal(readPorts(readFileSync(inputPath, 'utf8')).length, 2);
    assert.match(readFileSync(inputPath, 'utf8'), /本示例无有效期/);
    project = await get();
    assert.equal(project.nodes.find(n => n.id === combo.id).outputs.length, 2);
    data = body();
    data.interfaces = [{ id: combo.id, revision: project.nodes.find(n => n.id === combo.id).interfaceRevision, inputs: [], outputs: combo.outputs }];
    response = await post(data); assert.equal(response.status, 400); assert.match(await response.text(), /未定义接口/);
    assert.equal(readPorts(readFileSync(inputPath, 'utf8')).length, 2);
    const feedback = project.nodes.find(n => n.id === 'framework-feedback');
    data = body(); data.interfaces = [{ id: feedback.id, revision: feedback.interfaceRevision, inputs: [], outputs: [] }];
    assert.equal((await post(data)).status, 200);
    project = await get(); assert.deepEqual(project.nodes.find(n => n.id === feedback.id).inputs, []);
    const zero = body();
    zero.connections = [];
    zero.interfaces = [{ id: zero.id, revision: project.nodes[0].interfaceRevision, inputs: [], outputs: [] }];
    assert.equal((await post(zero)).status, 200);
    project = await get();
    data = body(); const current = project.nodes.find(n => n.id === combo.id);
    data.interfaces = [{ id: combo.id, revision: current.interfaceRevision, inputs: current.inputs, outputs: current.outputs }];
    writeFileSync(inputPath, readFileSync(inputPath, 'utf8') + '\n外部修改\n');
    assert.equal((await post(data)).status, 409);
    project = await get(); data = body();
    const latest = project.nodes.find(n => n.id === combo.id);
    data.interfaces = [{ id: combo.id, revision: latest.interfaceRevision, inputs: [...latest.inputs, { name: 'extra', description: '新增' }], outputs: latest.outputs }];
    const before = readFileSync(inputPath, 'utf8');
    writeFileSync(join(root, 'scripts/panorama.mjs'), 'process.exit(1);');
    assert.equal((await post(data)).status, 400);
    assert.equal(readFileSync(inputPath, 'utf8'), before);
    writeFileSync(inputPath, writePorts(before, []));
    assert.ok(load(root).errors.some(e => e.includes('未定义接口')));
  } finally { await new Promise(r => server.close(r)); rmSync(temp, { recursive: true, force: true }); }
});

test('接口定义拒绝重复名称、空要求和多块定义，更新保留正文', () => {
  assert.throws(() => writePorts('正文', [{ name: 'a', description: '' }]));
  assert.throws(() => writePorts('正文', [{ name: 'a', description: '一' }, { name: 'a', description: '二' }]));
  const text = writePorts('# 输入\n\n原有说明', [{ name: 'a', description: '要求' }]);
  assert.throws(() => readPorts(text + '\n' + text));
  assert.match(writePorts(text, []), /原有说明/);
  assert.deepEqual(readPorts(writePorts(text, [])), []);
});


test('执行信息可选，非法值、缺失文件和实际路径越界拒绝，旧文件不改写', () => {
  const temp = mkdtempSync(join(tmpdir(), 'framework-entry-')), root = join(temp, 'project');
  cpSync(new URL('../../', import.meta.url), root, { recursive: true });
  try {
    const path = join(root, 'module.json'), original = readFileSync(path, 'utf8'), meta = JSON.parse(original);
    const check = patch => { writeFileSync(path, JSON.stringify({ ...meta, ...patch })); return load(root).errors; };
    assert.deepEqual(check({ processor: 'program', implementation: 'implementation/run.mjs' }), []);
    for (const processor of ['human', null, {}, 1]) assert.ok(check({ processor }).some(e => e.includes('processor')));
    for (const implementation of ['../README.md', '/tmp/a', 'implementation/../README.md', 'implementation/run.mjs --run', 'implementation/missing.md', null]) assert.ok(check({ implementation }).some(e => e.includes('implementation')));
    writeFileSync(join(temp, 'outside.md'), 'outside');
    symlinkSync(temp, join(root, 'implementation', 'linked'), 'junction');
    assert.ok(check({ implementation: 'implementation/linked/outside.md' }).some(e => e.includes('实际路径越界')));
    writeFileSync(path, original); assert.deepEqual(load(root).errors, []);
    assert.equal(readFileSync(path, 'utf8'), original);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('连接布局区分分支和汇合，反馈同列且不改连接', () => {
  const edge = (a,b) => ({ from:{module:a}, to:{module:b} });
  const edges = [edge('$self','a'),edge('a','b'),edge('a','c'),edge('b','d'),edge('c','d'),edge('d','$self')];
  const before = JSON.stringify(edges), ids = ['$input','a','b','c','d','$output'];
  const p = arrange(ids,edges);
  assert.ok(p.a.x < p.b.x && p.b.x < p.d.x); assert.equal(p.b.x,p.c.x); assert.notEqual(p.b.y,p.c.y);
  assert.equal(JSON.stringify(edges),before);
  edges.push(edge('d','a')); const cycle = arrange(ids,edges);
  assert.equal(cycle.a.x,cycle.d.x); assert.notEqual(cycle.a.y,cycle.d.y);
});


test('画布页面模块语法有效，只读展开使用父草稿而非独立编辑事务', () => {
  const html = readFileSync(new URL('../canvas.html', import.meta.url), 'utf8');
  const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: source, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(source, /parent\.canvasSnapshot\(\)/);
  assert.match(source, /if\(embedded\)return/);
  assert.match(source, /内部只读视图/);
});
