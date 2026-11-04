# project-framework

人与 AI 协作的方法模板：把复杂的事情简单化，把简单的事情流程化。

适合让 AI 长期做的项目，不限编程。项目照 `template/` 搭。

## 怎么用

1. 把 `template/` 的内容全部复制到新项目根目录，含 `.gitignore`、`.gitattributes`。
2. 在新项目里 `git init`，跑 `node check.mjs`。需要 Node 18+。

根目录放项目本身的东西，`modules/` 下每个目录是一个模块，默认平铺。只有多个模块要凑成一项任务时，才在该模块下再建 `modules/`。

智能体先读 `AGENTS.md`。
