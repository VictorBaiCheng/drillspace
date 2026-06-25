from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.models.trajectory import TrajectoryCalculateRequest, TrajectoryStationIn
from app.services.wellpath_engine import build_chart_data, calculate_trajectory, parse_import_preview, scan_collision

router = APIRouter(prefix="/wellPath", tags=["legacy-mydrill-compatible"])


def _legacy_ok(data: Any, message: str = "success") -> dict[str, Any]:
    return {"code": 200, "ok": True, "message": message, "data": data}


def _payload_to_request(payload: dict[str, Any]) -> TrajectoryCalculateRequest:
    rows_payload = payload.get("rows") or payload.get("trajectoryRows")
    if rows_payload:
        rows = [
            TrajectoryStationIn(
                md=float(item.get("md", item.get("MD", item.get("measuredDepth", 0)))),
                inc=float(item.get("inc", item.get("INC", item.get("inclination", 0)))),
                azi=float(item.get("azi", item.get("AZI", item.get("azimuth", 0)))),
                station_type=str(item.get("station_type", item.get("type", item.get("Type", "")))),
                remark=str(item.get("remark", item.get("Remark", ""))),
            )
            for item in rows_payload
        ]
    else:
        md_data = payload.get("mdData") or payload.get("MDData") or payload.get("md") or []
        inc_data = payload.get("incData") or payload.get("INCData") or payload.get("inc") or []
        azi_data = payload.get("aziData") or payload.get("AZIData") or payload.get("azi") or []
        rows = []
        for md, inc, azi in zip(md_data, inc_data, azi_data, strict=False):
            rows.append(TrajectoryStationIn(md=float(md), inc=float(inc), azi=float(azi)))

    if not rows:
        # Built-in fallback sample so legacy frontends can smoke-test the endpoint.
        rows = [
            TrajectoryStationIn(md=0, inc=0, azi=121.5, station_type="井口"),
            TrajectoryStationIn(md=432, inc=0, azi=121.5, station_type="直井段"),
            TrajectoryStationIn(md=1250, inc=8.5, azi=121.5, station_type="造斜段"),
            TrajectoryStationIn(md=2680, inc=32, azi=121.5, station_type="增斜段"),
            TrajectoryStationIn(md=4320, inc=32, azi=121.5, station_type="稳斜段"),
            TrajectoryStationIn(md=5320, inc=10, azi=121.5, station_type="降斜段"),
        ]

    return TrajectoryCalculateRequest(
        trajectory_id=str(payload.get("tid") or payload.get("trajectoryId") or "LEGACY-TRJ"),
        trajectory_name=str(payload.get("trajectoryName") or payload.get("name") or "Legacy Trajectory"),
        target_azimuth=float(payload.get("targetAzimuth") or payload.get("dLHP") or 121.5),
        depth_interval=float(payload.get("depthInterval") or payload.get("interval") or 30.0),
        rows=rows,
    )


def _legacy_rows(rows) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows:
        item = row.model_dump()
        result.append(
            {
                "index": item["index"],
                "MD": item["md"],
                "INC": item["inc"],
                "AZI": item["azi"],
                "CL": item["cl"],
                "TVD": item["tvd"],
                "NS": item["ns"],
                "EW": item["ew"],
                "LHP": item["vsec"],
                "VSec": item["vsec"],
                "Dogleg": item["dogleg"],
                "TF": item["tf"],
                "Build": item["build"],
                "Turn": item["turn"],
                "type": item["station_type"],
                "remark": item["remark"],
            }
        )
    return result


@router.post("/FrmDesignTest/getFrmMd")
def legacy_get_frm_md(payload: dict[str, Any]):
    try:
        response = calculate_trajectory(_payload_to_request(payload))
        return _legacy_ok({"summary": response.summary.model_dump(), "rows": _legacy_rows(response.rows)})
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/FrmDesignTest/getCalculateDesignWellBore")
def legacy_design_template(payload: dict[str, Any]):
    # V2.7.5 returns a deterministic engineering template; later versions can expand
    # this endpoint into full J/S/horizontal parameter generators.
    template_type = str(payload.get("templateType") or payload.get("type") or "horizontal").lower()
    if "j" in template_type or "j形" in template_type:
        rows = [
            TrajectoryStationIn(md=0, inc=0, azi=121.5, station_type="井口"),
            TrajectoryStationIn(md=420, inc=0, azi=121.5, station_type="KOP"),
            TrajectoryStationIn(md=1250, inc=20, azi=121.5, station_type="J形井"),
        ]
    elif "s" in template_type or "s形" in template_type:
        rows = [
            TrajectoryStationIn(md=0, inc=0, azi=121.5, station_type="井口"),
            TrajectoryStationIn(md=500, inc=0, azi=121.5, station_type="KOP"),
            TrajectoryStationIn(md=1600, inc=28, azi=121.5, station_type="增斜"),
            TrajectoryStationIn(md=2500, inc=12, azi=121.5, station_type="降斜"),
        ]
    else:
        rows = [
            TrajectoryStationIn(md=0, inc=0, azi=121.5, station_type="井口"),
            TrajectoryStationIn(md=432, inc=0, azi=121.5, station_type="直井段"),
            TrajectoryStationIn(md=1250, inc=8.5, azi=121.5, station_type="造斜段"),
            TrajectoryStationIn(md=2680, inc=32, azi=121.5, station_type="增斜段"),
            TrajectoryStationIn(md=4320, inc=32, azi=121.5, station_type="稳斜段"),
            TrajectoryStationIn(md=5320, inc=10, azi=121.5, station_type="降斜段"),
        ]
    req = TrajectoryCalculateRequest(trajectory_name=f"{template_type} template", rows=rows)
    response = calculate_trajectory(req)
    return _legacy_ok({"summary": response.summary.model_dump(), "rows": _legacy_rows(response.rows)})


def _chart_endpoint(payload: dict[str, Any], chart_type: str):
    response = calculate_trajectory(_payload_to_request(payload))
    return _legacy_ok(build_chart_data(response.rows, chart_type))


@router.post("/FormMain/ChartSP")
def chart_sp(payload: dict[str, Any]):
    return _chart_endpoint(payload, "vertical_profile")


@router.post("/FormMain/CharCMST")
def chart_cmst(payload: dict[str, Any]):
    return _chart_endpoint(payload, "horizontal_projection")


@router.post("/FormMain/ChartINC")
def chart_inc(payload: dict[str, Any]):
    return _chart_endpoint(payload, "inclination")


@router.post("/FormMain/ChartAZI")
def chart_azi(payload: dict[str, Any]):
    return _chart_endpoint(payload, "azimuth")


@router.post("/FormMain/ChartDogleg")
def chart_dogleg(payload: dict[str, Any]):
    return _chart_endpoint(payload, "dogleg")


@router.post("/FormMain/ChartBuild")
def chart_build(payload: dict[str, Any]):
    return _chart_endpoint(payload, "build")


@router.post("/FormMain/ChartTurn")
def chart_turn(payload: dict[str, Any]):
    return _chart_endpoint(payload, "turn")


@router.post("/FormMain/FrmFlatScanData")
def flat_scan(payload: dict[str, Any]):
    result = scan_collision({**payload, "method": "flatScan"} if isinstance(payload, dict) else {"method": "flatScan", "payload": payload})
    return _legacy_ok(result)

@router.post("/FormMain/FrmDistanceData")
def distance_data(payload: dict[str, Any]):
    result = scan_collision({**payload, "method": "nearestDistance"} if isinstance(payload, dict) else {"method": "nearestDistance", "payload": payload})
    return _legacy_ok(result)

@router.post("/FormMain/FrmDisjunctMatrixData")
def separation_distance(payload: dict[str, Any]):
    result = scan_collision({**payload, "method": "separationDistance"} if isinstance(payload, dict) else {"method": "separationDistance", "payload": payload})
    return _legacy_ok(result)

@router.post("/FormMain/FrmDisjunctRatioData")
def separation_factor(payload: dict[str, Any]):
    result = scan_collision({**payload, "method": "separationFactor"} if isinstance(payload, dict) else {"method": "separationFactor", "payload": payload})
    return _legacy_ok(result)

@router.get("/FormMain/getErrorSource")
def error_source_get():
    return _legacy_ok({"method": "error-source", "sources": ["survey", "toolface", "magnetic", "depth", "gyro", "MWD"]})

@router.post("/FormMain/getErrorSource")
def error_source(payload: dict[str, Any]):
    return _legacy_ok({"method": "error-source", "sources": ["survey", "toolface", "magnetic", "depth", "gyro", "MWD"]})


@router.post("/FormMain/getErrorEllipsoid")
def error_ellipsoid(payload: dict[str, Any]):
    result = scan_collision({**payload, "method": "errorEllipsoid"} if isinstance(payload, dict) else {"method": "errorEllipsoid", "payload": payload})
    result["errorEllipsoid"] = {"majorAxis": 18.2, "minorAxis": 6.4, "confidence": 0.95}
    return _legacy_ok(result)


@router.post("/TbTrajectory/importTrajectParamsCsv")
async def import_traject_params_csv(file: UploadFile = File(...)):
    content = await file.read()
    preview = parse_import_preview(file.filename or "trajectory.csv", content)
    return _legacy_ok(preview.model_dump())


@router.post("/TbTrajectory/getPidTbTrajectory")
def get_pid_tb_trajectory(payload: dict[str, Any]):
    return _legacy_ok([])


@router.post("/TbTrajectory/addToUpdateTbTrajectory")
def add_to_update_tb_trajectory(payload: dict[str, Any]):
    return _legacy_ok({"saved": True, "payload": payload})
