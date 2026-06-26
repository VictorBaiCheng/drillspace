
import json
import math
import os
import time
from typing import Any, Dict, List, Tuple

from app.services.wellpath_engine import minimum_curvature, n

PLANNING_METHODS: List[Dict[str, Any]] = [
    {"id": "slant", "name": "Slant", "cn": "斜井段", "desc": "1st Hold + Build + Max Angle + 2nd Hold", "fields": ["firstHoldLen", "firstBuild", "maxAngle", "secondHoldLen", "targetTvd", "targetNs", "targetEw"]},
    {"id": "sWell", "name": "S Well", "cn": "S形井", "desc": "增斜、稳斜、降斜与最终稳斜段组合", "fields": ["firstHoldLen", "firstBuild", "maxAngle", "secondHoldLen", "secondBuild", "finalInc", "finalHold"]},
    {"id": "buildTurn", "name": "Build Turn", "cn": "造斜转向", "desc": "Build 与 Turn 同步推进下一段", "fields": ["build", "turn", "cl", "md", "inc", "azi"]},
    {"id": "doglegToolface", "name": "Dogleg Toolface", "cn": "狗腿工具面", "desc": "DLS/TFO/Const-TFO 求解下一段轨迹", "fields": ["dls", "tfo", "using", "cl", "md", "onlineByTvd", "inc", "azi"]},
    {"id": "hold", "name": "Hold", "cn": "稳斜保持", "desc": "按 CL / MD / TVD / Vertical Section 保持当前井斜和方位推进", "fields": ["holdMode", "cl", "md", "tvd", "verticalSection"]},
    {"id": "optimumAlign", "name": "Optimum Align", "cn": "最优对准", "desc": "Curve-Hold-Curve / Curve-Curve 到目标点对准", "fields": ["alignType", "doglegs", "tvd", "tangentLength", "targetTvd", "targetNs", "targetEw", "targetInc", "targetAzi"]},
    {"id": "nudge", "name": "Nudge", "cn": "微调段", "desc": "MD/INC/AZI、TVD/INC/AZI、DLS/INC/AZI 等 Section Type 组合微调", "fields": ["sectionType", "md", "cl", "inc", "azi", "tvd", "dls", "dipAngle", "direction"]},
]

SECTION_TYPES: List[Dict[str, Any]] = [
    {"id": "incAziMd", "label": "Inc Azi MD", "desc": "输入井斜、方位、测深"},
    {"id": "tvdIncAzi", "label": "TVD Inc Azi", "desc": "输入垂深、井斜、方位，反推MD/CL"},
    {"id": "dlsIncAzi", "label": "DLS Inc Azi", "desc": "输入狗腿度、井斜、方位，反推CL/MD"},
    {"id": "mdDlsAziHigh", "label": "MD DLS AZI (H)", "desc": "测深、狗腿度、方位，高侧求解井斜"},
    {"id": "mdDlsAziLow", "label": "MD DLS AZI (L)", "desc": "测深、狗腿度、方位，低侧求解井斜"},
    {"id": "mdDlsIncHigh", "label": "MD DLS INC (H)", "desc": "测深、狗腿度、井斜，高侧求解方位"},
    {"id": "mdDlsIncLow", "label": "MD DLS INC (L)", "desc": "测深、狗腿度、井斜，低侧求解方位"},
    {"id": "lineUpOnTarget", "label": "Line up on Target", "desc": "按目标点方向对齐"},
    {"id": "landingPlane", "label": "Landing Plane", "desc": "按着陆平面、倾角和方向求解"},
    {"id": "insertLine", "label": "Insert Line", "desc": "插入空白规划行"},
]

def method_templates() -> Dict[str, Any]:
    return {"methods": PLANNING_METHODS, "sectionTypes": SECTION_TYPES}

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))

def _norm_azi(a: float) -> float:
    return (a + 360.0) % 360.0

def _delta_azi(a2: float, a1: float) -> float:
    return (a2 - a1 + 180.0) % 360.0 - 180.0

def _current(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "type": row.get("type", "当前行"),
        "md": n(row.get("md", row.get("MD", 0))),
        "inc": n(row.get("inc", row.get("INC", 0))),
        "azi": n(row.get("azi", row.get("AZI", 0))),
        "tvd": n(row.get("tvd", row.get("TVD", 0))),
        "ns": n(row.get("ns", row.get("NS", 0))),
        "ew": n(row.get("ew", row.get("EW", 0))),
        "remark": row.get("remark", "current-row"),
    }

def _section_label(section_id: str) -> str:
    for st in SECTION_TYPES:
        if st["id"] == section_id:
            return st["label"]
    return section_id or "Inc Azi MD"

def _method_exists(method: str) -> bool:
    return any(m["id"] == method for m in PLANNING_METHODS)

def _validate(method: str, start: Dict[str, Any], params: Dict[str, Any], section_type: str) -> Tuple[List[str], List[str]]:
    errors, warnings = [], []
    if not _method_exists(method):
        errors.append(f"Unsupported planning method: {method}")
    inc = n(params.get("inc", start.get("inc", 0)))
    azi = n(params.get("azi", start.get("azi", 0)))
    md = n(params.get("md", start.get("md", 0) + n(params.get("cl", 30))))
    cl = n(params.get("cl", max(0, md - n(start.get("md")))))
    if inc < 0 or inc > 180:
        errors.append("INC must be within [0, 180]")
    if md < n(start.get("md")) and section_type != "insertLine":
        errors.append("Final MD must be greater than or equal to current MD")
    if cl < 0:
        errors.append("CL must be non-negative")
    if n(params.get("dls", 0)) < 0:
        errors.append("DLS must be non-negative")
    if abs(_delta_azi(azi, n(start.get("azi")))) > 160:
        warnings.append("Large azimuth change; review target direction or section type")
    if method in ["slant", "sWell"] and n(params.get("firstBuild", 1)) == 0:
        errors.append("Build rate cannot be zero")
    if method == "doglegToolface" and n(params.get("dls", 0)) == 0 and n(params.get("cl", 0)) > 0:
        warnings.append("DLS is zero; result degenerates to Hold-like segment")
    return errors, warnings

def _minimum_segment(start: Dict[str, Any], end: Dict[str, Any]) -> Dict[str, Any]:
    rows = minimum_curvature([start, end])
    out = dict(rows[-1]) if rows else dict(end)
    out["sectionType"] = end.get("sectionType", "Inc Azi MD")
    out["target"] = end.get("target", "")
    out["remark"] = end.get("remark", out.get("remark", "planning"))
    return out

def _row(start: Dict[str, Any], md: float, inc: float, azi: float, section_type: str, remark: str) -> Dict[str, Any]:
    end = {
        "type": "规划段",
        "md": max(n(start.get("md")), n(md)),
        "inc": _clamp(n(inc), 0, 180),
        "azi": _norm_azi(n(azi)),
        "tvd": n(start.get("tvd")),
        "ns": n(start.get("ns")),
        "ew": n(start.get("ew")),
        "sectionType": section_type,
        "remark": remark,
    }
    return _minimum_segment(start, end)

def _target_azimuth(start: Dict[str, Any], params: Dict[str, Any]) -> float:
    dns = n(params.get("targetNs")) - n(start.get("ns"))
    dew = n(params.get("targetEw")) - n(start.get("ew"))
    if abs(dns) + abs(dew) < 1e-9:
        return n(start.get("azi"))
    return _norm_azi(math.degrees(math.atan2(dew, dns)))

def _tvd_to_cl(start: Dict[str, Any], target_tvd: float, inc: float) -> float:
    dtvd = n(target_tvd) - n(start.get("tvd"))
    cosv = max(0.03, abs(math.cos(math.radians(max(0.01, n(inc))))))
    return max(0.0, dtvd / cosv)

def _dogleg_angle_between(start: Dict[str, Any], inc: float, azi: float) -> float:
    i1, i2 = math.radians(n(start.get("inc"))), math.radians(n(inc))
    a1, a2 = math.radians(n(start.get("azi"))), math.radians(n(azi))
    cos_dl = math.cos(i1) * math.cos(i2) + math.sin(i1) * math.sin(i2) * math.cos(a2 - a1)
    return math.degrees(math.acos(_clamp(cos_dl, -1.0, 1.0)))

def _section_type_endpoint(start: Dict[str, Any], params: Dict[str, Any], section_type: str) -> Tuple[float, float, float, List[str]]:
    warnings: List[str] = []
    md0, inc0, azi0 = n(start.get("md")), n(start.get("inc")), n(start.get("azi"))
    md = n(params.get("md"), md0 + n(params.get("cl"), 30.0))
    inc = n(params.get("inc"), inc0)
    azi = n(params.get("azi"), azi0)
    dls = max(0.0, n(params.get("dls"), 2.0))

    if section_type == "incAziMd":
        return md, inc, azi, warnings

    if section_type == "tvdIncAzi":
        cl = _tvd_to_cl(start, n(params.get("tvd"), start.get("tvd")), inc)
        return md0 + cl, inc, azi, warnings

    if section_type == "dlsIncAzi":
        dl = _dogleg_angle_between(start, inc, azi)
        cl = dl / max(0.001, dls) * 30.0 if dls > 0 else n(params.get("cl"), 30.0)
        return md0 + cl, inc, azi, warnings

    if section_type in ["mdDlsAziHigh", "mdDlsAziLow"]:
        cl = max(0.001, md - md0)
        dl = dls * cl / 30.0
        sign = 1 if section_type.endswith("High") else -1
        inc = inc0 + sign * dl
        return md, _clamp(inc, 0, 180), azi, warnings

    if section_type in ["mdDlsIncHigh", "mdDlsIncLow"]:
        cl = max(0.001, md - md0)
        dl = dls * cl / 30.0
        sign = 1 if section_type.endswith("High") else -1
        # approximate azimuth swing that satisfies DLS magnitude after fixing INC
        dinc = abs(inc - inc0)
        dazi = math.sqrt(max(0.0, dl * dl - dinc * dinc)) / max(0.15, math.sin(math.radians(max(1.0, (inc + inc0) / 2.0))))
        azi = azi0 + sign * dazi
        return md, inc, _norm_azi(azi), warnings

    if section_type == "lineUpOnTarget":
        azi = _target_azimuth(start, params)
        return md, inc, azi, warnings

    if section_type == "landingPlane":
        inc = n(params.get("dipAngle"), inc)
        azi = n(params.get("direction"), azi)
        return md, inc, _norm_azi(azi), warnings

    if section_type == "insertLine":
        warnings.append("Insert Line created with current INC/AZI and next MD")
        return md0 + max(1.0, n(params.get("cl"), 30.0)), inc0, azi0, warnings

    return md, inc, azi, warnings

def solve_planning_method(payload: Dict[str, Any]) -> Dict[str, Any]:
    method = payload.get("method") or "doglegToolface"
    params = payload.get("params") or {}
    section_type = params.get("sectionType") or payload.get("sectionType") or "incAziMd"
    start = _current(payload.get("currentRow") or payload.get("current") or {})
    errors, warnings = _validate(method, start, params, section_type)
    rows: List[Dict[str, Any]] = []

    if not errors:
        if method == "doglegToolface":
            cl = n(params.get("cl"), 30.0)
            dls = n(params.get("dls"), 2.0)
            tfo = n(params.get("tfo"), 0.0)
            dangle = dls * cl / 30.0
            inc = n(start.get("inc")) + dangle * math.cos(math.radians(tfo))
            sin_inc = max(0.15, math.sin(math.radians(max(1.0, n(start.get("inc"))))))
            azi = n(start.get("azi")) + dangle * math.sin(math.radians(tfo)) / sin_inc
            rows.append(_row(start, n(start.get("md")) + cl, inc, azi, _section_label(section_type), "Dogleg Toolface"))

        elif method == "buildTurn":
            cl = n(params.get("cl"), 30.0)
            inc = n(start.get("inc")) + n(params.get("build"), 0.0) * cl / 30.0
            azi = n(start.get("azi")) + n(params.get("turn"), 0.0) * cl / 30.0
            rows.append(_row(start, n(start.get("md")) + cl, inc, azi, _section_label(section_type), "Build Turn"))

        elif method == "hold":
            mode = params.get("holdMode") or "cl"
            if mode == "md":
                cl = max(0.0, n(params.get("md"), n(start.get("md")) + 30.0) - n(start.get("md")))
            elif mode == "tvd":
                cl = _tvd_to_cl(start, n(params.get("tvd"), start.get("tvd")), n(start.get("inc")))
            else:
                cl = n(params.get("cl"), 30.0)
            rows.append(_row(start, n(start.get("md")) + cl, n(start.get("inc")), n(start.get("azi")), "Hold", "Hold"))

        elif method == "slant":
            first_hold = n(params.get("firstHoldLen"), 300.0)
            build = n(params.get("firstBuild"), 2.0)
            max_angle = n(params.get("maxAngle"), 30.0)
            second_hold = n(params.get("secondHoldLen"), 300.0)
            r1 = _row(start, n(start.get("md")) + first_hold, n(start.get("inc")), n(start.get("azi")), "Hold", "Slant 1st Hold")
            r2 = _row(r1, n(r1.get("md")) + abs(max_angle - n(r1.get("inc"))) / max(0.1, abs(build)) * 30.0, max_angle, n(start.get("azi")), "Build", "Slant Build")
            r3 = _row(r2, n(r2.get("md")) + second_hold, n(r2.get("inc")), n(r2.get("azi")), "Hold", "Slant 2nd Hold")
            rows.extend([r1, r2, r3])

        elif method == "sWell":
            first_hold = n(params.get("firstHoldLen"), 300.0)
            first_build = n(params.get("firstBuild"), 2.0)
            max_angle = n(params.get("maxAngle"), 40.0)
            second_hold = n(params.get("secondHoldLen"), 300.0)
            second_build = abs(n(params.get("secondBuild"), 2.0))
            final_inc = n(params.get("finalInc"), 10.0)
            final_hold = n(params.get("finalHold"), 300.0)
            r1 = _row(start, n(start.get("md")) + first_hold, n(start.get("inc")), n(start.get("azi")), "Hold", "S Well 1st Hold")
            r2 = _row(r1, n(r1.get("md")) + abs(max_angle - n(r1.get("inc"))) / max(0.1, abs(first_build)) * 30.0, max_angle, n(start.get("azi")), "Build", "S Well Build")
            r3 = _row(r2, n(r2.get("md")) + second_hold, max_angle, n(start.get("azi")), "Hold", "S Well 2nd Hold")
            r4 = _row(r3, n(r3.get("md")) + abs(final_inc - max_angle) / max(0.1, second_build) * 30.0, final_inc, n(start.get("azi")), "Drop", "S Well Drop")
            r5 = _row(r4, n(r4.get("md")) + final_hold, final_inc, n(start.get("azi")), "Hold", "S Well Final Hold")
            rows.extend([r1, r2, r3, r4, r5])

        elif method == "optimumAlign":
            cl = n(params.get("tangentLength"), 300.0)
            target_azi = _target_azimuth(start, params)
            target_inc = n(params.get("targetInc"), n(start.get("inc")))
            rows.append(_row(start, n(start.get("md")) + cl, target_inc, target_azi, "Optimum Align", "Optimum Align"))

        elif method == "nudge":
            md, inc, azi, sec_warnings = _section_type_endpoint(start, params, section_type)
            warnings.extend(sec_warnings)
            rows.append(_row(start, md, inc, azi, _section_label(section_type), "Nudge"))

        else:
            errors.append(f"Unsupported planning method: {method}")

    status = "ERROR" if errors else "READY"
    result = {
        "ok": not bool(errors),
        "status": status,
        "method": method,
        "sectionType": section_type,
        "sectionLabel": _section_label(section_type),
        "start": start,
        "rows": rows,
        "previewRow": rows[-1] if rows else None,
        "rowCount": len(rows),
        "diagnostics": {"errors": errors, "warnings": warnings},
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }

    log_dir = "data/planning"
    os.makedirs(log_dir, exist_ok=True)
    with open(os.path.join(log_dir, "last_planning_result.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    return result
