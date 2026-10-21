# project-framework

人与 AI 协作的方法模板：把复杂的事情简单化，把简单的事情流程化。

适用范围：适合让 AI 长期做的项目（不限编程），项目照 `template/` 搭。

当前模板为 2.0.0：每个位置各有一套模块文件，组合与项目采用同样结构。提供配置检查、全景和可运行示例；分身调度、自动修正、清理及升级的执行约定已写入方法，但未提供后台服务。

[2026-10-22 讨论稿](docs/methodology-draft-2026-10-22.md) 保留讨论时的存档状态；当前采用情况以模板及 [方法首页](template/methodology/README.md) 为准。

## 怎么用

1. 把 `template/` 里的全部内容（含 `.gitignore`、`.gitattributes`）复制到新项目根目录。
2. 按 [文件模板与中文对照](template/methodology/module-template.md) 修改项目和各位置的配套文件；新位置重新配置，用新标识，先设为 pending。
3. 替换示例模块及连接，配置完成后审阅必需条件，再改为 ready。普通模块不需要 modules/ 和 connections.json。
4. 在新项目里 `git init`，跑 `node scripts/check.mjs --verify`（需要 Node 18+）。
5. 改了模块、成员或连接后，运行 `node scripts/panorama.mjs`，再跑检查。示例运行：`node implementation/run.mjs "一月。二月。三月。"`。

任务开始先读 [方法首页](template/methodology/README.md)，按任务类型查看设计、实施或验收指引。使用其他智能体时，在该客户端支持的项目入口引用同一首页；不能假定所有客户端都会自动读取 AGENTS.md。

## 改造已有项目

已有项目改造前，先说明迁移范围、保留数据与恢复方式，征得用户同意。升级比较旧模板、新模板、当前项目，保留配置及用户偏好，冲突先问；不直接覆盖。

新版工具兼容旧根格式：没有 module.json 时仍按原 TREE.md 与模块 README 检查。整套采用 scripts/，不要只复制一个入口；不自动迁移旧模块，不同步其他项目。具体见 [实施指引](template/methodology/implementation.md)。

## 反馈

框架规则不顺手、互相矛盾、检查误报漏报，或缺了该有的规定，提一份反馈交回模板维护者。

- 先问用户同不同意；同意后到本仓库 [Issues](https://github.com/Numberreport/project-framework/issues/new?template=framework-feedback.yml) 用「框架反馈」模板提 Issue，一件事一个，保持简短。用户不同意就不提。
- 仓库是公开的，Issue 里不写账号、密钥、个人信息或项目隐私。
- 用不了 GitHub 的，把反馈要点告诉用户，由用户转交。
