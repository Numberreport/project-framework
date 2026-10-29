# 模块与位置

## 位置

| 职责 | 位置 |
| --- | --- |
| 项目配套文件 | 根目录，按组合结构组织，见 [模块模板](methodology/module-template.md) |
| 直接成员 | 当前模块的 modules/，继续按同一结构展开 |
| 实现 | 各模块 implementation/ |
| 默认设置与偏好 | 各模块 settings/ |
| 运行记录 | 各模块 runs/ |
| 正式成果 | 各模块 outputs/ |
| 知识资料 | 各模块 knowledge/，按需 |
| 方法、配置标准、全景 | methodology/ |
| 配置检查及全景工具 | scripts/ |

目录是成员唯一来源，module.json 记录稳定标识和版本，connections.json 是连接唯一来源。本页只指位置，不另维护模块或成员清单。示例可以改名或替换；新位置使用新标识并重新配置。

## 项目全景

属 [方法首页 · 三层可视化](methodology/README.md#三层可视化) 的**第二层（底层结构可视化）**：方便开发者看清结构与连接，不面向最终用户。

[概览](methodology/overview.svg)

[详细说明](methodology/panorama.md)

[可编辑画布使用说明](methodology/canvas.md)：运行 `node scripts/canvas-server.mjs`，在本机浏览器拖线编辑连接（第二层）。

从实际模块和连接生成。结构变化后运行 `node scripts/panorama.mjs`，再运行检查。
