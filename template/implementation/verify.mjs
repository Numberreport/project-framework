import assert from 'node:assert/strict';
import { run } from './run.mjs';
// 只检查本组合的输入输出交接，成员完整用例另行运行。
assert.equal(run('一月。二月。三月。'), '一月。三月。二月。');
assert.throws(() => run(''), /非空/);
console.log('组合交接通过');
