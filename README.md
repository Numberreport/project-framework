# project-framework

人与 AI 协作的轻量项目框架与命令行工具：把复杂的事情简单化，把简单的事情流程化。

核心思路是**引擎与业务分离**：框架引擎（检查、调度、断点恢复、画布）作为独立工具运行，业务项目只保留自己的模块、连接和精简规则，不再复制粘贴数千行框架代码。

## 安装与使用

需要 Node.js 18+，零外部依赖。

```bash
# 在本仓库根目录链接全局命令 pf
npm link
```

也可以不安装，直接运行 `node <本仓库路径>/bin/pf.mjs <命令>`。

### 常用命令

```bash
pf init my-project        # 用精简骨架初始化新项目
cd my-project && git init
pf check                  # 检查结构、连接、本地链接与文档标题层级
pf check --verify         # 结构检查 + 运行各模块 verify 验收脚本
pf check --tree           # 打印模块清单
pf plan                   # 查看正式执行计划
pf run input.json         # 按正式连接运行原生程序项目
pf canvas                 # 打开本地画布（查看结构或在草稿中试改）
```

## 仓库结构

- `bin/pf.mjs`：统一命令行入口。
- `lib/`：独立框架引擎（`structure.mjs`、`check.mjs`、`run.mjs`、`workflow.mjs`、`canvas/`）。
- `template/`：新项目骨架，仅包含规则文件、空骨架以及三个内置协作模块（项目自检、流程引导、框架反馈）。
- `examples/`：参考示例（如 AI 本体结构示例 `examples/ai_example/`）。
- `tests/`：框架自身的自动化测试，运行 `npm test`。

## 程序接入执行与流程引导

在代码或智能体宿主中，可直接引入本包进行统一调度（原生 `.mjs` 程序模块自动在独立 Worker 中运行；AI 模块通过 `executeAI` 接入，框架不内置模型账号）：

```javascript
import { executionPlan, runProject } from 'project-framework';

const plan = executionPlan(projectDir);
const result = await runProject(projectDir, inputs, {
  expectedVersion: plan.version,
  taskDirectory: `${projectDir}/workspace/task-01`, // 启用暂停恢复或确认时必填
  executeAI: async ({ prompt, values, outputs, directory }) => {
    return yourAgent({ prompt, values, outputs, directory });
  },
});
```

- **确认与恢复**：在组合的 `module.json` 中设置 `"guidance": { "mode": "key", "checkpoints": ["成员id"] }`（`mode` 可选 `none`/`key`/`all`）。运行到确认点会返回 `{ status: 'waiting', pending }`；收到用户明确同意或修改后，带 `resume: true` 和 `decision: { action: 'approve' | 'revise', token, inputs? }` 恢复。
- **条件与回路**：连线含 `when` 时传入 `evaluateWhen`；存在反馈回路时在 `connections.json` 写 `stop` 并传入 `shouldStop`。
- **版本保护**：每次接力前后自动校验正式文件版本，中途文件变化立即停止传递结果。

画布详细用法见 [画布说明](lib/canvas/README.md)。
