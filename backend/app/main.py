from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.well_path import router as well_path_router

app = FastAPI(
    title="DrillSpace Backend",
    version="2.8.9",
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
        "version": "2.8.9",
        "engine": "minimum-curvature-v289",
    }

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "version": "2.8.9",
        "service": "drillspace-fastapi",
        "engine": "minimum-curvature-v289",
        "alignment": "MyDrill well-path API contract reference",
    }

app.include_router(well_path_router)
