# 项目全景

> 从模块目录、module.json 和 connections.json 生成；不推断执行顺序。

## 模块

- 示例项目（project-example）：.
- 文字重排组合（example-combo）：modules/_example_combo
- 文字重排（example-text）：modules/_example_combo/modules/_example

## 连接

### 示例项目

- $self.text → example-combo.text：原始文字
- example-combo.text → $self.text：重排后的文字

### 文字重排组合

- $self.text → example-text.text：原始文字
- example-text.text → $self.text：重排后的文字
