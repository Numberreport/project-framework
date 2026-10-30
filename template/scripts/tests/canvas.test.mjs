import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createCanvasServer } from '../canvas-server.mjs';
import { readPorts, writePorts } from '../module-ports.mjs';
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
    const data = { id: node.id, revision: node.revision, layoutRevision: project.layoutRevision, connections: structuredClone(node.document.connections), positions: { '$input': { x: 50, y: 70 } }, stop: '' };
    const post = body => fetch(url + '/api/save', { method: 'POST', headers, body: JSON.stringify(body) });
    const original = readFileSync(join(root, 'connections.json'), 'utf8');
    const invalid = structuredClone(data); invalid.connections[0].to.module = 'missing';
    assert.equal((await post(invalid)).status, 400);
    assert.equal(readFileSync(join(root, 'connections.json'), 'utf8'), original);
    data.connections[0].info = '画布编辑测试';
    let response = await post(data); assert.equal(response.status, 200, await response.text());
    assert.equal(JSON.parse(readFileSync(join(root, 'connections.json'), 'utf8')).connections[0].info, '画布编辑测试');
    assert.match(readFileSync(join(root, 'methodology/panorama.md'), 'utf8'), /画布编辑测试/);
    assert.equal((await post(data)).status, 409);
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
