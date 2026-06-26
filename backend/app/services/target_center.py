
import json
import math
import os
import time
from typing import Any, Dict, List, Optional

from app.services.planning_methods import solve_planning_method

TARGET_LIBRARY_PATH = "data/targets/target_library.json"

DEFAULT_TARGETS: List[Dict[str, Any]] = [
    {
        "id": "surface_location",
        "name": "Surface Location / 井口",
        "type": "surface",
        "tvd": 0.0,
        "ns": 0.0,
        "ew": 0.0,
        "verticalSection": 0.0,
        "radius": 5.0,
        "ellipseMajor": 10.0,
        "ellipseMinor": 10.0,
        "entryInc": 0.0,
        "entryAzi": 0.0,
        "tolerance": 5.0,
        "priority": "reference",
        "enabled": True,
        "remark": "井口参考点",
    },
    {
        "id": "kop",
        "name": "KOP / 造斜点",
        "type": "kop",
        "tvd": 1200.0,
        "ns": 0.0,
        "ew": 0.0,
        "verticalSection": 0.0,
        "radius": 20.0,
        "ellipseMajor": 30.0,
        "ellipseMinor": 20.0,
        "entryInc": 0.0,
        "entryAzi": 110.0,
        "tolerance": 20.0,
        "priority": "design",
        "enabled": True,
        "remark": "Kick-off point",
    },
    {
        "id": "target_center",
        "name": "Target Center / 靶心",
        "type": "target",
        "tvd": 3500.0,
        "ns": 2050.0,
        "ew": 1560.0,
        "verticalSection": 2570.0,
        "radius": 35.0,
        "ellipseMajor": 60.0,
        "ellipseMinor": 35.0,
        "entryInc": 86.0,
        "entryAzi": 121.8,
        "tolerance": 20.0,
        "priority": "primary",
        "enabled": True,
        "remark": "主目标靶区",
    },
    {
        "id": "landing_point",
        "name": "Landing Point / 着陆点",
        "type": "landing",
        "tvd": 3420.0,
        "ns": 1900.0,
        "ew": 1450.0,
        "verticalSection": 2385.0,
        "radius": 30.0,
        "ellipseMajor": 80.0,
        "ellipseMinor": 30.0,
        "entryInc": 88.5,
        "entryAzi": 121.8,
        "tolerance": 15.0,
        "priority": "primary",
        "enabled": True,
        "remark": "水平段着陆约束",
    },
    {
        "id": "pbhl",
        "name": "PBHL / 设计井底",
        "type": "pbhl",
        "tvd": 3550.0,
        "ns": 2800.0,
        "ew": 2300.0,
        "verticalSection": 3600.0,
        "radius": 50.0,
        "ellipseMajor": 100.0,
        "ellipseMinor": 45.0,
        "entryInc": 90.0,
        "entryAzi": 122.0,
        "tolerance": 25.0,
        "priority": "primary",
        "enabled": True,
        "remark": "Planned bottom hole location",
    },
    {
        "id": "lease_line_north",
        "name": "Lease Line North / 北侧边界",
        "type": "leaseLine",
        "tvd": 3500.0,
        "ns": 3150.0,
        "ew": 2300.0,
        "verticalSection": 4000.0,
        "radius": 80.0,
        "ellipseMajor": 200.0,
        "ellipseMinor": 80.0,
        "entryInc": 90.0,
        "entryAzi": 122.0,
        "tolerance": 40.0,
        "priority": "constraint",
        "enabled": True,
        "remark": "边界约束示例",
    },
    {
        "id": "no_go_fault",
        "name": "No-Go Zone / 避让区",
        "type": "noGo",
        "tvd": 3300.0,
        "ns": 1750.0,
        "ew": 1320.0,
        "verticalSection": 2200.0,
        "radius": 120.0,
        "ellipseMajor": 160.0,
        "ellipseMinor": 100.0,
        "entryInc": 0.0,
        "entryAzi": 0.0,
        "tolerance": 50.0,
        "priority": "avoid",
        "enabled": True,
        "remark": "避让区，进入半径内视为风险",
    },
]


def _n(v: Any, default: float = 0.0) -> float:
    try:
        if v is None or v == "":
            return float(default)
        return float(v)
    except Exception:
        return float(default)


def _ensure_dir(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)


def _load(path: str = TARGET_LIBRARY_PATH) -> List[Dict[str, Any]]:
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data.get("targets", DEFAULT_TARGETS)
        if isinstance(data, list):
            return data
    return [dict(t) for t in DEFAULT_TARGETS]


def _save(targets: List[Dict[str, Any]], path: str = TARGET_LIBRARY_PATH) -> Dict[str, Any]:
    _ensure_dir(path)
    payload = {
        "ok": True,
        "version": "2.9.7",
        "targetCount": len(targets),
        "targets": targets,
        "savedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return payload


def list_targets(path: str = TARGET_LIBRARY_PATH) -> Dict[str, Any]:
    targets = _load(path)
    return {
        "ok": True,
        "version": "2.9.7",
        "targetCount": len(targets),
        "targets": targets,
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def get_target(target_id: str, path: str = TARGET_LIBRARY_PATH) -> Dict[str, Any]:
    targets = _load(path)
    for t in targets:
        if str(t.get("id")) == str(target_id):
            return dict(t)
    raise KeyError(f"Target not found: {target_id}")


def upsert_target(payload: Dict[str, Any], path: str = TARGET_LIBRARY_PATH) -> Dict[str, Any]:
    targets = _load(path)
    target = dict(payload or {})
    target_id = str(target.get("id") or f"target_{int(time.time())}")
    target["id"] = target_id
    target.setdefault("enabled", True)
    target.setdefault("type", "target")
    target.setdefault("priority", "design")
    target.setdefault("radius", 30.0)
    target.setdefault("ellipseMajor", target.get("radius", 30.0))
    target.setdefault("ellipseMinor", target.get("radius", 30.0))
    found = False
    for i, t in enumerate(targets):
        if str(t.get("id")) == target_id:
            targets[i] = {**t, **target}
            found = True
            break
    if not found:
        targets.append(target)
    saved = _save(targets, path)
    saved["target"] = target
    return saved


def delete_target(target_id: str, path: str = TARGET_LIBRARY_PATH) -> Dict[str, Any]:
    targets = _load(path)
    before = len(targets)
    targets = [t for t in targets if str(t.get("id")) != str(target_id)]
    saved = _save(targets, path)
    saved["deleted"] = before - len(targets)
    return saved


def _ellipse_value(dx: float, dy: float, major: float, minor: float) -> float:
    major = max(1e-6, abs(major))
    minor = max(1e-6, abs(minor))
    return (dx / major) ** 2 + (dy / minor) ** 2


def evaluate_target(row: Dict[str, Any], target: Dict[str, Any]) -> Dict[str, Any]:
    tvd_error = _n(row.get("tvd", row.get("TVD"))) - _n(target.get("tvd"))
    ns_error = _n(row.get("ns", row.get("NS"))) - _n(target.get("ns"))
    ew_error = _n(row.get("ew", row.get("EW"))) - _n(target.get("ew"))
    horizontal_error = math.sqrt(ns_error ** 2 + ew_error ** 2)
    center_distance_3d = math.sqrt(horizontal_error ** 2 + tvd_error ** 2)
    radius = max(1e-6, _n(target.get("radius"), 30.0))
    tolerance = max(1e-6, _n(target.get("tolerance"), 20.0))
    ellipse_major = max(1e-6, _n(target.get("ellipseMajor"), radius))
    ellipse_minor = max(1e-6, _n(target.get("ellipseMinor"), radius))
    ellipse_value = _ellipse_value(ns_error, ew_error, ellipse_major, ellipse_minor)
    in_circle = horizontal_error <= radius
    in_ellipse = ellipse_value <= 1.0
    tvd_ok = abs(tvd_error) <= tolerance
    is_no_go = target.get("type") == "noGo"
    in_target = (in_circle or in_ellipse) and tvd_ok
    if is_no_go:
        status = "RISK" if in_target else "CLEAR"
        verdict = "REVIEW" if in_target else "PASS"
    else:
        status = "IN_TARGET" if in_target else "MISS"
        verdict = "PASS" if in_target else "REVIEW"

    return {
        "ok": True,
        "targetId": target.get("id"),
        "targetName": target.get("name"),
        "targetType": target.get("type"),
        "row": row,
        "target": target,
        "errors": {
            "tvdError": round(tvd_error, 4),
            "nsError": round(ns_error, 4),
            "ewError": round(ew_error, 4),
            "horizontalError": round(horizontal_error, 4),
            "centerDistance3d": round(center_distance_3d, 4),
            "ellipseValue": round(ellipse_value, 6),
        },
        "limits": {
            "radius": radius,
            "ellipseMajor": ellipse_major,
            "ellipseMinor": ellipse_minor,
            "tolerance": tolerance,
        },
        "checks": {
            "inCircle": in_circle,
            "inEllipse": in_ellipse,
            "tvdOk": tvd_ok,
            "inTarget": in_target,
            "noGoZone": is_no_go,
        },
        "status": status,
        "verdict": verdict,
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def evaluate_targets(payload: Dict[str, Any], path: str = TARGET_LIBRARY_PATH) -> Dict[str, Any]:
    row = payload.get("row") or payload.get("currentRow") or {}
    target_id = payload.get("targetId")
    if target_id:
        targets = [get_target(target_id, path)]
    else:
        targets = [t for t in _load(path) if t.get("enabled", True)]
    evaluations = [evaluate_target(row, t) for t in targets]
    worst = "PASS"
    for e in evaluations:
        if e["verdict"] != "PASS":
            worst = "REVIEW"
            break
    best = None
    target_evals = [e for e in evaluations if e.get("targetType") != "noGo"]
    if target_evals:
        best = min(target_evals, key=lambda e: e["errors"]["centerDistance3d"])
    return {
        "ok": True,
        "overallVerdict": worst,
        "row": row,
        "targetCount": len(evaluations),
        "bestTarget": best,
        "evaluations": evaluations,
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def _target_azimuth(row: Dict[str, Any], target: Dict[str, Any]) -> float:
    dns = _n(target.get("ns")) - _n(row.get("ns", row.get("NS")))
    dew = _n(target.get("ew")) - _n(row.get("ew", row.get("EW")))
    if abs(dns) + abs(dew) < 1e-9:
        return _n(row.get("azi", row.get("AZI")))
    return (math.degrees(math.atan2(dew, dns)) + 360.0) % 360.0


def line_up_target(payload: Dict[str, Any], path: str = TARGET_LIBRARY_PATH) -> Dict[str, Any]:
    row = payload.get("currentRow") or payload.get("row") or {}
    target = payload.get("target") or get_target(payload.get("targetId", "target_center"), path)
    azi = _target_azimuth(row, target)
    params = {
        "sectionType": "lineUpOnTarget",
        "md": _n(row.get("md", row.get("MD"))) + _n(payload.get("cl"), 60.0),
        "inc": _n(payload.get("inc"), _n(target.get("entryInc"), _n(row.get("inc", row.get("INC"))))),
        "azi": azi,
        "targetTvd": _n(target.get("tvd")),
        "targetNs": _n(target.get("ns")),
        "targetEw": _n(target.get("ew")),
    }
    result = solve_planning_method({
        "method": "nudge",
        "sectionType": "lineUpOnTarget",
        "currentRow": row,
        "params": params,
    })
    return {
        "ok": result.get("ok", False),
        "target": target,
        "lineUpAzi": round(azi, 4),
        "planningParams": params,
        "planningResult": result,
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def solve_to_target(payload: Dict[str, Any], path: str = TARGET_LIBRARY_PATH) -> Dict[str, Any]:
    row = payload.get("currentRow") or payload.get("row") or {}
    target = payload.get("target") or get_target(payload.get("targetId", "target_center"), path)
    method = payload.get("method", "optimumAlign")
    tangent = _n(payload.get("tangentLength"), 300.0)
    params = {
        "alignType": payload.get("alignType", "curveHoldCurve"),
        "doglegs": _n(payload.get("doglegs"), 2.0),
        "tangentLength": tangent,
        "targetTvd": _n(target.get("tvd")),
        "targetNs": _n(target.get("ns")),
        "targetEw": _n(target.get("ew")),
        "targetInc": _n(target.get("entryInc"), _n(row.get("inc", row.get("INC")))),
        "targetAzi": _n(target.get("entryAzi"), _target_azimuth(row, target)),
    }
    result = solve_planning_method({
        "method": method,
        "sectionType": "lineUpOnTarget",
        "currentRow": row,
        "params": params,
    })
    eval_result = None
    if result.get("previewRow"):
        eval_result = evaluate_target(result["previewRow"], target)
    return {
        "ok": result.get("ok", False),
        "target": target,
        "method": method,
        "planningParams": params,
        "planningResult": result,
        "evaluation": eval_result,
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def save_default_targets(path: str = TARGET_LIBRARY_PATH) -> Dict[str, Any]:
    return _save([dict(t) for t in DEFAULT_TARGETS], path)
