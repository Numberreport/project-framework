#!/usr/bin/env node
// 项目全景只从 TREE.md 的模块表和各模块 README 的「成员」「连接」「从哪来」生成。
// 不读实现文件，不读「规则」，不加第二套登记，不启浏览器。
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 18) {
  console.error('需要 Node 18 或更高版本');
  process.exit(1);
}

const MODULE_LIMIT = 8;
const BLANK = new Set(['', '（留空）', '留空', '（无）', '无', '—', '-']);
const SUGGEST = '建议补项目全景：有组合或模块超过 8 个。写在 TREE.md「模块」之前，再运行 node scripts/panorama.mjs';

const normalizePath = (path) => path.replace(/^\.\//, '').replace(/\\/g, '/').replace(/\/+$/, '');
const isSafePath = (path) => Boolean(path)
  && !path.startsWith('/')
  && !/^[A-Za-z]:/.test(path)
  && !path.includes('\\')
  && !path.split('/').includes('..');
const unquote = (text) => text.trim().replace(/^`(.*)`$/, '$1').trim();
const posix = (path) => relative(root, path).split('\\').join('/');

const readSections = (path) => {
  const sections = {};
  for (const part of readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/^##\s+/m).slice(1)) {
    const lineEnd = part.indexOf('\n');
    const title = (lineEnd === -1 ? part : part.slice(0, lineEnd)).trim();
    const body = lineEnd === -1 ? '' : part.slice(lineEnd + 1).trim();
    sections[title] = body;
  }
  return sections;
};

const parseTable = (body) => {
  const rows = [];
  for (const line of body.split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith('|')) continue;
    const cells = text.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2 || !cells[0] || /^:?-{2,}:?$/.test(cells[0])) continue;
    rows.push(cells);
  }
  return rows;
};

const listItems = (body) => body
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^[-*]\s+/.test(line))
  .map((line) => line.replace(/^[-*]\s+/, '').trim());

const escapeXml = (text) => String(text)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const readNorm = (path) => (
  existsSync(path)
    ? readFileSync(path, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
    : null
);

const load = () => {
  const errors = [];
  const treePath = join(root, 'TREE.md');
  if (!existsSync(treePath)) {
    return { errors: ['缺少 TREE.md'] };
  }
  const treeSections = readSections(treePath);
  const locations = new Map();
  for (const [role, dirsCell] of parseTable(treeSections['位置'] || '').filter((row) => row[0] !== '职责')) {
    const dirs = dirsCell.split(/[、,，]/).map((dir) => normalizePath(dir.trim())).filter(Boolean);
    if (!locations.has(role)) locations.set(role, []);
    locations.get(role).push(...dirs);
  }
  const docRel = (locations.get('文档') || [])[0] || '';
  if (!docRel) errors.push('位置表缺「文档」，项目全景无法放置');
  else if (!isSafePath(docRel) || !existsSync(join(root, docRel))) {
    errors.push(`登记的目录不存在：文档 -> ${docRel || '（空）'}`);
  }

  const moduleDirs = (locations.get('模块') || []).filter(isSafePath).map((dir) => join(root, dir));
  const modules = [];
  for (const [name, status] of parseTable(treeSections['模块'] || '').filter((row) => row[0] !== '模块')) {
    if (!name || /[\\/]/.test(name) || name.includes('..') || name.startsWith('.')) {
      errors.push(`模块名无法画进全景：${name}`);
      continue;
    }
    const hits = moduleDirs.filter((dir) => existsSync(join(dir, name)) && statSync(join(dir, name)).isDirectory());
    if (hits.length !== 1) {
      errors.push(hits.length === 0 ? `模块不存在：${name}` : `模块出现在多个模块目录：${name}`);
      continue;
    }
    const readme = join(hits[0], name, 'README.md');
    if (!existsSync(readme)) {
      errors.push(`缺少说明：${name}/README.md`);
      continue;
    }
    const sections = readSections(readme);
    const fromLine = (sections['输入'] || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('从哪来：') || line.startsWith('从哪来:'));
    if (!fromLine) {
      errors.push(`规格缺项：${name} / 输入里没有「从哪来：」`);
      continue;
    }
    const sources = fromLine.replace(/^从哪来[：:]/, '').split(/[、,，]/).map((source) => source.trim()).filter(Boolean);
    const isCombo = '成员' in sections;
    const members = [];
    const connections = [];
    if (isCombo) {
      for (const member of listItems(sections['成员'] || '').map(unquote)) {
        if (!members.includes(member)) members.push(member);
      }
      const linkBody = (sections['连接'] || '').trim();
      if (linkBody && !BLANK.has(linkBody)) {
        for (const item of listItems(linkBody)) {
          const match = item.match(/^(.+?)\s*(?:->|→)\s*(.+?)\s*(?:[：:]\s*(.*))?$/);
          if (!match) {
            errors.push(`连接写法不对：${name} / ${item}（写成 - 上游 -> 下游：传什么信息）`);
            continue;
          }
          connections.push({
            from: unquote(match[1]),
            to: unquote(match[2]),
            info: (match[3] || '').trim(),
          });
        }
      }
    }
    modules.push({ name, status, sources, isCombo, members, connections });
  }

  const names = new Set(modules.map((item) => item.name));
  const reuseCount = new Map(modules.map((item) => [item.name, 0]));
  for (const combo of modules.filter((item) => item.isCombo)) {
    for (const member of combo.members) {
      if (!names.has(member)) errors.push(`成员不存在：${combo.name} -> ${member}`);
      else reuseCount.set(member, reuseCount.get(member) + 1);
      if (!combo.connections.length) continue;
    }
    for (const edge of combo.connections) {
      if (!combo.members.includes(edge.from) || !combo.members.includes(edge.to)) {
        errors.push(`连接端点不在成员里：${combo.name} / ${edge.from} -> ${edge.to}`);
      }
      if (!edge.info) errors.push(`连接没写传什么信息：${combo.name} / ${edge.from} -> ${edge.to}`);
    }
  }

  return {
    errors,
    docRel,
    section: treeSections['项目全景'],
    declared: '项目全景' in treeSections,
    modules: modules.map((item) => ({ ...item, reused: (reuseCount.get(item.name) || 0) > 1 })),
  };
};

const needDetail = (model) => model.modules.some((item) => item.isCombo) || model.modules.length > MODULE_LIMIT;

const renderSvg = (model) => {
  const modules = model.modules;
  const cols = modules.length <= 1 ? 1 : modules.length <= 4 ? 2 : 3;
  const cardW = 260;
  const cardH = 96;
  const gapX = 56;
  const gapY = 72;
  const margin = 28;
  const width = Math.max(720, margin * 2 + cols * cardW + (cols - 1) * gapX);
  const legend = [
    '虚线是成员引用，不是上下级，也不复制实现。',
    '信息传递只认已登记的连接。没有则标缺项，不推断执行顺序。',
    '复用是同一模块，不是多份实现。导航分类不是父级。',
  ];
  const cardsTop = margin + 36 + legend.length * 22 + 16;
  const boxes = new Map();
  modules.forEach((item, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const rowWidth = cols * cardW + (cols - 1) * gapX;
    const left = Math.round((width - rowWidth) / 2);
    boxes.set(item.name, {
      x: left + col * (cardW + gapX),
      y: cardsTop + row * (cardH + gapY),
      w: cardW,
      h: cardH,
    });
  });
  const rows = Math.max(1, Math.ceil(modules.length / cols));
  const notes = [];
  if (modules.some((item) => item.isCombo && item.connections.length > 0)) {
    notes.push('已登记的信息传递见详细说明，概览不画执行顺序。');
  }
  for (const combo of modules.filter((item) => item.isCombo && item.connections.length === 0)) {
    notes.push(`缺项：${combo.name} 无已登记连接，不推断执行顺序。`);
  }
  if (modules.length === 0) notes.push('没有已登记模块。');
  const notesTop = cardsTop + rows * cardH + (rows - 1) * gapY + 36;
  const height = notesTop + notes.length * 24 + margin;

  const borderPoint = (box, toward) => {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const dx = toward.x - cx;
    const dy = toward.y - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const scaleX = dx === 0 ? Infinity : (box.w / 2) / Math.abs(dx);
    const scaleY = dy === 0 ? Infinity : (box.h / 2) / Math.abs(dy);
    const scale = Math.min(scaleX, scaleY);
    return { x: Math.round(cx + dx * scale), y: Math.round(cy + dy * scale) };
  };

  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" xml:lang="zh-CN" font-family="Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif">`,
    '<title>项目全景</title>',
    `<rect width="${width}" height="${height}" fill="#f7f6f3"/>`,
    `<text x="${margin}" y="${margin + 22}" font-size="20" fill="#1f1d1a">项目全景</text>`,
  ];
  legend.forEach((line, index) => {
    parts.push(`<text x="${margin}" y="${margin + 52 + index * 22}" font-size="13" fill="#6b6560">${escapeXml(line)}</text>`);
  });
  for (const combo of modules.filter((item) => item.isCombo)) {
    const from = boxes.get(combo.name);
    for (const member of combo.members) {
      const to = boxes.get(member);
      if (!from || !to || member === combo.name) continue;
      const start = borderPoint(from, { x: to.x + to.w / 2, y: to.y + to.h / 2 });
      const end = borderPoint(to, { x: from.x + from.w / 2, y: from.y + from.h / 2 });
      const labelX = Math.round((start.x + end.x) / 2);
      const labelY = Math.round((start.y + end.y) / 2) - 8;
      parts.push(`<g data-ref="${escapeXml(`${combo.name} ${member}`)}">`);
      parts.push(`<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#6b6560" stroke-dasharray="5 4"/>`);
      parts.push(`<text x="${labelX}" y="${labelY}" font-size="12" fill="#6b6560" text-anchor="middle">引用</text>`);
      parts.push('</g>');
    }
  }
  for (const item of modules) {
    const box = boxes.get(item.name);
    const kind = item.isCombo ? '组合' : '模块';
    const reuse = item.reused ? ' · 复用' : '';
    parts.push(`<g data-module="${escapeXml(item.name)}" data-reuse="${item.reused ? '1' : '0'}">`);
    parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="8" fill="#ffffff" stroke="#2c2a26"/>`);
    parts.push(`<text x="${box.x + 16}" y="${box.y + 32}" font-size="16" fill="#1f1d1a">${escapeXml(item.name)}</text>`);
    parts.push(`<text x="${box.x + 16}" y="${box.y + 54}" font-size="12" fill="#6b6560">${escapeXml(`${item.status} · ${kind}${reuse}`)}</text>`);
    parts.push(`<text x="${box.x + 16}" y="${box.y + 76}" font-size="12" fill="#6b6560">${escapeXml(`从哪来：${item.sources.join('、')}`)}</text>`);
    parts.push('</g>');
  }
  notes.forEach((note, index) => {
    const gap = note.startsWith('缺项：') ? note.slice(3, note.indexOf(' ')) : '';
    const attr = gap ? ` data-gap="${escapeXml(gap)}"` : '';
    parts.push(`<text x="${margin}" y="${notesTop + index * 24}" font-size="13" fill="#8a3b12"${attr}>${escapeXml(note)}</text>`);
  });
  parts.push('</svg>');
  return `${parts.join('\n')}\n`;
};

const renderDetail = (model) => {
  const lines = [
    '# 项目全景',
    '',
    '> 由 `node scripts/panorama.mjs` 生成。不要手改关系；改模块表或模块 README 的「成员」「连接」「从哪来」后重新生成。',
    '',
    '## 图例',
    '',
    '- 成员：组合引用哪些模块，不是上下级，也不复制实现。',
    '- 连接：向另一个模块传什么信息，不产生父子关系。',
    '- 导航分类：只帮助查找和排版，可有可无，不是父级。模块表不必为此加列。',
    '',
    '身份用模块名。标成复用的是同一模块。没登记的连接标成缺项，不凭名称猜执行顺序，不把组合当成默认完整执行。',
    '',
    '## 模块',
    '',
  ];
  if (model.modules.length === 0) lines.push('（无）', '');
  for (const item of model.modules) {
    const kind = item.isCombo ? '，组合' : '';
    const reuse = item.reused ? '，复用' : '';
    lines.push(`- \`${item.name}\`（${item.status}${kind}${reuse}）：从哪来：${item.sources.join('、')}`);
  }
  lines.push('', '## 成员', '');
  const combos = model.modules.filter((item) => item.isCombo);
  if (combos.length === 0) lines.push('（无）', '');
  for (const combo of combos) {
    lines.push(`### \`${combo.name}\``, '');
    if (combo.members.length === 0) lines.push('（无）', '');
    for (const member of combo.members) lines.push(`- \`${member}\`（引用）`);
    lines.push('');
  }
  lines.push('## 连接', '');
  if (combos.length === 0) lines.push('（无）', '');
  for (const combo of combos) {
    lines.push(`### \`${combo.name}\``, '');
    if (combo.connections.length === 0) {
      lines.push('缺项：无已登记连接，不推断执行顺序。', '');
      continue;
    }
    for (const edge of combo.connections) {
      lines.push(`- \`${edge.from}\` -> \`${edge.to}\`：${edge.info}`);
    }
    lines.push('');
  }
  lines.push('## 复用', '');
  const reused = model.modules.filter((item) => item.reused);
  if (reused.length === 0) lines.push('（无）');
  for (const item of reused) {
    const owners = combos.filter((combo) => combo.members.includes(item.name)).map((combo) => `\`${combo.name}\``);
    lines.push(`- \`${item.name}\`：同一模块，被 ${owners.join('、')} 引用`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
};

const outputsFor = (model) => {
  const files = new Map();
  if (!model.docRel) return files;
  files.set(`${model.docRel}/overview.svg`, renderSvg(model));
  if (needDetail(model)) files.set(`${model.docRel}/panorama.md`, renderDetail(model));
  return files;
};

const localLinks = (body) => [...body.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)]
  .map((match) => normalizePath(match[2].trim().replace(/^<|>$/g, '')))
  .filter((href) => href && !href.startsWith('#') && !/^[a-z]+:/i.test(href));

const sectionErrors = (model, files) => {
  const errors = [];
  const body = model.section || '';
  if (body.includes('![')) errors.push('项目全景用链接，不嵌图');
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*[-*]\s+/.test(line) && /->|→/.test(line) && /[：:]/.test(line)) {
      errors.push('项目全景不另写连接，连接只写在模块 README');
      break;
    }
  }
  const links = localLinks(body);
  for (const href of links) {
    if (!isSafePath(href)) errors.push(`项目全景链接不合法：${href}`);
    else if (![...files.keys()].includes(href)) errors.push(`项目全景链接不是生成文件：${href}`);
  }
  for (const href of files.keys()) {
    if (!links.includes(href)) errors.push(`项目全景缺链接：${href}`);
  }
  return errors;
};

const contentErrors = (model, files) => {
  const errors = [];
  const svg = files.get(`${model.docRel}/overview.svg`) || '';
  const detail = files.get(`${model.docRel}/panorama.md`) || '';
  const relationshipText = `${svg}\n${detail}`.replace(/不产生父子关系/g, '');
  if (relationshipText.includes('父子') || relationshipText.includes('父模块')) {
    errors.push('项目全景把成员画成了父子');
  }
  for (const item of model.modules) {
    const token = `data-module="${escapeXml(item.name)}"`;
    const start = svg.indexOf(token);
    const card = start === -1 ? '' : svg.slice(start, svg.indexOf('</g>', start));
    if (!card) errors.push(`概览缺模块：${item.name}`);
    else if (item.reused && !card.includes('data-reuse="1"')) errors.push(`复用没标出：${item.name}`);
    else if (!item.reused && card.includes('复用')) errors.push(`不该标成复用：${item.name}`);
    if (item.isCombo) {
      for (const member of item.members) {
        if (member === item.name || !model.modules.some((other) => other.name === member)) continue;
        if (!svg.includes(`data-ref="${escapeXml(`${item.name} ${member}`)}"`)) {
          errors.push(`概览缺成员引用：${item.name} -> ${member}`);
        }
      }
      if (item.connections.length === 0 && !svg.includes(`data-gap="${escapeXml(item.name)}"`)) {
        errors.push(`概览没标连接缺项：${item.name}`);
      }
    }
  }
  if (model.modules.some((item) => item.isCombo && item.connections.length > 0) && !svg.includes('概览不画执行顺序')) {
    errors.push('概览有连接时仍可能被看成执行顺序');
  }
  if (!detail) return errors;
  for (const item of model.modules) {
    if (!detail.includes(`\`${item.name}\``)) errors.push(`详细说明缺模块：${item.name}`);
  }
  for (const combo of model.modules.filter((item) => item.isCombo)) {
    if (combo.connections.length === 0 && !detail.includes('缺项：无已登记连接，不推断执行顺序。')) {
      errors.push(`详细说明没标连接缺项：${combo.name}`);
    }
    for (const edge of combo.connections) {
      if (!detail.includes(`\`${edge.from}\` -> \`${edge.to}\`：${edge.info}`)) {
        errors.push(`详细说明缺连接：${combo.name} / ${edge.from} -> ${edge.to}`);
      }
    }
  }
  return errors;
};

const main = () => {
  const checkOnly = process.argv.includes('--check');
  const model = load();
  if (model.errors.length) {
    for (const error of model.errors) console.error(`✗ ${error}`);
    process.exit(1);
  }
  if (!model.declared) {
    const suggest = model.modules.some((item) => item.isCombo) || model.modules.length > MODULE_LIMIT;
    if (checkOnly) {
      if (suggest) console.log(SUGGEST);
      process.exit(0);
    }
    console.error('TREE.md 没有「项目全景」。写在「模块」之前后再生成。');
    process.exit(1);
  }
  const files = outputsFor(model);
  const errors = [...sectionErrors(model, files), ...contentErrors(model, files)];
  if (errors.length) {
    for (const error of errors) console.error(`✗ ${error}`);
    process.exit(1);
  }
  if (checkOnly) {
    for (const [href, content] of files) {
      if (readNorm(join(root, href)) !== content) {
        console.error(`✗ 项目全景未同步：${href}（运行 node scripts/panorama.mjs）`);
        process.exit(1);
      }
    }
    console.error('项目全景已同步');
    process.exit(0);
  }
  const wrote = [];
  for (const [href, content] of files) {
    const path = join(root, href);
    if (readNorm(path) === content) continue;
    writeFileSync(path, content);
    wrote.push(href);
  }
  console.log(wrote.length ? `已生成：${wrote.join('、')}` : '项目全景已是最新');
  if (!needDetail(model) && existsSync(join(root, model.docRel, 'panorama.md'))) {
    console.log('当前不必保留详细说明；若 TREE 仍链着 panorama.md，请去掉链接。');
  }
};

main();
