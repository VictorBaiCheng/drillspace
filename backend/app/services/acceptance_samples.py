import csv
import io
import json
import math
import os
import time
from typing import Any, Dict, List

from app.services.wellpath_engine import minimum_curvature, n
from app.services.mydrill_calibration import compare_reference, rows_to_csv

SAMPLE_META: List[Dict[str, Any]] = [
    {
        "id": "vertical_well",
        "name": "01 直井样本",
        "type": "Trajectory",
        "level": "basic",
        "desc": "用于验证零井斜、垂深等于测深、横向位移接近零的基础链路。",
        "expectedVerdict": "PASS",
    },
    {
        "id": "j_well",
        "name": "02 J形井样本",
        "type": "Trajectory",
        "level": "standard",
        "desc": "直井段 + 一段增斜 + 稳斜段，用于验证常规J形井轨迹计算。",
        "expectedVerdict": "PASS",
    },
    {
        "id": "s_well",
        "name": "03 S形井样本",
        "type": "Trajectory",
        "level": "standard",
        "desc": "增斜、稳斜、降斜组合，用于验证Build/Turn和DLS连续性。",
        "expectedVerdict": "PASS",
    },
    {
        "id": "horizontal_well",
        "name": "04 水平井样本",
        "type": "Trajectory",
        "level": "standard",
        "desc": "高井斜水平井样本，用于验证长水平段TVD/NS/EW累计误差。",
        "expectedVerdict": "PASS",
    },
    {
        "id": "high_dogleg",
        "name": "05 大狗腿风险样本",
        "type": "Risk",
        "level": "review",
        "desc": "局部井斜/方位变化较大，用于触发DLS/Build/Turn审查。",
        "expectedVerdict": "REVIEW",
    },
    {
        "id": "collision_nearby",
        "name": "06 防碰近邻井样本",
        "type": "Collision",
        "level": "standard",
        "desc": "当前井与邻井接近的轨迹样本，用于后续防碰扫描验收联动。",
        "expectedVerdict": "PASS",
    },
]

def sample_ids() -> List[str]:
    return [m["id"] for m in SAMPLE_META]

def get_meta(sample_id: str) -> Dict[str, Any]:
    for m in SAMPLE_META:
        if m["id"] == sample_id:
            return dict(m)
    raise KeyError(f"unknown sample_id: {sample_id}")

def _linear_rows(points: List[Dict[str, float]], step: float = 120.0) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        md0, md1 = a["md"], b["md"]
        nseg = max(1, int(round((md1 - md0) / step)))
        for j in range(nseg):
            t = j / nseg
            md = md0 + (md1 - md0) * t
            if out and abs(md - out[-1]["md"]) < 1e-9:
                continue
            out.append({
                "type": "样本点",
                "md": round(md, 3),
                "inc": round(a["inc"] + (b["inc"] - a["inc"]) * t, 4),
                "azi": round(a["azi"] + (b["azi"] - a["azi"]) * t, 4),
                "remark": "acceptance-sample",
            })
    out.append({"type": "终点", "md": points[-1]["md"], "inc": points[-1]["inc"], "azi": points[-1]["azi"], "remark": "target"})
    return out

def input_rows(sample_id: str) -> List[Dict[str, Any]]:
    if sample_id == "vertical_well":
        return [{"type": "直井", "md": md, "inc": 0, "azi": 0, "remark": "vertical"} for md in range(0, 3601, 300)]
    if sample_id == "j_well":
        return _linear_rows([
            {"md": 0, "inc": 0, "azi": 118},
            {"md": 900, "inc": 0, "azi": 118},
            {"md": 1700, "inc": 28, "azi": 118},
            {"md": 3300, "inc": 28, "azi": 118},
            {"md": 4200, "inc": 32, "azi": 118},
        ], step=120)
    if sample_id == "s_well":
        return _linear_rows([
            {"md": 0, "inc": 0, "azi": 96},
            {"md": 700, "inc": 0, "azi": 96},
            {"md": 1500, "inc": 38, "azi": 102},
            {"md": 2400, "inc": 38, "azi": 108},
            {"md": 3300, "inc": 12, "azi": 112},
            {"md": 4300, "inc": 8, "azi": 112},
        ], step=120)
    if sample_id == "horizontal_well":
        return _linear_rows([
            {"md": 0, "inc": 0, "azi": 121.5},
            {"md": 800, "inc": 0, "azi": 121.5},
            {"md": 1800, "inc": 35, "azi": 121.5},
            {"md": 2600, "inc": 68, "azi": 121.5},
            {"md": 3200, "inc": 88.5, "azi": 121.5},
            {"md": 5600, "inc": 89.0, "azi": 121.8},
        ], step=100)
    if sample_id == "high_dogleg":
        return _linear_rows([
            {"md": 0, "inc": 0, "azi": 75},
            {"md": 600, "inc": 4, "azi": 75},
            {"md": 980, "inc": 26, "azi": 120},
            {"md": 1180, "inc": 42, "azi": 168},
            {"md": 1700, "inc": 46, "azi": 174},
            {"md": 2500, "inc": 22, "azi": 140},
            {"md": 3100, "inc": 15, "azi": 136},
        ], step=80)
    if sample_id == "collision_nearby":
        return _linear_rows([
            {"md": 0, "inc": 0, "azi": 121.5},
            {"md": 650, "inc": 0, "azi": 121.5},
            {"md": 1450, "inc": 20, "azi": 121.5},
            {"md": 2600, "inc": 47, "azi": 121.5},
            {"md": 3900, "inc": 62, "azi": 121.5},
            {"md": 5200, "inc": 62, "azi": 121.5},
        ], step=100)
    raise KeyError(f"unknown sample_id: {sample_id}")

def _canonical_result_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "MD": row.get("md", row.get("MD", 0)),
        "INC": row.get("inc", row.get("INC", 0)),
        "AZI": row.get("azi", row.get("AZI", 0)),
        "CL": row.get("cl", row.get("CL", 0)),
        "TVD": row.get("tvd", row.get("TVD", 0)),
        "NS": row.get("ns", row.get("NS", 0)),
        "EW": row.get("ew", row.get("EW", 0)),
        "VSEC": row.get("vsec", row.get("VSEC", 0)),
        "DOGLEG": row.get("dogleg", row.get("DOGLEG", row.get("Dogleg", 0))),
        "TF": row.get("tf", row.get("TF", 0)),
        "BUILD": row.get("build", row.get("BUILD", row.get("Build", 0))),
        "TURN": row.get("turn", row.get("TURN", row.get("Turn", 0))),
    }

def drillspace_result(sample_id: str) -> List[Dict[str, Any]]:
    return minimum_curvature(input_rows(sample_id))

def mydrill_reference_like(sample_id: str) -> List[Dict[str, Any]]:
    base = [_canonical_result_row(r) for r in drillspace_result(sample_id)]
    # Deterministic tiny perturbation simulating exported MyDrill-like reference.
    # It is intentionally small for PASS samples and larger for high_dogleg to exercise REVIEW.
    out: List[Dict[str, Any]] = []
    review = sample_id == "high_dogleg"
    for i, r in enumerate(base):
        rr = dict(r)
        phase = i + 1
        rr["TVD"] = round(rr["TVD"] + math.sin(phase / 3) * (0.018 if not review else 0.09), 6)
        rr["NS"] = round(rr["NS"] + math.cos(phase / 4) * (0.020 if not review else 0.11), 6)
        rr["EW"] = round(rr["EW"] + math.sin(phase / 5) * (0.020 if not review else 0.10), 6)
        rr["VSEC"] = round(rr["VSEC"] + math.sin(phase / 6) * (0.018 if not review else 0.08), 6)
        rr["DOGLEG"] = round(rr["DOGLEG"] + math.sin(phase / 2) * (0.006 if not review else 0.045), 6)
        rr["BUILD"] = round(rr["BUILD"] + math.cos(phase / 3) * (0.005 if not review else 0.040), 6)
        rr["TURN"] = round(rr["TURN"] + math.sin(phase / 4) * (0.004 if not review else 0.035), 6)
        out.append(rr)
    return out

def sample_payload(sample_id: str) -> Dict[str, Any]:
    meta = get_meta(sample_id)
    inp = input_rows(sample_id)
    result = [_canonical_result_row(r) for r in drillspace_result(sample_id)]
    reference = mydrill_reference_like(sample_id)
    return {
        "meta": meta,
        "inputRows": inp,
        "drillspaceResult": result,
        "mydrillReferenceLike": reference,
        "referenceCsv": rows_to_csv(reference),
    }

def calibrate_sample(sample_id: str, save_dir: str = "data/calibration") -> Dict[str, Any]:
    payload = sample_payload(sample_id)
    report = compare_reference(
        payload["mydrillReferenceLike"],
        input_rows=payload["inputRows"],
        save_dir=save_dir,
    )
    report["sample"] = payload["meta"]
    report["sampleId"] = sample_id
    report["reference"] = f"{payload['meta']['name']} / MyDrill-like acceptance reference"
    report["sourceType"] = "generated_acceptance_sample"
    return report

def list_samples() -> List[Dict[str, Any]]:
    return [dict(m) for m in SAMPLE_META]

def sample_csv(sample_id: str, kind: str = "reference") -> str:
    payload = sample_payload(sample_id)
    if kind == "input":
        rows = payload["inputRows"]
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=["MD", "INC", "AZI"], lineterminator="\n")
        writer.writeheader()
        for r in rows:
            writer.writerow({"MD": r["md"], "INC": r["inc"], "AZI": r["azi"]})
        return buf.getvalue()
    if kind == "drillspace":
        return rows_to_csv(payload["drillspaceResult"])
    return rows_to_csv(payload["mydrillReferenceLike"])

def write_sample_files(output_dir: str = "sample_data/acceptance") -> Dict[str, Any]:
    os.makedirs(output_dir, exist_ok=True)
    written: List[str] = []
    reports: List[str] = []
    for meta in SAMPLE_META:
        sid = meta["id"]
        sample_dir = os.path.join(output_dir, sid)
        os.makedirs(sample_dir, exist_ok=True)
        files = {
            "input_md_inc_azi.csv": sample_csv(sid, "input"),
            "drillspace_result.csv": sample_csv(sid, "drillspace"),
            "mydrill_reference_like.csv": sample_csv(sid, "reference"),
        }
        for name, text in files.items():
            path = os.path.join(sample_dir, name)
            with open(path, "w", encoding="utf-8-sig") as f:
                f.write(text)
            written.append(path)
        report = calibrate_sample(sid, save_dir=sample_dir)
        report_path = os.path.join(sample_dir, "calibration_report.json")
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        reports.append(report_path)
    index_path = os.path.join(output_dir, "sample_index.json")
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(SAMPLE_META, f, ensure_ascii=False, indent=2)
    return {"ok": True, "written": written, "reports": reports, "index": index_path}
