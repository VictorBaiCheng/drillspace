
import csv
import io
import json
import os
import time
from typing import Any, Dict, List

from app.services.target_center import DEFAULT_TARGETS
from app.services.target_driven_planning import (
    evaluate_after_insert,
    insert_target_segment_preview,
    recommend_target_method,
    solve_target_driven_path,
)

TARGET_DRIVEN_ACCEPTANCE_SAMPLES: List[Dict[str, Any]] = [
    {
        "id": "recommend_build_turn_to_target",
        "name": "01 Build Turn to Target 推荐样本",
        "mode": "recommend",
        "target": DEFAULT_TARGETS[2],
        "row": {"md": 2600, "inc": 45, "azi": 105, "tvd": 2300, "ns": 950, "ew": 680},
        "expectedMethodAny": ["buildTurn", "doglegToolface", "optimumAlign", "slant"],
        "desc": "中远距离目标，验证推荐方法与建议参数输出。",
    },
    {
        "id": "dogleg_toolface_to_target",
        "name": "02 Dogleg Toolface to Target 样本",
        "mode": "solve",
        "method": "doglegToolface",
        "target": DEFAULT_TARGETS[2],
        "row": {"md": 3300, "inc": 65, "azi": 103, "tvd": 2850, "ns": 1350, "ew": 980},
        "desc": "强制 Dogleg Toolface，验证目标驱动求解预览。",
    },
    {
        "id": "nudge_to_target",
        "name": "03 Nudge to Target 样本",
        "mode": "solve",
        "method": "nudge",
        "target": DEFAULT_TARGETS[2],
        "row": {"md": 4250, "inc": 84, "azi": 117, "tvd": 3460, "ns": 1950, "ew": 1460},
        "desc": "近靶区 Nudge / Line up on Target 求解。",
    },
    {
        "id": "optimum_align_to_pbhl",
        "name": "04 Optimum Align to PBHL 样本",
        "mode": "solve",
        "method": "optimumAlign",
        "target": DEFAULT_TARGETS[4],
        "row": {"md": 4600, "inc": 88, "azi": 118, "tvd": 3500, "ns": 2400, "ew": 1900},
        "desc": "PBHL 目标对准。",
    },
    {
        "id": "landing_plane_to_landing_point",
        "name": "05 Landing Plane to Landing Point 样本",
        "mode": "solve",
        "method": "nudge",
        "target": DEFAULT_TARGETS[3],
        "row": {"md": 4180, "inc": 84, "azi": 115, "tvd": 3390, "ns": 1820, "ew": 1360},
        "desc": "Landing Point 目标，验证着陆点目标求解。",
    },
    {
        "id": "insert_after_evaluate",
        "name": "06 插入后入靶评价样本",
        "mode": "insertPreview",
        "target": DEFAULT_TARGETS[2],
        "row": {"md": 4200, "inc": 82, "azi": 116, "tvd": 3445, "ns": 1900, "ew": 1410},
        "desc": "生成 rowsToInsert 并评价插入后预览行。",
    },
]


def list_target_driven_samples() -> List[Dict[str, Any]]:
    return [
        {
            "id": s["id"],
            "name": s["name"],
            "mode": s["mode"],
            "targetId": s["target"]["id"],
            "targetName": s["target"]["name"],
            "method": s.get("method", "auto"),
            "desc": s["desc"],
        }
        for s in TARGET_DRIVEN_ACCEPTANCE_SAMPLES
    ]


def _sample(sample_id: str) -> Dict[str, Any]:
    for s in TARGET_DRIVEN_ACCEPTANCE_SAMPLES:
        if s["id"] == sample_id:
            return dict(s)
    raise KeyError(f"unknown target-driven sample: {sample_id}")


def run_target_driven_sample(sample_id: str, save_dir: str = "data/calibration") -> Dict[str, Any]:
    s = _sample(sample_id)
    mode = s["mode"]
    payload = {"row": s["row"], "target": s["target"]}

    errors: List[str] = []
    if mode == "recommend":
        result = recommend_target_method(payload)
        method = result.get("recommendation", {}).get("method")
        if method not in s.get("expectedMethodAny", [method]):
            errors.append(f"unexpected recommended method: {method}")
    elif mode == "insertPreview":
        result = insert_target_segment_preview(payload)
        if result.get("rowCount", 0) <= 0:
            errors.append("no rowsToInsert generated")
        if result.get("rowsToInsert"):
            inserted = result["rowsToInsert"][-1]
            eval_result = evaluate_after_insert({"row": inserted, "target": s["target"]})
            result["evaluateAfterInsert"] = eval_result
    else:
        payload["method"] = s.get("method")
        result = solve_target_driven_path(payload)
        if not result.get("planningResult", {}).get("previewRow"):
            errors.append("no previewRow generated")

    if not result.get("ok", False):
        errors.append("service returned ok=false")
    if mode != "recommend" and not (result.get("insertRows") or result.get("rowsToInsert") or result.get("planningResult", {}).get("rows")):
        errors.append("no planning rows returned")

    verdict = "PASS" if not errors else "REVIEW"
    report = {
        "ok": True,
        "sampleId": sample_id,
        "sample": {
            "id": s["id"],
            "name": s["name"],
            "mode": s["mode"],
            "targetId": s["target"]["id"],
            "targetName": s["target"]["name"],
            "method": s.get("method", "auto"),
            "desc": s["desc"],
        },
        "sampleVerdict": verdict,
        "actualMethod": result.get("recommendation", {}).get("method") or result.get("method") or s.get("method", "auto"),
        "rowCount": len(result.get("insertRows") or result.get("rowsToInsert") or result.get("planningResult", {}).get("rows", [])),
        "result": result,
        "errors": errors,
        "recommendation": "通过" if verdict == "PASS" else "复核目标驱动推荐/求解/插入后评价闭环",
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }

    if save_dir:
        os.makedirs(save_dir, exist_ok=True)
        path = os.path.join(save_dir, f"target_driven_{sample_id}_report.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        report["savedReport"] = path
    return report


def run_all_target_driven_samples(save_dir: str = "data/calibration") -> Dict[str, Any]:
    os.makedirs(save_dir, exist_ok=True)
    reports = [run_target_driven_sample(s["id"], save_dir) for s in TARGET_DRIVEN_ACCEPTANCE_SAMPLES]
    pass_count = sum(1 for r in reports if r["sampleVerdict"] == "PASS")
    review_count = sum(1 for r in reports if r["sampleVerdict"] == "REVIEW")
    fail_count = sum(1 for r in reports if r["sampleVerdict"] == "FAILED")
    rows = []
    for r in reports:
        rows.append({
            "sampleId": r["sampleId"],
            "name": r["sample"]["name"],
            "mode": r["sample"]["mode"],
            "targetId": r["sample"]["targetId"],
            "targetName": r["sample"]["targetName"],
            "method": r["sample"]["method"],
            "actualMethod": r["actualMethod"],
            "rowCount": r["rowCount"],
            "sampleVerdict": r["sampleVerdict"],
            "recommendation": r["recommendation"],
        })
    report = {
        "ok": True,
        "version": "2.9.8",
        "reportType": "TargetDrivenPlanningAcceptanceReport",
        "overallVerdict": "PASS" if review_count == 0 and fail_count == 0 else "REVIEW",
        "totalSamples": len(reports),
        "passCount": pass_count,
        "reviewCount": review_count,
        "failCount": fail_count,
        "samples": rows,
        "reports": reports,
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "note": "Target-driven acceptance line verifies method recommendation, target-driven solve, insert preview and evaluate-after-insert.",
    }
    path = os.path.join(save_dir, "target_driven_planning_report.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    report["savedReport"] = path
    return report


def latest_target_driven_report(path: str = "data/calibration/target_driven_planning_report.json") -> Dict[str, Any]:
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return run_all_target_driven_samples(os.path.dirname(path) or "data/calibration")


def target_driven_csv(report: Dict[str, Any]) -> str:
    buf = io.StringIO()
    fields = ["sampleId", "name", "mode", "targetId", "targetName", "method", "actualMethod", "rowCount", "sampleVerdict", "recommendation"]
    writer = csv.DictWriter(buf, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for row in report.get("samples", []):
        writer.writerow({k: row.get(k, "") for k in fields})
    return buf.getvalue()
