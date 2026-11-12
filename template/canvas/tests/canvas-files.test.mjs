import test from 'node:test';
import assert from 'node:assert/strict';
import { replacePorts } from '../canvas.mjs';
import { readPorts } from '../../structure.mjs';

const doc = '# 模块\n\n## 职责\n\n处理输入。\n\n## 输入\n\n```interfaces\n[{"name":"text","description":"文字"}]\n```\n\n## 输出\n\n```interfaces\n[]\n```\n\n## 处理流程\n\n执行处理。\n\n## 没完成时\n\n停止并说明。\n';

test('编辑接口使用真实章节，保留围栏、注释中的伪标题及 tab 标题', () => {
  const examples = '~~~markdown\n## 输入\n~~~\n\n<!--\n## 输入\n-->\n\n';
  const before = doc.replace('## 输入', examples + '##\t输入').replace('## 输出', '##\t输出');
  const after = replacePorts(before, '输入', [{ name: 'changed', description: '改名后的文字' }]);
  assert.deepEqual(readPorts(after, '输入'), [{ name: 'changed', description: '改名后的文字' }]);
  assert.ok(after.includes(examples));
  assert.ok(after.includes('##\t输入'));
  assert.equal(after.slice(after.indexOf('##\t输出')), before.slice(before.indexOf('##\t输出')));
  assert.equal(after.slice(0, after.indexOf('##\t输入')), before.slice(0, before.indexOf('##\t输入')));
});

test('Windows 换行的说明书编辑输入后仍能编辑输出，兼容混合换行',()=>{
  const before=doc.replaceAll('\n','\r\n');
  const updated=replacePorts(replacePorts(before,'输入',[{name:'new_input',description:'新材料'}]),'输出',[{name:'result',description:'结果'}]);
  assert.deepEqual(readPorts(updated,'输入'),[{name:'new_input',description:'新材料'}]);
  assert.deepEqual(readPorts(updated,'输出'),[{name:'result',description:'结果'}]);
});
