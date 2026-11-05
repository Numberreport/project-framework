import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('节点悬停突出全部直接连线，切换或移开时清除旧高亮', () => {
  const html = readFileSync(new URL('../canvas.html', import.meta.url), 'utf8');
  const edges = [['a', 'b'], ['c', 'a'], ['a', 'a'], ['b', 'c'], ['boundary-input', 'a']].map(([source, target]) => ({
    dataset: { source, target },
    related: false,
    classList: { toggle(name, active) { assert.equal(name, 'node-related'); this.owner.related = active; } },
  }));
  edges.forEach(edge => { edge.classList.owner = edge; });
  const context = vm.createContext({ document: { querySelectorAll: () => edges } });
  vm.runInContext(html.slice(html.indexOf('function highlightNodeEdges('), html.indexOf('function drawEdges()')), context);
  const check = (id, expected) => {
    context.nodeId = id;
    vm.runInContext('highlightNodeEdges(nodeId)', context);
    assert.deepEqual(edges.map(edge => edge.related), expected);
  };
  check('a', [true, true, true, false, true]);
  check('b', [true, false, false, true, false]);
  check('boundary-input', [false, false, false, false, true]);
  check(null, [false, false, false, false, false]);
});
