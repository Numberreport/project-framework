import assert from 'node:assert/strict';
import { run } from './run.mjs';
assert.equal(run('一月。二月。三月。'), '一月。三月。二月。');
assert.equal(run(' 只有一句。 '), '只有一句。');
assert.equal(run('一？二！三。'), '一？三。二！');
assert.throws(() => run(null), /非空/);
console.log('文字重排用例通过');
