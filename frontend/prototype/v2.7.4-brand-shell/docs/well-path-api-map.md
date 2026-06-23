# DrillSpace V2.7.3 — MyDrill well-path API 映射

## 总体原则

DrillSpace 前端采用新工业界面，不照搬 MyDrill/RSDAS 老界面；轨迹正式计算仍映射 MyDrill Java `well-path` 服务。

## 调用链

```text
DrillSpace Frontend
  → API Gateway / Base URL
  → Java well-path Service
  → cal_wellbore.dll / Java trajectory utils
```

## API 映射表

| DrillSpace动作 | Key | Method | MyDrill well-path接口 | 说明 |
|---|---|---:|---|---|
| 刷新轨迹表 | calculateTable | POST | `/wellPath/FrmDesignTest/getFrmMd` | 根据 MD/INC/AZI 输出完整轨迹表 |
| 设计模板 | designTemplate | POST | `/wellPath/FrmDesignTest/getCalculateDesignWellBore` | J形井、S形井、水平井模板 |
| 水平投影 | horizontalProjection | POST | `/wellPath/FormMain/CharCMST` | 水平面轨迹曲线 |
| 侧面剖面 | verticalProfile | POST | `/wellPath/FormMain/ChartSP` | TVD/水平位移剖面图 |
| 井斜曲线 | inclination | POST | `/wellPath/FormMain/ChartINC` | INC 曲线 |
| 方位曲线 | azimuth | POST | `/wellPath/FormMain/ChartAZI` | AZI 曲线 |
| 狗腿度曲线 | dogleg | POST | `/wellPath/FormMain/ChartDogleg` | Dogleg/DLS 曲线 |
| 造斜率曲线 | build | POST | `/wellPath/FormMain/ChartBuild` | Build 曲线 |
| 偏转率曲线 | turn | POST | `/wellPath/FormMain/ChartTurn` | Turn 曲线 |
| 法平面扫描 | flatScan | POST | `/wellPath/FormMain/FrmFlatScanData` | 防碰法平面扫描 |
| 最近距离 | nearestDistance | POST | `/wellPath/FormMain/FrmDistanceData` | 最近距离扫描 |
| 分离距 | separationDistance | POST | `/wellPath/FormMain/FrmDisjunctMatrixData` | 分离距 / 分离矩阵 |
| 分离系数 | separationFactor | POST | `/wellPath/FormMain/FrmDisjunctRatioData` | 分离系数 |
| 误差源 | errorSource | GET | `/wellPath/FormMain/getErrorSource` | 误差源参数 |
| 误差椭球 | errorEllipsoid | POST | `/wellPath/FormMain/getErrorEllipsoid` | 误差椭球计算 |
| 导入CSV | importCsv | POST | `/wellPath/TbTrajectory/importTrajectParamsCsv` | 轨迹文件正式导入 |
| 轨迹列表 | listTrajectory | GET | `/wellPath/TbTrajectory/getPidTbTrajectory` | 项目下轨迹列表 |
| 保存轨迹元数据 | saveTrajectory | POST | `/wellPath/TbTrajectory/addToUpdateSingleWellTrajectory` | 保存轨迹记录 |
| 保存轨迹点表 | saveRows | POST | `/wellPath/FrmDesignTest/AddOrUpdateTbTrajectParams` | 保存轨迹点 |

## 前端 Mock/API 模式

- `MOCK`：离线演示，所有按钮可点，返回本地模拟结果。
- `API`：调用真实 Java `well-path` 服务。

在 `app.js` 中由：

```js
state.apiMode = 'mock' | 'api'
state.apiBaseUrl = 'http://127.0.0.1:8000'
```

控制。
