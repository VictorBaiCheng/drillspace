from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


class TrajectoryStationIn(BaseModel):
    """Minimum input station for trajectory calculation.

    MD / INC / AZI are the canonical inputs. The remaining values may be present
    when loading legacy rows, but are recomputed by the engine.
    """

    md: float = Field(..., description="Measured depth, m")
    inc: float = Field(..., description="Inclination angle, degree")
    azi: float = Field(..., description="Azimuth angle, degree")
    station_type: str = Field(default="", description="井段类型 / section type")
    remark: str = ""

    @field_validator("md")
    @classmethod
    def md_must_be_non_negative(cls, value: float) -> float:
        if value < 0:
            raise ValueError("MD must be non-negative")
        return value


class TrajectoryStationOut(BaseModel):
    index: int
    station_type: str = ""
    md: float
    inc: float
    azi: float
    cl: float
    tvd: float
    ns: float
    ew: float
    vsec: float
    dogleg: float
    tf: float
    build: float
    turn: float
    remark: str = ""


class TrajectoryCalculateRequest(BaseModel):
    trajectory_id: Optional[str] = None
    trajectory_name: str = "Untitled Trajectory"
    target_azimuth: float = 121.5
    depth_interval: float = 30.0
    rows: list[TrajectoryStationIn]
    options: dict[str, Any] = Field(default_factory=dict)


class TrajectorySummary(BaseModel):
    trajectory_id: str
    trajectory_name: str
    row_count: int
    md_start: float
    md_end: float
    tvd_end: float
    ns_end: float
    ew_end: float
    vsec_end: float
    max_dls: float
    max_inc: float
    target_azimuth: float
    calculated_at: str
    engine: str = "minimum-curvature-python"


class TrajectoryCalculateResponse(BaseModel):
    ok: bool = True
    message: str = "success"
    summary: TrajectorySummary
    rows: list[TrajectoryStationOut]
    warnings: list[str] = Field(default_factory=list)


class TrajectoryInterpolateRequest(TrajectoryCalculateRequest):
    interval: float = 30.0


class TrajectorySaveRequest(BaseModel):
    trajectory_id: Optional[str] = None
    trajectory_name: str = "Untitled Trajectory"
    project_id: str = "default-project"
    well_id: str = "default-well"
    target_azimuth: float = 121.5
    rows: list[TrajectoryStationOut | TrajectoryStationIn]
    metadata: dict[str, Any] = Field(default_factory=dict)


class TrajectoryRecord(BaseModel):
    trajectory_id: str
    trajectory_name: str
    project_id: str
    well_id: str
    target_azimuth: float
    rows: list[dict[str, Any]]
    metadata: dict[str, Any] = Field(default_factory=dict)
    saved_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")


class ImportPreviewResponse(BaseModel):
    ok: bool = True
    filename: str
    file_type: str
    columns: list[str]
    suggested_mapping: dict[str, str]
    preview_rows: list[dict[str, Any]]
    normalized_preview: list[TrajectoryStationIn]
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
