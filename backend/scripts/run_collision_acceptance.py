import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

from app.services.collision_acceptance_samples import collision_acceptance_csv, run_all_collision_samples  # noqa: E402

if __name__ == "__main__":
    out_dir = os.path.join(ROOT, "data", "calibration")
    os.makedirs(out_dir, exist_ok=True)
    report = run_all_collision_samples(out_dir)
    json_path = os.path.join(out_dir, "collision_acceptance_report.json")
    csv_path = os.path.join(out_dir, "collision_acceptance_report.csv")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    with open(csv_path, "w", encoding="utf-8-sig") as f:
        f.write(collision_acceptance_csv(report))
    print("overallVerdict:", report["overallVerdict"])
    print("totalSamples:", report["totalSamples"])
    print("PASS:", report["passCount"], "REVIEW:", report["reviewCount"], "DANGER:", report["dangerCount"])
    print("json:", json_path)
    print("csv:", csv_path)
