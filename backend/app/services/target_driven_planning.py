
import json
import math
import os
import time
from typing import Any, Dict, List, Tuple

from app.services.planning_methods import solve_planning_method
from app.services.target_center import evaluate_target, get_target


def _n(v: Any, default: float = 0.0) -> float:
    try:
        if v is None or v == "":
            return float(default)
        return float(v)
    except Exception:
        return float(default)


def _azimuth(row: Dict[str, Any], target: Dict[str, Any]) -> float:
    dns = _n(target.get("ns")) - _n(row.get("ns", row.get("NS")))
    dew = _n(target.get("ew")) - _n(row.get("ew", row.get("EW")))
    if abs(dns) + abs(dew) < 1e-9:
        return _n(row.get("azi", row.get("AZI")))
    return (math.degrees(math.atan2(dew, dns)) + 360.0) % 360.0


def _horizontal_distance(row: Dict[str, Any], target: Dict[str, Any]) -> float:
    dns = _n(target.get("ns")) - _n(row.get("ns", row.get("NS")))
    dew = _n(target.get("ew")) - _n(row.get("ew", row.get("EW")))
    return math.sqrt(dns * dns + dew * dew)


def _vertical_distance(row: Dict[str, Any], target: Dict[str, Any]) -> float:
    return _n(target.get("tvd")) - _n(row.get("tvd", row.get("TVD")))


def _target_dict(payload: Dict[str, Any], path: str) -> Dict[str, Any]:
    if payload.get("target"):
        return dict(payload["target"])
    return get_target(payload.get("targetId", "target_center"), path)


def recommend_target_method(payload: Dict[str, Any], path: str = "data/targets/target_library.json") -> Dict[str, Any]:
    row = payload.get("currentRow") or payload.get("row") or {}
    target = _target_dict(payload, path)

    hd = _horizontal_distance(row, target)
    vd = _vertical_distance(row, target)
    target_azi = _azimuth(row, target)
    current_inc = _n(row.get("inc", row.get("INC")))
    current_azi = _n(row.get("azi", row.get("AZI")))
    entry_inc = _n(target.get("entryInc"), current_inc)
    entry_azi = _n(target.get("entryAzi"), target_azi)
    radius = max(1.0, _n(target.get("radius"), 30.0))

    azi_delta = abs((target_azi - current_azi + 180.0) % 360.0 - 180.0)
    method = "optimumAlign"
    reason = "default target alignment"
    cl = max(30.0, min(600.0, math.sqrt(hd * hd + vd * vd) * 0.35))
    dls = 2.0
    tfo = 0.0

    if target.get("type") == "landing":
        method = "nudge"
        section_type = "landingPlane"
        reason = "landing target requires Landing Plane control"
        cl = max(30.0, min(200.0, hd * 0.25))
        target_inc = _n(target.get("entryInc"), 88.0)
        target_azi_out = _n(target.get("entryAzi"), target_azi)
    elif target.get("type") == "pbhl":
        method = "optimumAlign"
        section_type = "lineUpOnTarget"
        reason = "PBHL requires optimum alignment"
        target_inc = entry_inc
        target_azi_out = entry_azi or target_azi
    elif hd > 900 and current_inc < 30:
        method = "slant"
        section_type = "incAziMd"
        reason = "long distance and low inclination"
        cl = max(300.0, min(900.0, hd * 0.35))
        target_inc = min(45.0, max(20.0, entry_inc or 30.0))
        target_azi_out = target_azi
    elif hd > 400 and azi_delta > 8:
        method = "doglegToolface"
        section_type = "lineUpOnTarget"
        reason = "medium distance with azimuth correction"
        cl = max(60.0, min(240.0, hd * 0.25))
        target_inc = min(95.0, max(current_inc, entry_inc or current_inc))
        target_azi_out = target_azi
        dls = min(4.0, max(1.5, azi_delta / max(1.0, cl / 30.0)))
        tfo = 90.0 if ((target_azi - current_azi + 360.0) % 360.0) < 180.0 else -90.0
    elif hd <= max(180.0, radius * 5.0):
        method = "nudge"
        section_type = "lineUpOnTarget"
        reason = "near target, use Nudge / Line up on Target"
        cl = max(30.0, min(120.0, hd * 0.35))
        target_inc = entry_inc or current_inc
        target_azi_out = target_azi
    else:
        method = "buildTurn"
        section_type = "lineUpOnTarget"
        reason = "balanced distance, build-turn is suitable"
        cl = max(60.0, min(300.0, hd * 0.30))
        target_inc = entry_inc or min(90.0, current_inc + 5.0)
        target_azi_out = target_azi

    inc_delta = target_inc - current_inc
    azi_delta_signed = (target_azi_out - current_azi + 180.0) % 360.0 - 180.0
    build = inc_delta / max(1.0, cl / 30.0)
    turn = azi_delta_signed / max(1.0, cl / 30.0)

    recommendation = {
        "method": method,
        "sectionType": section_type,
        "reason": reason,
        "currentToTarget": {
            "horizontalDistance": round(hd, 4),
            "verticalDistance": round(vd, 4),
            "targetAzimuth": round(target_azi, 4),
            "azimuthDelta": round(abs(azi_delta_signed), 4),
        },
        "suggested": {
            "cl": round(cl, 4),
            "md": round(_n(row.get("md", row.get("MD"))) + cl, 4),
            "inc": round(target_inc, 4),
            "azi": round(target_azi_out % 360.0, 4),
            "build": round(build, 4),
            "turn": round(turn, 4),
            "dls": round(dls, 4),
            "tfo": round(tfo, 4),
            "targetTvd": _n(target.get("tvd")),
            "targetNs": _n(target.get("ns")),
            "targetEw": _n(target.get("ew")),
        },
    }

    return {
        "ok": True,
        "version": "2.9.8",
        "target": target,
        "row": row,
        "recommendation": recommendation,
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def _payload_from_recommendation(row: Dict[str, Any], target: Dict[str, Any], rec: Dict[str, Any]) -> Dict[str, Any]:
    method = rec["method"]
    section_type = rec["sectionType"]
    s = rec["suggested"]
    params = {
        "sectionType": section_type,
        "cl": s["cl"],
        "md": s["md"],
        "inc": s["inc"],
        "azi": s["azi"],
        "build": s["build"],
        "turn": s["turn"],
        "dls": s["dls"],
        "tfo": s["tfo"],
        "using": "DLS",
        "targetTvd": s["targetTvd"],
        "targetNs": s["targetNs"],
        "targetEw": s["targetEw"],
        "targetInc": s["inc"],
        "targetAzi": s["azi"],
        "tangentLength": s["cl"],
        "dipAngle": _n(target.get("entryInc"), s["inc"]),
        "direction": _n(target.get("entryAzi"), s["azi"]),
    }
    if method == "slant":
        params.update({
            "firstHoldLen": max(30.0, s["cl"] * 0.35),
            "firstBuild": max(0.5, abs(s["build"]) or 2.0),
            "maxAngle": s["inc"],
            "secondHoldLen": max(30.0, s["cl"] * 0.35),
        })
    if method == "nudge" and section_type == "landingPlane":
        params["dipAngle"] = _n(target.get("entryInc"), s["inc"])
        params["direction"] = _n(target.get("entryAzi"), s["azi"])
    return {
        "method": method,
        "sectionType": section_type,
        "currentRow": row,
        "params": params,
    }


def solve_target_driven_path(payload: Dict[str, Any], path: str = "data/targets/target_library.json") -> Dict[str, Any]:
    row = payload.get("currentRow") or payload.get("row") or {}
    target = _target_dict(payload, path)

    if payload.get("recommendation"):
        rec = payload["recommendation"]
    else:
        rec = recommend_target_method({"row": row, "target": target}, path)["recommendation"]

    forced_method = payload.get("method")
    if forced_method:
        rec = dict(rec)
        rec["method"] = forced_method

    planning_payload = _payload_from_recommendation(row, target, rec)
    planning_result = solve_planning_method(planning_payload)
    preview = planning_result.get("previewRow")
    evaluation = evaluate_target(preview, target) if preview else None

    before = evaluate_target(row, target)
    after_error = evaluation.get("errors", {}) if evaluation else {}
    before_error = before.get("errors", {})

    improvement = None
    if after_error:
        improvement = {
            "horizontalErrorBefore": before_error.get("horizontalError"),
            "horizontalErrorAfter": after_error.get("horizontalError"),
            "tvdErrorBefore": before_error.get("tvdError"),
            "tvdErrorAfter": after_error.get("tvdError"),
            "centerDistanceBefore": before_error.get("centerDistance3d"),
            "centerDistanceAfter": after_error.get("centerDistance3d"),
        }

    result = {
        "ok": bool(planning_result.get("ok")),
        "version": "2.9.8",
        "target": target,
        "row": row,
        "recommendation": rec,
        "planningPayload": planning_payload,
        "planningResult": planning_result,
        "beforeEvaluation": before,
        "afterEvaluation": evaluation,
        "improvement": improvement,
        "insertRows": planning_result.get("rows", []),
        "previewRow": preview,
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }

    os.makedirs("data/target_driven", exist_ok=True)
    with open("data/target_driven/last_target_driven_solution.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    return result


def insert_target_segment_preview(payload: Dict[str, Any], path: str = "data/targets/target_library.json") -> Dict[str, Any]:
    result = solve_target_driven_path(payload, path)
    rows = result.get("insertRows", [])
    return {
        "ok": result.get("ok", False),
        "version": "2.9.8",
        "target": result.get("target"),
        "recommendation": result.get("recommendation"),
        "rowsToInsert": rows,
        "rowCount": len(rows),
        "afterEvaluation": result.get("afterEvaluation"),
        "instruction": "Frontend may insert rowsToInsert after the selected row, then recalculate the trajectory and refresh target evaluation.",
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def evaluate_after_insert(payload: Dict[str, Any], path: str = "data/targets/target_library.json") -> Dict[str, Any]:
    target = _target_dict(payload, path)
    row = payload.get("previewRow") or payload.get("insertedRow") or payload.get("row") or payload.get("currentRow") or {}
    return {
        "ok": True,
        "version": "2.9.8",
        "target": target,
        "evaluation": evaluate_target(row, target),
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
