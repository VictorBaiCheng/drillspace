import argparse
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

from app.services.mydrill_calibration import compare_reference, parse_csv_text  # noqa: E402

def main():
    parser = argparse.ArgumentParser(description="Compare FastAPI minimum-curvature engine against MyDrill/well-path exported reference CSV.")
    parser.add_argument("--reference", required=True, help="MyDrill/well-path exported CSV with MD,INC,AZI,TVD,NS,EW,DOGLEG,BUILD,TURN...")
    parser.add_argument("--out", default="data/calibration/last_alignment_report.json", help="Output JSON report path.")
    args = parser.parse_args()

    with open(args.reference, "r", encoding="utf-8-sig") as f:
        text = f.read()

    rows = parse_csv_text(text)
    report = compare_reference(rows)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print("verdict:", report["verdict"])
    print("stationCount:", report["stationCount"])
    print("saved:", args.out)
    for col, m in report["metrics"].items():
        print(f"{col:8s} maxAbs={m['maxAbs']:.9f} rmse={m['rmse']:.9f}")

if __name__ == "__main__":
    main()
