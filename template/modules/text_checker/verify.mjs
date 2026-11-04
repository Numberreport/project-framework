import assert from 'node:assert/strict';
import { run } from './run.mjs';
assert.equal(run('一月。三月。二月。', '一月。二月。三月。'), '通过');
assert.match(run('一月。二月。三月。', '一月。二月。三月。'), /^不通过/);
assert.equal(run('结果', ''), '未完成');
console.log('重排核对用例通过');
