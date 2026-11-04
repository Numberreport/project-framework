# project-framework

人与 AI 协作的方法模板：把复杂的事情简单化，把简单的事情流程化。

适合让 AI 长期做的项目，不限编程。项目照 `template/` 搭。当前模板为 3.0.0。

## 怎么用

1. 把 `template/` 里的全部内容（含 `.gitignore`、`.gitattributes`）复制到新项目根目录。
2. 读 [项目方法](template/METHOD.md)，弄清模块怎么划分、每个模块写什么。
3. 把示例模块改成你要做的事，比着它写。新模块先把 `module.json` 的 status 设为 `pending`，写完自检没问题再改 `ready`。
4. 在新项目里 `git init`，跑 `node check.mjs`。需要 Node 18+。
5. 改了模块或连接后运行 `node check.mjs --panorama` 更新全景，再跑检查。

项目结构只有一层：根目录是项目本身，`modules/` 下每个目录是一个模块，平铺，不套层。确实要把多个模块凑成一项任务时，才在该模块下再放一个 `modules/`。

用其他智能体时，在客户端支持的项目入口指向 `METHOD.md`；不能假定所有客户端都会自动读 AGENTS.md。

## 方法版本变化

2.0.0 到 3.0.0 改了结构，旧项目不能直接覆盖升级：

- 八份方法说明合并成一份 `METHOD.md`
- `settings/DEFAULTS.md` 和 `settings/PREFERENCES.md` 合并成模块目录下的 `SETTINGS.md`
- 根目录的 `implementation/`、`scripts/`、`methodology/` 取消；检查脚本改为根目录的 `check.mjs`
- `implementation` 改为填相对模块目录的路径，例如 `run.mjs`
- 全景简化为 `README.md` 里自动生成的一段，不再生成 `overview.svg` 和 `panorama.md`
- 旧格式兼容脚本和画布的旧实现已移除；画布改为根目录 `canvas.mjs` + `canvas.html`，节点位置存在 `canvas-layout.json`

改造已有项目见 [项目方法 · 改造已有项目](template/METHOD.md#六改造已有项目)。

## 文档说明

现行方法以 [`template/METHOD.md`](template/METHOD.md) 为准。[2026-10-22 讨论稿](docs/archive/methodology-draft-2026-10-22.md) 是历史存档，其中被取代的段落不作为现行约定。
