import { transform } from '../_example/impl.mjs';

// 成员的用例由成员自己验收，这里只验衔接
const output = transform('一月。二月。三月。');
if (typeof output !== 'string' || !output.trim()) {
  console.error('衔接失败：_example 的结果不能当本组合的输出');
  process.exit(1);
}
console.log('验收通过：衔接 1 处');
