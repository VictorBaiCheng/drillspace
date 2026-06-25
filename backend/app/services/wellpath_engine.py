import math
from typing import Any, Dict, Iterable, List, Optional

EPS = 1.0e-12

def n(v: Any, default: float = 0.0) -> float:
    try:
        if v is None or v == "":
            return default
        return float(v)
    except Exception:
        return default

def normalize_delta_angle_deg(a2: float, a1: float) -> float:
    """Smallest signed delta angle in degrees, normalized to [-180, 180)."""
    return (a2 - a1 + 180.0) % 360.0 - 180.0

def ratio_factor(dogleg_rad: float) -> float:
    if abs(dogleg_rad) < 1.0e-10:
        return 1.0
    return 2.0 / dogleg_rad * math.tan(dogleg_rad / 2.0)

def source_rows_from_payload(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    rows = payload.get("rows") or payload.get("data") or payload.get("points")
    if rows and isinstance(rows, list):
        return rows
    md = payload.get("mdData") or payload.get("md_data") or payload.get("MD") or []
    inc = payload.get("incData") or payload.get("inc_data") or payload.get("INC") or []
    azi = payload.get("aziData") or payload.get("azi_data") or payload.get("AZI") or []
    out: List[Dict[str, Any]] = []
    for i, m in enumerate(md):
        out.append({
            "md": m,
            "inc": inc[i] if i < len(inc) else 0,
            "azi": azi[i] if i < len(azi) else 0,
            "type": "井段",
            "remark": "payload-array"
        })
    return out

def normalize_input_rows(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for i, r in enumerate(rows or []):
        out.append({
            "index": i + 1,
            "type": r.get("type") or r.get("station_type") or r.get("Type") or "井段",
            "md": n(r.get("md", r.get("MD", r.get("measuredDepth", 0)))),
            "inc": n(r.get("inc", r.get("INC", r.get("inclination", 0)))),
            "azi": n(r.get("azi", r.get("AZI", r.get("azimuth", 0)))),
            "tvd": n(r.get("tvd", r.get("TVD", 0))),
            "ns": n(r.get("ns", r.get("NS", r.get("north", 0)))),
            "ew": n(r.get("ew", r.get("EW", r.get("east", 0)))),
            "remark": r.get("remark") or r.get("Remark") or "",
        })
    out.sort(key=lambda x: x["md"])
    return out

def minimum_curvature(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Minimum-curvature trajectory calculation.
    Output names intentionally include both DrillSpace-friendly lower-case fields and
    MyDrill/RSDAS-like aliases where useful.
    """
    stations = normalize_input_rows(rows)
    if not stations:
        return []

    result: List[Dict[str, Any]] = []
    prev_out: Optional[Dict[str, Any]] = None
    prev_in: Optional[Dict[str, Any]] = None

    for i, cur in enumerate(stations):
        md = n(cur["md"])
        inc = n(cur["inc"])
        azi = n(cur["azi"])

        if i == 0:
            # Respect any non-zero imported starting coordinates.
            tvd = n(cur.get("tvd", 0))
            ns = n(cur.get("ns", 0))
            ew = n(cur.get("ew", 0))
            out = {
                "index": 1,
                "type": cur.get("type", "井口"),
                "md": round(md, 6),
                "inc": round(inc, 6),
                "azi": round(azi, 6),
                "cl": 0.0,
                "tvd": round(tvd, 6),
                "ns": round(ns, 6),
                "ew": round(ew, 6),
                "vsec": round(math.sqrt(ns * ns + ew * ew), 6),
                "dogleg": 0.0,
                "doglegAngle": 0.0,
                "ratioFactor": 1.0,
                "tf": 0.0,
                "build": 0.0,
                "turn": 0.0,
                "remark": cur.get("remark", "start"),
            }
        else:
            assert prev_out is not None and prev_in is not None
            cl = max(0.0, md - n(prev_in["md"]))
            i1 = math.radians(n(prev_in["inc"]))
            i2 = math.radians(inc)
            a1 = math.radians(n(prev_in["azi"]))
            a2 = math.radians(azi)

            cos_dl = math.cos(i1) * math.cos(i2) + math.sin(i1) * math.sin(i2) * math.cos(a2 - a1)
            cos_dl = max(-1.0, min(1.0, cos_dl))
            dl = math.acos(cos_dl)
            rf = ratio_factor(dl)

            dtvd = 0.5 * cl * (math.cos(i1) + math.cos(i2)) * rf
            dns = 0.5 * cl * (math.sin(i1) * math.cos(a1) + math.sin(i2) * math.cos(a2)) * rf
            dew = 0.5 * cl * (math.sin(i1) * math.sin(a1) + math.sin(i2) * math.sin(a2)) * rf

            tvd = n(prev_out["tvd"]) + dtvd
            ns = n(prev_out["ns"]) + dns
            ew = n(prev_out["ew"]) + dew

            dls = math.degrees(dl) / max(cl, EPS) * 30.0
            build = (inc - n(prev_in["inc"])) / max(cl, EPS) * 30.0
            dazi = normalize_delta_angle_deg(azi, n(prev_in["azi"]))
            turn = dazi / max(cl, EPS) * 30.0

            # Practical toolface proxy for display. Exact rotary steerable TFO can be
            # model-specific; this keeps frontend continuity until DLL/vendor model is wired.
            tf = (math.degrees(math.atan2(turn, build)) + 360.0) % 360.0 if abs(build) + abs(turn) > EPS else 0.0

            out = {
                "index": i + 1,
                "type": cur.get("type", "井段"),
                "md": round(md, 6),
                "inc": round(inc, 6),
                "azi": round(azi, 6),
                "cl": round(cl, 6),
                "tvd": round(tvd, 6),
                "ns": round(ns, 6),
                "ew": round(ew, 6),
                "vsec": round(math.sqrt(ns * ns + ew * ew), 6),
                "dogleg": round(dls, 6),
                "doglegAngle": round(math.degrees(dl), 6),
                "ratioFactor": round(rf, 9),
                "tf": round(tf, 6),
                "build": round(build, 6),
                "turn": round(turn, 6),
                "remark": cur.get("remark", "minimum-curvature"),
            }

        # MyDrill-like aliases; frontend accepts lower case, external validation can use upper case.
        out.update({
            "MD": out["md"],
            "INC": out["inc"],
            "AZI": out["azi"],
            "CL": out["cl"],
            "TVD": out["tvd"],
            "NS": out["ns"],
            "EW": out["ew"],
            "Dogleg": out["dogleg"],
            "TF": out["tf"],
            "Build": out["build"],
            "Turn": out["turn"],
        })

        result.append(out)
        prev_out = out
        prev_in = cur

    return result

def design_template(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    well_type = (payload.get("type") or payload.get("wellType") or "H").upper()
    kop = n(payload.get("kop", payload.get("KOP", 1250)))
    target_md = n(payload.get("targetMd", payload.get("target_md", 5320)))
    target_inc = 88.5 if well_type == "H" else 35 if well_type == "J" else 12
    azi = n(payload.get("azi", payload.get("AZI", 121.5)))
    rows = [
        {"type": "井口", "md": 0, "inc": 0, "azi": azi, "remark": "template-start"},
        {"type": "直井段", "md": kop, "inc": 0, "azi": azi, "remark": "KOP"},
        {"type": "造斜段", "md": kop + (target_md - kop) * 0.35, "inc": target_inc * 0.55, "azi": azi, "remark": "build"},
        {"type": "稳斜段" if well_type != "H" else "水平段", "md": target_md, "inc": target_inc, "azi": azi, "remark": "target"},
    ]
    return minimum_curvature(rows)

def chart_series(rows: List[Dict[str, Any]], x_key: str, y_key: str) -> Dict[str, Any]:
    return {
        "series": [
            {"x": r.get(x_key, 0), "y": r.get(y_key, 0), "md": r.get("md", 0)}
            for r in rows
        ],
        "rows": rows,
        "xKey": x_key,
        "yKey": y_key,
    }
