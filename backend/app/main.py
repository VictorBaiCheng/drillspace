from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.well_path import router as well_path_router

app = FastAPI(
    title="DrillSpace Backend",
    version="2.9.8",
    description="Trajectory minimum-curvature and anti-collision reference engine aligned to MyDrill/well-path interface contracts."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {
        "status": "ok",
        "name": "DrillSpace Backend",
        "version": "2.9.8",
        "engine": "minimum-curvature-v290",
    }

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "version": "2.9.8",
        "service": "drillspace-fastapi",
        "engine": "minimum-curvature-v290",
        "alignment": "MyDrill well-path API contract reference",
    }

app.include_router(well_path_router)
