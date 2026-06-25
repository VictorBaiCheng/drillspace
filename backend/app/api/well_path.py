from typing import Any, Dict
from fastapi import APIRouter, Body
from app.services.wellpath_engine import chart_series, design_template, minimum_curvature, source_rows_from_payload
from app.services.collision_engine import collision_scan
from app.services.mydrill_calibration import CALIBRATION_COLUMNS, compare_reference, parse_csv_text, rows_to_csv, sample_reference_rows

router = APIRouter()

def data(x: Any) -> Dict[str, Any]:
    return {"data": x}

def rows_from_body(payload: Any):
    if isinstance(payload, list):
        # MyDrill chart endpoints often receive List<DisignDto>; use first dict if needed.
        if payload and isinstance(payload[0], dict) and ("mdData" in payload[0] or "rows" in payload[0]):
            return source_rows_from_payload(payload[0])
        return payload
    if isinstance(payload, dict):
        return source_rows_from_payload(payload)
    return []

@router.get("/api/well-path/engine-info")
def engine_info():
    return data({
        "version": "2.8.7",
        "trajectoryEngine": "minimum-curvature-v287",
        "collisionEngine": "collision-reference-v287",
        "alignment": [
            "/wellPath/FrmDesignTest/getFrmMd",
            "/wellPath/FormMain/FrmDistanceData",
            "/wellPath/FormMain/FrmFlatScanData",
            "/wellPath/FormMain/FrmDisjunctMatrixData",
            "/wellPath/FormMain/FrmDisjunctRatioData",
        ],
        "note": "Reference implementation. DLL/JNI exact parity requires vendor cal_wellbore.dll bridge.",
    })

@router.get("/wellPath/TbTrajectory/getPidTbTrajectory")
def list_trajectory():
    return data([
        {"id": "TRJ-A5123", "name": "B-1井 设计轨迹 A5123", "type": "设计", "rows": 1200},
        {"id": "TRJ-S4210", "name": "B-1井 实测轨迹 S4210", "type": "实测", "rows": 120},
        {"id": "TRJ-B2-REF", "name": "B-2井 邻井参考轨迹", "type": "邻井", "rows": 880},
    ])

@router.post("/wellPath/FrmDesignTest/getFrmMd")
def legacy_calculate(payload: Dict[str, Any] = Body(default={})):
    return data(minimum_curvature(source_rows_from_payload(payload)))

@router.post("/api/well-path/trajectory/calculate")
def calculate(payload: Dict[str, Any] = Body(default={})):
    return data(minimum_curvature(source_rows_from_payload(payload)))

@router.post("/wellPath/FrmDesignTest/getCalculateDesignWellBore")
def design_template_endpoint(payload: Dict[str, Any] = Body(default={})):
    return data(design_template(payload))

@router.post("/wellPath/FormMain/CharCMST")
def chart_plan(payload: Any = Body(default={})):
    rows = minimum_curvature(rows_from_body(payload))
    return data(chart_series(rows, "ns", "ew"))

@router.post("/wellPath/FormMain/ChartSP")
def chart_sp(payload: Any = Body(default={})):
    rows = minimum_curvature(rows_from_body(payload))
    return data(chart_series(rows, "ns", "tvd"))

@router.post("/wellPath/FormMain/ChartINC")
def chart_inc(payload: Any = Body(default={})):
    rows = minimum_curvature(rows_from_body(payload))
    return data(chart_series(rows, "md", "inc"))

@router.post("/wellPath/FormMain/ChartAZI")
def chart_azi(payload: Any = Body(default={})):
    rows = minimum_curvature(rows_from_body(payload))
    return data(chart_series(rows, "md", "azi"))

@router.post("/wellPath/FormMain/ChartDogleg")
def chart_dogleg(payload: Any = Body(default={})):
    rows = minimum_curvature(rows_from_body(payload))
    return data(chart_series(rows, "md", "dogleg"))

@router.post("/wellPath/FormMain/ChartBuild")
def chart_build(payload: Any = Body(default={})):
    rows = minimum_curvature(rows_from_body(payload))
    return data(chart_series(rows, "md", "build"))

@router.post("/wellPath/FormMain/ChartTurn")
def chart_turn(payload: Any = Body(default={})):
    rows = minimum_curvature(rows_from_body(payload))
    return data(chart_series(rows, "md", "turn"))

@router.post("/api/well-path/trajectory/collision-scan")
def api_collision(payload: Dict[str, Any] = Body(default={})):
    return data(collision_scan(payload))

@router.post("/api/well-path/trajectory/deviation")
def deviation(payload: Dict[str, Any] = Body(default={})):
    design = minimum_curvature(payload.get("design") or payload.get("designRows") or payload.get("rows") or [])
    survey = minimum_curvature(payload.get("survey") or payload.get("surveyRows") or [])
    max_plan = 0.0
    max_tvd = 0.0
    rows = []
    if design and survey:
        by_md = {round(r["md"], 3): r for r in survey}
        for d in design:
            s = by_md.get(round(d["md"], 3))
            if not s:
                continue
            plan = ((d["ns"] - s["ns"]) ** 2 + (d["ew"] - s["ew"]) ** 2) ** 0.5
            tvd = abs(d["tvd"] - s["tvd"])
            max_plan = max(max_plan, plan)
            max_tvd = max(max_tvd, tvd)
            rows.append({"md": d["md"], "planDeviation": round(plan, 3), "tvdDeviation": round(tvd, 3)})
    return data({"ok": True, "maxPlanDeviation": round(max_plan, 3), "maxTvdDeviation": round(max_tvd, 3), "rows": rows})

@router.post("/wellPath/FormMain/FrmDistanceData")
def frm_distance(payload: Dict[str, Any] = Body(default={})):
    payload["method"] = "nearestDistance"
    return data(collision_scan(payload))

@router.post("/wellPath/FormMain/FrmFlatScanData")
def frm_flat(payload: Dict[str, Any] = Body(default={})):
    payload["method"] = "flatScan"
    return data(collision_scan(payload))

@router.post("/wellPath/FormMain/FrmDisjunctMatrixData")
def frm_matrix(payload: Dict[str, Any] = Body(default={})):
    payload["method"] = "separationDistance"
    return data(collision_scan(payload))

@router.post("/wellPath/FormMain/FrmDisjunctRatioData")
def frm_ratio(payload: Dict[str, Any] = Body(default={})):
    payload["method"] = "separationFactor"
    return data(collision_scan(payload))

@router.get("/wellPath/FormMain/getErrorSource")
def error_source():
    return data([
        {"name": "MWD测量误差", "sigma": 8.5},
        {"name": "井口坐标误差", "sigma": 3.0},
        {"name": "测深误差", "sigma": 2.0},
        {"name": "工具面误差", "sigma": 4.0},
    ])

@router.post("/wellPath/FormMain/getErrorEllipsoid")
def frm_ellipsoid(payload: Dict[str, Any] = Body(default={})):
    payload["method"] = "errorEllipsoid"
    return data(collision_scan(payload))

@router.post("/wellPath/TbTrajectory/addToUpdateSingleWellTrajectory")
def save_trajectory(payload: Dict[str, Any] = Body(default={})):
    return data({"ok": True, "saved": True, "trajectoryId": payload.get("tid", "TRJ-A5123")})

@router.post("/wellPath/FrmDesignTest/AddOrUpdateTbTrajectParams")
def save_rows(payload: Any = Body(default=None)):
    return data({"ok": True, "savedRows": len(payload) if isinstance(payload, list) else 0})

@router.post("/wellPath/TbTrajectory/importTrajectParamsCsv")
def import_csv(payload: Any = Body(default=None)):
    return data({"ok": True, "message": "Import endpoint placeholder ready"})



@router.get("/api/well-path/calibration/template")
def calibration_template():
    return data({
        "columns": CALIBRATION_COLUMNS,
        "csvHeader": ",".join(CALIBRATION_COLUMNS),
        "usage": "Export MyDrill/well-path DLL result with MD,INC,AZI,CL,TVD,NS,EW,VSEC,DOGLEG,TF,BUILD,TURN, then POST rows to /api/well-path/calibration/compare."
    })

@router.get("/api/well-path/calibration/sample")
def calibration_sample():
    rows = sample_reference_rows()
    return data(compare_reference(rows, save_dir="data/calibration"))

@router.post("/api/well-path/calibration/compare")
def calibration_compare(payload: Dict[str, Any] = Body(default={})):
    reference_rows = payload.get("reference_rows") or payload.get("referenceRows") or payload.get("mydrillRows") or []
    input_rows = payload.get("input_rows") or payload.get("inputRows") or None
    tolerance = payload.get("tolerance") or None
    if not reference_rows and payload.get("csvText"):
        reference_rows = parse_csv_text(payload["csvText"])
    return data(compare_reference(reference_rows, input_rows=input_rows, tolerance=tolerance, save_dir="data/calibration"))

@router.post("/api/well-path/calibration/compare-csv")
def calibration_compare_csv(payload: Dict[str, Any] = Body(default={})):
    csv_text = payload.get("csvText", "")
    reference_rows = parse_csv_text(csv_text)
    return data(compare_reference(reference_rows, tolerance=payload.get("tolerance"), save_dir="data/calibration"))

@router.get("/api/well-path/calibration/sample-csv")
def calibration_sample_csv():
    return {"csv": rows_to_csv(sample_reference_rows())}
