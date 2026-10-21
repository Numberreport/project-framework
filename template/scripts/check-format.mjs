import { existsSync, readFileSync, realpathSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { load, inside } from './module-model.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { nodes, errors } = load(root);
const required = ['AGENTS.md', 'TREE.md', 'methodology/README.md', 'methodology/design.md', 'methodology/implementation.md', 'methodology/acceptance.md', 'methodology/module-template.md', 'methodology/CONFIG_VALIDATION.md', 'methodology/operation.md'];
for (const file of required) if (!existsSync(join(root, file))) errors.push('缺少项目入口：' + file);
const commands = new Map();
for (const node of nodes) {
  const command = node.meta.verify;
  if (command === undefined) continue;
  if (typeof command !== 'string' || !/^implementation\/[A-Za-z0-9_./-]+\.mjs$/.test(command) || command.split('/').includes('..')) {
    errors.push('验收路径须在本模块 implementation 内：' + node.label); continue;
  }
  const target = join(node.dir, command);
  if (!existsSync(target) || !statSync(target).isFile() || !inside(realpathSync(node.dir), realpathSync(target))) errors.push('验收脚本缺失或越界：' + node.label);
  else commands.set(node, target);
}
// 配套说明里的本地链接必须有效；不读取运行数据或密钥。
function checkLinks(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith('.') || ['runs', 'outputs', 'knowledge', 'node_modules'].includes(item.name)) continue;
    const path = join(dir, item.name);
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) { checkLinks(path); continue; }
    if (!item.name.endsWith('.md')) continue;
    const text = readFileSync(path, 'utf8').replace(/```[^]*?```/g, '');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].replace(/^<|>$/g, '').split('#')[0];
      if (!link || /^[a-z]+:/i.test(link)) continue;
      const target = join(dirname(path), link);
      if (!existsSync(target) || !inside(realpathSync(root), realpathSync(target))) errors.push('文档链接缺失或越界：' + relative(root, path) + ' / ' + link);
    }
  }
}
checkLinks(root);
const panorama = spawnSync(process.execPath, [join(root, 'scripts/panorama.mjs'), '--check'], { encoding: 'utf8', timeout: 60000 });
if (panorama.status !== 0 || panorama.error) errors.push('项目全景检查失败：' + (panorama.stderr || panorama.error?.message));
else if (panorama.stdout.trim()) console.log(panorama.stdout.trim());
if (process.argv.includes('--tree')) for (const n of nodes) console.log(n.label + ' [' + n.meta.id + '] ' + n.meta.name);
if (errors.length) { for (const e of errors) console.error('✗ ' + e); process.exit(1); }
let ran = 0, skipped = 0;
const failed = new Set();
if (process.argv.includes('--verify')) {
  for (const node of [...nodes].reverse()) {
    if (node.meta.status !== 'ready' || node.children.some(n => failed.has(n))) {
      failed.add(node); skipped++; console.log('跳过验收：' + node.label + '（待配置或成员未通过）'); continue;
    }
    const script = commands.get(node);
    if (!script) { skipped++; continue; }
    const result = spawnSync(process.execPath, [script], { cwd: node.dir, encoding: 'utf8', timeout: 60000 });
    if (result.status !== 0 || result.error) { failed.add(node); errors.push('验收失败：' + node.label + '\n' + (result.stderr || result.stdout || result.error?.message || '超时或退出异常')); }
    else { ran++; console.log('✓ 验收通过：' + node.label); }
  }
}
if (errors.length) { for (const e of errors) console.error(e); process.exit(1); }
const pending = nodes.filter(n => n.meta.status === 'pending').length;
console.log('配置结构检查通过：' + nodes.length + ' 个模块；待配置 ' + pending + ' 个' + (pending ? '（这些模块不得运行）' : ''));
if (process.argv.includes('--verify')) console.log('示例/维护验收通过 ' + ran + ' 项，跳过 ' + skipped + ' 项；不代表业务内容合格或已运行业务检验。');
