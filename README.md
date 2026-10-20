# project-framework

AI 项目通用框架模板：用模块、信息流和检查脚本组织项目，让 AI 和人按同一套规则协作。

## 怎么用

1. 把 `template/` 里的全部内容（含 `.gitignore`、`.gitattributes`）复制到新项目根目录。
2. 改 `AGENTS.md`：标题换成项目名，补「使用说明」「维护窗口」。
3. 按实际目录改 `TREE.md` 的「位置」表，删掉或替换 `_example` 示例模块。
4. 在新项目里 `git init`，跑 `node scripts/check.mjs --verify`（需要 Node 18+）。

## 反馈

框架规则不顺手、检查误报漏报等，到本仓库 [Issues](https://github.com/Numberreport/project-framework/issues) 用「框架反馈」模板提交。
