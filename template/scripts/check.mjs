#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('需要 Node 18 或更高版本');
await import(existsSync(fileURLToPath(new URL('../module.json', import.meta.url)))
  ? './check-format.mjs' : './legacy/check.mjs');
