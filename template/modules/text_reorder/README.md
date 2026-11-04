# 文字重排

- [输入](INPUT.md)、[输出](OUTPUT.md)、[处理流程](PROCESS.md)、[检验标准](VALIDATION.md)、[设置](SETTINGS.md)。
- 通用方法见 [项目方法](../../METHOD.md)。

## 职责

把一段多句文字的首句保持在原位，其余句子倒序排列，不改动句内文字和标点。

入口为 `run.mjs`，命令见处理流程。新位置复制后先把状态改为 pending 并重新配置。
