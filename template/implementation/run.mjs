import { pathToFileURL } from 'node:url';
import { assertRunnable } from '../scripts/module-start.mjs';
import { run as memberRun } from '../modules/_example_combo/implementation/run.mjs';
export function run(text) {
  assertRunnable(new URL('../', import.meta.url));
  if (typeof text !== 'string' || !text.trim()) throw new Error('text 必须是非空字符串');
  return memberRun(text);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(run(process.argv[2])); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
