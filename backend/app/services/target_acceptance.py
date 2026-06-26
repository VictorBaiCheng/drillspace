
import csv
import io
import json
import os
import time
from typing import Any, Dict, List

from app.services.target_center import DEFAULT_TARGETS, evaluate_target, line_up_target, solve_to_target

TARGET_ACCEPTANCE_SAMPLES: List[Dict[str, Any]] = [
    {
        "id": "circle_hit",
        "name": "01 圆形靶区入靶样本",
        "mode": "evaluate",
        "target": DEFAULT_TARGETS[2],
        "row": {"md": 4360, "inc": 86, "azi": 121.8, "tvd": 3508, "ns": 2060, "ew": 1572},
        "expected": "PASS",
        "desc": "水平误差与垂深误差均在圆形靶区容差内。",
    },
    {
        "id": "ellipse_hit",
        "name": "02 椭圆靶区入靶样本",
        "mode": "evaluate",
        "target": DEFAULT_TARGETS[3],
        "row": {"md": 4260, "inc": 88.5, "azi": 121.8, "tvd": 3428, "ns": 1948, "ew": 1460},
        "expected": "PASS",
        "desc": "落点在椭圆靶区内。",
    },
    {
        "id": "miss_offset",
        "name": "03 未入靶偏差样本",
        "mode": "evaluate",
        "target": DEFAULT_TARGETS[2],
        "row": {"md": 4360, "inc": 86, "azi": 121.8, "tvd": 3565, "ns": 2180, "ew": 1690},
        "expected": "REVIEW",
        "desc": "水平误差与垂深误差超限，应提示复核。",
    },
    {
        "id": "no_go_clear",
        "name": "04 避让区安全样本",
        "mode": "evaluate",
        "target": DEFAULT_TARGETS[6],
        "row": {"md": 4100, "inc": 80, "azi": 119, "tvd": 3350, "ns": 2050, "ew": 1680},
        "expected": "PASS",
        "desc": "轨迹点未进入 No-Go Zone。",
    },
    {
        "id": "line_up_target",
        "name": "05 Line up on Target 样本",
        "mode": "lineUp",
        "target": DEFAULT_TARGETS[2],
        "row": {"md": 4300, "inc": 85, "azi": 118, "tvd": 3450, "ns": 1900, "ew": 1400},
        "expected": "PASS",
        "desc": "按目标点自动计算对准方位。",
    },
    {
        "id": "landing_plane_target",
        "name": "06 Landing Plane 目标样本",
        "mode": "solve",
        "target": DEFAULT_TARGETS[3],
        "row": {"md": 4200, "inc": 86, "azi": 122, "tvd": 3400, "ns": 1870, "ew": 1420},
        "expected": "PASS",
        "desc": "按着陆点目标执行目标驱动求解。",
    },
    {
        "id": "optimum_align_target",
        "name": "07 Optimum Align 目标样本",
        "mode": "solve",
        "target": DEFAULT_TARGETS[4],
        "row": {"md": 4500, "inc": 88, "azi": 121, "tvd": 3500, "ns": 2350, "ew": 1900},
        "expected": "PASS",
        "desc": "Optimum Align 到 PBHL 方向。",
    },
]


def list_target_acceptance_samples() -> List[Dict[str, Any]]:
    return [
        {
            "id": s["id"],
            "name": s["name"],
            "mode": s["mode"],
            "targetId": s["target"]["id"],
            "targetName": s["target"]["name"],
            "expected": s["expected"],
            "desc": s["desc"],
        }
        for s in TARGET_ACCEPTANCE_SAMPLES
    ]


def _sample(sample_id: str) -> Dict[str, Any]:
    for s in TARGET_ACCEPTANCE_SAMPLES:
        if s["id"] == sample_id:
            return dict(s)
    raise KeyError(f"unknown target acceptance sample: {sample_id}")


def run_target_acceptance_sample(sample_id: str, save_dir: str = "data/calibration") -> Dict[str, Any]:
    s = _sample(sample_id)
    mode = s["mode"]
    if mode == "evaluate":
        result = evaluate_target(s["row"], s["target"])
        actual = result["verdict"]
    elif mode == "lineUp":
        result = line_up_target({"row": s["row"], "target": s["target"], "cl": 60.0})
        actual = "PASS" if result.get("ok") and result.get("planningResult", {}).get("previewRow") else "REVIEW"
    else:
        result = solve_to_target({"row": s["row"], "target": s["target"], "method": "optimumAlign", "tangentLength": 300.0})
        actual = "PASS" if result.get("ok") and result.get("planningResult", {}).get("previewRow") else "REVIEW"

    verdict = "PASS" if actual == s["expected"] else "REVIEW"
    report = {
        "ok": True,
        "sampleId": sample_id,
        "sample": {
            "id": s["id"],
            "name": s["name"],
            "mode": s["mode"],
            "targetId": s["target"]["id"],
            "targetName": s["target"]["name"],
            "desc": s["desc"],
        },
        "expectedVerdict": s["expected"],
        "actualVerdict": actual,
        "sampleVerdict": verdict,
        "row": s["row"],
        "target": s["target"],
        "result": result,
        "recommendation": "通过" if verdict == "PASS" else "复核目标约束、靶区半径/椭圆参数或求解器逻辑",
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    if save_dir:
        os.makedirs(save_dir, exist_ok=True)
        path = os.path.join(save_dir, f"target_{sample_id}_report.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        report["savedReport"] = path
    return report


def run_all_target_acceptance_samples(save_dir: str = "data/calibration") -> Dict[str, Any]:
    os.makedirs(save_dir, exist_ok=True)
    reports = [run_target_acceptance_sample(s["id"], save_dir) for s in TARGET_ACCEPTANCE_SAMPLES]
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
            "expectedVerdict": r["expectedVerdict"],
            "actualVerdict": r["actualVerdict"],
            "sampleVerdict": r["sampleVerdict"],
            "recommendation": r["recommendation"],
        })
    report = {
        "ok": True,
        "version": "2.9.7",
        "reportType": "TargetConstraintAcceptanceReport",
        "overallVerdict": "PASS" if review_count == 0 and fail_count == 0 else "REVIEW",
        "totalSamples": len(reports),
        "passCount": pass_count,
        "reviewCount": review_count,
        "failCount": fail_count,
        "samples": rows,
        "reports": reports,
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "note": "Target acceptance line verifies target evaluation, circular/elliptical target, no-go zone, line-up target and target-driven planning.",
    }
    path = os.path.join(save_dir, "target_acceptance_report.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    report["savedReport"] = path
    return report


def latest_target_acceptance_report(path: str = "data/calibration/target_acceptance_report.json") -> Dict[str, Any]:
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return run_all_target_acceptance_samples(os.path.dirname(path) or "data/calibration")


def target_acceptance_csv(report: Dict[str, Any]) -> str:
    buf = io.StringIO()
    fields = ["sampleId", "name", "mode", "targetId", "targetName", "expectedVerdict", "actualVerdict", "sampleVerdict", "recommendation"]
    writer = csv.DictWriter(buf, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for row in report.get("samples", []):
        writer.writerow({k: row.get(k, "") for k in fields})
    return buf.getvalue()
