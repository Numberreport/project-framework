#!/usr/bin/env node
import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProject } from '../lib/check.mjs';
import { executionPlan, runProject } from '../lib/run.mjs';
import { createCanvas } from '../lib/canvas/canvas.mjs';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const templateDir = join(pkgRoot, 'template');

const HELP = `project-framework (pf) 命令行工具

用法：
  pf init [目标目录]                  初始化新项目（默认当前目录）
  pf check [目录] [--verify] [--tree] 检查项目结构、链接与文档层级
  pf plan [目录]                      输出正式执行计划 JSON
  pf run <输入.json> [目录]           按正式连接运行原生程序项目
  pf canvas [目录] [--port <端口>]    启动本地画布服务
  pf --help                           查看帮助
`;

function parseArgs(argv) {
  const flags = new Set();
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' && i + 1 < argv.length) {
      options.port = Number(argv[++i]);
    } else if (arg.startsWith('--port=')) {
      options.port = Number(arg.slice('--port='.length));
    } else if (arg.startsWith('--')) {
      flags.add(arg);
    } else {
      positional.push(arg);
    }
  }
  return { flags, options, positional };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    return;
  }

  const { flags, options, positional } = parseArgs(rest);

  if (command === 'init') {
    const target = resolve(positional[0] || process.cwd());
    if (existsSync(target) && readdirSync(target).some(name => name !== '.git')) {
      throw Error('目标目录非空，请指定空目录或新目录：' + target);
    }
    mkdirSync(target, { recursive: true });
    cpSync(templateDir, target, { recursive: true });
    console.log('已初始化项目到：' + target);
    console.log('下一步：在项目目录运行 pf check 验证结构。');
    return;
  }

  if (command === 'check') {
    const target = resolve(positional[0] || process.cwd());
    const result = checkProject(target, {
      verify: flags.has('--verify'),
      tree: flags.has('--tree'),
    });
    for (const line of result.output) console.log(line);
    if (!result.ok) {
      for (const err of result.errors) console.error('✗ ' + err);
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'plan') {
    const target = resolve(positional[0] || process.cwd());
    console.log(JSON.stringify(executionPlan(target), null, 2));
    return;
  }

  if (command === 'run') {
    const inputPath = positional[0];
    if (!inputPath) throw Error('用法：pf run <输入.json> [目录]');
    const target = resolve(positional[1] || process.cwd());
    const inputs = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
    console.log(JSON.stringify(await runProject(target, inputs), null, 2));
    return;
  }

  if (command === 'canvas') {
    const target = resolve(positional[0] || process.cwd());
    const port = Number.isInteger(options.port) && options.port >= 0 ? options.port : 0;
    const server = createCanvas(target);
    server.listen(port, '127.0.0.1', () => {
      console.log('项目画布：http://127.0.0.1:' + server.address().port);
      console.log('项目目录：' + target);
      console.log('停止这个进程就关闭画布。');
    });
    return;
  }

  throw Error('未知命令：' + command + '\n\n' + HELP);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
