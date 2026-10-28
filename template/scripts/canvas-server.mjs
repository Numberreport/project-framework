import { createServer } from 'node:http';
import { readFileSync, existsSync, realpathSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { load, inside } from './module-model.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
export function createCanvasServer(root) {
  const token = randomBytes(24).toString('hex');
  const layoutPath = join(root, 'methodology', 'canvas-layout.json');
  const safe = p => { if (!inside(realpathSync(root), realpathSync(dirname(p))) || (existsSync(p) && !inside(realpathSync(root), realpathSync(p)))) throw Error('文件路径越界'); };
  const readLayout = () => { safe(layoutPath); return existsSync(layoutPath) ? readFileSync(layoutPath, 'utf8') : '{}'; };
  function snapshot() {
    const { nodes, errors } = load(root);
    if (errors.length) throw Error(errors.join('\n'));
    const layout = readLayout();
    return { layout: JSON.parse(layout), layoutRevision: hash(layout), nodes: nodes.map(n => {
      const path = join(n.dir, 'connections.json'); safe(path);
      const raw = n.children.length || existsSync(path) ? readFileSync(path, 'utf8') : null;
      return { id: n.meta.id, name: n.meta.name, label: n.label, children: n.children.map(c => c.meta.id),
        input: readFileSync(join(n.dir, 'INPUT.md'), 'utf8'), output: readFileSync(join(n.dir, 'OUTPUT.md'), 'utf8'),
        document: raw ? JSON.parse(raw) : null, revision: raw ? hash(raw) : null };
    }) };
  }
  function atomic(path, content) {
    safe(path); const temporary = path + '.' + token + '.tmp';
    try { writeFileSync(temporary, content, { flag: 'wx' }); renameSync(temporary, path); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const host = '127.0.0.1:' + serverPort(req);
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== 'http://' + host)) { res.writeHead(403).end(); return; }
    try {
      if (req.method === 'GET' && req.url === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(readFileSync(new URL('./canvas.html', import.meta.url), 'utf8').replace('__TOKEN__', token)); return;
      }
      if (req.headers['x-canvas-token'] !== token) { res.writeHead(403).end(); return; }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (req.method === 'GET' && req.url === '/api/project') { res.end(JSON.stringify(snapshot())); return; }
      if (req.method !== 'POST' || req.url !== '/api/save') { res.writeHead(404).end(); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 1000000) throw Error('保存内容过大'); }
      const data = JSON.parse(body), current = snapshot();
      const node = current.nodes.find(n => n.id === data.id && n.document);
      if (!node) throw Error('请选择组合模块');
      if (node.revision !== data.revision || current.layoutRevision !== data.layoutRevision) { res.writeHead(409).end(JSON.stringify({ error: '文件已被其他操作修改，请重新加载后再编辑。' })); return; }
      const document = { ...node.document, connections: data.connections };
      if (typeof data.stop !== 'string') throw Error('停止条件格式无效');
      if (data.stop.trim()) document.stop = data.stop; else delete document.stop;
      const checked = load(root, new Map([[node.label, document]]));
      if (checked.errors.length) throw Error(checked.errors.join('\n'));
      if (!data.positions || typeof data.positions !== 'object' || Array.isArray(data.positions)) throw Error('节点位置无效');
      const allowed = new Set(['$input', '$output', ...node.children]);
      for (const [id, p] of Object.entries(data.positions)) {
        if (!allowed.has(id) || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x > 20000 || p.y > 20000) throw Error('节点位置无效');
      }
      const layout = { ...current.layout, [node.id]: data.positions };
      const targetNode = checked.nodes.find(n => n.meta.id === node.id);
      const path = join(targetNode.dir, 'connections.json'), before = readFileSync(path, 'utf8'), beforeLayout = readLayout(), hadLayout = existsSync(layoutPath);
      try {
        atomic(path, JSON.stringify(document, null, 2) + '\n');
        atomic(layoutPath, JSON.stringify(layout, null, 2) + '\n');
        const result = spawnSync(process.execPath, [join(root, 'scripts', 'panorama.mjs')], { encoding: 'utf8', timeout: 15000 });
        if (result.status !== 0) throw Error(result.stderr || '全景更新失败');
      } catch (e) {
        atomic(path, before);
        if (hadLayout) atomic(layoutPath, beforeLayout); else if (existsSync(layoutPath)) unlinkSync(layoutPath);
        spawnSync(process.execPath, [join(root, 'scripts', 'panorama.mjs')], { timeout: 15000 });
        throw e;
      }
      res.end(JSON.stringify(snapshot()));
    } catch (e) { res.writeHead(400).end(JSON.stringify({ error: e.message })); }
  });
}
function serverPort(req) { return req.socket.localPort; }
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const server = createCanvasServer(root);
  server.listen(0, '127.0.0.1', () => console.log('项目画布：http://127.0.0.1:' + server.address().port + '\n关闭此进程即可停止。'));
}
