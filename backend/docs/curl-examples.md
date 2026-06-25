# API Examples

## Calculate trajectory

```bash
curl -X POST http://127.0.0.1:8000/api/well-path/trajectory/calculate \
  -H "Content-Type: application/json" \
  -d '{
    "trajectory_name":"B-1井设计轨迹 A5123",
    "target_azimuth":121.5,
    "rows":[
      {"md":0,"inc":0,"azi":121.5,"station_type":"井口"},
      {"md":432,"inc":0,"azi":121.5,"station_type":"直井段"},
      {"md":1250,"inc":8.5,"azi":121.5,"station_type":"造斜段"},
      {"md":2680,"inc":32,"azi":121.5,"station_type":"增斜段"},
      {"md":4320,"inc":32,"azi":121.5,"station_type":"稳斜段"},
      {"md":5320,"inc":10,"azi":121.5,"station_type":"降斜段"}
    ]
  }'
```

## Import preview

```bash
curl -X POST http://127.0.0.1:8000/api/well-path/trajectory/import-preview \
  -F "file=@sample_data/trajectory_sample.csv"
```
