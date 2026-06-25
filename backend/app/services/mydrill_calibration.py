import csv
import io
import json
import math
import os
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

from app.services.wellpath_engine import minimum_curvature, n, source_rows_from_payload

CALIBRATION_COLUMNS = [
    "MD", "INC", "AZI", "CL", "TVD", "NS", "EW", "VSEC", "DOGLEG", "TF", "BUILD", "TURN"
]

COLUMN_ALIASES = {
    "MD": ["md", "measureddepth", "measured_depth", "测深", "井深"],
    "INC": ["inc", "inclination", "井斜", "井斜角"],
    "AZI": ["azi", "azimuth", "方位", "方位角"],
    "CL": ["cl", "course", "course_length", "段长"],
    "TVD": ["tvd", "trueverticaldepth", "垂深"],
    "NS": ["ns", "northsouth", "north_south", "n/s", "南北"],
    "EW": ["ew", "eastwest", "east_west", "e/w", "东西"],
    "VSEC": ["vsec", "v.section", "v_sec", "垂直剖面"],
    "DOGLEG": ["dogleg", "dls", "狗腿", "狗腿度"],
    "TF": ["tf", "toolface", "工具面"],
    "BUILD": ["build", "buildrate", "造斜率"],
    "TURN": ["turn", "turnrate", "偏转率"],
}

DEFAULT_TOLERANCE = {
    "CL": 1.0e-3,
    "TVD": 5.0e-2,
    "NS": 5.0e-2,
    "EW": 5.0e-2,
    "VSEC": 5.0e-2,
    "DOGLEG": 2.0e-2,
    "TF": 2.0e-1,
    "BUILD": 2.0e-2,
    "TURN": 2.0e-2,
}

COMPARE_COLUMNS = ["CL", "TVD", "NS", "EW", "VSEC", "DOGLEG", "TF", "BUILD", "TURN"]

def _key(s: str) -> str:
    return "".join(ch for ch in str(s).lower() if ch.isalnum() or ch in ["/"])

def normalize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    lookup = {_key(k): v for k, v in row.items()}
    out: Dict[str, Any] = {}
    for canonical, aliases in COLUMN_ALIASES.items():
        found = None
        for a in [canonical] + aliases:
            kk = _key(a)
            if kk in lookup:
                found = lookup[kk]
                break
        if found is not None:
            out[canonical] = n(found)
    # lower-case fields for engine
    if "MD" in out: out["md"] = out["MD"]
    if "INC" in out: out["inc"] = out["INC"]
    if "AZI" in out: out["azi"] = out["AZI"]
    if "TVD" in out: out["tvd"] = out["TVD"]
    if "NS" in out: out["ns"] = out["NS"]
    if "EW" in out: out["ew"] = out["EW"]
    return out

def normalize_rows(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = [normalize_row(r) for r in rows or []]
    return sorted([r for r in out if "MD" in r or "md" in r], key=lambda r: n(r.get("MD", r.get("md", 0))))

def parse_csv_text(text: str) -> List[Dict[str, Any]]:
    text = text.replace("\ufeff", "")
    sample = text[:2048]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t; ")
        delimiter = dialect.delimiter
    except Exception:
        delimiter = "," if "," in sample else "\t"
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    return [dict(row) for row in reader]

def rows_to_csv(rows: List[Dict[str, Any]]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CALIBRATION_COLUMNS, lineterminator="\n")
    writer.writeheader()
    for r in rows:
        nr = normalize_row(r)
        writer.writerow({c: nr.get(c, nr.get(c.lower(), "")) for c in CALIBRATION_COLUMNS})
    return buf.getvalue()

def align_by_md(reference: List[Dict[str, Any]], candidate: List[Dict[str, Any]], md_tol: float = 1.0e-6) -> List[Tuple[Dict[str, Any], Dict[str, Any]]]:
    cand_by_md = {round(n(r.get("MD", r.get("md", 0))), 6): r for r in candidate}
    pairs = []
    for ref in reference:
        md = round(n(ref.get("MD", ref.get("md", 0))), 6)
        cand = cand_by_md.get(md)
        if cand is None:
            # nearest fallback
            cand = min(candidate, key=lambda x: abs(n(x.get("MD", x.get("md", 0))) - md)) if candidate else None
        if cand is not None and abs(n(cand.get("MD", cand.get("md", 0))) - md) <= max(md_tol, 1.0e-3):
            pairs.append((ref, cand))
    return pairs

def _get_col(row: Dict[str, Any], col: str) -> Optional[float]:
    if col in row:
        return n(row[col])
    lower = col.lower()
    if lower in row:
        return n(row[lower])
    alias = {"DOGLEG": "dogleg", "BUILD": "build", "TURN": "turn", "TF": "tf", "VSEC": "vsec"}
    if col in alias and alias[col] in row:
        return n(row[alias[col]])
    return None

def compute_metrics(pairs: List[Tuple[Dict[str, Any], Dict[str, Any]]], columns: List[str]) -> Dict[str, Dict[str, float]]:
    metrics: Dict[str, Dict[str, float]] = {}
    for col in columns:
        errors = []
        for ref, cand in pairs:
            rv = _get_col(ref, col)
            cv = _get_col(cand, col)
            if rv is None or cv is None:
                continue
            errors.append(cv - rv)
        if not errors:
            metrics[col] = {"count": 0, "meanError": 0.0, "meanAbs": 0.0, "maxAbs": 0.0, "rmse": 0.0}
            continue
        metrics[col] = {
            "count": len(errors),
            "meanError": round(sum(errors) / len(errors), 9),
            "meanAbs": round(sum(abs(e) for e in errors) / len(errors), 9),
            "maxAbs": round(max(abs(e) for e in errors), 9),
            "rmse": round(math.sqrt(sum(e * e for e in errors) / len(errors)), 9),
        }
    return metrics

def row_errors(pairs: List[Tuple[Dict[str, Any], Dict[str, Any]]], columns: List[str], limit: int = 500) -> List[Dict[str, Any]]:
    rows = []
    for i, (ref, cand) in enumerate(pairs[:limit]):
        item: Dict[str, Any] = {
            "index": i + 1,
            "MD": n(ref.get("MD", ref.get("md", 0))),
        }
        for col in columns:
            rv = _get_col(ref, col)
            cv = _get_col(cand, col)
            if rv is None or cv is None:
                continue
            item[f"{col}_ref"] = round(rv, 9)
            item[f"{col}_fastapi"] = round(cv, 9)
            item[f"{col}_err"] = round(cv - rv, 9)
        rows.append(item)
    return rows

def compare_reference(reference_rows: List[Dict[str, Any]],
                      input_rows: Optional[List[Dict[str, Any]]] = None,
                      tolerance: Optional[Dict[str, float]] = None,
                      save_dir: Optional[str] = None) -> Dict[str, Any]:
    ref = normalize_rows(reference_rows)
    if not input_rows:
        # Reference rows usually include MD/INC/AZI too. Use them as input.
        input_rows = [{"md": r.get("MD", r.get("md", 0)), "inc": r.get("INC", r.get("inc", 0)), "azi": r.get("AZI", r.get("azi", 0))} for r in ref]
    candidate = minimum_curvature(input_rows)
    # Normalize candidate to canonical uppercase too.
    cand_norm = []
    for c in candidate:
        cc = dict(c)
        cc.update({
            "MD": c.get("md", c.get("MD", 0)),
            "INC": c.get("inc", c.get("INC", 0)),
            "AZI": c.get("azi", c.get("AZI", 0)),
            "CL": c.get("cl", c.get("CL", 0)),
            "TVD": c.get("tvd", c.get("TVD", 0)),
            "NS": c.get("ns", c.get("NS", 0)),
            "EW": c.get("ew", c.get("EW", 0)),
            "VSEC": c.get("vsec", c.get("VSEC", 0)),
            "DOGLEG": c.get("dogleg", c.get("Dogleg", 0)),
            "TF": c.get("tf", c.get("TF", 0)),
            "BUILD": c.get("build", c.get("Build", 0)),
            "TURN": c.get("turn", c.get("Turn", 0)),
        })
        cand_norm.append(cc)

    pairs = align_by_md(ref, cand_norm)
    tol = {**DEFAULT_TOLERANCE, **(tolerance or {})}
    metrics = compute_metrics(pairs, COMPARE_COLUMNS)
    exceeded = {
        col: {"maxAbs": metrics[col]["maxAbs"], "tolerance": tol.get(col)}
        for col in COMPARE_COLUMNS
        if metrics.get(col, {}).get("count", 0) and metrics[col]["maxAbs"] > tol.get(col, float("inf"))
    }
    verdict = "PASS" if not exceeded and pairs else "REVIEW"
    report = {
        "ok": True,
        "verdict": verdict,
        "engine": "FastAPI minimum-curvature-v2.8.9",
        "reference": "MyDrill/well-path DLL exported result",
        "stationCount": len(pairs),
        "referenceCount": len(ref),
        "candidateCount": len(cand_norm),
        "tolerance": tol,
        "metrics": metrics,
        "exceeded": exceeded,
        "rowErrors": row_errors(pairs, COMPARE_COLUMNS, limit=500),
        "note": "Direct DLL/JNI execution is optional. This report aligns FastAPI result against MyDrill DLL exported CSV/reference rows.",
    }

    if save_dir:
        os.makedirs(save_dir, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        path = os.path.join(save_dir, f"mydrill_alignment_report_{ts}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        report["savedReport"] = path
    return report

def sample_reference_rows() -> List[Dict[str, Any]]:
    input_rows = [
        {"md": 0, "inc": 0, "azi": 121.5},
        {"md": 432, "inc": 0, "azi": 121.5},
        {"md": 1250, "inc": 8.5, "azi": 121.5},
        {"md": 2680, "inc": 32, "azi": 121.5},
        {"md": 3180, "inc": 32, "azi": 121.5},
        {"md": 4320, "inc": 32, "azi": 121.5},
        {"md": 5320, "inc": 10, "azi": 121.5},
    ]
    rows = minimum_curvature(input_rows)
    ref = []
    for r in rows:
        ref.append({
            "MD": r["md"], "INC": r["inc"], "AZI": r["azi"], "CL": r["cl"],
            "TVD": r["tvd"], "NS": r["ns"], "EW": r["ew"], "VSEC": r["vsec"],
            "DOGLEG": r["dogleg"], "TF": r["tf"], "BUILD": r["build"], "TURN": r["turn"],
        })
    return ref
