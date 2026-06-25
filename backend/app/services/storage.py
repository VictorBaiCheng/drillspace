from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.models.trajectory import TrajectoryRecord, TrajectorySaveRequest


def _record_path(trajectory_id: str) -> Path:
    safe_id = trajectory_id.replace("/", "_").replace("\\", "_")
    return settings.trajectory_dir / f"{safe_id}.json"


def save_trajectory(request: TrajectorySaveRequest) -> TrajectoryRecord:
    trajectory_id = request.trajectory_id or f"TRJ-{uuid.uuid4().hex[:10].upper()}"
    rows: list[dict[str, Any]] = []
    for row in request.rows:
        if hasattr(row, "model_dump"):
            rows.append(row.model_dump())
        else:
            rows.append(dict(row))
    record = TrajectoryRecord(
        trajectory_id=trajectory_id,
        trajectory_name=request.trajectory_name,
        project_id=request.project_id,
        well_id=request.well_id,
        target_azimuth=request.target_azimuth,
        rows=rows,
        metadata=request.metadata,
    )
    path = _record_path(trajectory_id)
    path.write_text(json.dumps(record.model_dump(), ensure_ascii=False, indent=2), encoding="utf-8")
    return record


def get_trajectory(trajectory_id: str) -> TrajectoryRecord:
    path = _record_path(trajectory_id)
    if not path.exists():
        raise FileNotFoundError(f"trajectory not found: {trajectory_id}")
    return TrajectoryRecord.model_validate_json(path.read_text(encoding="utf-8"))


def list_trajectories() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for path in sorted(settings.trajectory_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            record = TrajectoryRecord.model_validate_json(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 - skip broken local records
            continue
        items.append(
            {
                "trajectory_id": record.trajectory_id,
                "trajectory_name": record.trajectory_name,
                "project_id": record.project_id,
                "well_id": record.well_id,
                "row_count": len(record.rows),
                "saved_at": record.saved_at,
            }
        )
    return items
