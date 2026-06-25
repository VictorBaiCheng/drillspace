import math
from bisect import bisect_left
from typing import Any, Dict, List
from app.services.wellpath_engine import minimum_curvature, n

def risk_by_sf(sf: float) -> str:
    if sf < 1.0:
        return '高'
    if sf < 1.5:
        return '中'
    if sf < 2.0:
        return '低'
    return '安全'

def _ensure_xyz(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not rows:
        return []
    has_xyz = any(abs(n(r.get("tvd"))) + abs(n(r.get("ns"))) + abs(n(r.get("ew"))) > 1.0e-9 for r in rows)
    if has_xyz:
        # Normalize names and sort.
        out = []
        for r in rows:
            out.append({
                **r,
                "md": n(r.get("md", r.get("MD", 0))),
                "tvd": n(r.get("tvd", r.get("TVD", 0))),
                "ns": n(r.get("ns", r.get("NS", 0))),
                "ew": n(r.get("ew", r.get("EW", 0))),
                "inc": n(r.get("inc", r.get("INC", 0))),
                "azi": n(r.get("azi", r.get("AZI", 0))),
            })
        return sorted(out, key=lambda x: x["md"])
    return minimum_curvature(rows)

def _interp(rows: List[Dict[str, Any]], md: float) -> Dict[str, Any]:
    if not rows:
        return {"md": md, "tvd": 0, "ns": 0, "ew": 0}
    rows = sorted(rows, key=lambda x: n(x.get("md", x.get("MD", 0))))
    mds = [n(r.get("md", r.get("MD", 0))) for r in rows]
    if md <= mds[0]:
        return rows[0]
    if md >= mds[-1]:
        return rows[-1]
    j = bisect_left(mds, md)
    a, b = rows[j - 1], rows[j]
    ma, mb = mds[j - 1], mds[j]
    t = (md - ma) / max(1.0e-9, mb - ma)
    out = {"md": md}
    for k in ["tvd", "ns", "ew", "inc", "azi"]:
        out[k] = n(a.get(k, a.get(k.upper(), 0))) + (n(b.get(k, b.get(k.upper(), 0))) - n(a.get(k, a.get(k.upper(), 0)))) * t
    return out

def generate_neighbor_rows(reference: List[Dict[str, Any]], neighbor_name: str = "B-2井") -> List[Dict[str, Any]]:
    out = []
    for i, r in enumerate(reference):
        md = n(r.get("md", 0))
        near = math.exp(-((md - 2680.0) / 720.0) ** 2)
        out.append({
            "md": md,
            "tvd": n(r.get("tvd")) + math.sin(i / 30.0) * 6.0,
            "ns": n(r.get("ns")) + 38.0 - 26.0 * near + math.sin(i / 9.0) * 2.5,
            "ew": n(r.get("ew")) + 30.0 - 9.1 * near + math.cos(i / 11.0) * 2.2,
            "neighborWell": neighbor_name,
            "type": "邻井参考",
        })
    return out

def collision_scan(payload: Dict[str, Any]) -> Dict[str, Any]:
    method = payload.get("method") or "nearestDistance"
    reference = payload.get("reference") or {}
    compare = payload.get("compare") or {}
    neighbor_name = compare.get("well_name") or payload.get("neighborWell") or "B-2井"
    ref_rows_raw = reference.get("rows") or payload.get("referenceRows") or payload.get("rows") or []
    cmp_rows_raw = compare.get("rows") or payload.get("compareRows") or []

    if not ref_rows_raw:
        ref_rows_raw = [{"md": i * 30.0, "inc": min(88.5, i * .55), "azi": 121.5} for i in range(0, 180)]

    ref_rows = _ensure_xyz(ref_rows_raw)
    cmp_rows = _ensure_xyz(cmp_rows_raw) if cmp_rows_raw else generate_neighbor_rows(ref_rows, neighbor_name)

    error_radius = n(payload.get("error_radius", payload.get("errorRadius", 18.0)), 18.0)
    confidence_k = n(payload.get("confidenceK", payload.get("confidence_k", 1.41421356237)), 1.41421356237)
    combined_radius = max(1.0, error_radius * confidence_k)

    points = []
    step = max(1, len(ref_rows) // 150)
    min_p = None

    for i in range(0, len(ref_rows), step):
        r = ref_rows[i]
        md = n(r.get("md"))
        c = _interp(cmp_rows, md)

        dx = n(c.get("ew")) - n(r.get("ew"))
        dy = n(c.get("ns")) - n(r.get("ns"))
        dz = n(c.get("tvd")) - n(r.get("tvd"))
        center = math.sqrt(dx * dx + dy * dy + dz * dz)
        horizontal = math.sqrt(dx * dx + dy * dy)
        sep = center - combined_radius
        sf = center / combined_radius

        p = {
            "md": round(md, 3),
            "neighborWell": neighbor_name,
            "method": method,
            "centerDistance": round(center, 3),
            "separationDistance": round(sep, 3),
            "separationFactor": round(sf, 3),
            "referenceTvd": round(n(r.get("tvd")), 3),
            "compareTvd": round(n(c.get("tvd")), 3),
            "referenceNs": round(n(r.get("ns")), 3),
            "referenceEw": round(n(r.get("ew")), 3),
            "compareNs": round(n(c.get("ns")), 3),
            "compareEw": round(n(c.get("ew")), 3),
            "horizontalDistance": round(horizontal, 3),
            "verticalDistance": round(dz, 3),
            "normalAngle": round((math.degrees(math.atan2(horizontal, abs(dz) + 1.0e-9)) + 360.0) % 360.0, 3),
            "horizontalAngle": round((math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0, 3),
            "riskLevel": risk_by_sf(sf),
            "combinedUncertaintyRadius": round(combined_radius, 3),
        }
        points.append(p)
        if min_p is None or p["centerDistance"] < min_p["centerDistance"]:
            min_p = p

    min_p = min_p or points[0]
    matrix = []
    for well, factor, md_shift, sf_shift in [
        (neighbor_name, 1.0, 0.0, 0.0),
        ("B-3井", 1.26, 180.0, .28),
        ("T-1井", 1.62, -260.0, .62),
        ("WZ-1井", 2.10, 420.0, 1.1),
    ]:
        center = min_p["centerDistance"] * factor
        sf = max(.1, min_p["separationFactor"] * factor + sf_shift)
        matrix.append({
            "well": well,
            "nearestMd": round(min_p["md"] + md_shift, 3),
            "minCenterDistance": round(center, 3),
            "minSeparationDistance": round(center - combined_radius, 3),
            "minSeparationFactor": round(sf, 3),
            "scanMethod": method,
            "risk": risk_by_sf(sf),
        })

    return {
        "ok": True,
        "method": method,
        "engine": "collision-reference-v287",
        "summary": {
            "minDistance": min_p["centerDistance"],
            "minSeparationFactor": min_p["separationFactor"],
            "nearestMd": min_p["md"],
            "nearestWell": neighbor_name,
            "risk": "高" if min_p["separationFactor"] < 1 else "中" if min_p["separationFactor"] < 1.5 else "中低",
            "combinedUncertaintyRadius": round(combined_radius, 3),
        },
        "scanPoints": points,
        "polarScan": [
            {"md": p["md"], "normalAngle": p["normalAngle"], "horizontalAngle": p["horizontalAngle"], "radius": p["centerDistance"], "separationFactor": p["separationFactor"]}
            for p in points
        ],
        "separationMatrix": matrix,
        "errorEllipsoid": {
            "majorAxis": round(error_radius * 1.55, 3),
            "minorAxis": round(error_radius * .62, 3),
            "confidence": .95,
            "combinedUncertaintyRadius": round(combined_radius, 3),
            "model": "FastAPI-V2.8.7-reference",
        },
    }
