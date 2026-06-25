# DrillSpace V2.7.5 前端 API Base 对接说明

## 1. 启动后端

```powershell
cd D:\WCode\DrillSpace\drillspace\backend\drillspace-api
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

健康检查：

```text
http://127.0.0.1:8000/api/health
```

接口文档：

```text
http://127.0.0.1:8000/docs
```

## 2. V2.7.4/V2.7.3 前端接入

在页面左侧 API Base URL 填写：

```text
http://127.0.0.1:8000
```

然后点击顶部 `API` 按钮，从 MOCK 切换为 API 模式。

## 3. 新 DrillSpace Clean API

| 前端动作 | 新接口 |
|---|---|
| 健康检查 | `GET /api/health` |
| 轨迹刷新计算 | `POST /api/well-path/trajectory/calculate` |
| 轨迹插值 | `POST /api/well-path/trajectory/interpolate` |
| 导入预览 | `POST /api/well-path/trajectory/import-preview` |
| 保存轨迹 | `POST /api/well-path/trajectory/save` |
| 读取轨迹 | `GET /api/well-path/trajectory/{trajectory_id}` |
| 轨迹列表 | `GET /api/well-path/trajectory` |

## 4. MyDrill old API 兼容别名

为了让 V2.7.4 前端不用立刻重写 `apiMap`，V2.7.5 同时保留 MyDrill 风格兼容接口：

| MyDrill 接口 | V2.7.5 处理方式 |
|---|---|
| `POST /wellPath/FrmDesignTest/getFrmMd` | 转到 Python 最小曲率轨迹计算 |
| `POST /wellPath/FrmDesignTest/getCalculateDesignWellBore` | 返回 J/S/水平井模板预览 |
| `POST /wellPath/FormMain/ChartSP` | 返回侧面图数据 |
| `POST /wellPath/FormMain/CharCMST` | 返回水平投影数据 |
| `POST /wellPath/FormMain/ChartINC` | 返回井斜曲线数据 |
| `POST /wellPath/FormMain/ChartAZI` | 返回方位曲线数据 |
| `POST /wellPath/FormMain/ChartDogleg` | 返回 DLS 曲线数据 |
| `POST /wellPath/FormMain/ChartBuild` | 返回造斜率曲线数据 |
| `POST /wellPath/FormMain/ChartTurn` | 返回偏转率曲线数据 |
| `POST /wellPath/TbTrajectory/importTrajectParamsCsv` | 返回导入预览 |

## 5. 当前边界

V2.7.5 是 Clean Backend Scaffold。它已经可以跑通：

```text
前端 → FastAPI → Python wellpath-engine → 轨迹表结果
```

但以下能力仍是预览版，后续需要继续增强：

```text
复杂防碰扫描
误差椭球
高级轨迹控制
数据库正式持久化
用户权限
项目管理
```
