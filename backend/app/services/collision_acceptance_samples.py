
import csv, io, json, math, os, time
from typing import Any, Dict, List
from app.services.collision_engine import collision_scan
from app.services.wellpath_engine import minimum_curvature, n

COLLISION_SAMPLE_META: List[Dict[str, Any]] = [
    {"id":"far_safe","name":"01 远距离安全样本","level":"safe","expectedStatus":"SAFE","desc":"当前井与邻井保持较大安全距离，用于验证低风险防碰扫描链路。"},
    {"id":"nearby_risk","name":"02 近邻井风险样本","level":"danger","expectedStatus":"DANGER","desc":"邻井在关键井段接近当前井，用于验证最近距离与高风险判读。"},
    {"id":"low_sf","name":"03 低分离系数样本","level":"review","expectedStatus":"REVIEW","desc":"中心距尚可但误差半径导致分离系数偏低，用于验证SF阈值。"},
    {"id":"normal_plane","name":"04 法平面扫描样本","level":"review","expectedStatus":"REVIEW","desc":"邻井在法平面方向接近，用于验证法平面扫描角与极图数据。"},
    {"id":"horizontal_scan","name":"05 水平扫描样本","level":"warning","expectedStatus":"WARNING","desc":"邻井在水平角方向接近，用于验证水平扫描角分布。"},
    {"id":"ellipsoid_amplified","name":"06 误差椭球放大样本","level":"review","expectedStatus":"REVIEW","desc":"增大误差半径后触发复核，用于验证误差椭球和不确定性影响。"},
]

def list_collision_samples():
    return [dict(x) for x in COLLISION_SAMPLE_META]

def meta(sample_id: str):
    for x in COLLISION_SAMPLE_META:
        if x["id"] == sample_id:
            return dict(x)
    raise KeyError(sample_id)

def _linear(points, step=100.0):
    out=[]
    for i in range(len(points)-1):
        a,b=points[i],points[i+1]
        nseg=max(1,int(round((b["md"]-a["md"])/step)))
        for j in range(nseg):
            t=j/nseg
            md=a["md"]+(b["md"]-a["md"])*t
            if out and abs(md-out[-1]["md"])<1e-9: 
                continue
            out.append({"type":"当前井","md":round(md,3),"inc":round(a["inc"]+(b["inc"]-a["inc"])*t,4),"azi":round(a["azi"]+(b["azi"]-a["azi"])*t,4),"remark":"collision-current"})
    out.append({"type":"当前井","md":points[-1]["md"],"inc":points[-1]["inc"],"azi":points[-1]["azi"],"remark":"collision-target"})
    return out

def base_current_input_rows():
    return _linear([
        {"md":0,"inc":0,"azi":121.5},{"md":700,"inc":0,"azi":121.5},{"md":1550,"inc":22,"azi":121.5},
        {"md":2600,"inc":48,"azi":121.5},{"md":3900,"inc":62,"azi":121.8},{"md":5600,"inc":62,"azi":122.2},
    ],100)

def params(sample_id: str):
    table={
        "far_safe":dict(lateral=110,approach=8,width=760,md=2850,vertical=4,error=16,phase=0.0),
        "nearby_risk":dict(lateral=52,approach=34,width=620,md=2680,vertical=3,error=18,phase=0.4),
        "low_sf":dict(lateral=46,approach=15,width=690,md=3050,vertical=6,error=18,phase=0.9),
        "normal_plane":dict(lateral=44,approach=17,width=520,md=3150,vertical=12,error=18,phase=1.4),
        "horizontal_scan":dict(lateral=58,approach=20,width=580,md=3450,vertical=2,error=18,phase=2.1),
        "ellipsoid_amplified":dict(lateral=58,approach=16,width=650,md=3000,vertical=5,error=28,phase=1.1),
    }
    return table[sample_id]

def neighbor_from_current(current_xyz, sample_id: str):
    p=params(sample_id); out=[]
    for i,r in enumerate(current_xyz):
        md=n(r.get("md")); near=math.exp(-((md-p["md"])/p["width"])**2)
        lateral=p["lateral"]-p["approach"]*near
        ang=p["phase"]+i/38.0
        out.append({
            "type":"邻井","md":md,"inc":n(r.get("inc",0)),"azi":n(r.get("azi",0))+0.2*math.sin(i/20.0),
            "tvd":n(r.get("tvd"))+p["vertical"]*math.sin(i/17.0),
            "ns":n(r.get("ns"))+lateral*math.cos(ang),
            "ew":n(r.get("ew"))+lateral*math.sin(ang),
            "remark":f"neighbor-{sample_id}"
        })
    return out

def collision_sample_payload(sample_id: str):
    current_input=base_current_input_rows()
    current_xyz=minimum_curvature(current_input)
    neighbor=neighbor_from_current(current_xyz, sample_id)
    p=params(sample_id)
    return {
        "meta":meta(sample_id),
        "currentInputRows":current_input,
        "currentRows":current_xyz,
        "neighborRows":neighbor,
        "scanPayload":{
            "method": sample_id if sample_id in ["normal_plane","horizontal_scan"] else "nearestDistance",
            "reference":{"well_name":"B-1井","trajectory_name":"当前井标准样本","rows":current_xyz},
            "compare":{"well_name":"B-2井","trajectory_name":f"邻井-{sample_id}","rows":neighbor},
            "error_radius":p["error"],"search_radius":120,"confidenceK":1.41421356237
        }
    }

def status_from_sf(sf: float):
    if sf < 1.0: return "DANGER"
    if sf < 1.5: return "REVIEW"
    if sf < 2.0: return "WARNING"
    return "SAFE"

def run_collision_sample(sample_id: str, save_dir="data/calibration"):
    payload=collision_sample_payload(sample_id)
    scan=collision_scan(payload["scanPayload"])
    summary=scan.get("summary",{})
    min_sf=float(summary.get("minSeparationFactor",0))
    actual=status_from_sf(min_sf)
    expected=payload["meta"].get("expectedStatus","SAFE")
    verdict="PASS" if actual==expected else "REVIEW"
    report={
        "ok":True,"sampleId":sample_id,"sample":payload["meta"],"sampleVerdict":verdict,
        "expectedStatus":expected,"actualStatus":actual,
        "minDistance":summary.get("minDistance",0),"minSeparationFactor":min_sf,
        "nearestMd":summary.get("nearestMd",0),"nearestWell":summary.get("nearestWell","B-2井"),
        "risk":summary.get("risk",actual),"scan":scan,
        "recommendation":"通过" if verdict=="PASS" else "复核防碰阈值、误差半径或邻井轨迹输入",
        "generatedAt":time.strftime("%Y-%m-%d %H:%M:%S")
    }
    if save_dir:
        os.makedirs(save_dir, exist_ok=True)
        path=os.path.join(save_dir,f"collision_{sample_id}_report.json")
        with open(path,"w",encoding="utf-8") as f: json.dump(report,f,ensure_ascii=False,indent=2)
        report["savedReport"]=path
    return report

def run_all_collision_samples(save_dir="data/calibration"):
    os.makedirs(save_dir, exist_ok=True)
    reports=[run_collision_sample(x["id"], save_dir) for x in COLLISION_SAMPLE_META]
    pass_count=sum(1 for r in reports if r.get("sampleVerdict")=="PASS")
    review_count=sum(1 for r in reports if r.get("sampleVerdict")=="REVIEW")
    danger_count=sum(1 for r in reports if r.get("actualStatus")=="DANGER")
    rows=[]
    for r in reports:
        s=r.get("sample",{})
        rows.append({"sampleId":r["sampleId"],"name":s.get("name"),"expectedStatus":r.get("expectedStatus"),"actualStatus":r.get("actualStatus"),"sampleVerdict":r.get("sampleVerdict"),"minDistance":r.get("minDistance"),"minSeparationFactor":r.get("minSeparationFactor"),"nearestMd":r.get("nearestMd"),"risk":r.get("risk"),"recommendation":r.get("recommendation")})
    report={"ok":True,"version":"2.9.3","reportType":"CollisionAcceptanceReport","overallVerdict":"PASS" if review_count==0 else "REVIEW","totalSamples":len(reports),"passCount":pass_count,"reviewCount":review_count,"dangerCount":danger_count,"minGlobalDistance":min(float(r.get("minDistance",999)) for r in reports),"minGlobalSeparationFactor":min(float(r.get("minSeparationFactor",999)) for r in reports),"samples":rows,"reports":reports,"generatedAt":time.strftime("%Y-%m-%d %H:%M:%S"),"note":"Collision acceptance samples verify distance, SF, normal/horizontal scan and ellipsoid uncertainty workflows."}
    path=os.path.join(save_dir,"collision_acceptance_report.json")
    with open(path,"w",encoding="utf-8") as f: json.dump(report,f,ensure_ascii=False,indent=2)
    report["savedReport"]=path
    return report

def latest_collision_acceptance_report(path="data/calibration/collision_acceptance_report.json"):
    if os.path.exists(path):
        with open(path,"r",encoding="utf-8") as f: return json.load(f)
    return run_all_collision_samples(os.path.dirname(path) or "data/calibration")

def collision_acceptance_csv(report):
    fields=["sampleId","name","expectedStatus","actualStatus","sampleVerdict","minDistance","minSeparationFactor","nearestMd","risk","recommendation"]
    buf=io.StringIO(); w=csv.DictWriter(buf,fieldnames=fields,lineterminator="\n"); w.writeheader()
    for row in report.get("samples",[]): w.writerow({k:row.get(k,"") for k in fields})
    return buf.getvalue()

def rows_to_csv(rows):
    fields=["md","inc","azi","tvd","ns","ew","type","remark"]
    buf=io.StringIO(); w=csv.DictWriter(buf,fieldnames=fields,lineterminator="\n"); w.writeheader()
    for r in rows: w.writerow({k:r.get(k,"") for k in fields})
    return buf.getvalue()

def collision_sample_csv(sample_id: str, kind="current"):
    p=collision_sample_payload(sample_id)
    if kind=="neighbor": return rows_to_csv(p["neighborRows"])
    if kind=="input": return rows_to_csv(p["currentInputRows"])
    return rows_to_csv(p["currentRows"])

def write_collision_sample_files(output_dir="sample_data/collision_acceptance"):
    os.makedirs(output_dir, exist_ok=True)
    written=[]; reports=[]
    for x in COLLISION_SAMPLE_META:
        sid=x["id"]; d=os.path.join(output_dir,sid); os.makedirs(d,exist_ok=True)
        for kind in ["input","current","neighbor"]:
            path=os.path.join(d,f"{kind}_trajectory.csv")
            with open(path,"w",encoding="utf-8-sig") as f: f.write(collision_sample_csv(sid,kind))
            written.append(path)
        rep=run_collision_sample(sid,d)
        report_path=os.path.join(d,"collision_report.json")
        with open(report_path,"w",encoding="utf-8") as f: json.dump(rep,f,ensure_ascii=False,indent=2)
        reports.append(report_path)
    all_report=run_all_collision_samples(output_dir)
    return {"ok":True,"written":written,"reports":reports,"overallReport":os.path.join(output_dir,"collision_acceptance_report.json")}
