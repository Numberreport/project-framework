#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 18) {
  console.error('需要 Node 18 或更高版本');
  process.exit(1);
}
const showTree = process.argv.includes('--tree');
const runVerify = process.argv.includes('--verify');

const STATUSES = ['在用', '实验中', '待删'];
const TASK_STATUSES = ['待办', '进行中', '完成'];
const SECTIONS = ['输入', '输出', '谁处理', '什么时候跑', '怎么算做对', '失败怎么办'];
// 有「成员」一节的就是组合；组合靠成员处理信息，所以不写「谁处理」「失败怎么办」
const COMBO_SECTIONS = ['成员', '连接', '输入', '输出', '人工确认', '失败在哪停', '什么时候跑', '怎么算做对'];
const BLANK = new Set(['', '（留空）', '留空', '（无）', '无', '—', '-']);
const OS_JUNK = new Set(['Thumbs.db', 'desktop.ini', '.DS_Store']);
const STALE_MS = 30 * 24 * 60 * 60 * 1000;
// 超时只杀外层进程；子进程（Windows 下尤其常见）可能残留，需要手动结束。
const VERIFY_TIMEOUT_MS = 60 * 1000;
const ROOT_FIXED = new Set(['AGENTS.md', 'TREE.md', 'scripts']);
// 工具和构建配置，不算项目内容
const ROOT_IGNORED = new Set([
  'node_modules', 'dist', 'build', '__pycache__', 'venv',
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'tsconfig.json', 'pyproject.toml', 'requirements.txt', 'Makefile',
  'Thumbs.db', 'desktop.ini',
]);

const errors = [];
const warnings = [];
const add = (msg) => errors.push(msg);

const normalizePath = (path) => path.replace(/^\.\//, '').replace(/\/+$/, '');
const isSafePath = (path) =>
  Boolean(path)
  && !path.startsWith('/')
  && !/^[A-Za-z]:/.test(path)
  && !path.includes('\\')
  && !path.split('/').includes('..');

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
    if (cells.length < 2) continue;
    if (!cells[0] || /^:?-{2,}:?$/.test(cells[0])) continue;
    rows.push(cells);
  }
  return rows;
};

const listItems = (body) => body
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^[-*]\s+/.test(line))
  .map((line) => line.replace(/^[-*]\s+/, '').trim());
const unquote = (text) => text.trim().replace(/^`(.*)`$/, '$1').trim();

const treePath = join(root, 'TREE.md');
if (!existsSync(treePath)) {
  console.error('缺少 TREE.md');
  process.exit(1);
}

const treeSections = readSections(treePath);
if (!('位置' in treeSections)) add('TREE.md 缺「位置」一节');
if (!('模块' in treeSections)) add('TREE.md 缺「模块」一节');

const locations = new Map();
for (const [role, dirsCell] of parseTable(treeSections['位置'] || '').filter((row) => row[0] !== '职责')) {
  const dirs = dirsCell.split(/[、,，]/).map((dir) => normalizePath(dir.trim())).filter(Boolean);
  if (!locations.has(role)) locations.set(role, []);
  locations.get(role).push(...dirs);
}

for (const required of ['模块', '状态']) {
  if (!locations.get(required)?.length) add(`位置表缺「${required}」`);
}

// AGENTS.md「收纳」里箭头后指向的职责，必须在位置表里有
const agentsPath = join(root, 'AGENTS.md');
if (existsSync(agentsPath)) {
  for (const line of (readSections(agentsPath)['收纳'] || '').split(/\r?\n/)) {
    const arrow = line.indexOf('→');
    if (!line.trim().startsWith('-') || arrow === -1) continue;
    // 只看箭头后第一个分句，后面的「」是说明文字，不是职责
    const target = line.slice(arrow + 1).split(/[，。]/)[0];
    for (const [, role] of target.matchAll(/「(.+?)」/g)) {
      if (!locations.has(role)) add(`AGENTS.md「收纳」提到的职责不在位置表里：${role}`);
    }
  }
}

for (const [role, dirs] of locations) {
  for (const dir of dirs) {
    if (!isSafePath(dir)) {
      add(`位置表路径不合法：${role} -> ${dir}`);
    } else if (!existsSync(join(root, dir))) {
      add(`登记的目录不存在：${role} -> ${dir}`);
    }
  }
}

const rows = [];
const seenNames = new Set();
for (const [name, status] of parseTable(treeSections['模块'] || '').filter((row) => row[0] !== '模块')) {
  // 模块名会拼进路径，多段名能指到模块目录之外
  if (/[\\/]/.test(name) || name.includes('..')) {
    add(`模块名只能是单段，不能含 / \\ 或 ..：${name}`);
    continue;
  }
  if (seenNames.has(name)) add(`重复登记：${name} 在模块表里出现了不止一次`);
  seenNames.add(name);
  rows.push({ name, status });
}

// 有在用模块就必须有 Git
if (rows.some((row) => row.status === '在用') && !existsSync(join(root, '.git'))) {
  add('有「在用」模块，但项目根目录没有 .git；先 git init');
}

const names = new Set(rows.map((row) => row.name));
const moduleDirs = (locations.get('模块') || []).map((dir) => join(root, dir));
const combos = new Map();
const sourcesByModule = new Map();
const commands = new Map();
const pendingDeletes = [];

for (const { name, status } of rows) {
  if (!STATUSES.includes(status)) add(`状态不合法：${name} -> ${status}`);
  if (status === '待删') pendingDeletes.push(name);

  // 模块位置缺失已经在上面报过，不再逐个重复报
  let dir = null;
  if (moduleDirs.length > 0) {
    const hits = moduleDirs
      .map((moduleDir) => join(moduleDir, name))
      .filter((path) => existsSync(path) && statSync(path).isDirectory());
    if (hits.length === 0) {
      add(`模块不存在：${name}`);
      continue;
    }
    if (hits.length > 1) {
      add(`模块出现在多个模块目录：${name}`);
      continue;
    }
    dir = hits[0];
  }
  if (!dir) continue;

  const readme = join(dir, 'README.md');
  if (!existsSync(readme)) {
    add(`缺少说明：${name}/README.md`);
    continue;
  }

  const sections = readSections(readme);
  const isCombo = '成员' in sections;

  for (const section of isCombo ? COMBO_SECTIONS : SECTIONS) {
    if (!sections[section]) add(`规格缺项：${name} / ${section}`);
  }
  if ('属于哪个模块' in sections) {
    warnings.push(`「属于哪个模块」已取消：${name}（组合关系只写在组合的「成员」里）`);
  }

  if (isCombo) {
    const members = [];
    for (const member of listItems(sections['成员'] || '').map(unquote)) {
      if (members.includes(member)) {
        add(`成员重复：${name} / ${member}`);
        continue;
      }
      members.push(member);
      if (!names.has(member)) add(`成员不存在：${name} -> ${member}`);
    }
    if (sections['成员'] && members.length === 0) {
      add(`成员写法不对：${name}（每行写 - 模块名）`);
    }

    const connections = [];
    const linkBody = (sections['连接'] || '').trim();
    if (linkBody && !BLANK.has(linkBody)) {
      const items = listItems(linkBody);
      if (items.length === 0) add(`连接写法不对：${name}（每行写 - 上游 -> 下游：传什么信息）`);
      for (const item of items) {
        const match = item.match(/^(.+?)\s*(?:->|→)\s*(.+?)\s*(?:[：:]\s*(.*))?$/);
        if (!match) {
          add(`连接写法不对：${name} / ${item}（写成 - 上游 -> 下游：传什么信息）`);
          continue;
        }
        const [from, to] = [unquote(match[1]), unquote(match[2])];
        const info = (match[3] || '').trim();
        for (const end of [from, to]) {
          if (!members.includes(end)) add(`连接端点不在成员里：${name} / ${from} -> ${to}（${end}）`);
        }
        if (!info) add(`连接没写传什么信息：${name} / ${from} -> ${to}`);
        connections.push({ from, to, info });
      }
    }
    combos.set(name, { members, connections });
  }

  const processor = isCombo ? '' : sections['谁处理'] || '';
  if (processor) {
    const isProgram = /^程序[：:]/.test(processor);
    const isAI = /^AI[：:]/.test(processor);
    if (!isProgram && !isAI) {
      add(`谁处理要以「程序：」或「AI：」开头：${name}`);
    }
    if (isAI && !sections['规则']) {
      add(`规格缺项：${name} / 规则（谁处理写的是 AI，必须写清规则）`);
    }
  }

  const accept = sections['怎么算做对'] || '';
  const commandLine = accept
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('验收命令：') || line.startsWith('验收命令:'));
  const rawCommand = commandLine ? commandLine.replace(/^验收命令[：:]/, '').trim() : '';
  const command = rawCommand.replace(/^`(.*)`$/, '$1').trim();
  if (status === '在用' && accept && !command) {
    add(`缺验收命令：${name}（写在「怎么算做对」里）`);
  }
  const validCommand = /^node\s+\S+$/.test(command)
    && !command.includes('\\')
    && !/^node\s+(\/|[A-Za-z]:)/.test(command);
  if (command && !validCommand) {
    add(`验收命令必须写成 node <相对路径>，路径用 /，不要有空格和额外参数：${name}`);
  }
  if (command && validCommand) {
    const scriptPath = command.slice('node '.length).trim();
    if (isSafePath(scriptPath)) {
      commands.set(name, scriptPath);
    } else {
      add(`验收脚本路径不合法（不能用 ..、绝对路径或盘符）：${name} -> ${scriptPath}`);
    }
  }

  const input = sections['输入'] || '';
  const fromLine = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('从哪来：') || line.startsWith('从哪来:'));
  if (!fromLine) {
    add(`规格缺项：${name} / 输入里没有「从哪来：」`);
  } else {
    const sources = fromLine
      .replace(/^从哪来[：:]/, '')
      .split(/[、,，]/)
      .map((source) => source.trim())
      .filter(Boolean);
    sourcesByModule.set(name, sources);
    if (sources.length === 0) add(`输入来源为空：${name}`);
    for (const source of sources) {
      if (source === name) warnings.push(`输入来源写了自己（自环）：${name}`);
      if (source !== '外部' && !names.has(source)) {
        add(`输入来源不存在：${name} -> ${source}`);
      }
    }
  }
}

// 反向校验：模块目录下只能放已登记的模块
for (const moduleDir of moduleDirs) {
  if (!existsSync(moduleDir)) continue;
  for (const entry of readdirSync(moduleDir)) {
    if (entry.startsWith('.') || OS_JUNK.has(entry)) continue;
    const path = join(moduleDir, entry);
    if (!statSync(path).isDirectory()) {
      add(`模块目录下只能放模块目录：${entry}`);
      continue;
    }
    if (!names.has(entry)) add(`未登记：${entry} 不在模块表里`);
  }
}

// tasks.json 格式
const stateDirs = (locations.get('状态') || []).map((dir) => join(root, dir));
const taskFiles = stateDirs
  .map((dir) => join(dir, 'tasks.json'))
  .filter((path) => existsSync(path));

if (stateDirs.length > 0) {
  if (taskFiles.length === 0) {
    add('找不到 tasks.json（应在「状态」登记的目录下）');
  } else if (taskFiles.length > 1) {
    add('找到多个 tasks.json，无法确定用哪个');
  } else {
    let data;
    let parsed = false;
    try {
      data = JSON.parse(readFileSync(taskFiles[0], 'utf8').replace(/^\uFEFF/, ''));
      parsed = true;
    } catch (error) {
      add(`tasks.json 不是合法 JSON：${error.message}`);
    }
    if (parsed) {
      if (!data || !Array.isArray(data.tasks)) {
        add('tasks.json 顶层要有 tasks 数组');
      } else {
        const ids = new Set();
        let inProgress = 0;
        data.tasks.forEach((task, index) => {
          const where = `tasks.json 第 ${index + 1} 条`;
          if (!task || typeof task !== 'object') {
            add(`${where} 不是对象`);
            return;
          }
          const id = typeof task.id === 'string' ? task.id.trim() : '';
          const taskText = typeof task.task === 'string' ? task.task.trim() : '';
          const taskStatus = typeof task.status === 'string' ? task.status.trim() : '';
          if (!id) add(`${where} id 必须是非空字符串`);
          if (!taskText) add(`${where} 缺 task`);
          if (!taskStatus) add(`${where} 缺 status`);
          if (typeof task.note !== 'string') add(`${where} 缺 note`);
          if (taskStatus && !TASK_STATUSES.includes(taskStatus)) {
            add(`${where} 状态不合法：${taskStatus}`);
          }
          if (taskStatus === '进行中') inProgress += 1;
          if (id) {
            if (ids.has(id)) add(`tasks.json id 重复：${id}`);
            ids.add(id);
          }
        });
        if (inProgress > 1) {
          warnings.push(`tasks.json 同时有 ${inProgress} 条「进行中」，做完的改成「完成」`);
        }
      }
    }
  }
}

// 非 NFC 文件名提醒
const nfcDirs = new Map();
for (const dirs of locations.values()) {
  for (const dir of dirs) {
    if (!isSafePath(dir)) continue;
    const abs = join(root, dir);
    if (!nfcDirs.has(abs)) nfcDirs.set(abs, dir);
  }
}
for (const [abs, label] of nfcDirs) {
  if (!existsSync(abs)) continue;
  for (const entry of readdirSync(abs)) {
    if (entry.startsWith('.') || OS_JUNK.has(entry)) continue;
    if (entry !== entry.normalize('NFC')) {
      warnings.push(`文件名不是 NFC 形式，跨系统可能对不上：${label}/${entry}`);
    }
  }
}

// 根目录白名单：固定文件 + 登记目录的顶层
const allowedTop = new Set(ROOT_FIXED);
for (const dirs of locations.values()) {
  for (const dir of dirs) {
    if (isSafePath(dir)) allowedTop.add(dir.split('/')[0]);
  }
}
for (const entry of readdirSync(root)) {
  if (entry.startsWith('.')) continue;
  if (allowedTop.has(entry) || ROOT_IGNORED.has(entry)) continue;
  add(`计划外的文件和目录：${entry}（先确认是不是密钥；不是再放进登记的目录）`);
}

// 组合直接或间接包含自身；同一模块进多个组合不算错
const reportedCycles = new Set();
const visitCombo = (path) => {
  for (const member of combos.get(path[path.length - 1])?.members || []) {
    const at = path.indexOf(member);
    if (at !== -1) {
      const cycle = path.slice(at);
      const key = [...cycle].sort().join('|');
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        add(`组合递归包含自身：${[...cycle, member].join(' -> ')}`);
      }
      continue;
    }
    if (combos.has(member)) visitCombo([...path, member]);
  }
};
for (const name of combos.keys()) visitCombo([name]);

// 引用了待删模块
for (const name of names) {
  for (const member of combos.get(name)?.members || []) {
    if (pendingDeletes.includes(member)) {
      warnings.push(`引用了待删模块：${name} 的成员有 ${member}`);
    }
  }
  for (const source of sourcesByModule.get(name) || []) {
    if (pendingDeletes.includes(source)) {
      warnings.push(`引用了待删模块：${name} 的输入来自 ${source}`);
    }
  }
}

// 验收：结构没问题才跑
let verifyRan = 0;
if (runVerify) {
  if (errors.length) {
    console.log('结构检查有问题，跳过验收');
  } else {
    // 成员先验，组合复用成员结果：成员没过就不跑组合，免得重复跑成员里耗时或花钱的任务
    const order = [];
    const queued = new Set();
    const enqueue = (name) => {
      if (queued.has(name)) return;
      queued.add(name);
      for (const member of combos.get(name)?.members || []) enqueue(member);
      order.push(name);
    };
    for (const { name } of rows) enqueue(name);

    const failedVerify = new Set();
    for (const name of order) {
      const badMember = (combos.get(name)?.members || []).find((member) => failedVerify.has(member));
      if (badMember) {
        failedVerify.add(name);
        if (commands.has(name)) console.log(`跳过组合验收：${name}（成员 ${badMember} 验收没过）`);
        continue;
      }
      const scriptPath = commands.get(name);
      if (!scriptPath || pendingDeletes.includes(name)) continue;
      if (!existsSync(join(root, scriptPath))) {
        failedVerify.add(name);
        add(`验收脚本不存在：${name}（${scriptPath}）`);
        continue;
      }
      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: root,
        encoding: 'utf8',
        timeout: VERIFY_TIMEOUT_MS,
      });
      if (result.error) {
        failedVerify.add(name);
        if (result.error.code === 'ETIMEDOUT') {
          add(`验收超时（${VERIFY_TIMEOUT_MS / 1000} 秒）：${name}（命令：node ${scriptPath}）；子进程可能仍在运行，请手动结束后再重跑`);
        } else {
          add(`验收无法执行：${name}（node ${scriptPath}）：${result.error.message}`);
        }
        continue;
      }
      if (result.status !== 0) {
        failedVerify.add(name);
        add(`验收失败：${name}（命令：node ${scriptPath}）`);
        const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
        if (output) console.error(output.split(/\r?\n/).slice(-20).join('\n'));
      } else {
        verifyRan += 1;
        console.log(`✓ 验收通过：${name}（命令：node ${scriptPath}）`);
      }
    }
  }
}

if (showTree) {
  const statusOf = new Map(rows.map((row) => [row.name, row.status]));
  const memberOf = new Map();
  for (const [combo, { members }] of combos) {
    for (const member of members) {
      if (!memberOf.has(member)) memberOf.set(member, []);
      memberOf.get(member).push(combo);
    }
  }
  const label = (name) => {
    if (!names.has(name)) return `${name}（不存在）`;
    const sources = sourcesByModule.get(name) || [];
    return `${name} [${statusOf.get(name)}]${combos.has(name) ? '（组合）' : ''}${sources.length ? ` ← ${sources.join('、')}` : ''}`;
  };
  const walk = (path) => {
    const name = path[path.length - 1];
    const indent = '  '.repeat(path.length);
    const { members, connections } = combos.get(name);
    for (const member of members) {
      if (path.includes(member)) {
        console.log(`${indent}- ${member}（递归包含，不再展开）`);
        continue;
      }
      console.log(`${indent}- ${label(member)}`);
      if (combos.has(member)) walk([...path, member]);
    }
    for (const { from, to, info } of connections) {
      console.log(`${indent}${from} → ${to}：${info || '（没写传什么信息）'}`);
    }
  };
  for (const { name } of rows) {
    const inCombos = memberOf.get(name);
    console.log(`${label(name)}${inCombos ? `（在组合：${inCombos.join('、')}）` : ''}`);
    if (combos.has(name)) walk([name]);
  }
}

// 文件名开头的 YYYY-MM-DD-：没有前缀返回 null，日期无效返回 NaN，否则返回时间戳
const nameDate = (entry) => {
  const match = entry.match(/^(\d{4})-(\d{2})-(\d{2})-/);
  if (!match) return null;
  const [year, month, day] = match.slice(1, 4).map(Number);
  // Date 会把 2 月 30 日顺延成 3 月，逐项比对才能发现无效日期
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return NaN;
  return date.getTime();
};
const roleEntries = (role) => (locations.get(role) || [])
  .map((dir) => join(root, dir))
  .filter((dir) => existsSync(dir))
  .flatMap((dir) => readdirSync(dir)
    .filter((entry) => !entry.startsWith('.') && !OS_JUNK.has(entry)));

// 暂存滞留提醒：看文件名开头的日期
for (const entry of roleEntries('暂存')) {
  const time = nameDate(entry);
  if (time === null) {
    warnings.push(`暂存缺日期：${entry}（文件名以 YYYY-MM-DD- 开头）`);
  } else if (Number.isNaN(time)) {
    add(`暂存日期无效：${entry}`);
  } else if (Date.now() - time > STALE_MS) {
    warnings.push(`过期暂存：${entry}（超过 30 天，收尾时归位或删掉）`);
  }
}

if (pendingDeletes.length) {
  warnings.push(`待删待确认：${pendingDeletes.join('、')}`);
}

if (errors.length) {
  for (const error of errors) console.error(`✗ ${error}`);
  console.error(`\n${errors.length} 处问题`);
}
for (const warning of warnings) console.log(warning);
if (errors.length) process.exit(1);

if (runVerify) {
  const verifySkipped = rows.length - verifyRan;
  console.log(
    verifyRan > 0
      ? `检查通过（含验收）：验收 ${verifyRan} 条，跳过 ${verifySkipped} 个模块`
      : `检查通过（未验收）：没有可执行的验收命令，跳过 ${verifySkipped} 个模块`,
  );
} else {
  console.log(`结构检查通过（未验收）：${rows.length} 个模块`);
}
