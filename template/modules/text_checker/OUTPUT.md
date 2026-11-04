# 输出要求

result：检验结论。

- `pass`：全部满足标准。
- `fail`：不通过，附问题列表，每条写明违反哪条标准、出现在哪一句。
- `incomplete`：缺少原始输入或无法完成检验。

不通过时给出修改意见，退回到「文字重排」重做；重做后重新完整检验，不只查改动的那一句。

```interfaces
[{ "name": "result", "description": "检验结论：pass、fail 或 incomplete" }]
```
