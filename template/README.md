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

方法、做事要求和检查命令都在 [AGENTS.md](AGENTS.md)。模块在 `modules/` 下，每个模块的说明看它自己的 README。项目口径检查使用独立入口，调用方式见[检查模块](modules/project_consistency/README.md)，不作为项目对外业务接口；建项时保留该模块。[提示词可读性检查](modules/prompt_readability/README.md)也可独立调用，按项目现行提示词写法规范报告问题，修复由当前智能体处理。

建成新项目后，这一份也要改成自己的：职责、输入、输出、处理流程各写实际的内容，没用到框架反馈时把它的接口和连线一起删掉。

## 没完成时

缺材料、缺授权、拿不准，就停下来问人，说清卡在哪、缺什么，别把没做成的说成做成了。

## 正式执行

正式画布、执行计划和实际接力都读取模块目录、README 接口与 `connections.json`。`structure.mjs` 负责共用读取，`run.mjs` 按同一套连接执行，不接受另传的流程图。草稿不能从正式执行入口运行。

程序模块登记 `implementation`。原生支持 `.mjs`，导出 `async function run(inputs, context)`；输入、返回值都是按接口名填写的对象，缺接口、多接口或返回 undefined 都会报错。`context.directory` 是模块目录。每次在独立环境中调用入口，避免复用旧代码。其他语言通过 `executeProgram` 接入。

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

采用 `runProject` 时的接力规则：同一输出可分给多个下游；每个输入按到达顺序排队，所有输入各有一份材料时调用一次模块，不自动合并多份材料。无输入模块每次进入组合只运行一次。未接入流程的模块不运行；已接入但缺来源的必需输入会在启动前报错。组合从外层接收输入，按内部连接处理，再从 `$self` 交出结果；组合不能另设本体入口。独立输入通过 `ioInputs: { 节点标识: 材料 }` 提供，独立输出在返回值的 `ioOutputs` 中。

有 `when` 的连线必须接入 `evaluateWhen`，根据收到的 `condition`、`value` 和 `edge` 返回布尔值；不提供就拒绝运行，不把条件当作始终成立。`kind` 仍仅作标记。反馈回路还必须填写 `stop`，并接入 `shouldStop`，根据 `condition`、`steps` 和当前组合 `outputs` 判断是否停止。每次成员交付后判断一次；组合多次交付同一输出时，以最新一次为结果。默认最多调用 1000 次成员、每次执行或判断最多等待 60 秒，可以通过 `maxSteps` 和 `timeoutMs` 调整。

执行前先检查整条接力链。缺本体、未完成、接口失效或缺少所需执行方式时拒绝启动。每次接力前后核对正式版本，包含本体代码、提示词和资料；变化后停止传递结果。布局与 `workspace/` 运行数据不改变执行版本。超时或停止接力不会撤销模块已经产生的外部操作，不能据此盲目重试。接口名称检查不替代内容验收。
