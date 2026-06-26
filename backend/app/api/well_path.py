from typing import Any, Dict
from fastapi import APIRouter, Body, Response, Response, Response, Response, Response, Response, Response, Response, Response
from app.services.wellpath_engine import chart_series, design_template, minimum_curvature, source_rows_from_payload
from app.services.collision_engine import collision_scan
from app.services.planning_methods import method_templates, solve_planning_method
from app.services.planning_acceptance import latest_planning_acceptance_report, list_planning_samples, planning_acceptance_csv, run_all_planning_samples, run_planning_sample
from app.services.target_center import delete_target, evaluate_targets, get_target, line_up_target, list_targets, save_default_targets, solve_to_target, upsert_target
from app.services.target_acceptance import latest_target_acceptance_report, list_target_acceptance_samples, run_all_target_acceptance_samples, run_target_acceptance_sample, target_acceptance_csv
from app.services.acceptance_center import export_stage_acceptance_package, latest_stage_acceptance_summary, run_stage_acceptance, stage_summary_csv
from app.services.collision_acceptance_samples import collision_acceptance_csv, collision_sample_csv, collision_sample_payload, latest_collision_acceptance_report, list_collision_samples, run_all_collision_samples, run_collision_sample, write_collision_sample_files
from app.services.mydrill_calibration import CALIBRATION_COLUMNS, compare_reference, parse_csv_text, rows_to_csv, sample_reference_rows
from app.services.acceptance_samples import calibrate_sample, list_samples, sample_csv, sample_payload, write_sample_files, acceptance_report_csv, batch_acceptance_report, latest_batch_acceptance_report

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





@router.get("/api/well-path/samples")
def acceptance_sample_list():
    return data(list_samples())

@router.get("/api/well-path/samples/{sample_id}")
def acceptance_sample_detail(sample_id: str):
    if sample_id == 'acceptance-report':
        return data(latest_batch_acceptance_report('data/calibration/acceptance_report.json'))
    return data(sample_payload(sample_id))

@router.post("/api/well-path/samples/{sample_id}/calibrate")
def acceptance_sample_calibrate(sample_id: str):
    return data(calibrate_sample(sample_id, save_dir="data/calibration"))

@router.get("/api/well-path/samples/{sample_id}/csv")
def acceptance_sample_csv(sample_id: str, kind: str = "reference"):
    text = sample_csv(sample_id, kind=kind)
    filename = f"{sample_id}_{kind}.csv"
    return Response(
        content="\ufeff" + text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.post("/api/well-path/samples/generate-files")
def acceptance_sample_generate_files():
    return data(write_sample_files("sample_data/acceptance"))

@router.get("/api/well-path/calibration/latest")
def calibration_latest():
    import glob
    import json
    import os
    candidates = []
    candidates.extend(glob.glob("data/calibration/mydrill_alignment_report_*.json"))
    candidates.extend(glob.glob("data/calibration/*alignment_report*.json"))
    candidates.extend(glob.glob("data/calibration/report.json"))
    candidates.extend(glob.glob("data/calibration/last_alignment_report.json"))
    candidates = [p for p in candidates if os.path.isfile(p)]
    if not candidates:
        rows = sample_reference_rows()
        return data(compare_reference(rows, save_dir="data/calibration"))
    latest = max(candidates, key=lambda p: os.path.getmtime(p))
    with open(latest, "r", encoding="utf-8") as f:
        report = json.load(f)
    report["loadedReport"] = latest
    return data(report)



@router.post("/api/well-path/samples/run-all")
def acceptance_sample_run_all():
    return data(batch_acceptance_report("data/calibration"))

@router.get("/api/well-path/samples/acceptance-report")
def acceptance_sample_acceptance_report():
    return data(latest_batch_acceptance_report("data/calibration/acceptance_report.json"))

@router.get("/api/well-path/samples/acceptance-report.csv")
def acceptance_sample_acceptance_report_csv():
    report = latest_batch_acceptance_report("data/calibration/acceptance_report.json")
    text = acceptance_report_csv(report)
    return Response(
        content="\ufeff" + text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=drillspace_acceptance_report.csv"}
    )



# V2.9.2.2 stable aliases: avoid conflict with /api/well-path/samples/{sample_id}
@router.post("/api/well-path/batch-run-all")
def acceptance_batch_run_all_alias():
    return data(batch_acceptance_report("data/calibration"))

@router.get("/api/well-path/batch-acceptance-report")
def acceptance_batch_report_alias():
    return data(latest_batch_acceptance_report("data/calibration/acceptance_report.json"))

@router.get("/api/well-path/batch-acceptance-report.csv")
def acceptance_batch_report_csv_alias():
    report = latest_batch_acceptance_report("data/calibration/acceptance_report.json")
    text = acceptance_report_csv(report)
    return Response(
        content="\ufeff" + text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=drillspace_acceptance_report.csv"}
    )



@router.get("/api/well-path/collision-acceptance/samples")
def collision_acceptance_sample_list():
    return data(list_collision_samples())

@router.get("/api/well-path/collision-acceptance/samples/{sample_id}")
def collision_acceptance_sample_detail(sample_id: str):
    return data(collision_sample_payload(sample_id))

@router.post("/api/well-path/collision-acceptance/samples/{sample_id}/run")
def collision_acceptance_sample_run(sample_id: str):
    return data(run_collision_sample(sample_id, save_dir="data/calibration"))

@router.post("/api/well-path/collision-acceptance/run-all")
def collision_acceptance_run_all():
    return data(run_all_collision_samples("data/calibration"))

@router.get("/api/well-path/collision-acceptance/report")
def collision_acceptance_report():
    return data(latest_collision_acceptance_report("data/calibration/collision_acceptance_report.json"))

@router.get("/api/well-path/collision-acceptance/report.csv")
def collision_acceptance_report_csv():
    report = latest_collision_acceptance_report("data/calibration/collision_acceptance_report.json")
    text = collision_acceptance_csv(report)
    return Response(
        content="\ufeff" + text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=drillspace_collision_acceptance_report.csv"}
    )

@router.get("/api/well-path/collision-acceptance/samples/{sample_id}/csv")
def collision_acceptance_sample_csv_endpoint(sample_id: str, kind: str = "current"):
    text = collision_sample_csv(sample_id, kind=kind)
    return Response(
        content="\ufeff" + text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={sample_id}_{kind}.csv"}
    )

@router.post("/api/well-path/collision-acceptance/generate-files")
def collision_acceptance_generate_files():
    return data(write_collision_sample_files("sample_data/collision_acceptance"))




@router.post("/api/well-path/acceptance/run-all")
def stage_acceptance_run_all():
    return data(run_stage_acceptance("data"))

@router.get("/api/well-path/acceptance/summary")
def stage_acceptance_summary():
    return data(latest_stage_acceptance_summary("data"))

@router.get("/api/well-path/acceptance/summary.csv")
def stage_acceptance_summary_csv():
    summary = latest_stage_acceptance_summary("data")
    text = stage_summary_csv(summary)
    return Response(
        content="\ufeff" + text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=drillspace_stage_acceptance_summary.csv"}
    )

@router.get("/api/well-path/acceptance/package")
def stage_acceptance_package():
    return data(export_stage_acceptance_package("data"))




@router.get("/api/well-path/planning/methods")
def planning_methods():
    return data(method_templates()["methods"])

@router.get("/api/well-path/planning/section-types")
def planning_section_types():
    return data(method_templates()["sectionTypes"])

@router.post("/api/well-path/planning/solve-section")
def planning_solve_section(payload: Dict[str, Any] = Body(default={})):
    return data(solve_planning_method(payload))

@router.post("/api/well-path/planning/calculate-next")
def planning_calculate_next(payload: Dict[str, Any] = Body(default={})):
    return data(solve_planning_method(payload))

@router.post("/api/well-path/planning/insert-section")
def planning_insert_section(payload: Dict[str, Any] = Body(default={})):
    return data(solve_planning_method(payload))




@router.get("/api/well-path/planning-acceptance/samples")
def planning_acceptance_sample_list():
    return data(list_planning_samples())

@router.post("/api/well-path/planning-acceptance/samples/{sample_id}/run")
def planning_acceptance_sample_run(sample_id: str):
    return data(run_planning_sample(sample_id, save_dir="data/calibration"))

@router.post("/api/well-path/planning-acceptance/run-all")
def planning_acceptance_run_all():
    return data(run_all_planning_samples("data/calibration"))

@router.get("/api/well-path/planning-acceptance/report")
def planning_acceptance_report():
    return data(latest_planning_acceptance_report("data/calibration/planning_acceptance_report.json"))

@router.get("/api/well-path/planning-acceptance/report.csv")
def planning_acceptance_report_csv():
    report = latest_planning_acceptance_report("data/calibration/planning_acceptance_report.json")
    text = planning_acceptance_csv(report)
    return Response(
        content="\ufeff" + text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=drillspace_planning_acceptance_report.csv"}
    )


@router.get("/api/well-path/targets")
def target_list():
    return data(list_targets("data/targets/target_library.json"))

@router.post("/api/well-path/targets")
def target_save(payload: Dict[str, Any] = Body(default={})):
    return data(upsert_target(payload, "data/targets/target_library.json"))

@router.post("/api/well-path/targets/defaults")
def target_defaults():
    return data(save_default_targets("data/targets/target_library.json"))

@router.post("/api/well-path/targets/evaluate")
def target_evaluate(payload: Dict[str, Any] = Body(default={})):
    return data(evaluate_targets(payload, "data/targets/target_library.json"))

@router.post("/api/well-path/planning/line-up-target")
def planning_line_up_target(payload: Dict[str, Any] = Body(default={})):
    return data(line_up_target(payload, "data/targets/target_library.json"))

@router.post("/api/well-path/planning/solve-to-target")
def planning_solve_to_target(payload: Dict[str, Any] = Body(default={})):
    return data(solve_to_target(payload, "data/targets/target_library.json"))

@router.get("/api/well-path/target-acceptance/samples")
def target_acceptance_sample_list():
    return data(list_target_acceptance_samples())

@router.post("/api/well-path/target-acceptance/samples/{sample_id}/run")
def target_acceptance_sample_run(sample_id: str):
    return data(run_target_acceptance_sample(sample_id, save_dir="data/calibration"))

@router.post("/api/well-path/target-acceptance/run-all")
def target_acceptance_run_all():
    return data(run_all_target_acceptance_samples("data/calibration"))

@router.get("/api/well-path/target-acceptance/report")
def target_acceptance_report():
    return data(latest_target_acceptance_report("data/calibration/target_acceptance_report.json"))

@router.get("/api/well-path/target-acceptance/report.csv")
def target_acceptance_report_csv():
    report = latest_target_acceptance_report("data/calibration/target_acceptance_report.json")
    text = target_acceptance_csv(report)
    return Response(
        content="\ufeff" + text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=drillspace_target_acceptance_report.csv"}
    )

@router.get("/api/well-path/targets/{target_id}")
def target_get(target_id: str):
    return data(get_target(target_id, "data/targets/target_library.json"))

@router.put("/api/well-path/targets/{target_id}")
def target_update(target_id: str, payload: Dict[str, Any] = Body(default={})):
    payload = dict(payload or {})
    payload["id"] = target_id
    return data(upsert_target(payload, "data/targets/target_library.json"))

@router.delete("/api/well-path/targets/{target_id}")
def target_delete(target_id: str):
    return data(delete_target(target_id, "data/targets/target_library.json"))
