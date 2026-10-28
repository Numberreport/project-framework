# project-framework

人与 AI 协作的方法模板：把复杂的事情简单化，把简单的事情流程化。

适用范围：适合让 AI 长期做的项目（不限编程），项目照 `template/` 搭。

先读 [方法首页](template/methodology/README.md)，从信息的处理和传递理解项目，再按任务查阅具体做法。当前模板为 2.0.0：每个位置各有一套模块文件，项目根目录按组合结构组织。具体格式见 [模块模板](template/methodology/module-template.md)。提供配置检查、全景和可运行示例；分身调度、自动修正、清理及升级的执行约定见运行说明，未提供后台服务。

[2026-10-22 讨论稿](docs/methodology-draft-2026-10-22.md) 保留讨论时的存档状态；当前采用情况以模板及 [方法首页](template/methodology/README.md) 为准。

## 怎么用

1. 把 `template/` 里的全部内容（含 `.gitignore`、`.gitattributes`）复制到新项目根目录。
2. 按 [文件模板与中文对照](template/methodology/module-template.md) 修改项目和各位置的配套文件；新位置重新配置，用新标识，先设为 pending。
3. 替换示例模块及连接，配置完成后审阅必需条件，再改为 ready。普通模块不需要 modules/ 和 connections.json。
4. 在新项目里 `git init`，跑 `node scripts/check.mjs --verify`（需要 Node 18+）。
5. 改了模块、成员或连接后，运行 `node scripts/panorama.mjs`，再跑检查。示例运行：`node implementation/run.mjs "一月。二月。三月。"`。

任务开始先读 [方法首页](template/methodology/README.md)，按任务类型查看设计、实施或验收指引。使用其他智能体时，在该客户端支持的项目入口引用同一首页；不能假定所有客户端都会自动读取 AGENTS.md。

## 可视化编辑连接

在采用当前模板的项目里运行 `node scripts/canvas-server.mjs`，打开显示的本机地址，即可拖线建立连接、编辑或删除连线、移动节点及进入组合。保存前查看变化，检查通过后写回现有连接文件并更新全景；节点位置单独保存。详见 [画布使用说明](template/methodology/canvas.md)。画布不执行模块，输入输出内容是否匹配仍需核对。

## 改造已有项目

已有项目改造前，先说明迁移范围、保留数据与恢复方式，征得用户同意。升级比较旧模板、新模板、当前项目，保留配置及用户偏好，冲突先问；不直接覆盖。

新版工具兼容旧根格式：没有 module.json 时仍按原 TREE.md 与模块 README 检查。整套采用 scripts/，不要只复制一个入口；不自动迁移旧模块，不同步其他项目。具体见 [实施指引](template/methodology/implementation.md)。

## 反馈

使用框架有意见，可以在对话中说“反馈框架问题”，由 [框架反馈模块](template/modules/framework_feedback/README.md) 整理并提交；也可直接使用 [GitHub 反馈表单](https://github.com/Numberreport/project-framework/issues/new?template=framework-feedback.yml)。只反馈通用框架，项目功能问题仍由各项目处理。

默认先确认。使用者明确开启指定范围的自动反馈后，可免逐条确认；仍需核对隐私、授权和重复问题。工具不可用时交付草稿，不伪装提交成功。具体流程和设置只在模块维护。
