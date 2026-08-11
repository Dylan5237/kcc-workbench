# Viewer Benchmark 骨架

> 目标：让 Viewer 的渲染能力有可复现、可回归的公开样例，而不只是“看起来能打开”。

## 范围

首版覆盖 Viewer 已支持的类型：

- Markdown（含标题、表格、代码块、图片、列表）
- Mermaid 流程图 / 时序图 / 状态图（含中英文长文本、复杂子图）
- ELK 布局（长节点、长文本、多子图）
- JSON（嵌套、大数组、特殊字符）
- HTML（安全预览，验证脚本/表单/外部网络被禁用）
- 文件增删改 Diff

## 样例存放

建议放在仓库 `test/fixtures/viewer/`（先建目录，不写入真实项目数据）：

```text
test/fixtures/viewer/
  markdown/
  mermaid/
  json/
  html/
  diff/
```

每个样例用一个 README 说明：文件名、渲染目标、预期行为、是否符合 ELK 布局。

## 回归方式

- 新增样例时补一个测试，断言渲染结果包含预期节点或文本。
- Mermaid 渲染失败应给出明确错误，而不是静默空白。
- ELK 布局回归用固定输入比较关键节点坐标或连通性，避免只测“不抛错”。

## 待办

- [ ] 建立 `test/fixtures/viewer/` 目录与首批样例
- [ ] 为 Markdown / Mermaid / JSON / HTML 各补一个回归测试
- [ ] 为 ELK 布局补一个含长文本的样例
- [ ] 在 README 中加入“Viewer 样例”入口
