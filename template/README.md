# <项目名>

本项目是一个模块，输入、处理、输出各有说明；内部组合可继续展开。

- 使用：[输入](INPUT.md)、[输出](OUTPUT.md)、[处理流程](PROCESS.md)。
- 设置：[默认设置](settings/DEFAULTS.md)、[当前位置偏好](settings/PREFERENCES.md)。
- 判断成果：[检验标准](VALIDATION.md)；维护检查由 module.json 中的可选 verify 指定。
- 查位置：[TREE.md](TREE.md)；推进任务：[方法首页](methodology/README.md)。

使用框架有意见，可以在对话中说“反馈框架问题”，见 [框架反馈模块](modules/framework_feedback/README.md)。默认先确认；使用者可明确开启指定范围的自动反馈。只反馈通用框架，不自动公开项目资料。

示例运行：`node implementation/run.mjs "一月。二月。三月。"`，输出重排后的文字，不自动保存。要求保存时按处理流程留档。

此示例验证项目、组合、普通模块的调用交接和启动前配置检查；不自动建立运行历史、执行检验修正或管理分身。完整执行方法由项目实现或智能体按方法指引执行。
