# 输入要求

- text：待检查的重排结果，非空字符串，来自「文字重排」的交付。
- original：重排前的原始文字，非空字符串，用来和 text 对照。

两项都必须有。缺任何一项都算检验未完成，不能判不通过。

```interfaces
[
  { "name": "text", "description": "待检查的重排结果" },
  { "name": "original", "description": "重排前的原始文字" }
]
```
