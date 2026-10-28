import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvasServer } from '../canvas-server.mjs';

test('画布保存、冲突、非法连接及回滚', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'framework-canvas-'));
  const root = join(temp, 'project');
  cpSync(new URL('../../', import.meta.url), root, { recursive: true });
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
