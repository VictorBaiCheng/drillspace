# DrillSpace V2.7.4 Brand Shell Polish + Trajectory Complete Industrial Editor

本版本在 V2.7.3 完整轨迹工业编辑器基础上，只做产品壳和第一眼工业品牌气质升级，不破坏轨迹数据表、Mock/API 双模式、well-path API 映射和导入预览能力。

## 升级重点

- 左上角品牌区重做：六边形井眼/钻头符号 + DRILLSPACE 工业字标。
- 顶部导航压实：更像工业软件工作台，不像网页后台。
- KPI 改成紧凑状态仪表条：减少卡片感，强化工程状态。
- 圆角继续降低，边框、表头、状态栏更硬朗。
- 保留 V2.7.3 的完整轨迹子系统能力：轨迹管理、轨迹测量、轨迹视图、偏差分析、轨迹控制、防碰扫描、导入导出、接口状态、操作日志。
- 保留 well-path API 映射和 Mock/API 双模式。

## 使用

直接打开 `index.html`。默认 MOCK 模式，可在顶部切换 API 模式，并在左侧设计参数中设置 API Base。

## 建议放置路径

```text
frontend/prototype/v2.7.4-brand-shell/
```

正式工程化时再拆入：

```text
frontend/src/modules/design/trajectory/
frontend/src/services/wellPathApi.js
frontend/src/styles/
```
