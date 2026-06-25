import os
import sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

from app.services.acceptance_samples import write_sample_files  # noqa: E402

if __name__ == "__main__":
    out = os.path.join(ROOT, "sample_data", "acceptance")
    result = write_sample_files(out)
    print("generated:", len(result["written"]), "csv files")
    print("reports:", len(result["reports"]))
    print("index:", result["index"])
