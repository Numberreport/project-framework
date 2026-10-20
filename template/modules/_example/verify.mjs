import { transform } from './impl.mjs';

const cases = [
  { input: '一月。二月。三月。', expected: '一月。三月。二月。' },
  { input: '只有一句。', expected: '只有一句。' },
];

let failed = 0;
for (const { input, expected } of cases) {
  const actual = transform(input);
  if (actual !== expected) {
    failed += 1;
    console.error(`用例失败：${input} -> ${actual}（期望 ${expected}）`);
  }
}

if (failed) process.exit(1);
console.log(`验收通过：${cases.length} 个用例`);
