import { fileURLToPath } from 'node:url';
import { load } from './module-model.mjs';

// 示例入口的启动前检查；不启动调度、业务检验或记录清理。
export function assertRunnable(moduleUrl) {
  const { nodes, errors } = load(fileURLToPath(moduleUrl));
  for (const node of nodes) {
    if (node.meta.status !== 'ready') errors.push('模块待配置，不得运行：' + node.label);
  }
  if (errors.length) throw new Error(errors.join('\n'));
}
