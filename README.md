# project-framework

AI 项目通用框架模板：用模块、信息流和检查脚本组织项目，让 AI 和人按同一套规则协作。

适用范围：适合让 AI 长期做的项目（不限编程），项目照 `template/` 搭。

## 怎么用

1. 把 `template/` 里的全部内容（含 `.gitignore`、`.gitattributes`）复制到新项目根目录。
2. 改 `AGENTS.md`：标题换成项目名，补「使用说明」「维护窗口」。
3. 按实际目录改 `TREE.md` 的「位置」表，删掉或替换 `_example` 示例模块。
4. 在新项目里 `git init`，跑 `node scripts/check.mjs --verify`（需要 Node 18+）。
5. 模板示例含「项目全景」。改了模块、成员或连接后，运行 `node scripts/panorama.mjs`，再跑检查。

任务开始先读 [方法首页](template/methodology/README.md)，按任务类型查看设计、实施或验收指引。使用其他智能体时，在该客户端支持的项目入口引用同一首页；不能假定所有客户端都会自动读取 AGENTS.md。

## 改造已有项目

已有项目也可以按框架改造，但动手前先列一份搬迁方案给用户看（哪些东西挪到哪、哪些不动），用户同意后再改。具体做法见 `template/AGENTS.md` 的「收纳」（迁移时先改位置表、不新建同名目录）和「版本管理」（动手前先提交一次）两节。

## 反馈

框架规则不顺手、互相矛盾、检查误报漏报，或缺了该有的规定，提一份反馈交回模板维护者。

- 先问用户同不同意；同意后到本仓库 [Issues](https://github.com/Numberreport/project-framework/issues/new?template=framework-feedback.yml) 用「框架反馈」模板提 Issue，一件事一个，保持简短。用户不同意就不提。
- 仓库是公开的，Issue 里不写账号、密钥、个人信息或项目隐私。
- 用不了 GitHub 的，把反馈要点告诉用户，由用户转交。
