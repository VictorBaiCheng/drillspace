import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

from app.services.acceptance_center import export_stage_acceptance_package, run_stage_acceptance, stage_summary_csv  # noqa: E402

if __name__ == "__main__":
    out = run_stage_acceptance(os.path.join(ROOT, "data"))
    csv_path = os.path.join(ROOT, "data", "acceptance_package", "stage_acceptance_summary.csv")
    os.makedirs(os.path.dirname(csv_path), exist_ok=True)
    with open(csv_path, "w", encoding="utf-8-sig") as f:
        f.write(stage_summary_csv(out))
    package = export_stage_acceptance_package(os.path.join(ROOT, "data"))
    print("overallVerdict:", out["overallVerdict"])
    print("totalSamples:", out["totalSamples"])
    print("PASS:", out["passCount"], "REVIEW:", out["reviewCount"], "FAILED:", out["failCount"])
    print("summary:", os.path.join(ROOT, "data", "acceptance_package", "stage_acceptance_summary.json"))
    print("csv:", csv_path)
    print("package:", package["package"])
