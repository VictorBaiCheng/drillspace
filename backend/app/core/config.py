from __future__ import annotations

from pathlib import Path
from pydantic import BaseModel


class Settings(BaseModel):
    app_name: str = "DrillSpace V2.7.9 WellPath Backend"
    app_version: str = "2.7.9"
    api_prefix: str = "/api"
    data_dir: Path = Path(__file__).resolve().parents[2] / "data"
    trajectory_dir: Path = data_dir / "trajectories"
    cors_origins: list[str] = ["*"]


settings = Settings()
settings.trajectory_dir.mkdir(parents=True, exist_ok=True)
