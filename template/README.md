# <项目名>

项目由模块组成：根目录本身是一个组合，`modules/` 下每个目录是一个成员模块。

拿这个示例试试：把一句多段的话交给「文字重排」，它会首句不动、其余倒叙；「重排核对」按前一个模块的标准检查结果。

- 怎么划分模块、每个模块写什么：[项目方法](METHOD.md)
- 开工须知：[AGENTS.md](AGENTS.md)
- 检查结构：`node check.mjs`；连维护验收一起跑：`node check.mjs --verify`
- 打开画布：`node canvas.mjs`，在浏览器里拖线建连接、打包组合、查看模块文件

## 项目全景

> 由 `node check.mjs --panorama` 生成，别手改。只表示模块和连接，不表示执行顺序。

### 模块

- 示例项目（project-example）：根目录
  - 框架反馈（framework_feedback）：modules/framework_feedback
  - 重排核对（text_checker）：modules/text_checker
  - 文字重排（text_reorder）：modules/text_reorder

### 连接

#### 示例项目

- $self.original → text_reorder.text：待重排的原始文字
- text_reorder.text → text_checker.text：重排结果
- $self.original → text_checker.original：原始文字，供核对对照
- text_checker.result → $self.result：检验结论

