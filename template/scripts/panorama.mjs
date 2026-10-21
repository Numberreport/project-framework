#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
await import(existsSync(fileURLToPath(new URL('../module.json', import.meta.url)))
  ? './panorama-format.mjs' : './legacy/panorama.mjs');
