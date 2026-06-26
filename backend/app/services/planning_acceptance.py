
import csv
import io
import json
import os
import time
from typing import Any, Dict, List

from app.services.planning_methods import solve_planning_method

PLANNING_ACCEPTANCE_SAMPLES: List[Dict[str, Any]] = [
    {
        "id": "dogleg_toolface_standard",
        "name": "01 Dogleg Toolface 标准样本",
        "method": "doglegToolface",
        "sectionType": "incAziMd",
        "expectedRows": 1,
        "expectedStatus": "READY",
        "desc": "DLS/TFO 推进一段轨迹。",
        "currentRow": {"md": 3000, "inc": 45, "azi": 120, "tvd": 2500, "ns": 900, "ew": 600},
        "params": {"dls": 2.0, "tfo": 105, "using": "DLS", "cl": 30, "sectionType": "incAziMd"},
    },
    {
        "id": "build_turn_standard",
        "name": "02 Build Turn 标准样本",
        "method": "buildTurn",
        "sectionType": "incAziMd",
        "expectedRows": 1,
        "expectedStatus": "READY",
        "desc": "Build 与 Turn 同步推进。",
        "currentRow": {"md": 3200, "inc": 50, "azi": 118, "tvd": 2600, "ns": 980, "ew": 680},
        "params": {"build": 1.5, "turn": -1.0, "cl": 60, "sectionType": "incAziMd"},
    },
    {
        "id": "hold_to_md",
        "name": "03 Hold to MD 样本",
        "method": "hold",
        "sectionType": "incAziMd",
        "expectedRows": 1,
        "expectedStatus": "READY",
        "desc": "保持当前井斜方位到指定 MD。",
        "currentRow": {"md": 3500, "inc": 62, "azi": 121.5, "tvd": 2800, "ns": 1200, "ew": 820},
        "params": {"holdMode": "md", "md": 3700, "sectionType": "incAziMd"},
    },
    {
        "id": "hold_to_tvd",
        "name": "04 Hold to TVD 样本",
        "method": "hold",
        "sectionType": "tvdIncAzi",
        "expectedRows": 1,
        "expectedStatus": "READY",
        "desc": "保持当前井斜方位到指定 TVD。",
        "currentRow": {"md": 3500, "inc": 50, "azi": 121.5, "tvd": 2800, "ns": 1200, "ew": 820},
        "params": {"holdMode": "tvd", "tvd": 2920, "sectionType": "tvdIncAzi"},
    },
    {
        "id": "slant_standard",
        "name": "05 Slant 样本",
        "method": "slant",
        "sectionType": "incAziMd",
        "expectedRows": 3,
        "expectedStatus": "READY",
        "desc": "Slant 多段规划：Hold + Build + Hold。",
        "currentRow": {"md": 1000, "inc": 0, "azi": 110, "tvd": 1000, "ns": 0, "ew": 0},
        "params": {"firstHoldLen": 300, "firstBuild": 2.0, "maxAngle": 30, "secondHoldLen": 500, "sectionType": "incAziMd"},
    },
    {
        "id": "s_well_standard",
        "name": "06 S Well 样本",
        "method": "sWell",
        "sectionType": "incAziMd",
        "expectedRows": 5,
        "expectedStatus": "READY",
        "desc": "S Well 多段规划：Hold + Build + Hold + Drop + Hold。",
        "currentRow": {"md": 700, "inc": 0, "azi": 95, "tvd": 700, "ns": 0, "ew": 0},
        "params": {"firstHoldLen": 250, "firstBuild": 2.5, "maxAngle": 38, "secondHoldLen": 600, "secondBuild": 2.0, "finalInc": 8, "finalHold": 400, "sectionType": "incAziMd"},
    },
    {
        "id": "nudge_md_inc_azi",
        "name": "07 Nudge MD/INC/AZI 样本",
        "method": "nudge",
        "sectionType": "incAziMd",
        "expectedRows": 1,
        "expectedStatus": "READY",
        "desc": "Nudge 标准 Section Type：Inc Azi MD。",
        "currentRow": {"md": 4000, "inc": 70, "azi": 122, "tvd": 3300, "ns": 1800, "ew": 1400},
        "params": {"sectionType": "incAziMd", "md": 4060, "inc": 72, "azi": 124},
    },
    {
        "id": "landing_plane",
        "name": "08 Landing Plane 样本",
        "method": "nudge",
        "sectionType": "landingPlane",
        "expectedRows": 1,
        "expectedStatus": "READY",
        "desc": "按着陆平面倾角和方向求解。",
        "currentRow": {"md": 4200, "inc": 86, "azi": 122, "tvd": 3400, "ns": 1900, "ew": 1450},
        "params": {"sectionType": "landingPlane", "md": 4260, "dipAngle": 88.5, "direction": 121.8},
    },
    {
        "id": "line_up_target",
        "name": "09 Line up on Target 样本",
        "method": "nudge",
        "sectionType": "lineUpOnTarget",
        "expectedRows": 1,
        "expectedStatus": "READY",
        "desc": "按目标点方位自动对齐。",
        "currentRow": {"md": 4300, "inc": 85, "azi": 118, "tvd": 3500, "ns": 1900, "ew": 1400},
        "params": {"sectionType": "lineUpOnTarget", "md": 4360, "inc": 86, "targetTvd": 3520, "targetNs": 2050, "targetEw": 1560},
    },
]

def list_planning_samples() -> List[Dict[str, Any]]:
    return [
        {
            "id": s["id"],
            "name": s["name"],
            "method": s["method"],
            "sectionType": s["sectionType"],
            "expectedRows": s["expectedRows"],
            "expectedStatus": s["expectedStatus"],
            "desc": s["desc"],
        }
        for s in PLANNING_ACCEPTANCE_SAMPLES
    ]

def _sample(sample_id: str) -> Dict[str, Any]:
    for s in PLANNING_ACCEPTANCE_SAMPLES:
        if s["id"] == sample_id:
            return dict(s)
    raise KeyError(f"unknown planning sample: {sample_id}")

def _row_ok(row: Dict[str, Any]) -> bool:
    if not row:
        return False
    if row.get("md", 0) < 0:
        return False
    if row.get("inc", 0) < 0 or row.get("inc", 0) > 180:
        return False
    return True

def run_planning_sample(sample_id: str, save_dir: str = "data/calibration") -> Dict[str, Any]:
    s = _sample(sample_id)
    result = solve_planning_method({
        "method": s["method"],
        "sectionType": s["sectionType"],
        "currentRow": s["currentRow"],
        "params": s["params"],
    })
    rows = result.get("rows", [])
    row_count = len(rows)
    errors = []
    if result.get("status") != s["expectedStatus"]:
        errors.append(f"status={result.get('status')} expected={s['expectedStatus']}")
    if row_count != s["expectedRows"]:
        errors.append(f"rowCount={row_count} expected={s['expectedRows']}")
    if not all(_row_ok(r) for r in rows):
        errors.append("invalid row geometry")
    if result.get("diagnostics", {}).get("errors"):
        errors.extend(result["diagnostics"]["errors"])

    verdict = "PASS" if not errors else "REVIEW"
    report = {
        "ok": True,
        "sampleId": sample_id,
        "sample": {k: s[k] for k in ["id", "name", "method", "sectionType", "desc"]},
        "sampleVerdict": verdict,
        "expectedRows": s["expectedRows"],
        "actualRows": row_count,
        "expectedStatus": s["expectedStatus"],
        "actualStatus": result.get("status"),
        "method": s["method"],
        "sectionType": s["sectionType"],
        "previewRow": result.get("previewRow"),
        "rows": rows,
        "diagnostics": result.get("diagnostics", {}),
        "errors": errors,
        "recommendation": "通过" if verdict == "PASS" else "复核规划参数、Section Type 或后端求解逻辑",
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    if save_dir:
        os.makedirs(save_dir, exist_ok=True)
        path = os.path.join(save_dir, f"planning_{sample_id}_report.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        report["savedReport"] = path
    return report

def run_all_planning_samples(save_dir: str = "data/calibration") -> Dict[str, Any]:
    os.makedirs(save_dir, exist_ok=True)
    reports = [run_planning_sample(s["id"], save_dir=save_dir) for s in PLANNING_ACCEPTANCE_SAMPLES]
    pass_count = sum(1 for r in reports if r["sampleVerdict"] == "PASS")
    review_count = sum(1 for r in reports if r["sampleVerdict"] == "REVIEW")
    fail_count = sum(1 for r in reports if r["sampleVerdict"] == "FAILED")
    rows = []
    for r in reports:
        rows.append({
            "sampleId": r["sampleId"],
            "name": r["sample"]["name"],
            "method": r["method"],
            "sectionType": r["sectionType"],
            "expectedRows": r["expectedRows"],
            "actualRows": r["actualRows"],
            "expectedStatus": r["expectedStatus"],
            "actualStatus": r["actualStatus"],
            "sampleVerdict": r["sampleVerdict"],
            "recommendation": r["recommendation"],
        })
    report = {
        "ok": True,
        "version": "2.9.6",
        "reportType": "PlanningMethodsAcceptanceReport",
        "overallVerdict": "PASS" if review_count == 0 and fail_count == 0 else "REVIEW",
        "totalSamples": len(reports),
        "passCount": pass_count,
        "reviewCount": review_count,
        "failCount": fail_count,
        "samples": rows,
        "reports": reports,
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "note": "Planning acceptance line verifies Slant, S Well, Build Turn, Dogleg Toolface, Hold, Optimum Align/Nudge and Section Type workflows.",
    }
    path = os.path.join(save_dir, "planning_acceptance_report.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    report["savedReport"] = path
    return report

def latest_planning_acceptance_report(path: str = "data/calibration/planning_acceptance_report.json") -> Dict[str, Any]:
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return run_all_planning_samples(os.path.dirname(path) or "data/calibration")

def planning_acceptance_csv(report: Dict[str, Any]) -> str:
    buf = io.StringIO()
    fields = ["sampleId", "name", "method", "sectionType", "expectedRows", "actualRows", "expectedStatus", "actualStatus", "sampleVerdict", "recommendation"]
    writer = csv.DictWriter(buf, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for row in report.get("samples", []):
        writer.writerow({k: row.get(k, "") for k in fields})
    return buf.getvalue()
