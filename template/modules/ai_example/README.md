# AI 本体示例

这是供复制的文件结构，不是可直接运行的模块。写法遵循 [AI 本体提示词规范](../../AGENTS.md#本体)。

把 `implementation/` 复制到模块目录，把模块登记表的 `implementation` 填为 `implementation/prompt.md`。将方括号里的内容替换为实际做法，并按需要增删情况和资料。

- [主提示词](implementation/prompt.md)：判断该用哪种处理方式。
- [情况一](implementation/情况一/处理方式.md)、[情况二](implementation/情况二/处理方式.md)：各自的处理方式和资料用法。
- [公共资料](implementation/公共资料/资料.md)：多个情况共用的资料。

## 职责

[填写模块负责的工作。]

## 输入

[填写所需输入和接口。]

## 输出

[填写交付结果和接口。]

## 处理流程

从[主提示词](implementation/prompt.md)开始，按条件读取对应情况的处理方式。

## 没完成时

[填写何时停止、如何说明问题及需要用户补充什么。]
