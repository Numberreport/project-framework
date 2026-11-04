import { pathToFileURL } from 'node:url';
import { check } from './impl.mjs';
export function run(text, original) {
  const result = check(text, original);
  return result.verdict === 'pass' ? '通过' : result.verdict === 'incomplete' ? '未完成' : '不通过：' + result.issues.join('；');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(run(process.argv[2], process.argv[3]));
}
