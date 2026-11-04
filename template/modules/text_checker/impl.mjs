// 按 text_reorder 的检验标准核对；只做能机械判定的部分。
function split(text) {
  return (text.match(/[^。！？]+[。！？]?/g) || []).map(part => part.trim()).filter(Boolean);
}

export function check(text, original) {
  const issues = [];
  if (typeof text !== 'string' || !text.trim()) return { verdict: 'incomplete', issues: ['缺少待检结果'] };
  if (typeof original !== 'string' || !original.trim()) return { verdict: 'incomplete', issues: ['缺少原始输入'] };

  const expected = split(original);
  const actual = split(text);
  if (expected.length !== actual.length) {
    issues.push('句子数量应为 ' + expected.length + '，实际 ' + actual.length);
    return { verdict: 'fail', issues };
  }

  // 首句保持，其余为原句倒序。
  const order = [expected[0], ...expected.slice(1).reverse()];
  actual.forEach((sentence, i) => {
    if (sentence !== order[i]) issues.push('第 ' + (i + 1) + ' 句应为「' + order[i] + '」，实际「' + sentence + '」');
  });

  return { verdict: issues.length ? 'fail' : 'pass', issues };
}
