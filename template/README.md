# <项目名>

把复杂的事情简单化，把简单的事情流程化。

这份 README 是给具体项目用的。照模板建成新项目后，下面五段都要换成这个项目自己的内容：职责写项目干什么，输入输出写项目接什么、交什么，接口里的名字和说明一并换成真的，用不到框架反馈时把它和线一起删掉。

## 职责

按框架模板组织工作：提供 AI 协作的方法和检查工具，并把使用中发现的问题反馈给框架。

## 输入

接收 feedback：一项通用框架的问题或建议。

```interfaces
[{ "name": "feedback", "description": "一项通用框架的问题或建议" }]
```

## 输出

交付 result：框架反馈的处理结果，链接、草稿或原因。

```interfaces
[{ "name": "result", "description": "反馈处理结果：链接、草稿或原因" }]
```

## 处理流程

方法、做事要求和检查命令都在 [AGENTS.md](AGENTS.md)。模块在 `modules/` 下，每个模块的说明看它自己的 README。待配置节点和组合保留作示例，不接入默认反馈流程；采用时补齐内容并连接。项目口径检查使用独立入口，调用方式见[检查模块](modules/project_consistency/README.md)，不作为项目对外业务接口；建项时保留该模块。[文档与提示词可读性检查](modules/prompt_readability/README.md)也可独立调用，按项目现行的通用文档规范和文件专用要求报告问题，修复由当前智能体处理。

可选的[项目整体检查](modules/project_overall/README.md)用于检查目标、模块分工、完整流程与结果。对话中可要求“检查项目整体”，或要求“三项配套检查”一并使用口径、可读性和整体检查，具体安排见模块说明。

## 没完成时

缺材料、缺授权、拿不准，就停下来问人，说清卡在哪、缺什么，别把没做成的说成做成了。

## 正式执行

正式画布、执行计划和实际接力都读取模块目录、README 接口与 `connections.json`。`structure.mjs` 负责共用读取，`run.mjs` 按同一套连接执行，不接受另传的流程图。草稿不能从正式执行入口运行。

程序模块登记 `implementation`。原生支持 `.mjs`，导出 `async function run(inputs, context)`；输入、返回值都是按接口名填写的对象，输入或返回值缺少已声明的接口、包含未声明的接口，或接口值为 undefined 时，都会报错。`context.directory` 是模块目录。每次在独立环境中调用入口，避免复用旧代码。其他语言通过 `executeProgram` 接入。

```javascript
// 一个输入、一个输出的程序本体
export async function run({ text }) {
  return { result: text.trim() };
}
```

查看当前正式执行计划：`node run.mjs --plan`。只有原生程序模块时，可以用 `node run.mjs <输入.json>` 执行；输入文件建议放在 `workspace/<任务>/` 中。

AI 模块登记主提示词，用 `processor: "ai"` 标明；未填 processor 的 `.md` 入口也按 AI 模块处理。调用方通过 `executeAI` 接入实际智能体，由框架传入正式提示词、输入材料和输出接口，返回按接口名填写的结果。框架不内置模型账号，也不会自行发起模型请求。

```javascript
import { executionPlan, runProject } from './run.mjs';

const plan = executionPlan(projectDirectory);
const result = await runProject(projectDirectory, inputs, {
  expectedVersion: plan.version,
  executeAI: async ({ prompt, values, outputs, directory }) => {
    return yourAgent({ prompt, values, outputs, directory });
  },
});
```

`runProject` 是可选的统一调度方式。采用它时，既有程序或智能体把原来的调度入口改为调用它：调用方负责实际执行模块，框架负责选模块、传材料和检查接口，不要在执行方式中另写模块之间的调用顺序。也可以保留原入口，但项目须提供实际调用与正式结构一致的验证；修改结构后用相同输入重新验证，覆盖正常交接、失败停止和涉及的退回。框架不能阻止外部程序直接调用文件，因此只复制框架文件或只检查图形，不能声称实际执行已经绑定。

采用 `runProject` 时的接力规则：同一输出可分给多个下游；每个输入按到达顺序排队，所有输入各有一份材料时调用一次模块，不自动合并多份材料。多个成员同时可运行时轮流调度，持续收到反馈的成员不会阻塞其他已就绪成员。无输入模块每次进入组合只运行一次。未接入流程的模块不运行；已接入但缺来源的必需输入会在启动前报错。组合从外层接收输入，按内部连接处理，再从 `$self` 交出结果；采用 `runProject` 调度的组合不能另设本体入口。独立输入通过 `ioInputs: { 节点标识: 材料 }` 提供，独立输出在返回值的 `ioOutputs` 中。

有 `when` 的连线必须接入 `evaluateWhen`，根据收到的 `condition`、`value` 和 `edge` 返回布尔值；不提供就拒绝运行，不把条件当作始终成立。`kind` 仍仅作标记。反馈回路还必须填写 `stop`，并接入 `shouldStop`，根据 `condition`、`steps` 和当前组合 `outputs` 判断是否停止。每次成员交付后判断一次；组合多次交付同一输出时，以最新一次为结果。默认最多调用 1000 次成员、每次执行或判断的超时为 60 秒，可以通过 `maxSteps` 和 `timeoutMs` 调整。原生程序超时会终止 Worker；接入的执行与判断回调不得同步阻塞事件循环，其超时只约束异步等待。

执行前先检查整条接力链。缺本体、未完成、接口失效或缺少所需执行方式时拒绝启动。每次接力前后核对正式版本，包含本体代码、提示词和资料；变化后停止传递结果。普通隐藏代码和资料同样参与版本检查；版本库、画布草稿、虚拟环境（`venv/`、`.venv/`）、普通构建产物及 `.env` 本地配置默认不参与。布局、凭据文件与运行数据默认不改变执行版本。运行数据包括 `workspace/` 和旧项目根目录中未登记为项目文件的 `runs/`、`outputs/`。登记的本体或验收入口位于普通构建、依赖等默认排除目录时，该目录及其中的依赖参与版本检查。超时或停止接力不会撤销模块已经产生的外部操作，不能据此盲目重试。接口名称检查不替代内容验收。

未提供 `taskDirectory` 时，`runProject` 每次调用都从输入重新调度，不会自动读取存档或跳过已完成的模块。中断后，调用方须先核对任务存档和已产生的外部操作，再提供继续处理所需的输入；模块按[运行与存档](AGENTS.md#运行与存档)读取和保存状态，复用已完成的成果，避免重复操作。未实现这套恢复处理的项目，不能直接重新调用并声称已从断点继续。

## 流程引导接入

[流程引导模块](modules/workflow_guidance/README.md)负责面向用户的解释和决定整理。执行入口负责暂停、保存和恢复；对话或应用负责显示成果、获取用户真实答复和调用引导模块。框架不会自行弹出对话或调用模型。

### 设置确认位置

在项目或组合的 module.json 中增加可选 guidance。mode 为 none（不额外确认）、key（仅关键步骤）或 all（本层逐步确认），checkpoints 填本层已连接成员的标识，不填写执行顺序。

```json
{ "guidance": { "mode": "key", "checkpoints": ["proposal_checked"] } }
```

示例中的 proposal_checked 应替换为真实成员标识。组合默认没有可选确认；各组合独立设置，外层 all 不自动展开内部。未连接到当前执行入口的辅助组合不影响该入口的确认要求。调用时可用 confirmationMode 覆盖所有组合的确认方式；选择 all 会逐层确认。缺材料和权限要求遵循[流程引导规则](AGENTS.md#流程引导)。

画布设置只在草稿中修改；采纳后写回正式登记并验证。确认发生在成员完整交付后、沿连接传递前。需要先检查的成果，应把生成和检查放在同一组合，再在外层确认该组合的交付。

### 开始、暂停与继续

启用确认时必须提供项目 workspace/ 下的独立 taskDirectory。即使不需要确认，也可以提供该目录保存执行进度。输入和输出必须是普通 JSON 数据，不能包含 undefined、日期对象或循环引用。可恢复任务将输入副本交给本体，确认和恢复使用调用前保存的材料。

```javascript
const options = {
  taskDirectory: taskDirectory, // 当前项目 workspace/ 下的绝对路径
  executeAI: yourAgent,
};
let result = await runProject(projectDirectory, inputs, options);
// result.status === 'waiting'：把 pending.outputs 展示给用户。
// 以下只在收到用户对这次成果的明确同意后执行：
result = await runProject(projectDirectory, inputs, {
  ...options, resume: true,
  decision: { action: 'approve', token: result.pending.token },
});
```

waiting 是正常暂停，调用已经返回，不占用执行超时时间。重复读取时传 resume: true，不传 decision，仍返回同一待确认成果。completed 才表示完成。一个任务可能多次暂停，每次使用最新 token；任务输入、独立输入、执行版本和确认方式须保持一致。

修改当前待确认步骤时，decision 使用 action: 'revise'，并提供符合该成员原输入接口的完整 inputs。执行入口只重做该成员（组合则重做内部步骤），重新产生确认标识；先前步骤复用结果，下游尚未收到旧成果。若重做会产生外部操作，调用方须先核对并处理已发生的操作，修改决定本身不撤销这些操作。

回改更早的已确认步骤、运行中更换正式版本或改变整个任务输入，第一版不自动迁移存档：先核对受影响结果与外部操作，再另建任务，按正式接口提供可复用成果。不能绕过检查或直接手改存档。

### 保存与异常恢复

workflow.mjs 在任务目录保存 workflow-state.json，记录完成的本体调用、条件判断、停止判断、确认及当前修改输入；这些是当前任务的恢复资料，不是历史版本。恢复时按正式连接重建调度状态，已完成调用使用保存结果，不再执行本体；完成任务再次恢复也不会重复执行。不同任务互不共用状态。

只有明确完成并成功保存的调用才可复用。进程中断、超时、输出不合格或保存失败造成结果不明时，拒绝自动重试。workflow.lock 防止同一任务同时执行；异常退出后须先确认旧进程已停止、核对外部操作，再处理遗留锁。存档缺失、损坏或被修改时拒绝恢复，不猜测进度。

确认绑定保存的 JSON 成果和正式版本。输出引用外部文件时，调用方必须保存并核对文件内容或内容摘要，展示与确认时用同一份不可变成果；框架不能仅凭路径判断文件是否被改。条件和停止判断也会复用，须基于已保存的任务材料，不能依赖恢复时变化的外部状态。

保留原执行入口的项目须自行实现并验证相同的确认、保存与恢复要求。仅调用引导提示词不代表已经接入恢复功能。
