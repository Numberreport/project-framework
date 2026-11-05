# 未命名组合

## 职责

由画布打包生成，负责组织以下模块完成一项任务；具体职责请补充一句话说明。

成员：

- 未命名节点（node_4f52a8c3841f）
- 未命名节点（node_f903feef71bb）

## 输入

本组合不接收外部输入。

```interfaces
[
  {
    "name": "input",
    "description": "待处理的材料"
  }
]
```

## 输出

本组合不对外输出。

```interfaces
[
  {
    "name": "output",
    "description": "处理后的结果"
  }
]
```

## 处理流程

按 connections.json 把输入交给成员，收集成员的交付后对外输出。

内部连接：

- node_f903feef71bb.output → node_4f52a8c3841f.input

## 没完成时
