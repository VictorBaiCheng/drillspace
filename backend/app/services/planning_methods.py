
import json
import math
import os
import time
from typing import Any, Dict, List

from app.services.wellpath_engine import minimum_curvature, n

PLANNING_METHODS: List[Dict[str, Any]] = [
    {
        "id": "slant",
        "name": "Slant",
        "cn": "斜井段",
        "desc": "1st Hold + Build + Max Angle + 2nd Hold，用于自由斜井段规划。",
        "fields": ["firstHoldLen", "firstBuild", "maxAngle", "secondHoldLen", "targetTvd", "targetNs", "targetEw"],
    },
    {
        "id": "sWell",
        "name": "S Well",
        "cn": "S形井",
        "desc": "增斜、稳斜、降斜与最终稳斜段组合。",
        "fields": ["firstHoldLen", "firstBuild", "maxAngle", "secondHoldLen", "secondBuild", "finalInc", "finalHold"],
    },
    {
        "id": "buildTurn",
        "name": "Build Turn",
        "cn": "造斜转向",
        "desc": "按 Build 与 Turn 同步推进下一段。",
        "fields": ["build", "turn", "cl", "md", "inc", "azi"],
    },
    {
        "id": "doglegToolface",
        "name": "Dogleg Toolface",
        "cn": "狗腿工具面",
        "desc": "按 DLS/TFO 或 Const-TFO 求解下一段轨迹。",
        "fields": ["dls", "tfo", "using", "cl", "md", "onlineByTvd", "inc", "azi", "targetTvd", "targetNs", "targetEw"],
    },
    {
        "id": "hold",
        "name": "Hold",
        "cn": "稳斜保持",
        "desc": "按 CL / MD / TVD / Vertical Section 保持当前井斜和方位推进。",
        "fields": ["holdMode", "cl", "md", "tvd", "verticalSection"],
    },
    {
        "id": "optimumAlign",
        "name": "Optimum Align",
        "cn": "最优对准",
        "desc": "Curve-Hold-Curve / Curve-Curve 到目标点对准。",
        "fields": ["alignType", "doglegs", "tvd", "tangentLength", "targetTvd", "targetNs", "targetEw", "targetInc", "targetAzi"],
    },
    {
        "id": "nudge",
        "name": "Nudge",
        "cn": "微调段",
        "desc": "MD/INC/AZI、TVD/INC/AZI、DLS/INC/AZI 等 Section Type 组合微调。",
        "fields": ["sectionType", "md", "cl", "inc", "azi", "tvd", "dls", "dipAngle", "direction", "targetTvd", "targetNs", "targetEw"],
    },
]

SECTION_TYPES = [
    {"id": "incAziMd", "label": "Inc Azi MD", "desc": "输入井斜、方位、测深"},
    {"id": "tvdIncAzi", "label": "TVD Inc Azi", "desc": "输入垂深、井斜、方位"},
    {"id": "dlsIncAzi", "label": "DLS Inc Azi", "desc": "输入狗腿度、井斜、方位"},
    {"id": "mdDlsAziHigh", "label": "MD DLS AZI (H)", "desc": "测深、狗腿度、方位，高侧求解"},
    {"id": "mdDlsAziLow", "label": "MD DLS AZI (L)", "desc": "测深、狗腿度、方位，低侧求解"},
    {"id": "mdDlsIncHigh", "label": "MD DLS INC (H)", "desc": "测深、狗腿度、井斜，高侧求解"},
    {"id": "mdDlsIncLow", "label": "MD DLS INC (L)", "desc": "测深、狗腿度、井斜，低侧求解"},
    {"id": "lineUpOnTarget", "label": "Line up on Target", "desc": "按目标点方向对齐"},
    {"id": "landingPlane", "label": "Landing Plane", "desc": "按着陆平面、倾角和方向求解"},
    {"id": "insertLine", "label": "Insert Line", "desc": "插入空白规划行"},
]

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))

def _current(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "type": row.get("type", "当前行"),
        "md": n(row.get("md", row.get("MD", 0))),
        "inc": n(row.get("inc", row.get("INC", 0))),
        "azi": n(row.get("azi", row.get("AZI", 0))),
        "tvd": n(row.get("tvd", row.get("TVD", 0))),
        "ns": n(row.get("ns", row.get("NS", 0))),
        "ew": n(row.get("ew", row.get("EW", 0))),
        "remark": "current-row",
    }

def _normalize_angle(a: float) -> float:
    return (a + 360.0) % 360.0

def _calc_segment(start: Dict[str, Any], end: Dict[str, Any]) -> Dict[str, Any]:
    rows = minimum_curvature([start, end])
    result = dict(rows[-1]) if rows else dict(end)
    result["sectionType"] = end.get("sectionType", "Inc Azi MD")
    result["target"] = end.get("target", "")
    return result

def _new_row(start: Dict[str, Any], md: float, inc: float, azi: float, section_type: str, remark: str) -> Dict[str, Any]:
    end = {
        "type": "规划段",
        "md": max(start["md"], md),
        "inc": _clamp(inc, 0, 180),
        "azi": _normalize_angle(azi),
        "tvd": start.get("tvd", 0),
        "ns": start.get("ns", 0),
        "ew": start.get("ew", 0),
        "sectionType": section_type,
        "remark": remark,
    }
    return _calc_segment(start, end)

def _target_azimuth(start: Dict[str, Any], params: Dict[str, Any]) -> float:
    dns = n(params.get("targetNs")) - n(start.get("ns"))
    dew = n(params.get("targetEw")) - n(start.get("ew"))
    if abs(dns) + abs(dew) < 1e-9:
        return n(start.get("azi"))
    return _normalize_angle(math.degrees(math.atan2(dew, dns)))

def _target_inc(start: Dict[str, Any], params: Dict[str, Any], cl: float) -> float:
    dtvd = n(params.get("targetTvd")) - n(start.get("tvd"))
    if abs(dtvd) < 1e-9 or cl <= 1e-9:
        return n(start.get("inc"))
    cosv = _clamp(dtvd / max(1e-9, cl), -1.0, 1.0)
    return math.degrees(math.acos(cosv))

def solve_planning_method(payload: Dict[str, Any]) -> Dict[str, Any]:
    method = payload.get("method") or "doglegToolface"
    params = payload.get("params") or {}
    section_type = params.get("sectionType") or payload.get("sectionType") or "Inc Azi MD"
    start = _current(payload.get("currentRow") or payload.get("current") or {})
    rows: List[Dict[str, Any]] = []

    if method == "doglegToolface":
        cl = n(params.get("cl"), 30.0)
        dls = n(params.get("dls"), 2.0)
        tfo = n(params.get("tfo"), 0.0)
        dangle = dls * cl / 30.0
        # Toolface proxy: build component controls inclination, turn component controls azimuth.
        inc = start["inc"] + dangle * math.cos(math.radians(tfo))
        sin_inc = max(0.15, math.sin(math.radians(max(1.0, start["inc"]))))
        azi = start["azi"] + dangle * math.sin(math.radians(tfo)) / sin_inc
        rows.append(_new_row(start, start["md"] + cl, inc, azi, section_type, "Dogleg Toolface"))

    elif method == "buildTurn":
        cl = n(params.get("cl"), 30.0)
        build = n(params.get("build"), 0.0)
        turn = n(params.get("turn"), 0.0)
        inc = start["inc"] + build * cl / 30.0
        azi = start["azi"] + turn * cl / 30.0
        rows.append(_new_row(start, start["md"] + cl, inc, azi, section_type, "Build Turn"))

    elif method == "hold":
        mode = params.get("holdMode") or "cl"
        if mode == "md":
            cl = max(0.0, n(params.get("md"), start["md"] + 30.0) - start["md"])
        elif mode == "tvd":
            dtvd = max(0.0, n(params.get("tvd"), start["tvd"]) - start["tvd"])
            cl = dtvd / max(0.05, math.cos(math.radians(start["inc"])))
        else:
            cl = n(params.get("cl"), 30.0)
        rows.append(_new_row(start, start["md"] + cl, start["inc"], start["azi"], section_type, "Hold"))

    elif method == "slant":
        first_hold = n(params.get("firstHoldLen"), 300.0)
        build = n(params.get("firstBuild"), 2.0)
        max_angle = n(params.get("maxAngle"), 30.0)
        second_hold = n(params.get("secondHoldLen"), 300.0)
        r1 = _new_row(start, start["md"] + first_hold, start["inc"], start["azi"], "Hold", "Slant 1st Hold")
        r2_inc = _clamp(max_angle, 0, 120)
        r2 = _new_row(r1, r1["md"] + abs(r2_inc - r1["inc"]) / max(0.1, abs(build)) * 30.0, r2_inc, start["azi"], "Build", "Slant Build")
        r3 = _new_row(r2, r2["md"] + second_hold, r2["inc"], r2["azi"], "Hold", "Slant 2nd Hold")
        rows.extend([r1, r2, r3])

    elif method == "sWell":
        first_hold = n(params.get("firstHoldLen"), 300.0)
        first_build = n(params.get("firstBuild"), 2.0)
        max_angle = n(params.get("maxAngle"), 40.0)
        second_hold = n(params.get("secondHoldLen"), 300.0)
        second_build = abs(n(params.get("secondBuild"), 2.0))
        final_inc = n(params.get("finalInc"), 10.0)
        final_hold = n(params.get("finalHold"), 300.0)
        r1 = _new_row(start, start["md"] + first_hold, start["inc"], start["azi"], "Hold", "S Well 1st Hold")
        r2 = _new_row(r1, r1["md"] + abs(max_angle - r1["inc"]) / max(0.1, abs(first_build)) * 30.0, max_angle, start["azi"], "Build", "S Well Build")
        r3 = _new_row(r2, r2["md"] + second_hold, max_angle, start["azi"], "Hold", "S Well 2nd Hold")
        r4 = _new_row(r3, r3["md"] + abs(final_inc - max_angle) / max(0.1, second_build) * 30.0, final_inc, start["azi"], "Drop", "S Well Drop")
        r5 = _new_row(r4, r4["md"] + final_hold, final_inc, start["azi"], "Hold", "S Well Final Hold")
        rows.extend([r1, r2, r3, r4, r5])

    elif method == "optimumAlign":
        cl = n(params.get("tangentLength"), 300.0)
        target_azi = _target_azimuth(start, params)
        target_inc = n(params.get("targetInc"), _target_inc(start, params, cl))
        rows.append(_new_row(start, start["md"] + cl, target_inc, target_azi, section_type, "Optimum Align"))

    elif method == "nudge":
        st = params.get("sectionType", section_type)
        md = n(params.get("md"), start["md"] + n(params.get("cl"), 30.0))
        inc = n(params.get("inc"), start["inc"])
        azi = n(params.get("azi"), start["azi"])
        if st == "lineUpOnTarget":
            azi = _target_azimuth(start, params)
        elif st == "landingPlane":
            azi = n(params.get("direction"), start["azi"])
            inc = n(params.get("dipAngle"), start["inc"])
        rows.append(_new_row(start, md, inc, azi, st, "Nudge"))

    else:
        raise ValueError(f"Unsupported planning method: {method}")

    result = {
        "ok": True,
        "method": method,
        "sectionType": section_type,
        "start": start,
        "rows": rows,
        "previewRow": rows[-1] if rows else None,
        "rowCount": len(rows),
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }

    log_dir = "data/planning"
    os.makedirs(log_dir, exist_ok=True)
    with open(os.path.join(log_dir, "last_planning_result.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    return result

def method_templates() -> Dict[str, Any]:
    return {"methods": PLANNING_METHODS, "sectionTypes": SECTION_TYPES}
