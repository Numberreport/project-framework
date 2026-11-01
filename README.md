# project-framework

人与 AI 协作的方法模板：把复杂的事情简单化，把简单的事情流程化。

适用范围：适合让 AI 长期做的项目（不限编程），项目照 `template/` 搭。当前模板为 2.0.0。

## 怎么用

1. 把 `template/` 里的全部内容（含 `.gitignore`、`.gitattributes`）复制到新项目根目录。
2. 先读 [方法首页](template/methodology/README.md)，按任务查阅设计、实施或验收；文件格式见 [模块模板](template/methodology/module-template.md)。
3. 按模块模板修改各位置配套文件；新位置用新标识，先设为 pending，审阅后改为 ready。
4. 在新项目里 `git init`，跑 `node scripts/check.mjs --verify`（需要 Node 18+）。
5. 改了模块、成员或连接后，运行 `node scripts/panorama.mjs`，再跑检查。示例：`node implementation/run.mjs "一月。二月。三月。"`。

使用其他智能体时，在该客户端支持的项目入口引用同一方法首页；不能假定所有客户端都会自动读取 AGENTS.md。

画布编辑连接见 [画布使用说明](template/methodology/canvas.md)。框架意见反馈见 [框架反馈模块](template/modules/framework_feedback/README.md)。

## 改造已有项目

已有项目改造前，先说明迁移范围、保留数据与恢复方式，征得用户同意。升级比较旧模板、新模板、当前项目，保留配置及用户偏好，冲突先问；不直接覆盖。具体见 [实施指引](template/methodology/implementation.md)。

## 文档说明

现行方法以 `template/methodology/` 为准。[2026-10-22 讨论稿](docs/archive/methodology-draft-2026-10-22.md) 仅为历史存档，已被正式方法取代的段落勿当现行。更多说明见 [docs/README.md](docs/README.md)。