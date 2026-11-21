# 项目规则

把复杂的事情简单化，把简单的事情流程化。

## 核心结构

项目由模块组成，项目根目录本身也是一个模块。模块放 `modules/` 下，默认平铺；只有多个模块要接力完成同一项任务时，才建组合模块（该目录下同时放 `modules/` 和 `connections.json`）。

每个模块只放四样东西：

- `README.md`：说明书，固定五个二级标题：`职责`、`输入`、`输出`、`处理流程`、`没完成时`。对外接口用 `interfaces` JSON 代码块写在「输入」和「输出」里。
- `module.json`：登记表，含 `id`、`name`、`template`、`status`（`ready`/`pending`）、`implementation`（程序入口或 AI 主提示词，正文即本体时填 `README.md`），可选 `processor`（`program`/`ai`/`mixed`）、`verify`（`.mjs` 验收脚本）、`guidance`（流程引导确认设置）。
- 本体：代码文件或 AI 提示词。配置项用 JSON 与本体分开。
- `VALIDATION.md`：输出合格的检查标准。

连接写在 `connections.json`，说明 `from`、`to` 和传递内容 `info`；可选 `when`（条件）和 `kind`（`support`/`return`，仅作标记）。有反馈回路时必须写 `stop` 停止条件。

项目根目录放额外文件或目录时，在根 `module.json` 的 `rootFiles` 数组中登记（不得登记密钥）。

## 常用命令与对话触发

使用框架命令行工具 `pf`（或通过 `project-framework` 包调用）。用户用自然语言提出以下要求时，直接按对应方式执行：

- **检查结构** → 运行 `pf check`（加 `--verify` 跑验收脚本，`--tree` 看模块树）。
- **打开画布** → 运行 `pf canvas` 启动本地画布并返回地址。
- **整体检查 / 口径检查 / 可读性检查 / 项目自检** → 按 [项目自检](modules/project_check/README.md) 执行对应维度或全项检查。
- **反馈框架问题** → 按 [框架反馈](modules/framework_feedback/README.md) 整理反馈。
- **查看计划 / 运行程序** → `pf plan` 查看正式执行计划，`pf run <输入.json>` 运行原生程序模块。

## 开发底线

- **单一事实源**：正式画布和执行计划都从底层文件生成。改模块、接口或连接时，同步改受影响的实现与文档，并跑 `pf check` 和实际调用验证。
- **内容归位**：每条规则只在一处正式说明，其他地方引用，不重复抄写；采用新方案时清除旧规则和旧示例。
- **文档写法**：唯一一级标题，标题不跳级（`pf check` 自动查），一段只讲一件事，不堆术语，保留必要条件和例外。
- **质量与验收**：需要验收业务产物时，把生成模块和检查模块放进同一组合，检查通过后再交付。需要做口径、可读性或整体检查时，调用[项目自检](modules/project_check/README.md)。
- **诚实交付**：缺材料、缺授权或没做成，就停下来说明卡在哪，不把未验证或未完成的结果说成通过。
- **框架问题**：发现通用框架本身有问题时，用[框架反馈](modules/framework_feedback/README.md)整理反馈，不擅自修改外部框架。

## 流程引导

需要人工确认再继续时，在所属组合的 `module.json` 中设置 `guidance`（`mode` 为 `none`、`key` 或 `all`，`checkpoints` 填已连接的本层成员），配合 `taskDirectory` 暂停与恢复，面向用户的说明与决定整理见[流程引导](modules/workflow_guidance/README.md)。用户确认不替代质量检查。

## 运行与存档

每次任务在根目录 `workspace/<任务名>/` 下保存最新状态和产物，不同任务分开存放。`workspace/` 不进版本管理。中断或出错后核对存档与已产生的外部操作再继续，存档缺失或损坏时停下说明，不猜测进度。
