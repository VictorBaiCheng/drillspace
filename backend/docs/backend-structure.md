# DrillSpace V2.7.5 Clean Backend 结构

```text
backend/drillspace-api/
├─ app/
│  ├─ main.py                         # FastAPI 入口
│  ├─ api/
│  │  ├─ health.py                    # 健康检查
│  │  └─ well_path.py                 # 新 DrillSpace well-path API
│  ├─ legacy/
│  │  └─ mydrill_routes.py            # MyDrill old API 兼容别名
│  ├─ models/
│  │  └─ trajectory.py                # Pydantic 数据模型
│  ├─ services/
│  │  ├─ wellpath_engine.py           # Python 轨迹计算引擎
│  │  └─ storage.py                   # 本地 JSON 保存
│  └─ core/
│     └─ config.py                    # 配置
├─ data/trajectories/                 # 本地轨迹版本保存
├─ sample_data/trajectory_sample.csv  # 测试轨迹数据
├─ docs/
├─ tests/
├─ requirements.txt
└─ README.md
```

## 设计原则

- 不继承 MyDrill 旧 Java 微服务架构；
- 不依赖 Nacos / Gateway / 多模块 Maven；
- 先重写轨迹基础算法，快速形成 DrillSpace 新后端主线；
- MyDrill `well-path` 只作为算法参考和结果对照；
- 必要时后续再适配 DLL 或 Java 算法服务。
