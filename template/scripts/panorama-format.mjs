import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './module-model.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { nodes, errors } = load(root);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
const tree = existsSync(join(root, 'TREE.md')) ? readFileSync(join(root, 'TREE.md'), 'utf8') : '';
if (!/^## 项目全景\s*$/m.test(tree)) {
  if (process.argv.includes('--check')) { console.log('建议在 TREE.md 增加项目全景入口'); process.exit(0); }
  console.error('TREE.md 未声明项目全景'); process.exit(1);
}
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const lines = ['# 项目全景', '', '> 从模块目录、module.json 和 connections.json 生成；不推断执行顺序。', '', '## 模块', ''];
for (const n of nodes) lines.push('- ' + n.meta.name + '（' + n.meta.id + '）：' + n.label);
lines.push('', '## 连接', '');
for (const n of nodes.filter(n => n.children.length)) {
  lines.push('### ' + n.meta.name, '');
  for (const e of n.links) lines.push('- ' + e.from.module + '.' + e.from.port + ' → ' + e.to.module + '.' + e.to.port + '：' + e.info + (e.when ? '；条件：' + e.when : ''));
  lines.push('');
}
const detail = lines.join('\n').trimEnd() + '\n';
const rows = nodes.map((n, i) => {
  const depth = (n.label.match(/modules\//g) || []).length;
  const x = 24 + depth * 24, y = 92 + i * 78;
  return '<g data-module="' + esc(n.meta.id) + '"><rect x="' + x + '" y="' + y + '" width="620" height="60" rx="6" fill="white" stroke="#555"/><text x="' + (x + 12) + '" y="' + (y + 24) + '" font-size="16">' + esc(n.meta.name) + '</text><text x="' + (x + 12) + '" y="' + (y + 46) + '" font-size="12">' + esc(n.meta.id + ' · ' + n.label) + '</text></g>';
});
const width = 720 + Math.max(0, ...nodes.map(n => (n.label.match(/modules\//g) || []).length)) * 24;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + (110 + nodes.length * 78) + '" role="img" xml:lang="zh-CN" font-family="Microsoft YaHei, sans-serif"><title>项目全景</title><rect width="100%" height="100%" fill="#f7f6f3"/><text x="24" y="32" font-size="20">项目全景</text><text x="24" y="60" font-size="13">缩进表示组合内的位置；信息连接见详细说明，不推断执行顺序。</text>' + rows.join('') + '</svg>\n';
const files = new Map([['overview.svg', svg], ['panorama.md', detail]]);
for (const [name, content] of files) {
  const rel = 'methodology/' + name, path = join(root, rel);
  if (!tree.includes('](' + rel + ')')) { console.error('项目全景缺链接：' + rel); process.exit(1); }
  if (process.argv.includes('--check')) {
    if (!existsSync(path) || readFileSync(path, 'utf8').replaceAll('\r\n', '\n') !== content) { console.error('项目全景未同步：' + rel); process.exit(1); }
  } else writeFileSync(path, content);
}
