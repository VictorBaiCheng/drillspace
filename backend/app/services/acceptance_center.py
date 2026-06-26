
import csv
import io
import json
import os
import time
import zipfile
from typing import Any, Dict

from app.services.acceptance_samples import acceptance_report_csv, batch_acceptance_report, latest_batch_acceptance_report
from app.services.collision_acceptance_samples import collision_acceptance_csv, latest_collision_acceptance_report, run_all_collision_samples


def _safe_report(callable_obj, fallback: Dict[str, Any]) -> Dict[str, Any]:
    try:
        return callable_obj()
    except Exception as exc:
        data = dict(fallback)
        data["error"] = str(exc)
        return data


def _verdict_rank(v: str) -> int:
    v = str(v or "").upper()
    if v == "PASS":
        return 0
    if v == "REVIEW":
        return 1
    if v == "FAILED":
        return 2
    return 1


def _overall_verdict(*verdicts: str) -> str:
    worst = max([_verdict_rank(v) for v in verdicts] or [1])
    return "PASS" if worst == 0 else "FAILED" if worst >= 2 else "REVIEW"


def _md_summary(summary: Dict[str, Any]) -> str:
    return "\n".join([
        "# DrillSpace V2.9.4 轨迹子系统阶段验收说明",
        "",
        f"- 生成时间：{summary.get('generatedAt')}",
        f"- 总体结论：{summary.get('overallVerdict')}",
        f"- 轨迹计算验收：{summary.get('trajectory', {}).get('overallVerdict')}",
        f"- 防碰扫描验收：{summary.get('collision', {}).get('overallVerdict')}",
        f"- 样本总数：{summary.get('totalSamples')}",
        f"- PASS：{summary.get('passCount')}",
        f"- REVIEW：{summary.get('reviewCount')}",
        f"- FAILED：{summary.get('failCount')}",
        "",
        "## 阶段结论",
        "",
        "当前版本已完成轨迹计算验收线与防碰扫描验收线的标准样本库、批量运行、总报告生成与 JSON/CSV 导出。",
        "真实 MyDrill 导出 CSV 到位后，可替换 MyDrill-like 参考样本继续进行正式算法一致性校准。",
        "",
        "## 下一步建议",
        "",
        "1. 接入真实 MyDrill CSV 样本管理。",
        "2. 扩展防碰扫描真实案例。",
        "3. Java Bridge 直连 cal_wellbore.dll。",
    ])


def acceptance_summary_from_reports(trajectory: Dict[str, Any], collision: Dict[str, Any]) -> Dict[str, Any]:
    trajectory_samples = int(trajectory.get("totalSamples", 0) or 0)
    collision_samples = int(collision.get("totalSamples", 0) or 0)
    pass_count = int(trajectory.get("passCount", 0) or 0) + int(collision.get("passCount", 0) or 0)
    review_count = int(trajectory.get("reviewCount", 0) or 0) + int(collision.get("reviewCount", 0) or 0)
    fail_count = int(trajectory.get("failCount", 0) or 0) + int(collision.get("failCount", 0) or 0)
    total = trajectory_samples + collision_samples
    overall = _overall_verdict(trajectory.get("overallVerdict"), collision.get("overallVerdict"))

    return {
        "ok": True,
        "version": "2.9.4",
        "reportType": "TrajectorySubsystemAcceptanceSummary",
        "overallVerdict": overall,
        "totalSamples": total,
        "passCount": pass_count,
        "reviewCount": review_count,
        "failCount": fail_count,
        "acceptanceRate": round(pass_count / max(1, total), 4),
        "trajectory": {
            "overallVerdict": trajectory.get("overallVerdict", "REVIEW"),
            "totalSamples": trajectory_samples,
            "passCount": trajectory.get("passCount", 0),
            "reviewCount": trajectory.get("reviewCount", 0),
            "maxErrors": trajectory.get("maxErrors", {}),
        },
        "collision": {
            "overallVerdict": collision.get("overallVerdict", "REVIEW"),
            "totalSamples": collision_samples,
            "passCount": collision.get("passCount", 0),
            "reviewCount": collision.get("reviewCount", 0),
            "dangerCount": collision.get("dangerCount", 0),
            "minGlobalDistance": collision.get("minGlobalDistance", 0),
            "minGlobalSeparationFactor": collision.get("minGlobalSeparationFactor", 0),
        },
        "interfaceStatus": {
            "health": "OK",
            "trajectoryBatch": "READY",
            "collisionBatch": "READY",
            "exportPackage": "READY",
        },
        "reportFiles": {
            "trajectoryJson": "backend/data/calibration/acceptance_report.json",
            "trajectoryCsv": "backend/data/calibration/acceptance_report.csv",
            "collisionJson": "backend/data/calibration/collision_acceptance_report.json",
            "collisionCsv": "backend/data/calibration/collision_acceptance_report.csv",
            "summaryJson": "backend/data/acceptance_package/stage_acceptance_summary.json",
            "summaryMd": "backend/data/acceptance_package/stage_acceptance_summary.md",
        },
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "note": "Stage acceptance center consolidates trajectory calculation and collision scanning acceptance workflows.",
    }


def run_stage_acceptance(base_dir: str = "data") -> Dict[str, Any]:
    calibration_dir = os.path.join(base_dir, "calibration")
    package_dir = os.path.join(base_dir, "acceptance_package")
    os.makedirs(calibration_dir, exist_ok=True)
    os.makedirs(package_dir, exist_ok=True)

    trajectory = batch_acceptance_report(calibration_dir)
    collision = run_all_collision_samples(calibration_dir)
    summary = acceptance_summary_from_reports(trajectory, collision)

    summary_path = os.path.join(package_dir, "stage_acceptance_summary.json")
    md_path = os.path.join(package_dir, "stage_acceptance_summary.md")
    traj_csv_path = os.path.join(calibration_dir, "acceptance_report.csv")
    coll_csv_path = os.path.join(calibration_dir, "collision_acceptance_report.csv")

    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(_md_summary(summary))
    with open(traj_csv_path, "w", encoding="utf-8-sig") as f:
        f.write(acceptance_report_csv(trajectory))
    with open(coll_csv_path, "w", encoding="utf-8-sig") as f:
        f.write(collision_acceptance_csv(collision))

    summary["savedSummary"] = summary_path
    summary["savedMarkdown"] = md_path
    return summary


def latest_stage_acceptance_summary(base_dir: str = "data") -> Dict[str, Any]:
    package_dir = os.path.join(base_dir, "acceptance_package")
    summary_path = os.path.join(package_dir, "stage_acceptance_summary.json")
    if os.path.exists(summary_path):
        with open(summary_path, "r", encoding="utf-8") as f:
            return json.load(f)

    trajectory = _safe_report(
        lambda: latest_batch_acceptance_report(os.path.join(base_dir, "calibration", "acceptance_report.json")),
        {"overallVerdict": "REVIEW", "totalSamples": 0, "passCount": 0, "reviewCount": 0, "failCount": 0},
    )
    collision = _safe_report(
        lambda: latest_collision_acceptance_report(os.path.join(base_dir, "calibration", "collision_acceptance_report.json")),
        {"overallVerdict": "REVIEW", "totalSamples": 0, "passCount": 0, "reviewCount": 0, "failCount": 0, "dangerCount": 0},
    )
    return acceptance_summary_from_reports(trajectory, collision)


def export_stage_acceptance_package(base_dir: str = "data") -> Dict[str, Any]:
    summary = run_stage_acceptance(base_dir)
    package_dir = os.path.join(base_dir, "acceptance_package")
    calibration_dir = os.path.join(base_dir, "calibration")
    zip_path = os.path.join(package_dir, "drillspace_stage_acceptance_package.zip")
    manifest = {
        "package": zip_path,
        "version": "2.9.4",
        "createdAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "files": [],
    }

    candidate_files = [
        os.path.join(package_dir, "stage_acceptance_summary.json"),
        os.path.join(package_dir, "stage_acceptance_summary.md"),
        os.path.join(calibration_dir, "acceptance_report.json"),
        os.path.join(calibration_dir, "acceptance_report.csv"),
        os.path.join(calibration_dir, "collision_acceptance_report.json"),
        os.path.join(calibration_dir, "collision_acceptance_report.csv"),
    ]

    manifest_path = os.path.join(package_dir, "package_manifest.json")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for path in candidate_files:
            if os.path.exists(path):
                arc = os.path.relpath(path, base_dir)
                z.write(path, arc)
                manifest["files"].append(arc)
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        z.write(manifest_path, "acceptance_package/package_manifest.json")

    return {
        "ok": True,
        "summary": summary,
        "package": zip_path,
        "manifest": manifest,
    }


def stage_summary_csv(summary: Dict[str, Any]) -> str:
    buf = io.StringIO()
    fieldnames = ["line", "module", "verdict", "samples", "pass", "review", "failed_or_danger", "keyMetric"]
    writer = csv.DictWriter(buf, fieldnames=fieldnames, lineterminator="\n")
    writer.writeheader()
    writer.writerow({
        "line": "1",
        "module": "trajectory",
        "verdict": summary.get("trajectory", {}).get("overallVerdict"),
        "samples": summary.get("trajectory", {}).get("totalSamples"),
        "pass": summary.get("trajectory", {}).get("passCount"),
        "review": summary.get("trajectory", {}).get("reviewCount"),
        "failed_or_danger": "",
        "keyMetric": json.dumps(summary.get("trajectory", {}).get("maxErrors", {}), ensure_ascii=False),
    })
    writer.writerow({
        "line": "2",
        "module": "collision",
        "verdict": summary.get("collision", {}).get("overallVerdict"),
        "samples": summary.get("collision", {}).get("totalSamples"),
        "pass": summary.get("collision", {}).get("passCount"),
        "review": summary.get("collision", {}).get("reviewCount"),
        "failed_or_danger": summary.get("collision", {}).get("dangerCount"),
        "keyMetric": f"minDistance={summary.get('collision', {}).get('minGlobalDistance')}; minSF={summary.get('collision', {}).get('minGlobalSeparationFactor')}",
    })
    return buf.getvalue()
