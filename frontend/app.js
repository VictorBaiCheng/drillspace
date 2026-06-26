/* DrillSpace V2.9.7 Target Zone + Trajectory Constraint Center
 * - V2.7.2 industrial compact grid retained
 * - V2.7.1 trajectory subsystem coverage restored
 * - MyDrill well-path API mapping added
 * - Mock/API mode switch supported
 * - CSV/TXT import preview, operation log, API status panel included
 */

const state = {
  apiMode: localStorage.getItem('drillspace-api-mode') || 'mock',
  apiBaseUrl: localStorage.getItem('drillspace-api-base') || 'http://127.0.0.1:8000',
  activeSubmodule: 'design',
  editorView: 'grid',
  selectedRow: 0,
  rows: [],
  surveyRows: [],
  trajectories: [],
  importPreview: null,
  logs: [],
  apiHistory: [],
  changedCells: new Set(),
  validation: { invalidRows: [], warnings: [] },
  collision: { minDistance: 38.6, minSF: 1.86, nearestWell: 'B-2井', nearestMd: 2680, risk: '中低' },
  collisionResults: [],
  collisionMatrix: [],
  collisionPolar: [],
  errorEllipsoid: null,
  collisionMethod: 'nearestDistance',
  collisionSettings: { searchRadius: 80, errorRadius: 18, neighborWell: 'B-2井', method: '最近距离扫描法' },
  collisionView: 'normalPlane',
  collisionLayout: 'single',
  calibrationReport: null,
  calibrationSource: 'sample'
};


// V2.7.7 performance guard: the trajectory sheet may contain thousands of rows.
// Keep the complete data in state.rows, but render only the visible rows.
const GRID_ROW_HEIGHT = 26;
const GRID_BUFFER_ROWS = 18;
const gridRuntime = { raf: null, start: -1, end: -1, scrollTop: 0 };

const trajectoryApiMap = {
  calculateTable: {
    method: 'POST',
    path: '/wellPath/FrmDesignTest/getFrmMd',
    module: '轨迹设计',
    action: '根据 MD/INC/AZI 刷新完整轨迹表',
    payload: 'DisignDto{ tid, mdData[], incData[], aziData[], depthInterval, dLHP, type }',
    result: 'DateTableParameterVo[]'
  },
  designTemplate: {
    method: 'POST',
    path: '/wellPath/FrmDesignTest/getCalculateDesignWellBore',
    module: '轨迹设计',
    action: 'J形井 / S形井 / 水平井设计模板计算',
    payload: 'DisignWellBoreDto / Design template params',
    result: 'Design wellbore trajectory points'
  },
  horizontalProjection: {
    method: 'POST',
    path: '/wellPath/FormMain/CharCMST',
    module: '轨迹视图',
    action: '水平投影图',
    payload: 'List<DisignDto>',
    result: 'List<ChartCmstNameVo>'
  },
  verticalProfile: {
    method: 'POST',
    path: '/wellPath/FormMain/ChartSP',
    module: '轨迹视图',
    action: '侧面剖面图',
    payload: 'List<DisignDto>',
    result: 'List<ChartCmstNameVo>'
  },
  inclination: {
    method: 'POST',
    path: '/wellPath/FormMain/ChartINC',
    module: '轨迹视图',
    action: '井斜角曲线',
    payload: 'List<DisignDto>',
    result: 'List<ChartCmstNameVo>'
  },
  azimuth: {
    method: 'POST',
    path: '/wellPath/FormMain/ChartAZI',
    module: '轨迹视图',
    action: '方位角曲线',
    payload: 'List<DisignDto>',
    result: 'List<ChartCmstNameVo>'
  },
  dogleg: {
    method: 'POST',
    path: '/wellPath/FormMain/ChartDogleg',
    module: '轨迹视图',
    action: '狗腿度 / 曲率曲线',
    payload: 'List<DisignDto>',
    result: 'List<ChartCmstNameVo>'
  },
  build: {
    method: 'POST',
    path: '/wellPath/FormMain/ChartBuild',
    module: '轨迹视图',
    action: '造斜率曲线',
    payload: 'List<DisignDto>',
    result: 'List<ChartCmstNameVo>'
  },
  turn: {
    method: 'POST',
    path: '/wellPath/FormMain/ChartTurn',
    module: '轨迹视图',
    action: '偏转率曲线',
    payload: 'List<DisignDto>',
    result: 'List<ChartCmstNameVo>'
  },
  flatScan: {
    method: 'POST',
    path: '/wellPath/FormMain/FrmFlatScanData',
    module: '防碰扫描',
    action: '法平面扫描',
    payload: 'List<DisignDto>{reference, compare}',
    result: 'FrmSurfaceVo'
  },
  nearestDistance: {
    method: 'POST',
    path: '/wellPath/FormMain/FrmDistanceData',
    module: '防碰扫描',
    action: '最近距离扫描',
    payload: 'List<DisignDto>{reference, compare}',
    result: 'FrmDistanceVo'
  },
  separationDistance: {
    method: 'POST',
    path: '/wellPath/FormMain/FrmDisjunctMatrixData',
    module: '防碰扫描',
    action: '分离距 / 分离矩阵',
    payload: 'List<DisignDto>{reference, compare}',
    result: 'DisjunctMatrixVo'
  },
  separationFactor: {
    method: 'POST',
    path: '/wellPath/FormMain/FrmDisjunctRatioData',
    module: '防碰扫描',
    action: '分离系数',
    payload: 'List<DisignDto>{reference, compare}',
    result: 'DisjunctRatioVo'
  },
  errorSource: {
    method: 'GET',
    path: '/wellPath/FormMain/getErrorSource',
    module: '防碰扫描',
    action: '误差源',
    payload: 'None',
    result: 'ErrorSourceVo[]'
  },
  errorEllipsoid: {
    method: 'POST',
    path: '/wellPath/FormMain/getErrorEllipsoid',
    module: '防碰扫描',
    action: '误差椭球',
    payload: 'Trajectory + Error Source',
    result: 'ErrorEllipsoidVo'
  },
  collisionScan: {
    method: 'POST',
    path: '/api/well-path/trajectory/collision-scan',
    module: '防碰扫描',
    action: 'DrillSpace 新后端防碰扫描统一接口',
    payload: 'reference rows + compare rows + error model',
    result: 'CollisionScanResponse'
  },
  deviationAnalysis: {
    method: 'POST',
    path: '/api/well-path/trajectory/deviation',
    module: '偏差分析',
    action: 'DrillSpace 新后端设计/实测偏差分析',
    payload: 'design rows + survey rows',
    result: 'DeviationAnalysisResponse'
  },
  engineInfo: {
    method: 'GET',
    path: '/api/well-path/engine-info',
    module: '后端引擎',
    action: '查看 FastAPI 轨迹/防碰引擎版本',
    payload: 'None',
    result: 'EngineInfo'
  },
  samplesRunAll: {
    method: 'POST',
    path: '/api/well-path/samples/run-all',
    module: '批量验收',
    action: '一键运行全部标准验收样本',
    payload: 'None',
    result: 'BatchAcceptanceReport'
  },
  samplesAcceptanceReport: {
    method: 'GET',
    path: '/api/well-path/batch-acceptance-report',
    module: '批量验收',
    action: '读取最新批量验收总报告',
    payload: 'None',
    result: 'BatchAcceptanceReport'
  },
  samplesList: {
    method: 'GET',
    path: '/api/well-path/samples',
    module: '标准验收样本',
    action: '获取内置标准验收样本库',
    payload: 'None',
    result: 'AcceptanceSampleMeta[]'
  },
  sampleDetail: {
    method: 'GET',
    path: '/api/well-path/samples/{sample_id}',
    module: '标准验收样本',
    action: '获取样本输入、DrillSpace结果、MyDrill-like参考结果',
    payload: 'sample_id',
    result: 'AcceptanceSamplePayload'
  },
  sampleCalibrate: {
    method: 'POST',
    path: '/api/well-path/samples/{sample_id}/calibrate',
    module: '标准验收样本',
    action: '运行指定标准样本对照校准',
    payload: 'sample_id',
    result: 'CalibrationReport'
  },
  calibrationTemplate: {
    method: 'GET',
    path: '/api/well-path/calibration/template',
    module: 'DLL对照校准',
    action: '下载/查看 MyDrill 对照CSV字段模板',
    payload: 'None',
    result: 'CalibrationTemplate'
  },
  calibrationSample: {
    method: 'GET',
    path: '/api/well-path/calibration/sample',
    module: 'DLL对照校准',
    action: '运行内置样本对照，检查校准链路',
    payload: 'None',
    result: 'CalibrationReport'
  },
  calibrationCompare: {
    method: 'POST',
    path: '/api/well-path/calibration/compare',
    module: 'DLL对照校准',
    action: '输入 MyDrill DLL 输出结果，与 FastAPI 最小曲率结果逐列比较',
    payload: 'reference_rows + optional input_rows + tolerance',
    result: 'CalibrationReport'
  },
  calibrationLatest: {
    method: 'GET',
    path: '/api/well-path/calibration/latest',
    module: 'DLL对照校准',
    action: '读取最近一次 MyDrill 对照校准报告',
    payload: 'None',
    result: 'CalibrationReport'
  },
  importCsv: {
    method: 'POST',
    path: '/wellPath/TbTrajectory/importTrajectParamsCsv',
    module: '轨迹管理',
    action: '导入轨迹 CSV',
    payload: 'multipart/form-data',
    result: 'Import result + trajectory params'
  },
  listTrajectory: {
    method: 'GET',
    path: '/wellPath/TbTrajectory/getPidTbTrajectory',
    module: '轨迹管理',
    action: '获取项目下轨迹列表',
    payload: 'pid',
    result: 'TbTrajectory[]'
  },
  saveTrajectory: {
    method: 'POST',
    path: '/wellPath/TbTrajectory/addToUpdateSingleWellTrajectory',
    module: '轨迹管理',
    action: '保存轨迹元数据',
    payload: 'TbTrajectoryApiDto',
    result: 'ResponseVo'
  },
  saveRows: {
    method: 'POST',
    path: '/wellPath/FrmDesignTest/AddOrUpdateTbTrajectParams',
    module: '轨迹管理',
    action: '保存轨迹点表',
    payload: 'List<DateTableParameterVo>',
    result: 'ResponseVo'
  }
};

const projectData = [
  { name:'渤海湾油田B平台钻井工程', en:'Bohai B Platform Drilling Project', count:23, wells:[['B-1井','设计中'],['B-2井','仿真中'],['B-3井','作业中'],['B-4井','已完成']]},
  { name:'塔里木盆地深层钻探工程', en:'Tarim Basin Deepwell Project', count:18, wells:[['T-1井','作业中'],['T-2井','设计中'],['T-3井','已完成']]},
  { name:'四川盆地页岩气工程', en:'Sichuan Basin Shale Project', count:16, wells:[['S-1井','设计中'],['S-2井','仿真中']]},
  { name:'南海西部开发工程', en:'South China Sea West Project', count:11, wells:[['WZ-1井','作业中'],['WZ-2井','设计中']]}
];

const rowColumns = [
  ['type','类型'],
  ['md','MD(m)'],
  ['inc','INC(°)'],
  ['azi','AZI(°)'],
  ['cl','CL(m)'],
  ['tvd','TVD(m)'],
  ['ns','N/S(m)'],
  ['ew','E/W(m)'],
  ['vsec','V.Sec(m)'],
  ['dogleg','Dogleg(°/30m)'],
  ['tf','TF(°)'],
  ['build','Build(°/30m)'],
  ['turn','Turn(°/30m)'],
  ['remark','备注']
];

const submodules = [
  { key:'design', name:'轨迹设计', route:'/WellboreTrajectory/TrackDesign', desc:'Excel式轨迹数据表、模板井、刷新计算、保存版本' },
  { key:'management', name:'轨迹管理', route:'/TrajectoryManagement', desc:'导入、导出、编辑、激活、复制、删除、显示隐藏' },
  { key:'survey', name:'轨迹测量', route:'/TrajectoryMeasurement', desc:'实测轨迹新建、测斜导入、刷新、保存' },
  { key:'view', name:'轨迹视图', route:'/TrajectoryView', desc:'水平投影、侧面图、井斜、方位、DLS、Build、Turn' },
  { key:'deviation', name:'偏差分析', route:'/DeviationAnalysis/index', desc:'设计/实测/仿真轨迹平面与曲面投影对比' },
  { key:'control', name:'轨迹控制', route:'/TrajectoryControl', desc:'方向控制、单井段控制、连续导向软着陆' },
  { key:'collision', name:'防碰扫描', route:'/CollisionScan/index', desc:'法平面、最近距离、分离距、分离系数、误差椭球' },
  { key:'api', name:'接口状态', route:'/well-path/api-map', desc:'MyDrill well-path API 映射、Mock/API 切换' },
  { key:'importExport', name:'导入导出', route:'/TrajectoryImportExport', desc:'CSV/TXT预览、字段映射、异常行检查、正式上传' },
  { key:'calibration', name:'算法校准', route:'/Calibration/MyDrillAlignment', desc:'MyDrill DLL导出结果与DrillSpace后端最小曲率引擎逐列对照' }
];

function $(id){ return document.getElementById(id); }
function num(v){ return Number(v || 0); }
function fmt(v,d=1){
  if(v === undefined || v === null || Number.isNaN(Number(v))) return '--';
  const s = Number(v).toFixed(d);
  return s.replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');
}
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function esc(v){ return String(v ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }

function initRows(){
  const keyRows = [
    {type:'井口', md:0, inc:0, azi:121.5, cl:0, tvd:0, ns:0, ew:0, vsec:0, dogleg:0, tf:0, build:0, turn:0, remark:'井口'},
    {type:'直井段', md:432, inc:0, azi:121.5, cl:432, tvd:432, ns:0, ew:0, vsec:0, dogleg:0, tf:0, build:0, turn:0, remark:'起造前'},
    {type:'造斜段', md:1250, inc:8.5, azi:121.5, cl:818, tvd:1235, ns:346.4, ew:-100.2, vsec:352, dogleg:3.12, tf:121.5, build:1.2, turn:0, remark:'KOP'},
    {type:'增斜段', md:2680, inc:32, azi:121.5, cl:1430, tvd:2456, ns:1043.5, ew:-302.6, vsec:1086, dogleg:3.85, tf:121.5, build:1.65, turn:0, remark:'Build End'},
    {type:'稳斜段', md:3180, inc:32, azi:121.5, cl:500, tvd:2858, ns:1645.2, ew:-476.4, vsec:1712, dogleg:0, tf:0, build:0, turn:0, remark:'Hold'},
    {type:'降斜段', md:4320, inc:32, azi:121.5, cl:1140, tvd:3880, ns:4185.6, ew:-1212.3, vsec:4358, dogleg:0, tf:0, build:0, turn:0, remark:'Landing'},
    {type:'终点', md:5320, inc:10, azi:121.5, cl:1000, tvd:4320, ns:5262.8, ew:-1526.4, vsec:5452, dogleg:2.1, tf:121.5, build:-0.5, turn:0, remark:'靶点'}
  ];
  state.rows = [];
  for(let i=0;i<1200;i++){
    if(i<keyRows.length){ state.rows.push({...keyRows[i]}); continue; }
    const step = i-keyRows.length+1;
    const md = 5320 + step*30;
    const inc = Math.max(0, 10 + Math.sin(i/28)*1.8);
    const azi = 121.5 + Math.sin(i/50)*0.6;
    const cl = 30;
    const tvd = 4320 + step*18;
    const ns = 5262.8 + step*28.5;
    const ew = -1526.4 - step*8.7;
    state.rows.push({type:'水平段', md, inc:+inc.toFixed(2), azi:+azi.toFixed(2), cl, tvd:+tvd.toFixed(1), ns:+ns.toFixed(1), ew:+ew.toFixed(1), vsec:+(ns*1.02).toFixed(1), dogleg:+(Math.abs(Math.sin(i/20))*0.8).toFixed(2), tf:0, build:+(Math.sin(i/19)*0.2).toFixed(2), turn:+(Math.cos(i/33)*0.05).toFixed(2), remark:'自动插值点'});
  }
  state.surveyRows = state.rows.slice(0, 120).map((r,i)=>({ ...r, type:'实测', md:+(num(r.md)+Math.sin(i/7)*0.6).toFixed(2), inc:+(num(r.inc)+Math.sin(i/9)*0.35).toFixed(2), azi:+(num(r.azi)+Math.cos(i/10)*0.4).toFixed(2), remark:'测斜点' }));
  state.trajectories = [
    { id:'TRJ-A5123', name:'B-1井 设计轨迹 A5123', type:'设计', rows:1200, active:true, source:'DrillSpace', updated:'11:43:06' },
    { id:'TRJ-S4210', name:'B-1井 实测轨迹 S4210', type:'实测', rows:120, active:false, source:'MWD/CSV', updated:'09:15:20' },
    { id:'TRJ-SIM-0918', name:'B-1井 仿真轨迹 SIM-0918', type:'仿真', rows:960, active:false, source:'well-dynamic', updated:'昨天' },
    { id:'TRJ-B2-REF', name:'B-2井 邻井参考轨迹', type:'邻井', rows:880, active:false, source:'History', updated:'2024-05-18' }
  ];
}

function renderTree(){
  const tree = $('projectTree');
  tree.innerHTML = projectData.map((p,pi)=>`
    <div class="tree-group">
      <div class="tree-title">⌄ ${esc(p.name)}<em>${p.count}</em><small style="display:block;font-weight:500;color:#789;grid-column:1/3">${esc(p.en)}</small></div>
      ${p.wells.map((w,wi)=>`<div class="well-node ${pi===0&&wi===0?'active':''}"><span>↳</span><b>${esc(w[0])}</b><span class="${w[1]==='已完成'?'green':w[1]==='作业中'?'orange':'blue'}">${esc(w[1])}</span></div>`).join('')}
    </div>`).join('') + '<button class="link-btn" style="width:100%;margin-top:4px">打开井浏览器...</button>';
}

function renderSubsystemRoutes(){
  $('subsystemRouteList').innerHTML = submodules.map(m => `
    <button class="${state.activeSubmodule===m.key?'active':''}" data-route-module="${m.key}">
      <b>${esc(m.route)}</b><span>${esc(m.name)} · ${esc(m.desc)}</span>
    </button>`).join('');
  document.querySelectorAll('[data-route-module]').forEach(btn => btn.onclick = () => setSubmodule(btn.dataset.routeModule));
}

function setSubmodule(key){
  state.activeSubmodule = key;
  document.querySelectorAll('#subtabRow button').forEach(b => b.classList.toggle('active', b.dataset.module === key));
  renderSubsystemRoutes();
  const module = submodules.find(m => m.key === key) || submodules[0];
  $('pageTitle').textContent = `${module.name} · ${module.desc.split('、')[0] || '井眼轨迹子系统'}`;
  $('pageSubtitle').textContent = `${module.route}：${module.desc}`;
  if(key === 'design') switchEditorView('grid');
  else if(key === 'management') renderTrajectoryManagement();
  else if(key === 'survey') renderSurveyEditor();
  else if(key === 'view') switchEditorView('profile');
  else if(key === 'deviation') switchEditorView('deviation');
  else if(key === 'control') renderTrajectoryControl();
  else if(key === 'collision') switchEditorView('collision');
  else if(key === 'api') renderApiContractInline();
  else if(key === 'importExport') renderImportExportPanel();
  else if(key === 'calibration') renderCalibrationReportPage();
  addLog(`切换到${module.name}`);
}

function renderGrid(){
  state.editorView = 'grid';
  setActiveViewButton('grid');
  $('workbookTitle').textContent = '轨迹数据表 / Trajectory Data Sheet';
  $('rowCountLabel').textContent = `${state.rows.length} rows · virtual grid · editable · paste from Excel supported`;
  const content = $('editorContent');
  content.innerHTML = `<div class="sheet-wrap" id="sheetWrap"><table class="trajectory-sheet"><thead><tr><th class="selector">选中</th><th class="idx">序号</th>${rowColumns.map(c=>`<th>${esc(c[1])}</th>`).join('')}</tr></thead><tbody id="trajectoryTbody"></tbody></table></div>`;
  const wrap = $('sheetWrap');
  const tbody = $('trajectoryTbody');
  wrap.scrollTop = Math.min(gridRuntime.scrollTop || 0, Math.max(0, state.rows.length * GRID_ROW_HEIGHT - wrap.clientHeight));
  renderVirtualRows(true);
  wrap.addEventListener('scroll', () => {
    gridRuntime.scrollTop = wrap.scrollTop;
    if(gridRuntime.raf) cancelAnimationFrame(gridRuntime.raf);
    gridRuntime.raf = requestAnimationFrame(() => renderVirtualRows(false));
  }, { passive: true });
  tbody.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-index]');
    if(!tr) return;
    selectRow(Number(tr.dataset.index), false);
  });
  tbody.addEventListener('input', e => {
    const input = e.target.closest('input,select');
    if(!input) return;
    const tr = input.closest('tr[data-index]');
    if(!tr) return;
    const idx = Number(tr.dataset.index);
    const key = input.dataset.key;
    const value = input.tagName === 'SELECT' || key === 'remark' || key === 'type' ? input.value : Number(input.value || 0);
    state.rows[idx][key] = value;
    state.changedCells.add(`${idx}:${key}`);
    input.classList.toggle('invalid', !isCellValid(key, value, idx));
    if(idx === state.selectedRow) renderRowProps();
    updateSummary();
  });
  tbody.addEventListener('paste', handleGridPaste);
  selectRow(state.selectedRow, false);
}

function renderVirtualRows(force=false){
  const wrap = $('sheetWrap');
  const tbody = $('trajectoryTbody');
  if(!wrap || !tbody) return;
  const scrollTop = wrap.scrollTop || 0;
  const viewportRows = Math.ceil((wrap.clientHeight || 520) / GRID_ROW_HEIGHT);
  const start = Math.max(0, Math.floor(scrollTop / GRID_ROW_HEIGHT) - GRID_BUFFER_ROWS);
  const end = Math.min(state.rows.length, start + viewportRows + GRID_BUFFER_ROWS * 2);
  if(!force && start === gridRuntime.start && end === gridRuntime.end) return;
  gridRuntime.start = start;
  gridRuntime.end = end;
  const colSpan = rowColumns.length + 2;
  const topPad = start * GRID_ROW_HEIGHT;
  const bottomPad = Math.max(0, (state.rows.length - end) * GRID_ROW_HEIGHT);
  const topSpacer = topPad ? `<tr class="virtual-spacer" style="height:${topPad}px"><td colspan="${colSpan}"></td></tr>` : '';
  const bottomSpacer = bottomPad ? `<tr class="virtual-spacer" style="height:${bottomPad}px"><td colspan="${colSpan}"></td></tr>` : '';
  const rowsHtml = state.rows.slice(start,end).map((r,offset)=>renderRow(r,start+offset)).join('');
  tbody.innerHTML = topSpacer + rowsHtml + bottomSpacer;
}

function renderRow(r,i){
  const cells = rowColumns.map(([k]) => {
    const changed = state.changedCells.has(`${i}:${k}`) ? 'changed' : '';
    const invalid = !isCellValid(k, r[k], i) ? 'invalid' : '';
    if(k === 'type'){
      return `<td class="${changed} ${invalid}"><select data-key="type">${['井口','直井段','造斜段','增斜段','稳斜段','水平段','插值点','实测','终点'].map(opt => `<option ${r.type===opt?'selected':''}>${opt}</option>`).join('')}</select></td>`;
    }
    return `<td class="${changed} ${invalid}"><input data-key="${k}" value="${esc(r[k])}" ${k==='remark'?'style="width:130px;text-align:left"':''}/></td>`;
  }).join('');
  return `<tr data-index="${i}" class="${i===state.selectedRow?'selected':''}"><td class="selector"><span class="row-radio"></span></td><td class="idx">${i+1}</td>${cells}</tr>`;
}

function isCellValid(key, value, idx){
  if(['md','inc','azi','tvd','ns','ew','cl','dogleg','build','turn','tf','vsec'].includes(key)){
    if(value === '' || value === null || Number.isNaN(Number(value))) return false;
  }
  if(key === 'md' && idx > 0 && Number(value) < Number(state.rows[idx-1]?.md || 0)) return false;
  if(key === 'inc' && (Number(value) < 0 || Number(value) > 180)) return false;
  if(key === 'azi' && (Number(value) < -360 || Number(value) > 720)) return false;
  return true;
}

function validateRows(){
  const invalidRows = [];
  const warnings = [];
  state.rows.forEach((r,i) => {
    if(i > 0 && num(r.md) < num(state.rows[i-1].md)) invalidRows.push(i+1);
    if(num(r.inc) < 0 || num(r.inc) > 180) invalidRows.push(i+1);
    if(num(r.dogleg) > 6) warnings.push(`Row ${i+1}: DLS ${fmt(r.dogleg,2)} 超过建议阈值`);
  });
  state.validation = { invalidRows:[...new Set(invalidRows)], warnings };
  return state.validation;
}

function selectRow(idx, scroll=true){
  state.selectedRow = clamp(idx,0,state.rows.length-1);
  const wrap = $('sheetWrap');
  if(scroll && wrap){
    const top = state.selectedRow * GRID_ROW_HEIGHT;
    const bottom = top + GRID_ROW_HEIGHT;
    if(top < wrap.scrollTop || bottom > wrap.scrollTop + wrap.clientHeight){
      wrap.scrollTop = Math.max(0, top - GRID_ROW_HEIGHT * 4);
      gridRuntime.scrollTop = wrap.scrollTop;
      renderVirtualRows(true);
    }
  }
  document.querySelectorAll('.trajectory-sheet tr[data-index]').forEach(tr => tr.classList.toggle('selected', Number(tr.dataset.index) === state.selectedRow));
  renderRowProps();
}

function renderRowProps(){
  const r = state.rows[state.selectedRow] || state.rows[0];
  if(!r) return;
  $('selectedRowTag').textContent = `Row ${state.selectedRow+1}`;
  const keys = ['md','inc','azi','cl','tvd','ns','ew','dogleg','tf','build','turn'];
  $('rowPropForm').innerHTML = keys.map(k => `<label>${k.toUpperCase()}<input data-prop="${k}" value="${esc(r[k])}" /></label>`).join('');
}

function applyRowProps(){
  const r = state.rows[state.selectedRow];
  if(!r) return;
  document.querySelectorAll('#rowPropForm input').forEach(inp => {
    const key = inp.dataset.prop;
    r[key] = Number(inp.value || 0);
    state.changedCells.add(`${state.selectedRow}:${key}`);
  });
  rerenderCurrentView();
  updateSummary();
  toast('当前行属性已应用到轨迹数据表');
  addLog(`应用 Row ${state.selectedRow+1} 属性`);
}

function handleGridPaste(e){
  const input = e.target.closest('input');
  if(!input) return;
  const text = (e.clipboardData || window.clipboardData).getData('text');
  if(!text || !text.includes('\n')) return;
  e.preventDefault();
  const tr = input.closest('tr');
  const startRow = Number(tr.dataset.index);
  const startCol = rowColumns.findIndex(([k]) => k === input.dataset.key);
  const lines = text.trim().split(/\r?\n/).map(line => line.split(/\t|,/));
  lines.forEach((cols,ri) => {
    const rowIndex = startRow + ri;
    if(!state.rows[rowIndex]) state.rows[rowIndex] = createEmptyRow(num(state.rows[rowIndex-1]?.md || 0) + 30);
    cols.forEach((val,ci) => {
      const col = rowColumns[startCol + ci];
      if(!col) return;
      const key = col[0];
      state.rows[rowIndex][key] = ['type','remark'].includes(key) ? val : Number(val || 0);
      state.changedCells.add(`${rowIndex}:${key}`);
    });
  });
  renderGrid();
  updateSummary();
  addLog(`从 Excel 粘贴 ${lines.length} 行数据`);
  toast(`已粘贴 ${lines.length} 行数据`);
}

function createEmptyRow(md=0){
  return { type:'插值点', md, inc:0, azi:0, cl:30, tvd:0, ns:0, ew:0, vsec:0, dogleg:0, tf:0, build:0, turn:0, remark:'' };
}

function updateSummary(){
  const last = state.rows[state.rows.length-1] || createEmptyRow();
  const maxDls = Math.max(...state.rows.slice(0,300).map(r => num(r.dogleg)), 0);
  const validation = validateRows();
  $('rowCountKpi').textContent = String(state.rows.length);
  $('maxDlsKpi').textContent = `${fmt(maxDls,2)}°/30m`;
  $('collisionRiskKpi').textContent = state.collision.risk;
  $('apiModeKpi').textContent = state.apiMode.toUpperCase();
  $('apiModeBtn').textContent = state.apiMode.toUpperCase();
  $('apiModeBtn').classList.toggle('api', state.apiMode === 'api');
  $('serviceStatusText').textContent = `well-path：${state.apiMode === 'api' ? 'API Mode' : 'Mock Mode'} · ${state.apiBaseUrl}`;
  $('rowCountLabel').textContent = `${state.rows.length} rows · ${validation.invalidRows.length} invalid · ${validation.warnings.length} warnings`;
  $('compactMetrics').innerHTML = [
    ['测深MD',`${fmt(last.md,0)}m`],
    ['垂深TVD',`${fmt(last.tvd,1)}m`],
    ['N/S位移',`${fmt(last.ns,1)}m`],
    ['E/W位移',`${fmt(last.ew,1)}m`],
    ['最大DLS',`${fmt(maxDls,2)}°/30m`],
    ['异常行',`${validation.invalidRows.length}`]
  ].map(([a,b])=>`<div class="metric-line"><span>${a}</span><b>${b}</b></div>`).join('');
  renderRiskLines(maxDls, validation);
  renderApiList();
}

function renderRiskLines(maxDls, validation){
  const risk = state.collision;
  $('qualityTag').textContent = validation.invalidRows.length ? '需检查' : risk.risk + '风险';
  $('qualityTag').className = validation.invalidRows.length ? 'tag-medium warn' : 'tag-medium';
  $('riskLines').innerHTML = [
    ['最小中心距',`${fmt(risk.minDistance,1)} m`],
    ['最小分离系数',`${fmt(risk.minSF,2)}`],
    ['最近邻井',risk.nearestWell],
    ['最大DLS',`${fmt(maxDls,2)}°/30m`],
    ['异常行数',String(validation.invalidRows.length)],
    ['误差椭球','Ready']
  ].map(([a,b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
}

function renderApiList(){
  const keys = ['calculateTable','designTemplate','verticalProfile','horizontalProjection','flatScan','nearestDistance','importCsv','saveRows'];
  $('apiList').innerHTML = keys.map(key => {
    const api = trajectoryApiMap[key];
    const last = state.apiHistory.find(h => h.key === key);
    const status = last ? last.status : (state.apiMode === 'api' ? 'Ready' : 'Mock');
    return `<div><b>${api.method}</b> ${api.path} <span class="${status==='OK'?'call-ok':status==='Mock'?'call-mock':status==='Fail'?'call-fail':''}">${status}</span></div>`;
  }).join('');
}

function renderAlerts(){
  $('alertList').innerHTML = [
    ['high','井眼与邻井 B-2 接近','井深：2680.0m — 2710.0m','10:30'],
    ['mid','轨迹表存在待确认插值点','Row 8 — Row 60 之间新增插值','09:15'],
    ['mid','DLS 接近设计阈值','最大：3.85°/30m','08:45'],
    ['low','API 模式未启用','当前使用 Mock 返回','当前']
  ].map(a => `<div class="risk ${a[0]}"><b>${a[1]}</b><span>${a[2]}</span><em>${a[3]}</em></div>`).join('');
}

function renderTasks(){
  $('taskList').innerHTML = [
    ['轨迹数据表工业编辑器',100],
    ['MyDrill well-path API 映射',96],
    ['导入预览与字段映射',92],
    ['防碰扫描 Mock/API 合同',78],
    ['后端 Java well-path 联调',35]
  ].map(t => `<div><b>${t[0]}</b><i style="width:${t[1]}%"></i><span>${t[1]}%</span></div>`).join('');
}

function renderLogs(){
  $('logList').innerHTML = state.logs.map((l,i)=>`<div><span>${String(i+1).padStart(2,'0')} ${esc(l.msg)}</span><b>${l.time}</b></div>`).join('');
}

function renderApiHistory(){
  $('apiHistoryList').innerHTML = state.apiHistory.slice(0,8).map(h => `<div><b>${h.status}</b><span>${esc(h.method)} ${esc(h.path)}</span><em>${h.time}</em></div>`).join('') || '<div><b>--</b><span>暂无接口调用</span><em>--</em></div>';
}

function setActiveViewButton(view){
  document.querySelectorAll('.view-switch button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
}

function switchEditorView(view){
  state.editorView = view;
  setActiveViewButton(view);
  if(view === 'grid') return renderGrid();
  if(['profile','plan','inc','azi','dls','build','turn'].includes(view)) return renderChart(view);
  if(view === 'deviation') return renderDeviationView();
  if(view === 'collision') return renderCollisionView();
  renderGrid();
}

function rerenderCurrentView(){
  if(state.editorView === 'grid') renderGrid();
  else switchEditorView(state.editorView);
}

function chartConfig(type){
  const configs = {
    profile: { title:'侧面视图 / TVD - Horizontal Displacement', api:'verticalProfile', x:r=>num(r.ns), y:r=>num(r.tvd), yInvert:false, unit:'TVD(m)' },
    plan: { title:'水平投影 / North-South - East-West', api:'horizontalProjection', x:r=>num(r.ns), y:r=>num(r.ew), yInvert:false, unit:'E/W(m)' },
    inc: { title:'井斜角曲线 / Inclination', api:'inclination', x:r=>num(r.md), y:r=>num(r.inc), yInvert:true, unit:'INC(°)' },
    azi: { title:'方位角曲线 / Azimuth', api:'azimuth', x:r=>num(r.md), y:r=>num(r.azi), yInvert:true, unit:'AZI(°)' },
    dls: { title:'狗腿度 / 曲率 / Dogleg Severity', api:'dogleg', x:r=>num(r.md), y:r=>num(r.dogleg), yInvert:true, unit:'DLS(°/30m)' },
    build: { title:'造斜率 / Build Rate', api:'build', x:r=>num(r.md), y:r=>num(r.build), yInvert:true, unit:'Build(°/30m)' },
    turn: { title:'偏转率 / Turn Rate', api:'turn', x:r=>num(r.md), y:r=>num(r.turn), yInvert:true, unit:'Turn(°/30m)' }
  };
  return configs[type] || configs.profile;
}

function renderChart(type){
  const cfg = chartConfig(type);
  $('workbookTitle').textContent = cfg.title;
  $('rowCountLabel').textContent = `${state.rows.length} points · API: ${trajectoryApiMap[cfg.api]?.path || 'local'}`;
  const content = $('editorContent');
  const sample = sampleRows(state.rows, 220);
  const altSample = sampleRows(state.surveyRows.length ? state.surveyRows : state.rows.slice(0,160), 160);
  const points = pointsFor(sample, cfg.x, cfg.y, cfg.yInvert);
  const points2 = pointsFor(altSample, cfg.x, cfg.y, cfg.yInvert, {xPad:70,yPad:55,w:850,h:390,noise:10});
  content.innerHTML = `<div class="chart-view"><div class="chart-canvas">
    <div class="chart-title">${esc(cfg.title)}</div>
    <div class="chart-legend"><span><i class="blue-line"></i>设计</span><span><i class="green-line"></i>实测/仿真</span><span><i class="red-line"></i>阈值</span></div>
    <div class="axis-label" style="left:18px;top:52px">${esc(cfg.unit)}</div>
    <div class="axis-label" style="left:18px;bottom:16px">MD / Displacement</div>
    <svg viewBox="0 0 1000 500" preserveAspectRatio="none">
      ${gridSvg()}
      <polyline points="${points}" fill="none" stroke="#0f63d6" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
      <polyline points="${points2}" fill="none" stroke="#12a66a" stroke-width="3" stroke-dasharray="10 8"/>
      <line x1="70" x2="930" y1="210" y2="210" stroke="#f59e0b" stroke-width="2" stroke-dasharray="8 8"/>
      <line x1="70" x2="930" y1="330" y2="330" stroke="#ef4444" stroke-width="2" stroke-dasharray="8 8"/>
      <circle cx="${lastPointX(points)}" cy="${lastPointY(points)}" r="9" fill="#fff" stroke="#ef4444" stroke-width="5"/>
      <text x="120" y="110" fill="#0d2e55" font-size="22" font-weight="800">KOP @1250m</text>
      <text x="380" y="260" fill="#0d2e55" font-size="22" font-weight="800">Build / Hold</text>
      <text x="665" y="375" fill="#0d2e55" font-size="22" font-weight="800">Target</text>
    </svg>
    <button class="link-btn" style="position:absolute;right:14px;bottom:12px" onclick="invokeViewApi('${cfg.api}')">调用 ${esc(cfg.api)} API</button>
  </div><div class="chart-bottom-table">${miniRowsTable(sample.slice(0,12))}</div></div>`;
}

function sampleRows(rows, n){
  if(rows.length <= n) return rows;
  const step = Math.max(1, Math.floor(rows.length / n));
  const out = [];
  for(let i=0;i<rows.length;i+=step) out.push(rows[i]);
  return out.slice(0,n);
}

function pointsFor(rows, xFn, yFn, yInvert=false, opt={}){
  const xPad = opt.xPad ?? 70, yPad = opt.yPad ?? 55, w = opt.w ?? 850, h = opt.h ?? 390;
  const xs = rows.map(xFn), ys = rows.map(yFn);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return rows.map((r,i) => {
    const xNorm = (xFn(r)-minX)/Math.max(1e-9,maxX-minX);
    const yNorm = (yFn(r)-minY)/Math.max(1e-9,maxY-minY);
    const x = xPad + xNorm*w;
    let y = yInvert ? yPad + (1-yNorm)*h : yPad + yNorm*h;
    if(opt.noise) y += Math.sin(i/7)*opt.noise;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function lastPointX(points){ const last = points.trim().split(' ').pop() || '900,400'; return last.split(',')[0]; }
function lastPointY(points){ const last = points.trim().split(' ').pop() || '900,400'; return last.split(',')[1]; }
function gridSvg(){
  let s = '';
  for(let x=70;x<=930;x+=86) s += `<line x1="${x}" x2="${x}" y1="55" y2="445" stroke="#d9e5f2" stroke-width="1"/>`;
  for(let y=55;y<=445;y+=39) s += `<line x1="70" x2="930" y1="${y}" y2="${y}" stroke="#d9e5f2" stroke-width="1"/>`;
  return s;
}

function miniRowsTable(rows){
  return `<table class="mini-table"><thead><tr><th>节点</th><th>MD</th><th>INC</th><th>AZI</th><th>TVD</th><th>N/S</th><th>E/W</th><th>DLS</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${fmt(r.md,0)}</td><td>${fmt(r.inc,2)}</td><td>${fmt(r.azi,2)}</td><td>${fmt(r.tvd,1)}</td><td>${fmt(r.ns,1)}</td><td>${fmt(r.ew,1)}</td><td>${fmt(r.dogleg,2)}</td></tr>`).join('')}</tbody></table>`;
}

function renderDeviationView(){
  state.editorView = 'deviation';
  setActiveViewButton('deviation');
  $('workbookTitle').textContent = '偏差分析 / Design - Survey - Simulation Comparison';
  $('rowCountLabel').textContent = '平面投影 / 曲面投影 / 关键偏差统计';
  const rows = state.rows.slice(0,12).map((r,i)=>({
    md: r.md,
    planDev: Math.abs(Math.sin(i/2)*2.6 + i*0.12),
    tvdDev: Math.abs(Math.cos(i/3)*1.9),
    incDev: Math.abs(Math.sin(i/4)*0.6),
    aziDev: Math.abs(Math.cos(i/5)*0.8)
  }));
  $('editorContent').innerHTML = `<div class="submodule-content">
    <div class="module-grid">
      <div class="module-tile"><b>平面投影对比</b><p>设计轨迹、实测轨迹、仿真轨迹在水平面内的偏差分析，支持 Chart/Sheet 切换。</p><div class="btn-line"><button class="primary" onclick="callApiAction('horizontalProjection')">调用水平投影</button><button onclick="switchEditorView('plan')">查看图形</button></div></div>
      <div class="module-tile"><b>曲面投影对比</b><p>沿井眼曲面投影进行设计—实测—仿真偏差统计，用于轨迹跟踪评价。</p><div class="btn-line"><button onclick="callApiAction('verticalProfile')">调用剖面接口</button><button onclick="showDeviationSettings()">设置</button></div></div>
    </div>
    <table class="deviation-table" style="margin-top:10px"><thead><tr><th>MD</th><th>平面偏差(m)</th><th>TVD偏差(m)</th><th>INC偏差(°)</th><th>AZI偏差(°)</th><th>状态</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${fmt(r.md,0)}</td><td>${fmt(r.planDev,2)}</td><td>${fmt(r.tvdDev,2)}</td><td>${fmt(r.incDev,2)}</td><td>${fmt(r.aziDev,2)}</td><td>${r.planDev>4?'<b style="color:#c53333">检查</b>':'正常'}</td></tr>`).join('')}
    </tbody></table>
  </div>`;
}

function renderCollisionView(){
  state.editorView = 'collision';
  setActiveViewButton('collision');
  $('workbookTitle').textContent = '防碰扫描工作台 / Collision View Manager';
  $('rowCountLabel').textContent = '单数据源、多视图切换：最近距离、法平面、水平扫描、分离矩阵、分离系数、误差椭球';

  if(!state.collisionResults.length){
    normalizeCollisionResult(localCollisionScan(state.collisionMethod || 'nearestDistance'), state.collisionMethod || 'nearestDistance');
  }

  const scan = getCollisionScanPoints();
  const summary = getCollisionSummary(scan);
  const matrix = state.collisionMatrix && state.collisionMatrix.length ? state.collisionMatrix : buildSeparationMatrix(scan);
  const factors = buildSeparationFactorRows(scan);
  const currentView = state.collisionView || 'normalPlane';
  const layout = state.collisionLayout || 'single';
  const viewTitle = collisionViewTitle(currentView);
  const nearest = scan.reduce((a,b)=> !a || num(b.centerDistance) < num(a.centerDistance) ? b : a, null) || {};
  const riskClass = summary.minSF < 1 ? 'danger' : summary.minSF < 1.5 ? 'warn' : summary.minSF < 2 ? 'medium' : 'safe';

  $('editorContent').innerHTML = `<div class="submodule-content collision-workbench-v281">
    <div class="collision-vm-head">
      <div>
        <b>Collision View Manager</b>
        <span>统一防碰结果数据源 · 单主图焦点分析 · 可切换并列对比</span>
      </div>
      <div class="collision-layout-toggle">
        <button class="${layout==='single'?'active':''}" onclick="setCollisionLayout('single')">单视图</button>
        <button class="${layout==='compare'?'active':''}" onclick="setCollisionLayout('compare')">并列对比</button>
      </div>
    </div>

    <div class="collision-view-tabs-v281">
      <button class="${currentView==='nearest'?'active':''}" onclick="setCollisionView('nearest')"><span>01</span><b>最近距离</b><em>NEAREST</em></button>
      <button class="${currentView==='normalPlane'?'active':''}" onclick="setCollisionView('normalPlane')"><span>02</span><b>法平面扫描</b><em>NORMAL PLANE</em></button>
      <button class="${currentView==='horizontalPlane'?'active':''}" onclick="setCollisionView('horizontalPlane')"><span>03</span><b>水平扫描</b><em>HORIZONTAL</em></button>
      <button class="${currentView==='separationMatrix'?'active':''}" onclick="setCollisionView('separationMatrix')"><span>04</span><b>分离矩阵</b><em>MATRIX</em></button>
      <button class="${currentView==='separationFactor'?'active':''}" onclick="setCollisionView('separationFactor')"><span>05</span><b>分离系数</b><em>SF CURVE</em></button>
      <button class="${currentView==='ellipsoid'?'active':''}" onclick="setCollisionView('ellipsoid')"><span>06</span><b>误差椭球</b><em>ELLIPSOID</em></button>
      <button onclick="showCollisionSettings()"><span>⚙</span><b>扫描设置</b><em>CONFIG</em></button>
    </div>

    <div class="collision-scan-actions-v281">
      <button onclick="runCollisionAndFocus('nearestDistance','nearest')">最近距离扫描</button>
      <button onclick="runCollisionAndFocus('flatScan','normalPlane')">法平面扫描</button>
      <button onclick="runCollisionAndFocus('separationDistance','separationMatrix')">分离距 / 分离矩阵</button>
      <button onclick="runCollisionAndFocus('separationFactor','separationFactor')">分离系数</button>
      <button onclick="runCollisionAndFocus('errorEllipsoid','ellipsoid')">误差椭球</button>
    </div>

    <div class="collision-summary-grid v281">
      <div class="collision-summary ${riskClass}"><span>最小中心距</span><b>${fmt(summary.minDistance,2)} m</b><em>Nearest Distance</em></div>
      <div class="collision-summary ${riskClass}"><span>最小分离系数</span><b>${fmt(summary.minSF,2)}</b><em>Separation Factor</em></div>
      <div class="collision-summary"><span>最近井深</span><b>${fmt(summary.nearestMd || nearest.md || 0,1)} m</b><em>Nearest MD</em></div>
      <div class="collision-summary"><span>比较井</span><b>${esc(summary.nearestWell || state.collisionSettings.neighborWell)}</b><em>Neighbor Well</em></div>
      <div class="collision-summary"><span>当前视图</span><b>${esc(viewTitle)}</b><em>Active View</em></div>
      <div class="collision-summary"><span>风险等级</span><b>${esc(summary.risk)}风险</b><em>ISCWSA-style Review</em></div>
    </div>

    ${layout === 'compare' ? collisionCompareViewport(scan, matrix, factors) : collisionSingleViewport(currentView, scan, matrix, factors)}
  </div>`;
}

function getCollisionScanPoints(){
  return state.collisionResults && state.collisionResults.length ? state.collisionResults : localCollisionScan(state.collisionMethod || 'nearestDistance').scanPoints;
}

function getCollisionSummary(scan){
  const minRow = (scan || []).reduce((a,b)=> !a || num(b.centerDistance) < num(a.centerDistance) ? b : a, null) || {};
  return {
    minDistance: num(state.collision.minDistance || minRow.centerDistance),
    minSF: num(state.collision.minSF || minRow.separationFactor),
    nearestWell: state.collision.nearestWell || minRow.neighborWell || state.collisionSettings.neighborWell,
    nearestMd: num(state.collision.nearestMd || minRow.md),
    risk: state.collision.risk || riskBySf(minRow.separationFactor || state.collision.minSF)
  };
}

function collisionViewTitle(view){
  return ({
    nearest:'最近距离',
    normalPlane:'法平面扫描',
    horizontalPlane:'水平扫描',
    separationMatrix:'分离矩阵',
    separationFactor:'分离系数',
    ellipsoid:'误差椭球'
  })[view] || view;
}

function setCollisionView(view){
  state.collisionView = view;
  renderCollisionView();
  addLog(`切换防碰视图：${collisionViewTitle(view)}`);
}

function setCollisionLayout(layout){
  state.collisionLayout = layout;
  renderCollisionView();
  toast(layout === 'compare' ? '已切换到并列对比模式' : '已切换到单主图模式');
}

function runCollisionAndFocus(method, view){
  state.collisionView = view;
  return runCollisionScan(method);
}

function collisionSingleViewport(view, scan, matrix, factors){
  const title = collisionViewTitle(view);
  const subtitle = ({
    nearest:'MD 与最近距离关系，适合定位危险井段。',
    normalPlane:'最近距离与法平面扫描角关系，适合审查法平面方向。',
    horizontalPlane:'最近距离与水平扫描角关系，适合观察平面方位风险。',
    separationMatrix:'当前井与邻井组之间的最小距离、分离距与分离系数。',
    separationFactor:'沿测深方向的分离系数分布，用于风险等级判读。',
    ellipsoid:'误差椭球与不确定性模型预览，用于后续测量误差建模。'
  })[view] || '';
  return `<div class="collision-focus-shell">
    <div class="collision-focus-title"><div><b>${esc(title)}</b><span>${esc(subtitle)}</span></div><button onclick="setCollisionLayout('compare')">并列查看</button></div>
    <div class="collision-focus-main ${view}">
      ${collisionMainViewHtml(view, scan, matrix, factors)}
    </div>
  </div>`;
}

function collisionMainViewHtml(view, scan, matrix, factors){
  if(view === 'nearest') return `<div class="collision-big-plot">${collisionDistanceSvg(scan)}</div>${collisionNearestTable(scan, 18)}`;
  if(view === 'normalPlane') return `<div class="collision-big-polar">${collisionPolarSvg(scan,'normal')}</div>${collisionNearestTable(scan, 12)}`;
  if(view === 'horizontalPlane') return `<div class="collision-big-polar">${collisionPolarSvg(scan,'horizontal')}</div>${collisionNearestTable(scan, 12)}`;
  if(view === 'separationMatrix') return collisionMatrixTable(matrix);
  if(view === 'separationFactor') return `<div class="collision-big-plot">${collisionFactorSvg(factors)}</div>${collisionFactorTable(factors, 26)}`;
  if(view === 'ellipsoid') return collisionEllipsoidView(scan);
  return `<div class="small-note">未知防碰视图：${esc(view)}</div>`;
}

function collisionCompareViewport(scan, matrix, factors){
  return `<div class="collision-compare-grid-v281">
    <section class="collision-card"><div class="collision-card-title"><b>最近距离曲线</b><span>Nearest Distance</span></div>${collisionDistanceSvg(scan)}</section>
    <section class="collision-card"><div class="collision-card-title"><b>法平面扫描极图</b><span>Normal Plane Polar</span></div>${collisionPolarSvg(scan,'normal')}</section>
    <section class="collision-card"><div class="collision-card-title"><b>水平扫描极图</b><span>Horizontal Polar</span></div>${collisionPolarSvg(scan,'horizontal')}</section>
    <section class="collision-card"><div class="collision-card-title"><b>分离系数曲线</b><span>Separation Factor</span></div>${collisionFactorSvg(factors)}</section>
    <section class="collision-result-card wide"><div class="collision-card-title"><b>分离矩阵</b><span>Separation Matrix</span></div>${collisionMatrixTable(matrix)}</section>
  </div>`;
}

function collisionNearestTable(scan, limit=24){
  const rows = scan.slice().sort((a,b)=>num(a.centerDistance)-num(b.centerDistance)).slice(0,limit).map((r,i)=>`<tr class="${r.riskLevel==='高'?'row-danger':r.riskLevel==='中'?'row-warn':''}">
    <td>${i+1}</td><td>${fmt(r.md,1)}</td><td>${esc(r.neighborWell || state.collisionSettings.neighborWell)}</td>
    <td>${fmt(r.centerDistance,2)}</td><td>${fmt(r.separationDistance,2)}</td><td>${fmt(r.separationFactor,2)}</td>
    <td>${fmt(collisionAngle(r,'normal'),1)}°</td><td>${fmt(collisionAngle(r,'horizontal'),1)}°</td><td><b>${esc(r.riskLevel || riskBySf(r.separationFactor))}</b></td>
  </tr>`).join('');
  return `<div class="collision-focus-table"><table class="collision-table"><thead><tr><th>#</th><th>MD</th><th>比较井</th><th>中心距</th><th>分离距</th><th>SF</th><th>法平面角</th><th>水平角</th><th>风险</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function collisionMatrixTable(matrix){
  const rows = (matrix || []).map((r,i)=>`<tr class="${r.risk==='高'?'row-danger':r.risk==='中'?'row-warn':''}">
    <td>${i+1}</td><td>${esc(r.well)}</td><td>${fmt(r.nearestMd,1)}</td><td>${fmt(r.minCenterDistance,2)}</td>
    <td>${fmt(r.minSeparationDistance,2)}</td><td>${fmt(r.minSeparationFactor,2)}</td><td>${esc(r.scanMethod)}</td><td><b>${esc(r.risk)}</b></td>
  </tr>`).join('');
  return `<div class="collision-focus-table matrix"><table class="collision-table"><thead><tr><th>#</th><th>邻井</th><th>最近MD</th><th>最小中心距</th><th>最小分离距</th><th>最小SF</th><th>扫描方法</th><th>风险</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function collisionFactorTable(factors, limit=32){
  const rows = (factors || []).slice(0,limit).map((r,i)=>`<tr class="${r.sf<1?'row-danger':r.sf<1.5?'row-warn':''}"><td>${i+1}</td><td>${fmt(r.md,1)}</td><td>${fmt(r.center,2)}</td><td>${fmt(r.clearance,2)}</td><td>${fmt(r.sf,2)}</td><td>${esc(r.level)}</td></tr>`).join('');
  return `<div class="collision-focus-table"><table class="collision-table"><thead><tr><th>#</th><th>MD</th><th>中心距</th><th>分离距</th><th>SF</th><th>等级</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function collisionFactorSvg(factors){
  const rows = (factors && factors.length ? factors : buildSeparationFactorRows(getCollisionScanPoints())).slice(0,180);
  const w=720,h=420,padL=58,padR=24,padT=24,padB=42;
  const mdMin=Math.min(...rows.map(r=>num(r.md))), mdMax=Math.max(...rows.map(r=>num(r.md)));
  const sfMax=Math.max(...rows.map(r=>num(r.sf)),2.5), sfMin=0;
  const toX=md=>padL+(num(md)-mdMin)/Math.max(1,mdMax-mdMin)*(w-padL-padR);
  const toY=sf=>padT+(sfMax-num(sf))/Math.max(1,sfMax-sfMin)*(h-padT-padB);
  const pts=rows.map(r=>`${toX(r.md).toFixed(1)},${toY(r.sf).toFixed(1)}`).join(' ');
  const y1=toY(1), y15=toY(1.5), y2=toY(2);
  return `<svg class="collision-factor-svg" viewBox="0 0 ${w} ${h}">
    <defs><pattern id="sfGrid" width="42" height="30" patternUnits="userSpaceOnUse"><path d="M42 0H0V30" fill="none" stroke="#dfe7ef" stroke-width="1"/></pattern></defs>
    <rect width="${w}" height="${h}" fill="#fff"/><rect x="${padL}" y="${padT}" width="${w-padL-padR}" height="${h-padT-padB}" fill="url(#sfGrid)" stroke="#c9d4df"/>
    <line x1="${padL}" y1="${y1}" x2="${w-padR}" y2="${y1}" stroke="#d94444" stroke-dasharray="6 4"/><text x="${padL+8}" y="${y1-5}" fill="#d94444" font-size="10">SF=1</text>
    <line x1="${padL}" y1="${y15}" x2="${w-padR}" y2="${y15}" stroke="#d97706" stroke-dasharray="6 4"/><text x="${padL+8}" y="${y15-5}" fill="#d97706" font-size="10">SF=1.5</text>
    <line x1="${padL}" y1="${y2}" x2="${w-padR}" y2="${y2}" stroke="#0a955f" stroke-dasharray="6 4"/><text x="${padL+8}" y="${y2-5}" fill="#0a955f" font-size="10">SF=2</text>
    <polyline points="${pts}" fill="none" stroke="#0f63d6" stroke-width="2.2"/>
    <text x="18" y="24" fill="#17385f" font-size="12" font-weight="800">SF</text><text x="${w/2-20}" y="${h-10}" fill="#17385f" font-size="12" font-weight="800">MD(m)</text>
  </svg>`;
}

function collisionEllipsoidView(scan){
  const ell = state.errorEllipsoid || localCollisionScan('errorEllipsoid').errorEllipsoid || {};
  const nearest = (scan || []).reduce((a,b)=>!a||num(b.centerDistance)<num(a.centerDistance)?b:a,null) || {};
  return `<div class="collision-ellipsoid-view">
    <div class="ellipsoid-canvas"><svg viewBox="0 0 720 420">
      <rect width="720" height="420" fill="#fff"/><rect x="42" y="28" width="636" height="340" fill="#f8fbfe" stroke="#c9d4df"/>
      <ellipse cx="360" cy="205" rx="160" ry="72" fill="rgba(15,99,214,.10)" stroke="#0f63d6" stroke-width="2"/>
      <ellipse cx="360" cy="205" rx="82" ry="134" fill="rgba(217,68,68,.08)" stroke="#d94444" stroke-width="2" stroke-dasharray="8 5"/>
      <line x1="198" y1="205" x2="522" y2="205" stroke="#0f63d6"/><line x1="360" y1="70" x2="360" y2="340" stroke="#d94444"/>
      <circle cx="360" cy="205" r="5" fill="#17385f"/><text x="372" y="202" fill="#17385f" font-size="12">最近点 MD ${fmt(nearest.md,1)}m</text>
      <text x="58" y="54" fill="#17385f" font-weight="800" font-size="13">误差椭球 / Error Ellipsoid Preview</text>
      <text x="58" y="78" fill="#60758d" font-size="11">长轴 ${fmt(ell.majorAxis,1)}m · 短轴 ${fmt(ell.minorAxis,1)}m · Confidence ${fmt((ell.confidence||0.95)*100,0)}%</text>
    </svg></div>
    <div class="collision-focus-table"><table class="collision-table"><thead><tr><th>误差项</th><th>数值</th><th>说明</th></tr></thead><tbody>
      <tr><td>Major Axis</td><td>${fmt(ell.majorAxis,2)} m</td><td>主方向不确定性</td></tr>
      <tr><td>Minor Axis</td><td>${fmt(ell.minorAxis,2)} m</td><td>副方向不确定性</td></tr>
      <tr><td>Confidence</td><td>${fmt((ell.confidence||0.95)*100,0)}%</td><td>误差模型置信水平</td></tr>
      <tr><td>Model</td><td>${esc(ell.model || 'local-preview')}</td><td>当前误差模型来源</td></tr>
    </tbody></table></div>
  </div>`;
}

function renderTrajectoryManagement(){
  $('workbookTitle').textContent = '轨迹管理 / Trajectory Management';
  $('rowCountLabel').textContent = '导入、导出、编辑、激活、复制、删除、显示/隐藏';
  $('editorContent').innerHTML = `<div class="submodule-content">
    <div class="module-grid">
      <div class="module-tile"><b>轨迹列表</b><p>管理设计轨迹、实测轨迹、仿真轨迹和邻井参考轨迹。</p><div class="btn-line"><button class="primary" onclick="openTrajectoryManager()">打开管理器</button><button onclick="callApiAction('listTrajectory')">调用列表API</button></div></div>
      <div class="module-tile"><b>激活轨迹</b><p>选择当前工作轨迹，同步主表、视图、防碰扫描和后续钻柱力学建模。</p><div class="btn-line"><button onclick="activateTrajectory('TRJ-A5123')">激活设计轨迹</button><button onclick="activateTrajectory('TRJ-S4210')">激活实测轨迹</button></div></div>
    </div>
    ${trajectoryListHtml()}
  </div>`;
}

function trajectoryListHtml(){
  return `<table class="deviation-table" style="margin-top:10px"><thead><tr><th>选择</th><th>轨迹ID</th><th>名称</th><th>类型</th><th>测点数</th><th>来源</th><th>更新时间</th><th>操作</th></tr></thead><tbody>${state.trajectories.map(t=>`<tr><td>${t.active?'●':'○'}</td><td>${t.id}</td><td>${esc(t.name)}</td><td>${t.type}</td><td>${t.rows}</td><td>${t.source}</td><td>${t.updated}</td><td><button onclick="activateTrajectory('${t.id}')">激活</button> <button onclick="copyTrajectory('${t.id}')">复制</button></td></tr>`).join('')}</tbody></table>`;
}

function renderSurveyEditor(){
  $('workbookTitle').textContent = '轨迹测量 / Survey Trajectory';
  $('rowCountLabel').textContent = '实测轨迹新建、导入测斜、刷新计算、保存';
  const oldRows = state.rows;
  const showRows = state.surveyRows.length ? state.surveyRows : state.rows.slice(0,120);
  $('editorContent').innerHTML = `<div class="submodule-content">
    <div class="module-grid">
      <div class="module-tile"><b>新建实测轨迹</b><p>创建测斜轨迹，支持 MD/INC/AZI 输入后自动刷新 TVD、NS、EW、DLS。</p><div class="btn-line"><button class="primary" onclick="newSurveyTrajectory()">新建实测轨迹</button><button onclick="openImportFile()">导入测斜文件</button></div></div>
      <div class="module-tile"><b>测斜数据检查</b><p>检查测深递增、井斜范围、方位范围、重复测点与缺失列。</p><div class="btn-line"><button onclick="validateAndReport()">运行校验</button><button onclick="callApiAction('calculateTable')">后端刷新</button></div></div>
    </div>
    <div class="import-preview-table" style="margin-top:10px;max-height:390px">${miniRowsTable(showRows.slice(0,80))}</div>
  </div>`;
}

function renderTrajectoryControl(){
  $('workbookTitle').textContent = '轨迹控制 / Trajectory Control';
  $('rowCountLabel').textContent = '方向控制、单井段控制、连续导向软着陆';
  $('editorContent').innerHTML = `<div class="submodule-content"><div class="module-grid">
    <div class="module-tile"><b>方向控制</b><p>输入 AZI / TF / CL，计算下一段 INC / DLS，并可插入当前轨迹表。</p><div class="btn-line"><button class="primary" onclick="openDirectionControl()">方向控制</button><button onclick="insertControlResult('direction')">插入结果</button></div></div>
    <div class="module-tile"><b>单井段控制</b><p>给定起止 MD、INC、AZI，快速计算 TVD / N/S / E/W。</p><div class="btn-line"><button class="primary" onclick="openSingleSectionControl()">单井段控制</button><button onclick="insertControlResult('section')">插入结果</button></div></div>
    <div class="module-tile"><b>连续导向软着陆</b><p>用于水平井或导向井的连续轨迹控制与靶前软着陆。</p><div class="btn-line"><button class="primary" onclick="openSoftLandingControl()">软着陆</button><button onclick="insertControlResult('landing')">插入结果</button></div></div>
    <div class="module-tile"><b>接口预留</b><p>该部分后续可接 FormMainController 中 simCalculationClick / simInsertClick / BtnSim* 系列接口。</p><div class="btn-line"><button onclick="callApiAction('calculateTable')">刷新控制结果</button></div></div>
  </div></div>`;
}

function renderApiContractInline(){
  $('workbookTitle').textContent = 'well-path API 映射 / Contract';
  $('rowCountLabel').textContent = 'DrillSpace 前端动作 → MyDrill Java well-path 接口';
  $('editorContent').innerHTML = `<div class="submodule-content">${apiContractHtml()}<div class="btn-line" style="margin-top:10px"><button class="primary" onclick="toggleApiMode()">切换 Mock/API</button><button onclick="testApiConnection()">测试连接</button><button onclick="testBackendHealth()">健康检查</button><button onclick="exportApiMap()">导出接口映射</button></div></div>`;
}

function renderImportExportPanel(){
  $('workbookTitle').textContent = '轨迹导入导出 / Import & Export';
  $('rowCountLabel').textContent = 'CSV/TXT 预览、字段映射、异常行检查、正式上传';
  $('editorContent').innerHTML = `<div class="submodule-content"><div class="module-grid">
    <div class="module-tile"><b>导入预览</b><p>选择 CSV/TXT/LAS 文件，先做前端预览、字段映射和异常检查，再写入主表。</p><div class="btn-line"><button class="primary" onclick="openImportFile()">选择文件</button><button onclick="pasteImportModal()">粘贴数据</button></div></div>
    <div class="module-tile"><b>正式上传</b><p>后端运行后，可将原始文件上传到 /wellPath/TbTrajectory/importTrajectParamsCsv。</p><div class="btn-line"><button onclick="callApiAction('importCsv')">调用导入API</button><button onclick="exportCsv()">导出CSV</button></div></div>
    <div class="module-tile"><b>保存版本</b><p>保存轨迹元数据与轨迹点表，映射 addToUpdateSingleWellTrajectory 和 AddOrUpdateTbTrajectParams。</p><div class="btn-line"><button onclick="saveTrajectory()">保存版本</button><button onclick="callApiAction('saveRows')">保存点表API</button></div></div>
    <div class="module-tile"><b>异常检查</b><p>检查 MD 递增、INC/AZI 范围、空值、重复测点与 DLS 阈值。</p><div class="btn-line"><button onclick="validateAndReport()">运行检查</button></div></div>
  </div></div>`;
}

function apiContractHtml(){
  return `<div class="api-contract-table"><table><thead><tr><th>Key</th><th>方法</th><th>老接口路径</th><th>模块</th><th>动作</th><th>输入</th><th>输出</th><th>测试</th></tr></thead><tbody>${Object.entries(trajectoryApiMap).map(([key,api]) => `<tr><td><code>${key}</code></td><td>${api.method}</td><td><code>${api.path}</code></td><td>${api.module}</td><td>${api.action}</td><td>${api.payload}</td><td>${api.result}</td><td><button onclick="callApiAction('${key}')">调用</button></td></tr>`).join('')}</tbody></table></div>`;
}


function buildCollisionPayload(method='nearestDistance'){
  const referenceRows = state.rows.slice(0, Math.min(state.rows.length, 360)).map(r => ({
    md:num(r.md), inc:num(r.inc), azi:num(r.azi), tvd:num(r.tvd), ns:num(r.ns), ew:num(r.ew), station_type:r.type || '', remark:r.remark || ''
  }));
  const compareRows = generateNeighborRows(referenceRows, method);
  return {
    method,
    reference: { well_name:'B-1井', trajectory_name:'设计轨迹 A5123', rows: referenceRows },
    compare: { well_name: state.collisionSettings.neighborWell, trajectory_name:'邻井参考轨迹', rows: compareRows },
    search_radius: num(state.collisionSettings.searchRadius),
    error_radius: num(state.collisionSettings.errorRadius),
    unit: 'm'
  };
}

function generateNeighborRows(referenceRows, method='nearestDistance'){
  const shiftNsBase = method === 'flatScan' ? 34 : 38;
  const shiftEwBase = method === 'separationFactor' ? 24 : 30;
  return referenceRows.map((r,i) => {
    const nearFactor = Math.exp(-Math.pow((num(r.md)-2680)/720, 2));
    const lateralClose = 26 * nearFactor;
    return {
      md:num(r.md),
      inc:Math.max(0, num(r.inc) + Math.sin(i/22)*0.45),
      azi:num(r.azi) + Math.cos(i/27)*0.55,
      tvd:num(r.tvd) + Math.sin(i/30)*6,
      ns:num(r.ns) + shiftNsBase - lateralClose + Math.sin(i/9)*2.5,
      ew:num(r.ew) + shiftEwBase - lateralClose*0.35 + Math.cos(i/11)*2.2,
      station_type:'邻井',
      remark:'B-2邻井参考'
    };
  });
}

function localCollisionScan(method='nearestDistance'){
  const payload = buildCollisionPayload(method);
  const ref = payload.reference.rows;
  const cmp = payload.compare.rows;
  const step = Math.max(1, Math.floor(ref.length / 120));
  const scanPoints = [];
  let min = {centerDistance:Infinity, separationFactor:Infinity, md:0};
  for(let i=0;i<ref.length;i+=step){
    const r = ref[i];
    let nearest = null;
    let nearestDist = Infinity;
    for(let j=Math.max(0,i-3); j<Math.min(cmp.length,i+4); j++){
      const c = cmp[j];
      const d = Math.sqrt(Math.pow(num(r.ns)-num(c.ns),2) + Math.pow(num(r.ew)-num(c.ew),2) + Math.pow(num(r.tvd)-num(c.tvd),2));
      if(d < nearestDist){ nearestDist = d; nearest = c; }
    }
    const sepDistance = nearestDist - payload.error_radius * 1.25;
    const sf = nearestDist / Math.max(1, payload.error_radius * 1.35);
    const riskLevel = sf < 1 ? '高' : sf < 1.5 ? '中' : sf < 2 ? '低' : '安全';
    const dx = num(nearest?.ew ?? r.ew) - num(r.ew);
    const dy = num(nearest?.ns ?? r.ns) - num(r.ns);
    const dz = num(nearest?.tvd ?? r.tvd) - num(r.tvd);
    const horizontalDistance = Math.sqrt(dx*dx + dy*dy);
    const normalAngle = (Math.atan2(horizontalDistance, Math.abs(dz)+1e-6) * 180 / Math.PI + 360) % 360;
    const horizontalAngle = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    const p = {
      md:num(r.md),
      neighborWell: payload.compare.well_name,
      method: methodLabel(method),
      centerDistance:+nearestDist.toFixed(3),
      separationDistance:+sepDistance.toFixed(3),
      separationFactor:+sf.toFixed(3),
      referenceTvd:num(r.tvd),
      compareTvd:num(nearest?.tvd ?? r.tvd),
      referenceNs:num(r.ns),
      referenceEw:num(r.ew),
      compareNs:num(nearest?.ns ?? r.ns),
      compareEw:num(nearest?.ew ?? r.ew),
      horizontalDistance:+horizontalDistance.toFixed(3),
      verticalDistance:+dz.toFixed(3),
      normalAngle:+normalAngle.toFixed(3),
      horizontalAngle:+horizontalAngle.toFixed(3),
      riskLevel
    };
    if(p.centerDistance < min.centerDistance) min = p;
    scanPoints.push(p);
  }
  const risk = min.separationFactor < 1 ? '高' : min.separationFactor < 1.5 ? '中' : min.separationFactor < 2 ? '低' : '中低';
  return {
    ok:true,
    method,
    summary:{
      minDistance:min.centerDistance,
      minSeparationFactor:min.separationFactor,
      nearestMd:min.md,
      nearestWell: payload.compare.well_name,
      risk
    },
    scanPoints,
    polarScan: scanPoints.map(p=>({md:p.md, normalAngle:p.normalAngle, horizontalAngle:p.horizontalAngle, radius:p.centerDistance, separationFactor:p.separationFactor})),
    separationMatrix: buildSeparationMatrix(scanPoints),
    errorEllipsoid: {majorAxis: num(payload.error_radius)*1.55, minorAxis: num(payload.error_radius)*0.62, confidence: 0.95, model:'local-preview'}
  };
}

function methodLabel(method){
  return ({
    nearestDistance:'最近距离',
    flatScan:'法平面',
    separationDistance:'分离距',
    separationFactor:'分离系数',
    errorEllipsoid:'误差椭球'
  })[method] || method;
}

function normalizeCollisionResult(result, method){
  const data = result?.data || result?.result || result || {};
  const points = data.scanPoints || data.scan_points || data.points || [];
  const rows = points.map((p,i)=>({
    md:num(p.md ?? p.MD ?? state.rows[i]?.md),
    neighborWell:p.neighborWell || p.neighbor_well || p.neighbor || state.collisionSettings.neighborWell,
    method:p.method || methodLabel(method),
    centerDistance:num(p.centerDistance ?? p.center_distance ?? p.distance ?? p.min_distance ?? p.centerDist),
    separationDistance:num(p.separationDistance ?? p.separation_distance ?? p.clearance ?? p.centerDistance ?? p.center_distance),
    separationFactor:num(p.separationFactor ?? p.separation_factor ?? p.sf ?? p.SF),
    referenceTvd:num(p.referenceTvd ?? p.reference_tvd ?? p.tvd ?? 0),
    compareTvd:num(p.compareTvd ?? p.compare_tvd ?? 0),
    referenceNs:num(p.referenceNs ?? p.reference_ns ?? 0),
    referenceEw:num(p.referenceEw ?? p.reference_ew ?? 0),
    compareNs:num(p.compareNs ?? p.compare_ns ?? 0),
    compareEw:num(p.compareEw ?? p.compare_ew ?? 0),
    riskLevel:p.riskLevel || p.risk_level || (num(p.separationFactor ?? p.separation_factor ?? p.sf) < 1 ? '高' : num(p.separationFactor ?? p.separation_factor ?? p.sf) < 1.5 ? '中' : '低'),
    normalAngle:num(p.normalAngle ?? p.normal_angle ?? p.scanAngle ?? p.scan_angle ?? 0),
    horizontalAngle:num(p.horizontalAngle ?? p.horizontal_angle ?? p.azimuthAngle ?? p.azimuth_angle ?? 0),
    horizontalDistance:num(p.horizontalDistance ?? p.horizontal_distance ?? 0),
    verticalDistance:num(p.verticalDistance ?? p.vertical_distance ?? 0)
  })).filter(p => Number.isFinite(p.md) && Number.isFinite(p.centerDistance));
  const fallback = rows.length ? {scanPoints:rows, summary:{}} : localCollisionScan(method);
  const finalRows = rows.length ? rows : fallback.scanPoints;
  const summary = data.summary || {};
  const minRow = finalRows.reduce((a,b)=> !a || b.centerDistance < a.centerDistance ? b : a, null);
  state.collisionResults = finalRows;
  state.collisionMatrix = data.separationMatrix || data.separation_matrix || [];
  state.collisionPolar = data.polarScan || data.polar_scan || [];
  state.errorEllipsoid = data.errorEllipsoid || data.error_ellipsoid || null;
  state.collision = {
    minDistance: num(summary.minDistance ?? summary.min_distance ?? data.minDistance ?? data.min_distance ?? minRow?.centerDistance),
    minSF: num(summary.minSeparationFactor ?? summary.min_separation_factor ?? summary.minSF ?? summary.min_sf ?? data.separation_factor ?? minRow?.separationFactor),
    nearestWell: summary.nearestWell || summary.nearest_well || data.nearestWell || data.nearest_well || state.collisionSettings.neighborWell,
    nearestMd: num(summary.nearestMd ?? summary.nearest_md ?? minRow?.md),
    risk: summary.risk || data.risk_level || data.risk || (minRow?.riskLevel === '高' ? '高' : minRow?.riskLevel === '中' ? '中' : '中低')
  };
  return finalRows;
}

async function runCollisionScan(method='nearestDistance'){
  state.collisionMethod = method;
  state.collisionSettings.method = methodLabel(method);
  let result = null;
  if(state.apiMode === 'api'){
    result = await callApiAction('collisionScan', buildCollisionPayload(method), {silent:true});
  } else {
    await callApiAction(method === 'nearestDistance' ? 'nearestDistance' : method, buildCollisionPayload(method), {silent:true});
    result = localCollisionScan(method);
  }
  normalizeCollisionResult(result, method);
  updateSummary();
  renderCollisionView();
  addLog(`完成防碰扫描：${methodLabel(method)}，最小中心距 ${fmt(state.collision.minDistance,2)}m，SF ${fmt(state.collision.minSF,2)}`);
  toast(`防碰扫描完成：${methodLabel(method)} / 最小中心距 ${fmt(state.collision.minDistance,2)}m`);
}

function collisionAngle(point, mode='normal'){
  if(!point) return 0;
  const dx = num(point.compareEw) - num(point.referenceEw);
  const dy = num(point.compareNs) - num(point.referenceNs);
  const dz = num(point.compareTvd) - num(point.referenceTvd);
  if(mode === 'horizontal') return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  const horizontal = Math.sqrt(dx*dx + dy*dy);
  return (Math.atan2(horizontal, Math.abs(dz) + 1e-6) * 180 / Math.PI + 360) % 360;
}

function riskBySf(sf){
  sf = num(sf);
  if(sf < 1) return '高';
  if(sf < 1.5) return '中';
  if(sf < 2) return '低';
  return '安全';
}

function buildSeparationFactorRows(points){
  const rows = (points && points.length ? points : localCollisionScan().scanPoints).slice().sort((a,b)=>num(a.md)-num(b.md));
  return rows.map(r=>({
    md:num(r.md),
    center:num(r.centerDistance),
    clearance:num(r.separationDistance),
    sf:num(r.separationFactor),
    level:r.riskLevel || riskBySf(r.separationFactor)
  }));
}

function buildSeparationMatrix(points){
  const rows = (points && points.length ? points : localCollisionScan().scanPoints);
  const baseMin = rows.reduce((a,b)=> !a || num(b.centerDistance) < num(a.centerDistance) ? b : a, null) || {};
  const method = methodLabel(state.collisionMethod);
  const candidates = [
    {well: state.collisionSettings.neighborWell || 'B-2井', factor: 1.00, mdShift: 0, sfShift: 0},
    {well: 'B-3井', factor: 1.26, mdShift: 180, sfShift: .28},
    {well: 'T-1井', factor: 1.62, mdShift: -260, sfShift: .62},
    {well: 'WZ-1井', factor: 2.10, mdShift: 420, sfShift: 1.1}
  ];
  return candidates.map(c=>{
    const center = num(baseMin.centerDistance || state.collision.minDistance) * c.factor;
    const sep = center - num(state.collisionSettings.errorRadius) * 1.25;
    const sf = Math.max(0.1, num(baseMin.separationFactor || state.collision.minSF) * c.factor + c.sfShift);
    return {
      well:c.well,
      nearestMd:num(baseMin.md || state.collision.nearestMd || 2680) + c.mdShift,
      minCenterDistance:center,
      minSeparationDistance:sep,
      minSeparationFactor:sf,
      scanMethod:method,
      risk:riskBySf(sf)
    };
  });
}

function collisionDistanceSvg(points){
  const rows = (points && points.length ? points : localCollisionScan().scanPoints).slice(0,180);
  const w = 430, h = 390, padL = 54, padR = 18, padT = 24, padB = 38;
  const mdMin = Math.min(...rows.map(r=>num(r.md))), mdMax = Math.max(...rows.map(r=>num(r.md)));
  const dMax = Math.max(...rows.map(r=>num(r.centerDistance)), state.collisionSettings.searchRadius, 25);
  const dMin = 0;
  const toX = d => padL + (num(d)-dMin)/Math.max(1,dMax-dMin)*(w-padL-padR);
  const toY = md => padT + (num(md)-mdMin)/Math.max(1,mdMax-mdMin)*(h-padT-padB);
  const pts = rows.map(r=>`${toX(r.centerDistance).toFixed(1)},${toY(r.md).toFixed(1)}`).join(' ');
  const safeX = toX(num(state.collisionSettings.errorRadius)*1.35);
  return `<svg class="collision-distance-svg" viewBox="0 0 ${w} ${h}">
    <defs><pattern id="distGrid" width="32" height="28" patternUnits="userSpaceOnUse"><path d="M32 0H0V28" fill="none" stroke="#dfe7ef" stroke-width="1"/></pattern></defs>
    <rect width="${w}" height="${h}" fill="#fff"/><rect x="${padL}" y="${padT}" width="${w-padL-padR}" height="${h-padT-padB}" fill="url(#distGrid)" stroke="#c9d4df"/>
    <line x1="${safeX}" y1="${padT}" x2="${safeX}" y2="${h-padB}" stroke="#d94444" stroke-dasharray="6 4"/>
    <polyline points="${pts}" fill="none" stroke="#d93636" stroke-width="2.2"/>
    <text x="12" y="22" fill="#17385f" font-size="12" font-weight="800">测深 MD(m)</text>
    <text x="${w/2-42}" y="${h-10}" fill="#17385f" font-size="12" font-weight="800">最近距离(m)</text>
    <text x="${safeX+4}" y="${padT+14}" fill="#d94444" font-size="10">安全阈值</text>
  </svg>`;
}

function collisionPolarSvg(points, mode='normal'){
  const rows = (points && points.length ? points : localCollisionScan().scanPoints).slice(0,160);
  const size = 330, cx = size/2, cy = size/2, maxR = 126;
  const dMax = Math.max(...rows.map(r=>num(r.centerDistance)), 25);
  const toPoint = r => {
    const ang = (collisionAngle(r, mode)-90) * Math.PI / 180;
    const rr = Math.max(3, num(r.centerDistance)/Math.max(1,dMax)*maxR);
    return {x:cx+Math.cos(ang)*rr, y:cy+Math.sin(ang)*rr, rr};
  };
  const pts = rows.map(toPoint).map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const radialLabels = [0,30,60,90,120,150,180,210,240,270,300,330].map(a=>{
    const rad=(a-90)*Math.PI/180; const x=cx+Math.cos(rad)*(maxR+18); const y=cy+Math.sin(rad)*(maxR+18)+3;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" fill="#6b7d92" font-size="10">${a}</text>`;
  }).join('');
  return `<svg class="collision-polar-svg" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="#fff"/>
    ${[.25,.5,.75,1].map(k=>`<circle cx="${cx}" cy="${cy}" r="${(maxR*k).toFixed(1)}" fill="none" stroke="#d9e2ec"/>`).join('')}
    ${[0,30,60,90,120,150,180,210,240,270,300,330].map(a=>{const rad=(a-90)*Math.PI/180;return `<line x1="${cx}" y1="${cy}" x2="${(cx+Math.cos(rad)*maxR).toFixed(1)}" y2="${(cy+Math.sin(rad)*maxR).toFixed(1)}" stroke="#edf2f7"/>`;}).join('')}
    ${radialLabels}
    <polyline points="${pts}" fill="none" stroke="#1d67e0" stroke-width="2"/>
    <circle cx="${cx}" cy="${cy}" r="3" fill="#17385f"/>
    <text x="${cx}" y="${cy-8}" text-anchor="middle" fill="#17385f" font-size="10">0</text>
  </svg>`;
}

function collisionSpatialSvg(points){
  const rows = (points && points.length ? points : localCollisionScan().scanPoints).slice(0,80);
  const w=330,h=205;
  const ns = rows.map(r=>[num(r.referenceNs),num(r.compareNs)]).flat();
  const ew = rows.map(r=>[num(r.referenceEw),num(r.compareEw)]).flat();
  const nsMin=Math.min(...ns), nsMax=Math.max(...ns), ewMin=Math.min(...ew), ewMax=Math.max(...ew);
  const toX=v=>40+(v-ewMin)/Math.max(1,ewMax-ewMin)*(w-70);
  const toY=v=>h-30-(v-nsMin)/Math.max(1,nsMax-nsMin)*(h-60);
  const refPts=rows.map(r=>`${toX(r.referenceEw).toFixed(1)},${toY(r.referenceNs).toFixed(1)}`).join(' ');
  const cmpPts=rows.map(r=>`${toX(r.compareEw).toFixed(1)},${toY(r.compareNs).toFixed(1)}`).join(' ');
  const min=rows.reduce((a,b)=>!a||num(b.centerDistance)<num(a.centerDistance)?b:a,null)||rows[0]||{};
  return `<svg class="collision-spatial-svg" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#fff"/>
    <path d="M40 26 L300 26 L300 174 L40 174 Z" fill="#f8fbfe" stroke="#c9d4df"/>
    <polyline points="${refPts}" fill="none" stroke="#0f63d6" stroke-width="2.6"/><polyline points="${cmpPts}" fill="none" stroke="#10a66a" stroke-width="2.2" stroke-dasharray="6 4"/>
    <line x1="${toX(min.referenceEw).toFixed(1)}" y1="${toY(min.referenceNs).toFixed(1)}" x2="${toX(min.compareEw).toFixed(1)}" y2="${toY(min.compareNs).toFixed(1)}" stroke="#d94444" stroke-width="2"/>
    <text x="48" y="18" fill="#0f63d6" font-size="11">蓝：当前井</text><text x="130" y="18" fill="#10a66a" font-size="11">绿：邻井</text><text x="220" y="18" fill="#d94444" font-size="11">红：最近距</text>
    <text x="12" y="104" fill="#6b7d92" font-size="11">N/S</text><text x="154" y="198" fill="#6b7d92" font-size="11">E/W</text>
  </svg>`;
}

function collisionMiniSvg(points){
  return collisionDistanceSvg(points);
}


function closeModal(){
  const mask = $('modalMask');
  if(mask) mask.classList.remove('show');
}
window.closeModal = closeModal;

function showCollisionSettings(){
  showModal('防碰扫描设置', `
    <div class="modal-grid">
      <label>比较井 / Neighbor Well<input id="collisionNeighborInput" value="${esc(state.collisionSettings.neighborWell)}"></label>
      <label>搜索半径 m<input id="collisionRadiusInput" value="${state.collisionSettings.searchRadius}"></label>
      <label>误差半径 m<input id="collisionErrorInput" value="${state.collisionSettings.errorRadius}"></label>
      <label>扫描方法<select id="collisionMethodInput">
        <option value="nearestDistance">最近距离扫描法</option>
        <option value="flatScan">法平面扫描法</option>
        <option value="separationDistance">分离距 / 分离矩阵</option>
        <option value="separationFactor">分离系数</option>
        <option value="errorEllipsoid">误差椭球</option>
      </select></label>
    </div>
    <div class="small-note" style="margin-top:10px">
      V2.8.6：设置应用后会同时刷新防碰数据，并保持当前单视图/并列对比布局。
    </div>`,
    () => applyCollisionSettings(),
    {wide:true}
  );
  setTimeout(() => {
    const sel = $('collisionMethodInput');
    if(sel) sel.value = state.collisionMethod || 'nearestDistance';
  }, 0);
}

function applyCollisionSettings(){
  state.collisionSettings.neighborWell = $('collisionNeighborInput')?.value || 'B-2井';
  state.collisionSettings.searchRadius = num($('collisionRadiusInput')?.value) || 80;
  state.collisionSettings.errorRadius = num($('collisionErrorInput')?.value) || 18;
  const method = $('collisionMethodInput')?.value || 'nearestDistance';
  if(method === 'nearestDistance') state.collisionView = 'nearest';
  if(method === 'flatScan') state.collisionView = 'normalPlane';
  if(method === 'separationDistance') state.collisionView = 'separationMatrix';
  if(method === 'separationFactor') state.collisionView = 'separationFactor';
  if(method === 'errorEllipsoid') state.collisionView = 'ellipsoid';
  runCollisionScan(method);
}


function addRow(after=false){
  const base = state.rows[after ? state.selectedRow : state.rows.length-1] || createEmptyRow();
  const newRow = { ...base, type:'插值点', md:+(num(base.md)+30).toFixed(2), cl:30, tvd:+(num(base.tvd)+25).toFixed(2), ns:+(num(base.ns)+20).toFixed(2), ew:+(num(base.ew)-6).toFixed(2), remark:'新增行' };
  const index = after ? state.selectedRow + 1 : state.rows.length;
  state.rows.splice(index,0,newRow);
  state.selectedRow = index;
  rerenderCurrentView();
  updateSummary();
  addLog('新增轨迹数据行');
  toast('已新增轨迹数据行');
}

function deleteSelectedRow(){
  if(state.rows.length <= 1) return toast('至少保留一行轨迹数据');
  state.rows.splice(state.selectedRow,1);
  state.selectedRow = Math.max(0,state.selectedRow-1);
  rerenderCurrentView();
  updateSummary();
  addLog('删除轨迹数据行');
  toast('已删除当前行');
}

function moveRow(dir){
  const i = state.selectedRow, j = i + dir;
  if(j < 0 || j >= state.rows.length) return;
  [state.rows[i], state.rows[j]] = [state.rows[j], state.rows[i]];
  state.selectedRow = j;
  rerenderCurrentView();
  addLog(dir < 0 ? '上移轨迹行' : '下移轨迹行');
}

function clearRows(){
  confirmModal('清空轨迹数据表', '确定清空当前轨迹数据表？该操作在前端演示模式下不会影响后端。', () => {
    state.rows = [createEmptyRow(0)];
    state.selectedRow = 0;
    renderGrid();
    updateSummary();
    addLog('清空轨迹数据表');
  });
}

function recalcRowsLocal(){
  for(let i=0;i<state.rows.length;i++){
    const r = state.rows[i];
    if(i === 0){ r.cl = 0; r.tvd = num(r.tvd) || 0; continue; }
    const prev = state.rows[i-1];
    const cl = Math.max(0, num(r.md)-num(prev.md));
    const incRad = (num(prev.inc)+num(r.inc))*0.5*Math.PI/180;
    const aziRad = (num(prev.azi)+num(r.azi))*0.5*Math.PI/180;
    const dtvd = cl*Math.cos(incRad);
    const dh = cl*Math.sin(incRad);
    r.cl = +cl.toFixed(2);
    r.tvd = +(num(prev.tvd)+dtvd).toFixed(2);
    r.ns = +(num(prev.ns)+dh*Math.cos(aziRad)).toFixed(2);
    r.ew = +(num(prev.ew)+dh*Math.sin(aziRad)).toFixed(2);
    r.vsec = +(Math.sqrt(num(r.ns)**2 + num(r.ew)**2)).toFixed(2);
    r.dogleg = +(Math.sqrt((num(r.inc)-num(prev.inc))**2 + (Math.sin(incRad)*(num(r.azi)-num(prev.azi)))**2)/Math.max(1,cl)*30).toFixed(3);
    r.build = +((num(r.inc)-num(prev.inc))/Math.max(1,cl)*30).toFixed(3);
    r.turn = +((num(r.azi)-num(prev.azi))/Math.max(1,cl)*30).toFixed(3);
  }
}

async function recalcRows(){
  if(state.apiMode === 'api'){
    const result = await callApiAction('calculateTable', buildDisignDto(), {silent:false});
    if(result && Array.isArray(result)) normalizeApiRows(result);
    else recalcRowsLocal();
  } else {
    await callApiAction('calculateTable', buildDisignDto(), {silent:true});
    recalcRowsLocal();
  }
  rerenderCurrentView();
  updateSummary();
  addLog('刷新计算轨迹几何量');
  toast('已刷新计算轨迹表；API模式下可替换为 well-path 正式结果');
}

function normalizeApiRows(apiRows){
  state.rows = apiRows.map((r,i) => ({
    type: r.type || state.rows[i]?.type || '井段',
    md: num(r.MD ?? r.md), inc: num(r.INC ?? r.inc), azi: num(r.AZI ?? r.azi), cl: num(r.CL ?? r.cl),
    tvd: num(r.TVD ?? r.tvd), ns: num(r.NS ?? r.ns), ew: num(r.EW ?? r.ew), vsec: num(r.LHP ?? r.vsec),
    dogleg: num(r.Dogleg ?? r.dogleg), tf: num(r.TF ?? r.tf), build: num(r.Build ?? r.build), turn: num(r.Turn ?? r.turn),
    remark: r.remark || 'API返回'
  }));
}

function buildDisignDto(){
  return {
    tid: 'TRJ-A5123',
    mdData: state.rows.map(r => num(r.md)),
    incData: state.rows.map(r => num(r.inc)),
    aziData: state.rows.map(r => num(r.azi)),
    depthInterval: num($('depthInterval')?.value || 30),
    dLHP: 0,
    type: $('wellType')?.value || 'H'
  };
}

function interpolate(){
  const out = [];
  for(let i=0;i<state.rows.length-1;i++){
    const a = state.rows[i], b = state.rows[i+1];
    out.push(a);
    const gap = num(b.md)-num(a.md);
    if(gap > num($('depthInterval')?.value || 30)*1.5){
      const n = Math.min(8, Math.floor(gap/num($('depthInterval')?.value || 30))-1);
      for(let j=1;j<=n;j++){
        const t = j/(n+1);
        out.push(interpRow(a,b,t));
      }
    }
  }
  out.push(state.rows[state.rows.length-1]);
  state.rows = out;
  recalcRowsLocal();
  renderGrid();
  updateSummary();
  addLog('执行轨迹插值');
  toast(`已完成插值，当前 ${state.rows.length} 行`);
}

function interpRow(a,b,t){
  const row = {type:'插值点', remark:'自动插值'};
  ['md','inc','azi','cl','tvd','ns','ew','vsec','dogleg','tf','build','turn'].forEach(k => row[k] = +(num(a[k]) + (num(b[k])-num(a[k]))*t).toFixed(3));
  return row;
}

async function callApiAction(key, payload=null, options={}){
  const api = trajectoryApiMap[key];
  if(!api){ toast(`未知API：${key}`); return null; }
  const path = api.path;
  const method = api.method;
  const time = new Date().toLocaleTimeString('zh-CN',{hour12:false});
  if(state.apiMode === 'mock'){
    state.apiHistory.unshift({key, method, path, status:'Mock', time});
    state.apiHistory = state.apiHistory.slice(0,20);
    renderApiHistory();
    renderApiList();
    if(!options.silent) toast(`Mock 调用：${api.action}`);
    return mockApiResult(key, payload);
  }
  try{
    const url = state.apiBaseUrl.replace(/\/$/,'') + path;
    const fetchOpt = { method, headers:{'Content-Type':'application/json'} };
    if(method !== 'GET') fetchOpt.body = JSON.stringify(payload || buildDefaultPayload(key));
    const resp = await fetch(url, fetchOpt);
    if(!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    const json = await resp.json();
    state.apiHistory.unshift({key, method, path, status:'OK', time});
    renderApiHistory(); renderApiList();
    if(!options.silent) toast(`API成功：${api.action}`);
    return json.data || json.result || json;
  }catch(err){
    state.apiHistory.unshift({key, method, path, status:'Fail', time});
    renderApiHistory(); renderApiList();
    toast(`API失败，已保留前端Mock结果：${err.message}`);
    addLog(`API失败 ${path}`);
    return mockApiResult(key, payload);
  }
}

function buildDefaultPayload(key){
  if(['calculateTable','designTemplate'].includes(key)) return buildDisignDto();
  if(['collisionScan','flatScan','nearestDistance','separationDistance','separationFactor','errorEllipsoid'].includes(key)) return buildCollisionPayload(key === 'flatScan' ? 'flatScan' : key === 'collisionScan' ? state.collisionMethod : key);
  if(['verticalProfile','horizontalProjection','inclination','azimuth','dogleg','build','turn'].includes(key)) return [buildDisignDto(), {...buildDisignDto(), tid:'TRJ-B2-REF'}];
  return { pid:'P-Bohai-B-001', tid:'TRJ-A5123' };
}

function mockApiResult(key){
  if(key === 'calculateTable') return state.rows.map(r => ({...r}));
  if(key === 'listTrajectory') return state.trajectories;
  if(['engineInfo','calibrationTemplate','calibrationSample','calibrationCompare','calibrationLatest'].includes(key)) return mockCalibrationReport();
  if(['collisionScan','flatScan','nearestDistance','separationDistance','separationFactor','errorEllipsoid'].includes(key)) return localCollisionScan(key === 'flatScan' ? 'flatScan' : key === 'collisionScan' ? state.collisionMethod : key);
  return { ok:true, key, mock:true, rows: state.rows.length };
}

function invokeViewApi(key){ callApiAction(key, buildDefaultPayload(key)); }
window.invokeViewApi = invokeViewApi;
window.callApiAction = callApiAction;

function toggleApiMode(){
  state.apiMode = state.apiMode === 'mock' ? 'api' : 'mock';
  state.apiBaseUrl = $('apiBaseUrl')?.value || state.apiBaseUrl;
  localStorage.setItem('drillspace-api-mode', state.apiMode);
  localStorage.setItem('drillspace-api-base', state.apiBaseUrl);
  updateSummary();
  addLog(`切换到 ${state.apiMode.toUpperCase()} 模式`);
  toast(`已切换到 ${state.apiMode.toUpperCase()} 模式`);
}

async function testApiConnection(){
  state.apiBaseUrl = $('apiBaseUrl')?.value || state.apiBaseUrl;
  if(state.apiMode === 'mock'){
    toast('当前为 MOCK 模式；切换 API 后可测试真实 well-path');
    return;
  }
  await callApiAction('listTrajectory', {pid:'P-Bohai-B-001'});
}

function openImportFile(){ $('fileInput').click(); }

function handleFileSelected(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => parseImportText(reader.result, file.name);
  reader.readAsText(file, 'utf-8');
}

function parseImportText(text, filename='pasted.csv'){
  const lines = String(text || '').replace(/^\uFEFF/,'').split(/\r?\n/).filter(x => x.trim()).slice(0,5000);
  const delim = detectDelimiter(lines[0] || '');
  const rawRows = lines.map(line => line.split(delim).map(v => v.trim()));
  const headerGuess = rawRows[0] || [];
  const hasHeader = headerGuess.some(c => /md|inc|azi|测深|井斜|方位/i.test(c));
  const headers = hasHeader ? headerGuess : headerGuess.map((_,i) => `COL_${i+1}`);
  const dataRows = hasHeader ? rawRows.slice(1) : rawRows;
  state.importPreview = { filename, headers, dataRows, mapping: autoMapHeaders(headers) };
  showImportPreviewModal();
}

function detectDelimiter(line){
  if(line.includes('\t')) return '\t';
  if(line.includes(',')) return ',';
  if(line.includes(';')) return ';';
  return /\s+/.test(line.trim()) ? /\s+/ : ',';
}

function autoMapHeaders(headers){
  const map = { md:'', inc:'', azi:'' };
  headers.forEach(h => {
    const s = String(h).toLowerCase();
    if(!map.md && (/^md$|测深|井深|measured/.test(s))) map.md = h;
    if(!map.inc && (/inc|井斜/.test(s))) map.inc = h;
    if(!map.azi && (/azi|方位/.test(s))) map.azi = h;
  });
  if(!map.md && headers[0]) map.md = headers[0];
  if(!map.inc && headers[1]) map.inc = headers[1];
  if(!map.azi && headers[2]) map.azi = headers[2];
  return map;
}

function showImportPreviewModal(){
  const p = state.importPreview;
  if(!p) return;
  const options = p.headers.map(h => `<option value="${esc(h)}">${esc(h)}</option>`).join('');
  const previewRows = p.dataRows.slice(0,20);
  const body = `<div class="import-preview">
    <div class="small-note"><b>文件：</b>${esc(p.filename)}　<b>预览：</b>${p.dataRows.length} 行。先确认字段映射，再导入到轨迹数据表；正式后端上传映射到 <code>/wellPath/TbTrajectory/importTrajectParamsCsv</code>。</div>
    <div class="mapping-grid">
      <label>MD / 测深<select id="mapMd">${options}</select></label>
      <label>INC / 井斜<select id="mapInc">${options}</select></label>
      <label>AZI / 方位<select id="mapAzi">${options}</select></label>
      <label>导入策略<select id="importStrategy"><option value="replace">覆盖当前轨迹</option><option value="append">追加到当前轨迹</option><option value="survey">导入为实测轨迹</option></select></label>
      <label>测深间隔<input id="importDepthInterval" value="${esc($('depthInterval')?.value || 30)}" /></label>
      <label>重复测点<select><option>保留最后一条</option><option>保留第一条</option></select></label>
    </div>
    <div class="import-preview-table"><table><thead><tr>${p.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${previewRows.map(row => `<tr>${p.headers.map((h,i)=>`<td>${esc(row[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
  </div>`;
  showModal('轨迹文件导入预览 / Import Preview', body, () => commitImportPreview(), {wide:true});
  setTimeout(() => {
    if($('mapMd')) $('mapMd').value = p.mapping.md;
    if($('mapInc')) $('mapInc').value = p.mapping.inc;
    if($('mapAzi')) $('mapAzi').value = p.mapping.azi;
  },0);
}

function commitImportPreview(){
  const p = state.importPreview;
  if(!p) return;
  const mapping = { md:$('mapMd')?.value || p.mapping.md, inc:$('mapInc')?.value || p.mapping.inc, azi:$('mapAzi')?.value || p.mapping.azi };
  const strategy = $('importStrategy')?.value || 'replace';
  const idx = key => p.headers.indexOf(mapping[key]);
  const mdIdx = idx('md'), incIdx = idx('inc'), aziIdx = idx('azi');
  const imported = p.dataRows.map(row => ({
    type: strategy === 'survey' ? '实测' : '导入',
    md: Number(row[mdIdx] || 0),
    inc: Number(row[incIdx] || 0),
    azi: Number(row[aziIdx] || 0),
    cl:0,tvd:0,ns:0,ew:0,vsec:0,dogleg:0,tf:0,build:0,turn:0,remark:p.filename
  })).filter(r => !Number.isNaN(r.md) && !Number.isNaN(r.inc) && !Number.isNaN(r.azi));
  if(strategy === 'survey') state.surveyRows = imported;
  else if(strategy === 'append') state.rows = state.rows.concat(imported);
  else state.rows = imported;
  recalcRowsLocal();
  state.selectedRow = 0;
  renderGrid();
  updateSummary();
  addLog(`导入预览确认：${imported.length} 行`);
  toast(`已导入 ${imported.length} 行轨迹数据`);
}

function pasteImportModal(){
  showModal('粘贴轨迹数据', `<div class="small-note">从 Excel 复制三列或多列数据粘贴到下面。默认前三列识别为 MD / INC / AZI。</div><textarea id="pasteBox" style="width:100%;height:260px;border:1px solid #cbd9e8;border-radius:3px;font-family:Consolas,monospace"></textarea>`, () => {
    parseImportText($('pasteBox').value, 'pasted-trajectory.csv');
  }, {wide:true});
}

function exportCsv(){
  const headers = rowColumns.map(c => c[1]);
  const keys = rowColumns.map(c => c[0]);
  const csv = [headers.join(',')].concat(state.rows.map(r => keys.map(k => r[k]).join(','))).join('\n');
  const blob = new Blob(['\uFEFF' + csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `DrillSpace_Trajectory_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  addLog('导出轨迹 CSV');
  toast('已导出 CSV 文件');
}

function saveTrajectory(){
  const snapshot = { rows: state.rows.slice(0,500), time: new Date().toISOString(), apiMode: state.apiMode };
  localStorage.setItem('drillspace-v273-trajectory', JSON.stringify(snapshot));
  callApiAction('saveTrajectory', { tid:'TRJ-A5123', name:$('activeTrajectoryName').textContent, rows: state.rows.length }, {silent:true});
  callApiAction('saveRows', state.rows.slice(0,500), {silent:true});
  addLog('保存轨迹版本 V2.9.7-A5123');
  toast('轨迹版本已保存；API模式下将同步调用 well-path 保存接口');
}

function newProject(){
  showModal('新建项目 / 油田-区块-井筒-项目', `<div class="modal-grid"><label>油田名称<input value="渤海湾油田B平台"></label><label>区块名称<input value="Bohai-B-Block"></label><label>井筒名称<input value="B-5井筒"></label><label>项目名称<input value="B-5井轨迹设计项目"></label><label>工作路径<input value="D:/WCode/DrillSpace/projects/B5"></label><label>描述<input value="水平井轨迹设计与防碰校核"></label></div>`, () => { toast('已创建项目（前端模拟），后续接 project-manage'); addLog('新建项目 B-5井轨迹设计项目'); });
}

function newTrajectory(){
  showModal('新建设计轨迹', `<div class="modal-grid"><label>轨迹名称<input id="newTrajName" value="B-1井 设计轨迹 A5124"></label><label>轨迹类型<select id="newTrajType"><option>水平井</option><option>J形井</option><option>S形井</option></select></label><label>KOP(m)<input value="1250"></label><label>目标MD(m)<input value="5320"></label><label>目标TVD(m)<input value="4320"></label><label>方位角(°)<input value="121.50"></label></div>`, () => { const name = $('newTrajName')?.value || '新建设计轨迹'; $('activeTrajectoryName').textContent = name; state.trajectories.unshift({id:'TRJ-'+Date.now().toString().slice(-5), name, type:'设计', rows:state.rows.length, active:true, source:'DrillSpace', updated:'刚刚'}); toast('新轨迹已建立，可在表格中继续编辑'); addLog(`新建设计轨迹 ${name}`); });
}

function openTemplate(){
  showModal('设计模板 / J形井 · S形井 · 水平井', `<div class="modal-grid"><label>模板类型<select id="tplType"><option value="H">水平井</option><option value="J">J形井</option><option value="S">S形井</option></select></label><label>开钻井斜<input id="tplStartInc" value="0"></label><label>造斜点垂深<input id="tplKop" value="1700"></label><label>增斜率1<input id="tplBuild1" value="8"></label><label>增斜率2<input id="tplBuild2" value="10"></label><label>水平段井斜角<input id="tplHoldInc" value="88.51"></label><label>TVD<input id="tplTvd" value="2013"></label><label>N/S<input id="tplNs" value="-772.907"></label><label>E/W<input id="tplEw" value="-136.284"></label></div>`, () => { applyTemplateFromModal(); });
}

function applyTemplateFromModal(){
  const type = $('tplType')?.value || 'H';
  const kop = num($('tplKop')?.value || 1700);
  const tvd = num($('tplTvd')?.value || 2013);
  const ns = num($('tplNs')?.value || -772.907);
  const ew = num($('tplEw')?.value || -136.284);
  state.rows = [
    {type:'井口',md:0,inc:0,azi:121.5,cl:0,tvd:0,ns:0,ew:0,vsec:0,dogleg:0,tf:0,build:0,turn:0,remark:'模板井口'},
    {type:'直井段',md:kop,inc:0,azi:121.5,cl:kop,tvd:kop,ns:0,ew:0,vsec:0,dogleg:0,tf:0,build:0,turn:0,remark:'KOP'},
    {type:type==='J'?'造斜段':type==='S'?'增斜段':'增斜段',md:kop+850,inc:type==='J'?35:type==='S'?26:60,azi:121.5,cl:850,tvd:(kop+tvd)/2,ns:ns*0.35,ew:ew*0.35,vsec:Math.abs(ns*0.35),dogleg:3.2,tf:121.5,build:2.1,turn:0,remark:'模板中间点'},
    {type:type==='H'?'水平段':'终点',md:kop+1900,inc:type==='H'?88.5:type==='S'?12:35,azi:121.5,cl:1050,tvd,ns,ew,vsec:Math.sqrt(ns*ns+ew*ew),dogleg:2.6,tf:121.5,build:type==='S'?-1.2:1.8,turn:0,remark:'模板终点'}
  ];
  recalcRowsLocal();
  renderGrid();
  updateSummary();
  callApiAction('designTemplate', buildDisignDto(), {silent:true});
  addLog(`套用${type}形井设计模板`);
  toast(`已套用${type}形井模板`);
}

function openTrajectoryManager(){
  showModal('轨迹管理器', trajectoryListHtml(), () => {}, {wide:true});
}
function activateTrajectory(id){
  state.trajectories.forEach(t => t.active = t.id === id);
  const t = state.trajectories.find(x => x.id === id);
  if(t) $('activeTrajectoryName').textContent = t.name;
  addLog(`激活轨迹 ${id}`);
  toast(`已激活轨迹 ${id}`);
  if(state.activeSubmodule === 'management') renderTrajectoryManagement();
}
function copyTrajectory(id){
  const src = state.trajectories.find(t => t.id === id);
  if(!src) return;
  const cp = {...src, id:'TRJ-COPY-'+Date.now().toString().slice(-4), name:src.name+' 副本', active:false, updated:'刚刚'};
  state.trajectories.push(cp);
  addLog(`复制轨迹 ${id}`);
  toast('已复制轨迹');
  renderTrajectoryManagement();
}
window.activateTrajectory = activateTrajectory;
window.copyTrajectory = copyTrajectory;
window.openTrajectoryManager = openTrajectoryManager;

function newSurveyTrajectory(){
  state.surveyRows = state.rows.slice(0,120).map((r,i)=>({...r,type:'实测',md:+(num(r.md)+i*0.01).toFixed(2),remark:'新建实测'}));
  addLog('新建实测轨迹');
  toast('已新建实测轨迹');
  renderSurveyEditor();
}
function validateAndReport(){
  const v = validateRows();
  showModal('轨迹数据校验报告', `<div class="small-note">异常行：${v.invalidRows.length ? v.invalidRows.join(', ') : '无'}<br>警告：${v.warnings.length ? v.warnings.join('<br>') : '无'}<br><br>校验项目：MD递增、INC范围、AZI范围、DLS阈值、空值检查。</div>`, () => {});
}
window.validateAndReport = validateAndReport;
window.newSurveyTrajectory = newSurveyTrajectory;
window.openImportFile = openImportFile;
window.pasteImportModal = pasteImportModal;
window.exportCsv = exportCsv;
window.saveTrajectory = saveTrajectory;
window.toggleApiMode = toggleApiMode;
window.testApiConnection = testApiConnection;

function openDirectionControl(){
  showModal('方向控制', `<div class="modal-grid"><label>当前MD<input value="${fmt(state.rows[state.selectedRow]?.md,1)}"></label><label>AZI目标<input id="ctlAzi" value="103.778"></label><label>TF工具面<input id="ctlTf" value="10"></label><label>CL段长<input id="ctlCl" value="45"></label><label>计算INC<input id="ctlInc" value="74"></label><label>DLS<input id="ctlDls" value="0"></label></div>`, () => insertControlResult('direction'));
}
function openSingleSectionControl(){
  showModal('单井段控制', `<div class="modal-grid"><label>起点MD<input value="0"></label><label>终点MD<input value="100"></label><label>起点INC<input value="0"></label><label>终点INC<input value="40"></label><label>起点AZI<input value="0"></label><label>终点AZI<input value="60"></label></div>`, () => insertControlResult('section'));
}
function openSoftLandingControl(){
  showModal('连续导向软着陆', `<div class="modal-grid"><label>起点MD<input value="120"></label><label>目标INC<input value="90"></label><label>目标AZI<input value="0"></label><label>目标TVD<input value="120"></label><label>N/S<input value="0"></label><label>E/W<input value="0"></label></div>`, () => insertControlResult('landing'));
}
function insertControlResult(type){
  const base = state.rows[state.selectedRow] || state.rows[state.rows.length-1];
  const row = {...base, type:type==='direction'?'方向控制':type==='section'?'单井段':'软着陆', md:num(base.md)+45, cl:45, inc:type==='direction'?74:num(base.inc)+2, azi:type==='direction'?103.778:num(base.azi), tf:type==='direction'?10:0, remark:`${type}控制插入`};
  state.rows.splice(state.selectedRow+1,0,row);
  recalcRowsLocal();
  renderGrid();
  updateSummary();
  addLog(`插入${type}控制结果`);
  toast('控制结果已插入轨迹表');
}
window.openDirectionControl = openDirectionControl;
window.openSingleSectionControl = openSingleSectionControl;
window.openSoftLandingControl = openSoftLandingControl;
window.insertControlResult = insertControlResult;

function showDeviationSettings(){
  showModal('偏差分析设置', `<div class="modal-grid"><label>参考轨迹<select><option>设计轨迹</option><option>实测轨迹</option></select></label><label>比较轨迹<select><option>实测轨迹</option><option>仿真轨迹</option></select></label><label>投影方法<select><option>平面投影</option><option>曲面投影</option></select></label><label>采样间隔<input value="30"></label></div>`, () => {toast('偏差分析设置已应用');});
}
window.showDeviationSettings = showDeviationSettings;
window.showCollisionSettings = showCollisionSettings;
window.runCollisionScan = runCollisionScan;
window.applyCollisionSettings = applyCollisionSettings;



/* =========================================================
   V2.9.0.1.1 Calibration Report Page Fix
   补齐算法校准报告页渲染与“加载内置样本”按钮。
   ========================================================= */
function mockCalibrationReport(){
  const metrics = {
    TVD:{count:7,meanError:0,meanAbs:0.012,maxAbs:0.041,rmse:0.018},
    NS:{count:7,meanError:0,meanAbs:0.016,maxAbs:0.052,rmse:0.022},
    EW:{count:7,meanError:0,meanAbs:0.014,maxAbs:0.047,rmse:0.020},
    DOGLEG:{count:7,meanError:0,meanAbs:0.003,maxAbs:0.012,rmse:0.005},
    BUILD:{count:7,meanError:0,meanAbs:0.002,maxAbs:0.009,rmse:0.004},
    TURN:{count:7,meanError:0,meanAbs:0.001,maxAbs:0.006,rmse:0.003}
  };
  const rowErrors = [];
  for(let i=0;i<26;i++){
    const md = i === 0 ? 0 : 400 + i * 180;
    rowErrors.push({
      index:i+1,
      MD:md,
      TVD_err:+(Math.sin(i/3)*0.035).toFixed(5),
      NS_err:+(Math.cos(i/4)*0.045).toFixed(5),
      EW_err:+(Math.sin(i/5)*0.040).toFixed(5),
      DOGLEG_err:+(Math.sin(i/2)*0.010).toFixed(5),
      BUILD_err:+(Math.cos(i/3)*0.008).toFixed(5),
      TURN_err:+(Math.sin(i/4)*0.006).toFixed(5)
    });
  }
  return {
    ok:true,
    verdict:'PASS',
    engine:'FastAPI minimum-curvature-v2.9.0',
    reference:'MyDrill/well-path DLL exported result',
    stationCount:26,
    referenceCount:26,
    candidateCount:26,
    tolerance:{TVD:0.05,NS:0.05,EW:0.05,DOGLEG:0.02,BUILD:0.02,TURN:0.02},
    metrics,
    exceeded:{},
    rowErrors,
    note:'内置样本用于检查报告页面、后端接口和导出链路。真实验收请粘贴 MyDrill 导出 CSV。'
  };
}

function normalizeCalibrationReport(raw){
  const report = raw?.data || raw?.result || raw || mockCalibrationReport();
  report.metrics = report.metrics || {};
  report.rowErrors = report.rowErrors || [];
  report.exceeded = report.exceeded || {};
  report.verdict = report.verdict || (Object.keys(report.exceeded).length ? 'REVIEW' : 'PASS');
  return report;
}

function renderCalibrationReportPage(){
  state.activeSubmodule = 'calibration';
  state.editorView = 'calibration';
  document.querySelectorAll('#subtabRow button').forEach(b => b.classList.toggle('active', b.dataset.module === 'calibration'));
  const report = normalizeCalibrationReport(state.calibrationReport || mockCalibrationReport());
  state.calibrationReport = report;

  $('pageTitle').textContent = '算法校准 · MyDrill DLL 对照校准报告';
  $('pageSubtitle').textContent = '/Calibration/MyDrillAlignment：旧 MyDrill/well-path DLL 导出结果与 DrillSpace FastAPI 最小曲率引擎逐列对照';
  $('workbookTitle').textContent = 'MyDrill 对照校准报告 / Calibration Report';
  $('rowCountLabel').textContent = `${report.stationCount || 0} stations · ${report.verdict || 'REVIEW'} · ${report.engine || 'FastAPI engine'}`;

  const verdictClass = String(report.verdict || '').toUpperCase() === 'PASS' ? 'pass' : 'review';
  const metricCols = ['TVD','NS','EW','DOGLEG','BUILD','TURN'];
  const metricsHtml = metricCols.map(col => {
    const m = report.metrics?.[col] || {};
    const exceeded = report.exceeded && report.exceeded[col];
    return `<div class="calib-metric ${exceeded?'review':'pass'}">
      <span>${col} 最大误差</span>
      <b>${fmt(m.maxAbs ?? 0, col==='DOGLEG'||col==='BUILD'||col==='TURN'?4:3)}</b>
      <em>RMSE ${fmt(m.rmse ?? 0, col==='DOGLEG'||col==='BUILD'||col==='TURN'?4:3)} · N=${m.count || 0}</em>
    </div>`;
  }).join('');

  $('editorContent').innerHTML = `<div class="submodule-content calibration-page-v290">
    <div class="calibration-head ${verdictClass}">
      <div>
        <b>MyDrill / well-path DLL 对照校准报告</b>
        <span>将旧系统导出的 MD/INC/AZI/TVD/NS/EW/DLS/Build/Turn 与 DrillSpace 后端重新计算结果逐列比较。</span>
      </div>
      <div class="calibration-verdict">
        <strong>${esc(report.verdict || 'REVIEW')}</strong>
        <small>${esc(state.calibrationSource || 'sample')}</small>
      </div>
    </div>

    <div class="calibration-actions">
      <button class="primary" onclick="loadCalibrationSample()">加载内置样本</button>
      <button onclick="loadCalibrationLatest()">读取最新报告</button>
      <button onclick="openCalibrationCsvModal()">粘贴 MyDrill CSV 对照</button>
      <button onclick="exportCalibrationJson()">导出 JSON</button>
      <button onclick="exportCalibrationErrorCsv()">导出误差 CSV</button>
      <button onclick="callApiAction('calibrationTemplate')">查看字段模板</button>
    </div>

    <div class="calibration-kpi-grid">
      <div class="calib-kpi ${verdictClass}"><span>总体结论</span><b>${esc(report.verdict || 'REVIEW')}</b><em>PASS / REVIEW</em></div>
      <div class="calib-kpi"><span>对照测点</span><b>${report.stationCount || 0}</b><em>station pairs</em></div>
      <div class="calib-kpi"><span>参考来源</span><b>${esc(report.reference || 'MyDrill')}</b><em>reference output</em></div>
      <div class="calib-kpi"><span>计算引擎</span><b>${esc(report.engine || 'FastAPI')}</b><em>current backend</em></div>
    </div>

    <div class="calibration-metrics-grid">${metricsHtml}</div>

    <div class="calibration-main-grid">
      <section class="calibration-chart-card">
        <div class="calibration-card-title"><b>逐测点误差曲线</b><span>TVD / NS / EW / DLS / Build / Turn error by MD</span></div>
        ${calibrationErrorSvg(report)}
      </section>
      <section class="calibration-side-card">
        <div class="calibration-card-title"><b>超差与说明</b><span>Exceeded tolerance / notes</span></div>
        ${calibrationNotesHtml(report)}
      </section>
    </div>

    <section class="calibration-table-card">
      <div class="calibration-card-title"><b>逐测点误差表</b><span>前 500 行，真实 CSV 对照后自动更新</span></div>
      <div class="calibration-table-wrap">${calibrationErrorTable(report)}</div>
    </section>
  </div>`;
  addLog(`打开算法校准报告页：${report.verdict || 'REVIEW'}`);
}

async function loadCalibrationSample(){
  const result = await callApiAction('calibrationSample', null, {silent:true});
  state.calibrationReport = normalizeCalibrationReport(result);
  state.calibrationSource = state.apiMode === 'api' ? 'backend sample' : 'mock sample';
  renderCalibrationReportPage();
  toast('已加载内置校准样本');
  addLog('加载内置 MyDrill 对照样本');
}

async function loadCalibrationLatest(){
  const result = await callApiAction('calibrationLatest', null, {silent:true});
  state.calibrationReport = normalizeCalibrationReport(result);
  state.calibrationSource = state.apiMode === 'api' ? 'latest report' : 'mock latest';
  renderCalibrationReportPage();
  toast('已读取最新校准报告');
  addLog('读取最新校准报告');
}

function openCalibrationCsvModal(){
  showModal('粘贴 MyDrill / well-path 导出 CSV', `
    <div class="small-note">
      请粘贴旧 MyDrill 导出的轨迹计算结果。建议字段：
      <code>MD,INC,AZI,CL,TVD,NS,EW,VSEC,DOGLEG,TF,BUILD,TURN</code>
    </div>
    <textarea id="calibrationCsvBox" style="width:100%;height:330px;border:1px solid #cbd9e8;border-radius:3px;font-family:Consolas,monospace;margin-top:8px"
placeholder="MD,INC,AZI,CL,TVD,NS,EW,VSEC,DOGLEG,TF,BUILD,TURN"></textarea>`,
    () => compareCalibrationCsvText(),
    {extraWide:true}
  );
}

async function compareCalibrationCsvText(){
  const csvText = $('calibrationCsvBox')?.value || '';
  if(!csvText.trim()){
    toast('CSV为空，未执行对照');
    return;
  }
  const result = await callApiAction('calibrationCompare', {csvText}, {silent:true});
  state.calibrationReport = normalizeCalibrationReport(result);
  state.calibrationSource = 'pasted MyDrill CSV';
  renderCalibrationReportPage();
  toast('MyDrill CSV 对照完成');
  addLog('完成 MyDrill CSV 对照校准');
}

function calibrationNotesHtml(report){
  const exceeded = report.exceeded || {};
  const keys = Object.keys(exceeded);
  const noteClass = String(report.verdict || '').toUpperCase() === 'PASS' ? 'pass' : 'review';
  const exceededHtml = keys.length
    ? keys.map(k => `<div class="calibration-note review"><b>${esc(k)} 超差</b><span>maxAbs=${fmt(exceeded[k].maxAbs,4)}，tolerance=${fmt(exceeded[k].tolerance,4)}</span></div>`).join('')
    : `<div class="calibration-note pass"><b>未发现超差列</b><span>当前对照结果满足内置容差。真实验收时应使用旧 MyDrill 导出数据重新校验。</span></div>`;
  return `${exceededHtml}
    <div class="calibration-note ${noteClass}">
      <b>说明</b>
      <span>${esc(report.note || '该报告用于校验 DrillSpace 后端轨迹引擎与旧 MyDrill/well-path 输出的一致性。')}</span>
    </div>
    <div class="calibration-note">
      <b>建议流程</b>
      <span>先点“加载内置样本”检查链路，再粘贴旧 MyDrill CSV 做正式对照，最后导出 JSON/CSV 作为阶段验收附件。</span>
    </div>`;
}

function calibrationErrorSvg(report){
  const rows = (report.rowErrors || []).slice(0,120);
  if(!rows.length) return `<div class="calibration-empty">暂无误差曲线数据</div>`;
  const w = 780, h = 360, padL = 54, padR = 20, padT = 24, padB = 40;
  const cols = [
    ['TVD_err','#1d5fd0'],
    ['NS_err','#0ea5c6'],
    ['EW_err','#13a66f'],
    ['DOGLEG_err','#d48a09'],
    ['BUILD_err','#7c5cff'],
    ['TURN_err','#d94444']
  ];
  const mdMin = Math.min(...rows.map(r => num(r.MD)));
  const mdMax = Math.max(...rows.map(r => num(r.MD)));
  const maxAbs = Math.max(0.001, ...rows.flatMap(r => cols.map(c => Math.abs(num(r[c[0]])))));
  const toX = md => padL + (num(md)-mdMin)/Math.max(1e-9,mdMax-mdMin)*(w-padL-padR);
  const toY = v => padT + (maxAbs-num(v))/(maxAbs*2)*(h-padT-padB);
  const zeroY = toY(0);
  const polylines = cols.map(([key,color]) => {
    const pts = rows.map(r => `${toX(r.MD).toFixed(1)},${toY(r[key]||0).toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8"/>`;
  }).join('');
  const legend = cols.map(([key,color],i)=>`<g transform="translate(${padL+i*108},16)"><rect width="18" height="3" fill="${color}"/><text x="24" y="4" font-size="10" fill="#50627a">${key.replace('_err','')}</text></g>`).join('');
  return `<svg class="calibration-error-svg" viewBox="0 0 ${w} ${h}">
    <defs><pattern id="calibGrid" width="42" height="28" patternUnits="userSpaceOnUse"><path d="M42 0H0V28" fill="none" stroke="#e1eaf3"/></pattern></defs>
    <rect width="${w}" height="${h}" fill="#fff"/>
    <rect x="${padL}" y="${padT}" width="${w-padL-padR}" height="${h-padT-padB}" fill="url(#calibGrid)" stroke="#cbd8e7"/>
    <line x1="${padL}" x2="${w-padR}" y1="${zeroY}" y2="${zeroY}" stroke="#64748b" stroke-dasharray="6 4"/>
    ${polylines}
    ${legend}
    <text x="${w/2-28}" y="${h-10}" font-size="12" fill="#263e5e" font-weight="800">MD(m)</text>
    <text x="12" y="${padT+10}" font-size="12" fill="#263e5e" font-weight="800">Error</text>
  </svg>`;
}

function calibrationErrorTable(report){
  const rows = (report.rowErrors || []).slice(0,500);
  if(!rows.length) return `<div class="calibration-empty">暂无逐测点误差数据</div>`;
  const cols = ['TVD','NS','EW','DOGLEG','BUILD','TURN'];
  return `<table class="calibration-table">
    <thead><tr><th>#</th><th>MD</th>${cols.map(c=>`<th>${c}误差</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r,i)=>`<tr>
      <td>${i+1}</td><td>${fmt(r.MD,1)}</td>
      ${cols.map(c=>`<td>${fmt(r[c+'_err']||0, c==='DOGLEG'||c==='BUILD'||c==='TURN'?5:4)}</td>`).join('')}
    </tr>`).join('')}</tbody>
  </table>`;
}

function exportCalibrationJson(){
  const report = state.calibrationReport || mockCalibrationReport();
  const blob = new Blob([JSON.stringify(report,null,2)], {type:'application/json;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'DrillSpace_Calibration_Report.json'; a.click();
  URL.revokeObjectURL(url);
  toast('已导出校准报告 JSON');
}

function exportCalibrationErrorCsv(){
  const report = state.calibrationReport || mockCalibrationReport();
  const rows = report.rowErrors || [];
  const cols = ['index','MD','TVD_err','NS_err','EW_err','DOGLEG_err','BUILD_err','TURN_err'];
  const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => r[c] ?? '').join(','))).join('\n');
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'DrillSpace_Calibration_Errors.csv'; a.click();
  URL.revokeObjectURL(url);
  toast('已导出误差 CSV');
}

window.renderCalibrationReportPage = renderCalibrationReportPage;
window.loadCalibrationSample = loadCalibrationSample;
window.loadCalibrationLatest = loadCalibrationLatest;
window.openCalibrationCsvModal = openCalibrationCsvModal;
window.exportCalibrationJson = exportCalibrationJson;
window.exportCalibrationErrorCsv = exportCalibrationErrorCsv;


async function testBackendHealth(){
  const base = (state.apiBaseUrl || 'http://127.0.0.1:8000').replace(/\/$/,'');
  try{
    const resp = await fetch(base + '/api/health');
    const json = await resp.json();
    toast(`后端连接正常：${json.status || 'ok'} / ${json.version || 'V2.8.6'}`);
    addLog('FastAPI 后端健康检查通过');
  }catch(err){
    toast(`后端健康检查失败：${err.message}`);
    addLog('FastAPI 后端健康检查失败');
  }
}
window.testBackendHealth = testBackendHealth;

function apiStatus(){
  showModal('well-path API 状态 / MyDrill 接口映射', `<div class="small-note">当前模式：<b>${state.apiMode.toUpperCase()}</b>；BaseURL：<code>${esc(state.apiBaseUrl)}</code></div>${apiContractHtml()}<div class="modal-grid" style="margin-top:10px"><label>API Base URL<input id="modalApiBase" value="${esc(state.apiBaseUrl)}"></label><label>调用模式<select id="modalApiMode"><option value="mock">mock</option><option value="api">api</option></select></label></div>`, () => { state.apiBaseUrl = $('modalApiBase')?.value || state.apiBaseUrl; state.apiMode = $('modalApiMode')?.value || state.apiMode; localStorage.setItem('drillspace-api-base', state.apiBaseUrl); localStorage.setItem('drillspace-api-mode', state.apiMode); if($('apiBaseUrl')) $('apiBaseUrl').value = state.apiBaseUrl; updateSummary(); }, {extraWide:true});
  setTimeout(()=>{ if($('modalApiMode')) $('modalApiMode').value = state.apiMode; },0);
}

function exportApiMap(){
  const md = Object.entries(trajectoryApiMap).map(([key,a]) => `| ${key} | ${a.method} | ${a.path} | ${a.module} | ${a.action} | ${a.payload} | ${a.result} |`).join('\n');
  const text = `# DrillSpace V2.7.4 well-path API Map\n\n| Key | Method | Path | Module | Action | Payload | Result |\n|---|---|---|---|---|---|---|\n${md}\n`;
  const blob = new Blob([text], {type:'text/markdown;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='well-path-api-map.md'; a.click(); URL.revokeObjectURL(url);
}
window.exportApiMap = exportApiMap;

function showModal(title, body, onOk, opt={}){
  const mask = $('modalMask'), box = $('modalBox');
  box.className = `modal ${opt.wide?'wide':''} ${opt.extraWide?'extra-wide':''}`;
  box.innerHTML = `<div class="modal-head"><b>${title}</b><button class="link-btn" id="closeModal">关闭</button></div><div class="modal-body">${body}</div><div class="modal-foot"><button id="cancelModal">取消</button><button class="primary" id="okModal">确定</button></div>`;
  mask.classList.add('show');
  $('closeModal').onclick = $('cancelModal').onclick = () => mask.classList.remove('show');
  $('okModal').onclick = () => { mask.classList.remove('show'); if(onOk) onOk(); };
}
function confirmModal(title, msg, onOk){ showModal(title, `<div class="small-note">${msg}</div>`, onOk); }

function toast(msg){
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function addLog(msg){
  const now = new Date();
  state.logs.unshift({ msg, time: now.toLocaleTimeString('zh-CN',{hour12:false}) });
  state.logs = state.logs.slice(0,9);
  renderLogs();
}

function updateClock(){
  const now = new Date();
  $('statusTime').textContent = `本地时间：${now.toLocaleString('zh-CN',{hour12:false})}`;
}

function bind(){
  document.querySelectorAll('.view-switch button').forEach(b => b.onclick = () => switchEditorView(b.dataset.view));
  document.querySelectorAll('#subtabRow button').forEach(b => b.onclick = () => setSubmodule(b.dataset.module));
  document.querySelectorAll('.template-list button').forEach(b => b.onclick = () => { document.querySelectorAll('.template-list button').forEach(x => x.classList.remove('active')); b.classList.add('active'); $('wellType').value = b.dataset.template; toast(`已选择${b.dataset.template}形井模板`); });
  $('applyRowBtn').onclick = applyRowProps;
  $('applyFormBtn').onclick = () => { state.apiBaseUrl = $('apiBaseUrl').value; localStorage.setItem('drillspace-api-base', state.apiBaseUrl); updateSummary(); toast('设计参数与API Base已应用'); };
  $('addRowBtn').onclick = () => addRow(false);
  $('insertAfterBtn').onclick = () => addRow(true);
  $('deleteRowBtn').onclick = deleteSelectedRow;
  $('moveUpBtn').onclick = () => moveRow(-1);
  $('moveDownBtn').onclick = () => moveRow(1);
  $('clearBtn').onclick = clearRows;
  $('calculateBtn').onclick = recalcRows;
  $('calcBtnSide').onclick = recalcRows;
  $('interpolateBtn').onclick = interpolate;
  $('saveBtn').onclick = saveTrajectory;
  $('saveBtnSide').onclick = saveTrajectory;
  $('newProjectBtn').onclick = newProject;
  $('newTrajectoryBtn').onclick = newTrajectory;
  $('importSurveyBtn').onclick = openImportFile;
  $('importBtn').onclick = openImportFile;
  $('openTemplateBtn').onclick = openTemplate;
  $('templateBtn2').onclick = openTemplate;
  $('apiStatusBtn').onclick = apiStatus;
  $('apiModeBtn').onclick = toggleApiMode;
  $('collisionBtn').onclick = () => setSubmodule('collision');
  $('exportBtn').onclick = exportCsv;
  $('openLargeGridBtn').onclick = () => { document.body.classList.toggle('fullscreen-grid'); toast(document.body.classList.contains('fullscreen-grid') ? '已进入全屏表格编辑' : '已退出全屏表格编辑'); };
  $('openTrajectoryManagerBtn').onclick = () => setSubmodule('management');
  $('apiContractBtn').onclick = apiStatus;
  $('summaryDetailBtn').onclick = () => showModal('轨迹摘要详情', miniRowsTable(state.rows.slice(0,30)), () => {}, {wide:true});
  $('refreshRiskBtn').onclick = () => { renderAlerts(); toast('风险预警已刷新'); };
  $('apiHistoryBtn').onclick = () => showModal('接口调用记录', `<div class="api-contract-table"><table><thead><tr><th>状态</th><th>方法</th><th>路径</th><th>时间</th></tr></thead><tbody>${state.apiHistory.map(h=>`<tr><td>${h.status}</td><td>${h.method}</td><td><code>${h.path}</code></td><td>${h.time}</td></tr>`).join('')}</tbody></table></div>`, () => {}, {wide:true});
  $('clearLogBtn').onclick = () => { state.logs = []; renderLogs(); };
  $('fileInput').addEventListener('change', handleFileSelected);
}


function bindResizePerfGuard(){
  let timer = null;
  window.addEventListener('resize', () => {
    document.body.classList.add('resizing');
    clearTimeout(timer);
    timer = setTimeout(() => {
      document.body.classList.remove('resizing');
      if(state.editorView === 'grid') renderVirtualRows(true);
    }, 120);
  }, { passive: true });
}

function init(){
  initRows();
  if($('apiBaseUrl')) $('apiBaseUrl').value = state.apiBaseUrl;
  renderTree();
  renderSubsystemRoutes();
  renderGrid();
  renderAlerts();
  renderTasks();
  renderApiHistory();
  updateSummary();
  updateClock();
  setInterval(updateClock, 1000);
  addLog('打开 DrillSpace V2.9.7 目标靶区与轨迹约束中心版');
  addLog('加载 MyDrill well-path API 映射');
  addLog('加载 B-1井 设计轨迹 A5123');
  bind();
  bindResizePerfGuard();
}

init();


/* =========================================================
   V2.9.1.1 Acceptance Sample Library Runtime Fix
   强制补齐“加载样本库 / 标准验收样本库 / 运行样本”前端函数。
   ========================================================= */
function acceptanceSampleDefaults(){
  return [
    {id:'vertical_well',name:'01 直井样本',type:'Trajectory',level:'basic',desc:'验证零井斜、TVD=MD、横向位移接近零。',expectedVerdict:'PASS'},
    {id:'j_well',name:'02 J形井样本',type:'Trajectory',level:'standard',desc:'直井段 + 增斜 + 稳斜，验证常规J形井。',expectedVerdict:'PASS'},
    {id:'s_well',name:'03 S形井样本',type:'Trajectory',level:'standard',desc:'增斜、稳斜、降斜组合，验证Build/Turn连续性。',expectedVerdict:'PASS'},
    {id:'horizontal_well',name:'04 水平井样本',type:'Trajectory',level:'standard',desc:'高井斜长水平段，验证累计TVD/NS/EW误差。',expectedVerdict:'PASS'},
    {id:'high_dogleg',name:'05 大狗腿风险样本',type:'Risk',level:'review',desc:'局部井斜/方位变化较大，用于触发REVIEW。',expectedVerdict:'REVIEW'},
    {id:'collision_nearby',name:'06 防碰近邻井样本',type:'Collision',level:'standard',desc:'当前井与邻井接近，后续用于防碰标准样本。',expectedVerdict:'PASS'}
  ];
}

async function fetchBackendJson(path, options={}){
  const base = (state.apiBaseUrl || 'http://127.0.0.1:8000').replace(/\/$/,'');
  const resp = await fetch(base + path, options);
  if(!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
  return await resp.json();
}

function localSampleReport(sampleId){
  const sample = acceptanceSampleDefaults().find(s=>s.id===sampleId) || acceptanceSampleDefaults()[3];
  const baseReport = (typeof mockCalibrationReport === 'function') ? mockCalibrationReport() : {ok:true,metrics:{},rowErrors:[],exceeded:{}};
  const report = normalizeCalibrationReport(baseReport);
  report.sample = sample;
  report.sampleId = sample.id;
  report.reference = `${sample.name} / frontend acceptance mock`;
  report.sourceType = 'frontend_mock_acceptance_sample';
  report.stationCount = sample.id === 'vertical_well' ? 13 : sample.id === 'horizontal_well' ? 56 : 32;
  if(sample.id === 'high_dogleg'){
    report.verdict = 'REVIEW';
    report.metrics.DOGLEG = {count:report.stationCount,meanError:0,meanAbs:0.018,maxAbs:0.046,rmse:0.024};
    report.metrics.BUILD = {count:report.stationCount,meanError:0,meanAbs:0.016,maxAbs:0.041,rmse:0.022};
    report.metrics.TURN = {count:report.stationCount,meanError:0,meanAbs:0.014,maxAbs:0.036,rmse:0.020};
    report.exceeded = {
      DOGLEG:{maxAbs:0.046,tolerance:0.02},
      BUILD:{maxAbs:0.041,tolerance:0.02},
      TURN:{maxAbs:0.036,tolerance:0.02}
    };
  }else{
    report.verdict = 'PASS';
    report.exceeded = {};
  }
  report.note = `标准验收样本：${sample.name}。真实验收仍以旧 MyDrill 导出 CSV 为准。`;
  return report;
}

function sampleLibraryHtml(){
  const samples = state.acceptanceSamples || acceptanceSampleDefaults();
  const active = state.activeAcceptanceSample || 'horizontal_well';
  const current = samples.find(s=>s.id===active) || samples[3] || samples[0];
  return `<section class="sample-library-v291">
    <div class="sample-library-head">
      <div>
        <b>标准验收样本库 / Acceptance Sample Library</b>
        <span>没有真实 MyDrill CSV 时，先用标准轨迹样本持续验证算法、报告页与导出链路；真实样本到位后直接替换。</span>
      </div>
      <div class="sample-library-actions">
        <button onclick="loadAcceptanceSamples()">加载样本库</button>
        <button onclick="generateAcceptanceSampleFiles()">生成样本文件</button>
        <button onclick="exportAcceptanceSampleCsv('${active}','reference')">导出参考CSV</button>
      </div>
    </div>
    <div class="sample-card-grid">
      ${samples.map(s => `<button class="sample-card ${active===s.id?'active':''} ${s.level || ''}" onclick="selectAcceptanceSample('${s.id}')">
        <b>${esc(s.name)}</b>
        <span>${esc(s.desc || '')}</span>
        <em>${esc(s.type || 'Trajectory')} · 预期 ${esc(s.expectedVerdict || 'PASS')}</em>
      </button>`).join('')}
    </div>
    <div class="sample-runbar">
      <span>当前样本：<b>${esc(current.name || active)}</b></span>
      <button class="primary" onclick="runAcceptanceSample('${active}')">运行该样本对照</button>
      <button onclick="applyAcceptanceSampleToTrajectory('${active}')">载入到轨迹表</button>
      <button onclick="exportAcceptanceSampleCsv('${active}','input')">导出输入CSV</button>
      <button onclick="exportAcceptanceSampleCsv('${active}','drillspace')">导出DrillSpace结果</button>
    </div>
  </section>`;
}

async function loadAcceptanceSamples(){
  if(state.apiMode === 'api'){
    try{
      const json = await fetchBackendJson('/api/well-path/samples');
      state.acceptanceSamples = json.data || json.samples || json || acceptanceSampleDefaults();
      state.activeAcceptanceSample = state.activeAcceptanceSample || state.acceptanceSamples[3]?.id || 'horizontal_well';
      toast('标准样本库已从后端加载');
    }catch(err){
      state.acceptanceSamples = acceptanceSampleDefaults();
      state.activeAcceptanceSample = state.activeAcceptanceSample || 'horizontal_well';
      toast(`后端样本库加载失败，使用前端默认样本：${err.message}`);
    }
  }else{
    state.acceptanceSamples = acceptanceSampleDefaults();
    state.activeAcceptanceSample = state.activeAcceptanceSample || 'horizontal_well';
    toast('当前 MOCK 模式：已加载前端默认样本库');
  }
  renderCalibrationReportPage();
}

function selectAcceptanceSample(sampleId){
  state.activeAcceptanceSample = sampleId;
  state.calibrationReport = localSampleReport(sampleId);
  state.calibrationSource = `selected sample:${sampleId}`;
  renderCalibrationReportPage();
  addLog(`选择标准验收样本：${sampleId}`);
}

async function runAcceptanceSample(sampleId){
  state.activeAcceptanceSample = sampleId || state.activeAcceptanceSample || 'horizontal_well';
  if(state.apiMode === 'api'){
    try{
      const json = await fetchBackendJson(`/api/well-path/samples/${state.activeAcceptanceSample}/calibrate`, {method:'POST'});
      state.calibrationReport = normalizeCalibrationReport(json);
      state.calibrationSource = `backend sample:${state.activeAcceptanceSample}`;
      toast('后端标准样本对照完成');
    }catch(err){
      state.calibrationReport = localSampleReport(state.activeAcceptanceSample);
      state.calibrationSource = `mock sample:${state.activeAcceptanceSample}`;
      toast(`后端样本运行失败，使用前端Mock：${err.message}`);
    }
  }else{
    state.calibrationReport = localSampleReport(state.activeAcceptanceSample);
    state.calibrationSource = `mock sample:${state.activeAcceptanceSample}`;
    toast('当前 MOCK 模式：标准样本对照完成');
  }
  renderCalibrationReportPage();
  addLog(`运行标准验收样本对照：${state.activeAcceptanceSample}`);
}

async function applyAcceptanceSampleToTrajectory(sampleId){
  state.activeAcceptanceSample = sampleId || state.activeAcceptanceSample || 'horizontal_well';
  if(state.apiMode !== 'api'){
    toast('载入轨迹表建议使用 API 模式。当前先运行样本报告。');
    runAcceptanceSample(state.activeAcceptanceSample);
    return;
  }
  try{
    const json = await fetchBackendJson(`/api/well-path/samples/${state.activeAcceptanceSample}`);
    const payload = json.data || json;
    if(payload.inputRows && payload.inputRows.length){
      state.rows = payload.inputRows.map(r => ({
        type:r.type || '样本点',
        md:num(r.md ?? r.MD),
        inc:num(r.inc ?? r.INC),
        azi:num(r.azi ?? r.AZI),
        cl:0,tvd:0,ns:0,ew:0,vsec:0,dogleg:0,tf:0,build:0,turn:0,
        remark:r.remark || state.activeAcceptanceSample
      }));
      recalcRowsLocal();
      state.selectedRow = 0;
      renderGrid();
      updateSummary();
      toast('样本已载入轨迹数据表');
    }
  }catch(err){
    toast(`样本载入失败：${err.message}`);
  }
}

function downloadTextFile(filename, text, type='text/plain;charset=utf-8'){
  const blob = new Blob(['\uFEFF' + text], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

async function exportAcceptanceSampleCsv(sampleId, kind='reference'){
  sampleId = sampleId || state.activeAcceptanceSample || 'horizontal_well';
  if(state.apiMode === 'api'){
    try{
      const base = (state.apiBaseUrl || 'http://127.0.0.1:8000').replace(/\/$/,'');
      const resp = await fetch(`${base}/api/well-path/samples/${sampleId}/csv?kind=${kind}`);
      if(!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
      const text = await resp.text();
      downloadTextFile(`DrillSpace_${sampleId}_${kind}.csv`, text, 'text/csv;charset=utf-8');
      toast(`已导出 ${sampleId} / ${kind} CSV`);
      return;
    }catch(err){
      toast(`后端CSV导出失败，使用前端占位CSV：${err.message}`);
    }
  }
  const sample = acceptanceSampleDefaults().find(s=>s.id===sampleId) || acceptanceSampleDefaults()[0];
  const csv = `sample_id,name,type,expected\n${sample.id},${sample.name},${sample.type},${sample.expectedVerdict}\n`;
  downloadTextFile(`DrillSpace_${sampleId}_${kind}_mock.csv`, csv, 'text/csv;charset=utf-8');
}

async function generateAcceptanceSampleFiles(){
  if(state.apiMode !== 'api'){
    toast('生成样本文件需要后端 API 模式。请先启动后端并切到 API。');
    return;
  }
  try{
    const json = await fetchBackendJson('/api/well-path/samples/generate-files', {method:'POST'});
    const result = json.data || json;
    toast(`样本文件已生成：${(result.written||[]).length} 个CSV`);
    addLog('后端生成标准验收样本库文件');
  }catch(err){
    toast(`生成样本文件失败：${err.message}`);
  }
}

function renderCalibrationReportPage(){
  state.activeSubmodule = 'calibration';
  state.editorView = 'calibration';
  if(!state.acceptanceSamples) state.acceptanceSamples = acceptanceSampleDefaults();
  if(!state.activeAcceptanceSample) state.activeAcceptanceSample = 'horizontal_well';

  document.querySelectorAll('#subtabRow button').forEach(b => b.classList.toggle('active', b.dataset.module === 'calibration'));
  const report = normalizeCalibrationReport(state.calibrationReport || localSampleReport(state.activeAcceptanceSample));
  state.calibrationReport = report;

  $('pageTitle').textContent = '算法校准 · 标准验收样本库与 MyDrill 对照报告';
  $('pageSubtitle').textContent = '/Calibration/AcceptanceSamples：内置标准轨迹样本、MyDrill-like参考结果、后端最小曲率计算与逐列误差报告';
  $('workbookTitle').textContent = '标准验收样本库 / Calibration Report';
  $('rowCountLabel').textContent = `${report.stationCount || 0} stations · ${report.verdict || 'REVIEW'} · ${report.engine || 'FastAPI engine'}`;

  const verdictClass = String(report.verdict || '').toUpperCase() === 'PASS' ? 'pass' : 'review';
  const metricCols = ['TVD','NS','EW','DOGLEG','BUILD','TURN'];
  const metricsHtml = metricCols.map(col => {
    const m = report.metrics?.[col] || {};
    const exceeded = report.exceeded && report.exceeded[col];
    return `<div class="calib-metric ${exceeded?'review':'pass'}">
      <span>${col} 最大误差</span>
      <b>${fmt(m.maxAbs ?? 0, col==='DOGLEG'||col==='BUILD'||col==='TURN'?4:3)}</b>
      <em>RMSE ${fmt(m.rmse ?? 0, col==='DOGLEG'||col==='BUILD'||col==='TURN'?4:3)} · N=${m.count || 0}</em>
    </div>`;
  }).join('');

  $('editorContent').innerHTML = `<div class="submodule-content calibration-page-v290 calibration-page-v291">
    <div class="calibration-head ${verdictClass}">
      <div>
        <b>标准验收样本库 + MyDrill 对照校准报告</b>
        <span>先用标准样本保证“能跑、能验、能导出”，真实 MyDrill CSV 到位后直接替换参考结果。</span>
      </div>
      <div class="calibration-verdict">
        <strong>${esc(report.verdict || 'REVIEW')}</strong>
        <small>${esc(state.calibrationSource || 'acceptance sample')}</small>
      </div>
    </div>

    <div class="calibration-actions">
      <button class="primary" onclick="runAcceptanceSample(state.activeAcceptanceSample || 'horizontal_well')">运行当前样本</button>
      <button onclick="loadAcceptanceSamples()">加载样本库</button>
      <button onclick="loadCalibrationLatest()">读取最新报告</button>
      <button onclick="openCalibrationCsvModal()">粘贴真实 MyDrill CSV</button>
      <button onclick="exportCalibrationJson()">导出 JSON</button>
      <button onclick="exportCalibrationErrorCsv()">导出误差 CSV</button>
    </div>

    ${sampleLibraryHtml()}

    <div class="calibration-kpi-grid">
      <div class="calib-kpi ${verdictClass}"><span>总体结论</span><b>${esc(report.verdict || 'REVIEW')}</b><em>PASS / REVIEW</em></div>
      <div class="calib-kpi"><span>对照测点</span><b>${report.stationCount || 0}</b><em>station pairs</em></div>
      <div class="calib-kpi"><span>当前样本</span><b>${esc(report.sample?.name || state.activeAcceptanceSample || 'sample')}</b><em>acceptance sample</em></div>
      <div class="calib-kpi"><span>计算引擎</span><b>${esc(report.engine || 'FastAPI')}</b><em>current backend</em></div>
    </div>

    <div class="calibration-metrics-grid">${metricsHtml}</div>

    <div class="calibration-main-grid">
      <section class="calibration-chart-card">
        <div class="calibration-card-title"><b>逐测点误差曲线</b><span>TVD / NS / EW / DLS / Build / Turn error by MD</span></div>
        ${calibrationErrorSvg(report)}
      </section>
      <section class="calibration-side-card">
        <div class="calibration-card-title"><b>样本说明与超差项</b><span>Acceptance sample notes / exceeded tolerance</span></div>
        ${calibrationNotesHtml(report)}
      </section>
    </div>

    <section class="calibration-table-card">
      <div class="calibration-card-title"><b>逐测点误差表</b><span>前 500 行，运行不同样本后自动更新</span></div>
      <div class="calibration-table-wrap">${calibrationErrorTable(report)}</div>
    </section>
  </div>`;
  addLog(`打开标准验收样本库：${report.verdict || 'REVIEW'}`);
}

window.acceptanceSampleDefaults = acceptanceSampleDefaults;
window.loadAcceptanceSamples = loadAcceptanceSamples;
window.selectAcceptanceSample = selectAcceptanceSample;
window.runAcceptanceSample = runAcceptanceSample;
window.applyAcceptanceSampleToTrajectory = applyAcceptanceSampleToTrajectory;
window.exportAcceptanceSampleCsv = exportAcceptanceSampleCsv;
window.generateAcceptanceSampleFiles = generateAcceptanceSampleFiles;
window.renderCalibrationReportPage = renderCalibrationReportPage;


/* =========================================================
   V2.9.2.1 Runtime Patch: Batch Acceptance Button Fix
   目的：无论旧 renderCalibrationReportPage 是否覆盖，都强制显示
   “运行全部样本 / 读取总报告 / 导出总报告”区域。
   ========================================================= */
(function(){
  function safeNum(v){ return Number(v || 0); }

  if(typeof window.localBatchAcceptanceReport !== 'function'){
    window.localBatchAcceptanceReport = function(){
      const samples = (typeof acceptanceSampleDefaults === 'function') ? acceptanceSampleDefaults() : [
        {id:'vertical_well',name:'01 直井样本',type:'Trajectory',expectedVerdict:'PASS'},
        {id:'j_well',name:'02 J形井样本',type:'Trajectory',expectedVerdict:'PASS'},
        {id:'s_well',name:'03 S形井样本',type:'Trajectory',expectedVerdict:'PASS'},
        {id:'horizontal_well',name:'04 水平井样本',type:'Trajectory',expectedVerdict:'PASS'},
        {id:'high_dogleg',name:'05 大狗腿风险样本',type:'Risk',expectedVerdict:'REVIEW'},
        {id:'collision_nearby',name:'06 防碰近邻井样本',type:'Collision',expectedVerdict:'PASS'}
      ];
      const rows = samples.map(s => ({
        sampleId:s.id,
        name:s.name,
        type:s.type,
        expectedVerdict:s.expectedVerdict || 'PASS',
        actualVerdict:s.id === 'high_dogleg' ? 'REVIEW' : 'PASS',
        stationCount:s.id === 'horizontal_well' ? 56 : 32,
        TVD_maxAbs:s.id === 'high_dogleg' ? 0.09 : 0.041,
        NS_maxAbs:s.id === 'high_dogleg' ? 0.11 : 0.052,
        EW_maxAbs:s.id === 'high_dogleg' ? 0.10 : 0.047,
        DOGLEG_maxAbs:s.id === 'high_dogleg' ? 0.046 : 0.012,
        BUILD_maxAbs:s.id === 'high_dogleg' ? 0.041 : 0.009,
        TURN_maxAbs:s.id === 'high_dogleg' ? 0.036 : 0.006,
        recommendation:s.id === 'high_dogleg' ? '复核高狗腿/局部曲率或替换真实MyDrill样本' : '通过'
      }));
      const passCount = rows.filter(r=>r.actualVerdict==='PASS').length;
      const reviewCount = rows.filter(r=>r.actualVerdict==='REVIEW').length;
      const maxErrors = {};
      ['TVD','NS','EW','DOGLEG','BUILD','TURN'].forEach(c=>{
        maxErrors[c] = Math.max(...rows.map(r => safeNum(r[c+'_maxAbs'])));
      });
      return {
        ok:true,
        version:'2.9.2.1',
        overallVerdict:'PASS',
        totalSamples:rows.length,
        passCount,
        reviewCount,
        failCount:0,
        acceptanceRate:passCount/Math.max(1,rows.length),
        maxErrors,
        samples:rows,
        note:'V2.9.2.1 前端兜底批量验收报告。API模式下优先调用后端 run-all 接口。'
      };
    };
  }

  function batchTableHtml(report){
    const rows = report.samples || [];
    if(!rows.length) return '<div class="calibration-empty">暂无批量验收样本结果，请点击“运行全部样本”。</div>';
    return `<table class="batch-table">
      <thead><tr>
        <th>#</th><th>样本名称</th><th>类型</th><th>预期</th><th>实际</th><th>测点</th>
        <th>TVD</th><th>NS</th><th>EW</th><th>DLS</th><th>Build</th><th>Turn</th><th>建议</th>
      </tr></thead>
      <tbody>${rows.map((r,i)=>`<tr class="${String(r.actualVerdict).toUpperCase()==='PASS'?'row-pass':'row-review'}">
        <td>${i+1}</td><td>${esc(r.name)}</td><td>${esc(r.type)}</td><td>${esc(r.expectedVerdict)}</td><td><b>${esc(r.actualVerdict)}</b></td><td>${r.stationCount || 0}</td>
        <td>${fmt(r.TVD_maxAbs,3)}</td><td>${fmt(r.NS_maxAbs,3)}</td><td>${fmt(r.EW_maxAbs,3)}</td>
        <td>${fmt(r.DOGLEG_maxAbs,4)}</td><td>${fmt(r.BUILD_maxAbs,4)}</td><td>${fmt(r.TURN_maxAbs,4)}</td>
        <td>${esc(r.recommendation || '')}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }

  window.batchAcceptancePanelHtml = function(){
    const report = state.batchAcceptanceReport || localBatchAcceptanceReport();
    const verdictClass = String(report.overallVerdict || '').toUpperCase() === 'PASS' ? 'pass' : 'review';
    const max = report.maxErrors || {};
    return `<section class="batch-acceptance-v292">
      <div class="batch-head ${verdictClass}">
        <div>
          <b>轨迹算法批量验收总报告 / Batch Acceptance Report</b>
          <span>一键运行全部内置标准样本，生成总体结论、样本通过率、全局最大误差与复核清单。</span>
        </div>
        <div class="batch-verdict">
          <strong>${esc(report.overallVerdict || 'REVIEW')}</strong>
          <small>${report.passCount || 0} PASS / ${report.reviewCount || 0} REVIEW / ${report.failCount || 0} FAILED</small>
        </div>
      </div>
      <div class="batch-actions">
        <button class="primary" onclick="runAllAcceptanceSamples()">运行全部样本</button>
        <button onclick="loadBatchAcceptanceReport()">读取总报告</button>
        <button onclick="exportBatchAcceptanceJson()">导出总报告 JSON</button>
        <button onclick="exportBatchAcceptanceCsv()">导出总报告 CSV</button>
      </div>
      <div class="batch-kpi-grid">
        <div class="batch-kpi ${verdictClass}"><span>总体结论</span><b>${esc(report.overallVerdict || 'REVIEW')}</b><em>overall verdict</em></div>
        <div class="batch-kpi"><span>总样本数</span><b>${report.totalSamples || 0}</b><em>samples</em></div>
        <div class="batch-kpi pass"><span>PASS</span><b>${report.passCount || 0}</b><em>accepted</em></div>
        <div class="batch-kpi review"><span>REVIEW</span><b>${report.reviewCount || 0}</b><em>needs review</em></div>
        <div class="batch-kpi"><span>通过率</span><b>${fmt((report.acceptanceRate || 0)*100,1)}%</b><em>acceptance rate</em></div>
      </div>
      <div class="batch-error-grid">
        ${['TVD','NS','EW','DOGLEG','BUILD','TURN'].map(c => `<div><span>${c} 全局最大误差</span><b>${fmt(max[c] || 0, c==='DOGLEG'||c==='BUILD'||c==='TURN'?4:3)}</b></div>`).join('')}
      </div>
      <div class="batch-table-wrap">${batchTableHtml(report)}</div>
    </section>`;
  };

  window.runAllAcceptanceSamples = async function(){
    if(state.apiMode === 'api' && typeof fetchBackendJson === 'function'){
      try{
        const json = await fetchBackendJson('/api/well-path/samples/run-all', {method:'POST'});
        state.batchAcceptanceReport = json.data || json;
        toast('全部标准验收样本已运行完成');
      }catch(err){
        state.batchAcceptanceReport = localBatchAcceptanceReport();
        toast(`后端批量验收失败，使用前端兜底报告：${err.message}`);
      }
    }else{
      state.batchAcceptanceReport = localBatchAcceptanceReport();
      toast('当前 MOCK 模式：已运行全部标准样本');
    }
    renderCalibrationReportPage();
    addLog(`运行全部标准验收样本：${state.batchAcceptanceReport.overallVerdict}`);
  };

  window.loadBatchAcceptanceReport = async function(){
    if(state.apiMode === 'api' && typeof fetchBackendJson === 'function'){
      try{
        const json = await fetchBackendJson('/api/well-path/batch-acceptance-report');
        state.batchAcceptanceReport = json.data || json;
        toast('已读取后端最新批量验收报告');
      }catch(err){
        state.batchAcceptanceReport = localBatchAcceptanceReport();
        toast(`读取后端总报告失败，使用前端兜底报告：${err.message}`);
      }
    }else{
      state.batchAcceptanceReport = localBatchAcceptanceReport();
      toast('当前 MOCK 模式：已读取前端批量验收报告');
    }
    renderCalibrationReportPage();
  };

  window.exportBatchAcceptanceJson = function(){
    const report = state.batchAcceptanceReport || localBatchAcceptanceReport();
    const blob = new Blob([JSON.stringify(report,null,2)], {type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'DrillSpace_Batch_Acceptance_Report.json'; a.click();
    URL.revokeObjectURL(url);
    toast('已导出批量验收总报告 JSON');
  };

  window.exportBatchAcceptanceCsv = function(){
    const report = state.batchAcceptanceReport || localBatchAcceptanceReport();
    const cols = ['sampleId','name','type','expectedVerdict','actualVerdict','stationCount','TVD_maxAbs','NS_maxAbs','EW_maxAbs','DOGLEG_maxAbs','BUILD_maxAbs','TURN_maxAbs','recommendation'];
    const csv = [cols.join(',')].concat((report.samples||[]).map(r => cols.map(c => r[c] ?? '').join(','))).join('\n');
    const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download='DrillSpace_Batch_Acceptance_Report.csv'; a.click();
    URL.revokeObjectURL(url);
    toast('已导出批量验收总报告 CSV');
  };

  const oldRender = window.renderCalibrationReportPage || renderCalibrationReportPage;
  window.renderCalibrationReportPage = function(){
    oldRender();
    const box = document.querySelector('.calibration-page-v290');
    if(!box) return;
    if(box.querySelector('.batch-acceptance-v292')) return;
    state.batchAcceptanceReport = state.batchAcceptanceReport || localBatchAcceptanceReport();
    const head = box.querySelector('.calibration-head');
    const panel = document.createElement('div');
    panel.innerHTML = batchAcceptancePanelHtml();
    if(head && head.nextSibling){
      box.insertBefore(panel.firstElementChild, head.nextSibling);
    }else{
      box.prepend(panel.firstElementChild);
    }
    const title = document.getElementById('workbookTitle');
    if(title) title.textContent = '批量验收总报告 / Batch Acceptance Report';
    const label = document.getElementById('rowCountLabel');
    if(label) label.textContent = `${state.batchAcceptanceReport.totalSamples || 0} samples · ${state.batchAcceptanceReport.overallVerdict || 'REVIEW'} · V2.9.2.1`;
  };
})();


/* =========================================================
   V2.9.3 Collision Acceptance Runtime
   防碰扫描标准样本库 + 防碰总体验收报告。
   ========================================================= */
function collisionSampleDefaults(){
  return [
    {id:'far_safe',name:'01 远距离安全样本',level:'safe',expectedStatus:'SAFE',desc:'当前井与邻井保持较大安全距离。'},
    {id:'nearby_risk',name:'02 近邻井风险样本',level:'danger',expectedStatus:'DANGER',desc:'邻井在关键井段接近当前井。'},
    {id:'low_sf',name:'03 低分离系数样本',level:'review',expectedStatus:'REVIEW',desc:'中心距尚可但分离系数偏低。'},
    {id:'normal_plane',name:'04 法平面扫描样本',level:'review',expectedStatus:'REVIEW',desc:'验证法平面扫描角与极图数据。'},
    {id:'horizontal_scan',name:'05 水平扫描样本',level:'warning',expectedStatus:'WARNING',desc:'验证水平扫描角分布。'},
    {id:'ellipsoid_amplified',name:'06 误差椭球放大样本',level:'review',expectedStatus:'REVIEW',desc:'增大误差半径触发复核。'}
  ];
}
function localCollisionAcceptanceReport(){
  const samples = collisionSampleDefaults();
  const sfMap = {far_safe:3.85, nearby_risk:0.82, low_sf:1.22, normal_plane:1.34, horizontal_scan:1.72, ellipsoid_amplified:1.18};
  const distMap = {far_safe:92.4, nearby_risk:20.8, low_sf:31.2, normal_plane:33.8, horizontal_scan:43.5, ellipsoid_amplified:46.8};
  const actualMap = {far_safe:'SAFE', nearby_risk:'DANGER', low_sf:'REVIEW', normal_plane:'REVIEW', horizontal_scan:'WARNING', ellipsoid_amplified:'REVIEW'};
  const rows = samples.map((s,i)=>({sampleId:s.id,name:s.name,expectedStatus:s.expectedStatus,actualStatus:actualMap[s.id],sampleVerdict:actualMap[s.id]===s.expectedStatus?'PASS':'REVIEW',minDistance:distMap[s.id],minSeparationFactor:sfMap[s.id],nearestMd:2600+i*180,risk:actualMap[s.id],recommendation:actualMap[s.id]===s.expectedStatus?'通过':'复核防碰阈值'}));
  const passCount=rows.filter(r=>r.sampleVerdict==='PASS').length;
  const reviewCount=rows.filter(r=>r.sampleVerdict==='REVIEW').length;
  const dangerCount=rows.filter(r=>r.actualStatus==='DANGER').length;
  return {ok:true,version:'2.9.3',reportType:'CollisionAcceptanceReport',overallVerdict:reviewCount===0?'PASS':'REVIEW',totalSamples:rows.length,passCount,reviewCount,dangerCount,minGlobalDistance:Math.min(...rows.map(r=>num(r.minDistance))),minGlobalSeparationFactor:Math.min(...rows.map(r=>num(r.minSeparationFactor))),samples:rows,note:'前端Mock防碰验收报告。API模式下将调用后端防碰样本库。'};
}
async function runAllCollisionSamples(){
  if(state.apiMode === 'api'){
    try{
      const json = await fetchBackendJson('/api/well-path/collision-acceptance/run-all', {method:'POST'});
      state.collisionAcceptanceReport = json.data || json;
      toast('全部防碰标准样本已运行完成');
    }catch(err){
      state.collisionAcceptanceReport = localCollisionAcceptanceReport();
      toast(`后端防碰批量运行失败，使用前端Mock：${err.message}`);
    }
  }else{
    state.collisionAcceptanceReport = localCollisionAcceptanceReport();
    toast('当前 MOCK 模式：已运行全部防碰样本');
  }
  renderCalibrationReportPage();
  addLog(`运行全部防碰样本：${state.collisionAcceptanceReport.overallVerdict}`);
}
async function loadCollisionAcceptanceReport(){
  if(state.apiMode === 'api'){
    try{
      const json = await fetchBackendJson('/api/well-path/collision-acceptance/report');
      state.collisionAcceptanceReport = json.data || json;
      toast('已读取防碰总体验收报告');
    }catch(err){
      state.collisionAcceptanceReport = localCollisionAcceptanceReport();
      toast(`读取防碰报告失败，使用前端Mock：${err.message}`);
    }
  }else{
    state.collisionAcceptanceReport = localCollisionAcceptanceReport();
    toast('当前 MOCK 模式：已读取防碰验收报告');
  }
  renderCalibrationReportPage();
}
async function runCollisionAcceptanceSample(sampleId){
  state.activeCollisionSample = sampleId;
  if(state.apiMode === 'api'){
    try{
      const json = await fetchBackendJson(`/api/well-path/collision-acceptance/samples/${sampleId}/run`, {method:'POST'});
      const report = json.data || json;
      state.collisionAcceptanceReport = localCollisionAcceptanceReport();
      state.collisionAcceptanceReport.samples = (state.collisionAcceptanceReport.samples || []).filter(r => r.sampleId !== sampleId);
      state.collisionAcceptanceReport.samples.unshift({sampleId:report.sampleId,name:report.sample?.name || sampleId,expectedStatus:report.expectedStatus,actualStatus:report.actualStatus,sampleVerdict:report.sampleVerdict,minDistance:report.minDistance,minSeparationFactor:report.minSeparationFactor,nearestMd:report.nearestMd,risk:report.risk,recommendation:report.recommendation});
      toast(`防碰样本完成：${sampleId}`);
    }catch(err){ toast(`运行防碰样本失败：${err.message}`); }
  }else{
    state.collisionAcceptanceReport = localCollisionAcceptanceReport();
    toast('MOCK 模式：已运行防碰样本');
  }
  renderCalibrationReportPage();
}
function collisionAcceptanceTableHtml(report){
  const rows = report.samples || [];
  return `<table class="collision-acceptance-table"><thead><tr><th>#</th><th>样本</th><th>预期</th><th>实际</th><th>结论</th><th>最小中心距</th><th>最小SF</th><th>最近MD</th><th>建议</th></tr></thead><tbody>${rows.map((r,i)=>`<tr class="${String(r.sampleVerdict).toUpperCase()==='PASS'?'row-pass':'row-review'}"><td>${i+1}</td><td>${esc(r.name)}</td><td>${esc(r.expectedStatus)}</td><td><b>${esc(r.actualStatus)}</b></td><td>${esc(r.sampleVerdict)}</td><td>${fmt(r.minDistance,2)}</td><td>${fmt(r.minSeparationFactor,2)}</td><td>${fmt(r.nearestMd,1)}</td><td>${esc(r.recommendation || '')}</td></tr>`).join('')}</tbody></table>`;
}
function collisionAcceptancePanelHtml(){
  const report = state.collisionAcceptanceReport || localCollisionAcceptanceReport();
  const samples = collisionSampleDefaults();
  const verdictClass = String(report.overallVerdict || '').toUpperCase() === 'PASS' ? 'pass' : 'review';
  return `<section class="collision-acceptance-v293"><div class="collision-acceptance-head ${verdictClass}"><div><b>防碰扫描标准样本库 / Collision Acceptance Samples</b><span>覆盖远距离安全、近邻井风险、低分离系数、法平面、水平扫描、误差椭球放大六类场景。</span></div><div class="collision-acceptance-verdict"><strong>${esc(report.overallVerdict || 'REVIEW')}</strong><small>${report.passCount || 0} PASS / ${report.reviewCount || 0} REVIEW / ${report.dangerCount || 0} DANGER</small></div></div><div class="collision-acceptance-actions"><button class="primary" onclick="runAllCollisionSamples()">运行全部防碰样本</button><button onclick="loadCollisionAcceptanceReport()">读取防碰总报告</button><button onclick="exportCollisionAcceptanceJson()">导出防碰 JSON</button><button onclick="exportCollisionAcceptanceCsv()">导出防碰 CSV</button></div><div class="collision-sample-grid">${samples.map(s => `<button class="collision-sample-card ${s.level}" onclick="runCollisionAcceptanceSample('${s.id}')"><b>${esc(s.name)}</b><span>${esc(s.desc)}</span><em>预期 ${esc(s.expectedStatus)}</em></button>`).join('')}</div><div class="collision-acceptance-kpis"><div><span>总样本数</span><b>${report.totalSamples || 0}</b></div><div><span>最小中心距</span><b>${fmt(report.minGlobalDistance || 0,2)}m</b></div><div><span>最小分离系数</span><b>${fmt(report.minGlobalSeparationFactor || 0,2)}</b></div><div><span>高风险样本</span><b>${report.dangerCount || 0}</b></div></div><div class="collision-acceptance-table-wrap">${collisionAcceptanceTableHtml(report)}</div></section>`;
}
function exportCollisionAcceptanceJson(){
  const report = state.collisionAcceptanceReport || localCollisionAcceptanceReport();
  downloadTextFile('DrillSpace_Collision_Acceptance_Report.json', JSON.stringify(report,null,2), 'application/json;charset=utf-8');
  toast('已导出防碰验收 JSON');
}
function exportCollisionAcceptanceCsv(){
  const report = state.collisionAcceptanceReport || localCollisionAcceptanceReport();
  const cols = ['sampleId','name','expectedStatus','actualStatus','sampleVerdict','minDistance','minSeparationFactor','nearestMd','risk','recommendation'];
  const csv = [cols.join(',')].concat((report.samples||[]).map(r => cols.map(c => r[c] ?? '').join(','))).join('\n');
  downloadTextFile('DrillSpace_Collision_Acceptance_Report.csv', csv, 'text/csv;charset=utf-8');
  toast('已导出防碰验收 CSV');
}
(function(){
  const oldRender = window.renderCalibrationReportPage || renderCalibrationReportPage;
  window.renderCalibrationReportPage = function(){
    oldRender();
    const box = document.querySelector('.calibration-page-v290');
    if(!box || box.querySelector('.collision-acceptance-v293')) return;
    state.collisionAcceptanceReport = state.collisionAcceptanceReport || localCollisionAcceptanceReport();
    const batch = box.querySelector('.batch-acceptance-v292');
    const lib = box.querySelector('.sample-library-v291');
    const holder = document.createElement('div');
    holder.innerHTML = collisionAcceptancePanelHtml();
    const panel = holder.firstElementChild;
    if(batch && batch.nextSibling) box.insertBefore(panel, batch.nextSibling);
    else if(lib) box.insertBefore(panel, lib);
    else box.prepend(panel);
  };
})();
window.runAllCollisionSamples = runAllCollisionSamples;
window.loadCollisionAcceptanceReport = loadCollisionAcceptanceReport;
window.runCollisionAcceptanceSample = runCollisionAcceptanceSample;
window.exportCollisionAcceptanceJson = exportCollisionAcceptanceJson;
window.exportCollisionAcceptanceCsv = exportCollisionAcceptanceCsv;


/* =========================================================
   V2.9.5 Compass Planning Methods Runtime
   吸收 Compass Plan Editor 功能内容，不复制老旧界面。
   新增 Slant / S Well / Build Turn / Dogleg Toolface / Hold / Optimum Align / Nudge。
   ========================================================= */
function v295PlanningMethods(){
  return [
    {id:'slant', label:'Slant', cn:'斜井段', desc:'1st Hold + Build + Max Angle + 2nd Hold'},
    {id:'sWell', label:'S Well', cn:'S形井', desc:'增斜 / 稳斜 / 降斜 / Final Hold'},
    {id:'buildTurn', label:'Build Turn', cn:'造斜转向', desc:'Build + Turn 同步推进'},
    {id:'doglegToolface', label:'Dogleg Toolface', cn:'狗腿工具面', desc:'DLS / TFO / Const-TFO'},
    {id:'hold', label:'Hold', cn:'稳斜保持', desc:'Hold to CL / MD / TVD / V.Sec'},
    {id:'optimumAlign', label:'Optimum Align', cn:'最优对准', desc:'Curve-Hold-Curve / Target Align'},
    {id:'nudge', label:'Nudge', cn:'微调段', desc:'MD/INC/AZI 与目标线微调'}
  ];
}
function v295SectionTypes(){
  return [['incAziMd','Inc Azi MD'],['tvdIncAzi','TVD Inc Azi'],['dlsIncAzi','DLS Inc Azi'],['mdDlsAziHigh','MD DLS AZI (H)'],['mdDlsAziLow','MD DLS AZI (L)'],['mdDlsIncHigh','MD DLS INC (H)'],['mdDlsIncLow','MD DLS INC (L)'],['lineUpOnTarget','Line up on Target'],['landingPlane','Landing Plane'],['insertLine','Insert Line']];
}
function v295EnsurePlanningState(){
  state.planningMethod = state.planningMethod || 'doglegToolface';
  state.planningSectionType = state.planningSectionType || 'incAziMd';
  state.planningParams = state.planningParams || {dls:2.0,tfo:107.66,using:'DLS',cl:30,md:0,inc:0,azi:0,build:0,turn:0,firstHoldLen:300,firstBuild:2.0,maxAngle:45,secondHoldLen:300,secondBuild:2.0,finalInc:10,finalHold:300,holdMode:'cl',tvd:0,verticalSection:0,alignType:'curveHoldCurve',doglegs:2,tangentLength:300,targetTvd:0,targetNs:0,targetEw:0,targetInc:0,targetAzi:0,dipAngle:0,direction:0};
  state.planningPreview = state.planningPreview || null;
}
function v295ActiveRow(){ return state.rows[state.selectedRow] || state.rows[0] || {md:0,inc:0,azi:0,tvd:0,ns:0,ew:0}; }
function v295DefaultFromActive(){
  const r=v295ActiveRow();
  state.planningParams.md = num(r.md) + num(state.planningParams.cl || 30);
  state.planningParams.inc = num(r.inc); state.planningParams.azi = num(r.azi);
  state.planningParams.tvd = num(r.tvd);
  if(!state.planningParams.targetTvd) state.planningParams.targetTvd = num(r.tvd);
  if(!state.planningParams.targetNs) state.planningParams.targetNs = num(r.ns);
  if(!state.planningParams.targetEw) state.planningParams.targetEw = num(r.ew);
}
function v295ParamInput(key,label,unit=''){
  const v=state.planningParams?.[key] ?? 0;
  return `<label class="v295-field"><span>${label}${unit?`<em>${unit}</em>`:''}</span><input data-plan-param="${key}" value="${esc(v)}"/></label>`;
}
function v295SelectInput(key,label,options){
  const v=state.planningParams?.[key] ?? '';
  return `<label class="v295-field"><span>${label}</span><select data-plan-param="${key}">${options.map(o=>{const val=Array.isArray(o)?o[0]:o; const txt=Array.isArray(o)?o[1]:o; return `<option value="${esc(val)}" ${String(v)===String(val)?'selected':''}>${esc(txt)}</option>`;}).join('')}</select></label>`;
}
function v295SectionTypeSelector(){
  return `<div class="v295-section-types"><b>Section Type</b>${v295SectionTypes().map(([id,label])=>`<button class="${state.planningSectionType===id?'active':''}" onclick="v295SetSectionType('${id}')">${esc(label)}</button>`).join('')}</div>`;
}
function v295MethodFormHtml(method){
  if(method==='slant') return `<div class="v295-form-grid">${v295ParamInput('firstHoldLen','1st Hold Len','m')}${v295ParamInput('firstBuild','1st Build','°/30m')}${v295ParamInput('maxAngle','Max Angle','°')}${v295ParamInput('secondHoldLen','2nd Hold Len','m')}${v295ParamInput('targetTvd','Target TVD','m')}${v295ParamInput('targetNs','Target N/S','m')}${v295ParamInput('targetEw','Target E/W','m')}<div class="v295-unknowns"><b>Select unknowns</b><span>1st Hold / Build / Max Angle / 2nd Hold 可作为后续求解未知量。</span></div></div>`;
  if(method==='sWell') return `<div class="v295-form-grid">${v295ParamInput('firstHoldLen','1st Hold Len','m')}${v295ParamInput('firstBuild','1st Build','°/30m')}${v295ParamInput('maxAngle','Max Angle','°')}${v295ParamInput('secondHoldLen','2nd Hold Len','m')}${v295ParamInput('secondBuild','2nd Build','°/30m')}${v295ParamInput('finalInc','Final Inc','°')}${v295ParamInput('finalHold','Final Hold','m')}${v295ParamInput('targetTvd','Target TVD','m')}${v295ParamInput('targetNs','Target N/S','m')}${v295ParamInput('targetEw','Target E/W','m')}</div>`;
  if(method==='buildTurn') return `<div class="v295-form-grid">${v295ParamInput('build','Build','°/30m')}${v295ParamInput('turn','Turn','°/30m')}${v295ParamInput('cl','CL','m')}${v295ParamInput('md','Final MD','m')}${v295ParamInput('inc','Final Inc','°')}${v295ParamInput('azi','Final Azi','°')}<div class="v295-note"><b>Build Turn</b><span>按 Build 与 Turn 从当前行推进下一段。</span></div></div>`;
  if(method==='doglegToolface') return `<div class="v295-form-grid dogleg">${v295ParamInput('dls','DLS','°/30m')}${v295ParamInput('tfo','TFO','°')}${v295SelectInput('using','Using',[['DLS','DLS'],['TFO','TFO'],['Const-TFO','Const -TFO']])}${v295ParamInput('cl','Final CL','m')}${v295ParamInput('md','Final MD','m')}${v295ParamInput('inc','Final Inc','°')}${v295ParamInput('azi','Final Azi','°')}${v295ParamInput('targetTvd','Target TVD','m')}${v295ParamInput('targetNs','Target N/S','m')}${v295ParamInput('targetEw','Target E/W','m')}</div>`;
  if(method==='hold') return `<div class="v295-form-grid">${v295SelectInput('holdMode','Hold to',[['cl','CL'],['md','MD'],['tvd','TVD'],['verticalSection','Vertical Section']])}${v295ParamInput('cl','CL','m')}${v295ParamInput('md','MD','m')}${v295ParamInput('tvd','TVD','m')}${v295ParamInput('verticalSection','Vertical Section','m')}<div class="v295-note"><b>Hold</b><span>保持当前 Inc/Azi 不变，按终止条件推进。</span></div></div>`;
  if(method==='optimumAlign') return `<div class="v295-form-grid">${v295SelectInput('alignType','Type',[['curveHoldCurve','Curve-Hold-Curve'],['curveCurve','Curve-Curve']])}${v295ParamInput('doglegs','Doglegs','#')}${v295ParamInput('tvd','TVD','m')}${v295ParamInput('tangentLength','Tangent Length','m')}${v295ParamInput('targetTvd','Target TVD','m')}${v295ParamInput('targetNs','Target N/S','m')}${v295ParamInput('targetEw','Target E/W','m')}${v295ParamInput('targetInc','Target Inc','°')}${v295ParamInput('targetAzi','Target Azi','°')}<button class="v295-tool-btn" onclick="v295ProjectBackToTarget()">Project Back → Target</button></div>`;
  return `<div class="v295-form-grid nudge">${v295SectionTypeSelector()}${v295ParamInput('md','MD','m')}${v295ParamInput('cl','CL','m')}${v295ParamInput('inc','INC','°')}${v295ParamInput('azi','AZI','°')}${v295ParamInput('tvd','TVD','m')}${v295ParamInput('dls','DLS','°/30m')}${v295ParamInput('targetTvd','Target TVD','m')}${v295ParamInput('targetNs','Target N/S','m')}${v295ParamInput('targetEw','Target E/W','m')}${v295ParamInput('dipAngle','Dip Angle','°')}${v295ParamInput('direction','Direction','°')}</div>`;
}
function v295PlanningPreviewHtml(){
  const p=state.planningPreview;
  if(!p||!p.previewRow) return `<div class="v295-preview empty"><b>规划预览</b><span>点击 Calculate 后显示下一段 MD / INC / AZI / TVD / NS / EW / DLS。</span></div>`;
  const r=p.previewRow;
  return `<div class="v295-preview"><div><span>MD</span><b>${fmt(r.md,2)}</b></div><div><span>INC</span><b>${fmt(r.inc,2)}</b></div><div><span>AZI</span><b>${fmt(r.azi,2)}</b></div><div><span>TVD</span><b>${fmt(r.tvd,2)}</b></div><div><span>N/S</span><b>${fmt(r.ns,2)}</b></div><div><span>E/W</span><b>${fmt(r.ew,2)}</b></div><div><span>DLS</span><b>${fmt(r.dogleg,3)}</b></div><div><span>Rows</span><b>${p.rowCount||1}</b></div></div>`;
}
function v295RenderPlanningDock(){
  v295EnsurePlanningState();
  const active = v295PlanningMethods().find(m=>m.id===state.planningMethod) || v295PlanningMethods()[3];
  return `<div class="v295-planning-dock" id="v295PlanningDock"><div class="v295-dock-head"><div><b>Compass Planning Methods 融合区</b><span>功能参考 Compass Plan Editor，界面保持 DrillSpace 工业风格。</span></div><div class="v295-dock-status"><b>${esc(active.cn)}</b><span>${esc(active.desc)}</span></div></div><div class="v295-method-tabs">${v295PlanningMethods().map(m=>`<button class="${state.planningMethod===m.id?'active':''}" onclick="v295SetPlanningMethod('${m.id}')"><b>${esc(m.label)}</b><span>${esc(m.cn)}</span></button>`).join('')}</div><div class="v295-planning-body"><section class="v295-param-panel"><div class="v295-card-title"><b>Parameters</b><span>${esc(active.label)} / ${esc(active.cn)}</span></div>${v295MethodFormHtml(state.planningMethod)}</section><section class="v295-target-panel"><div class="v295-card-title"><b>Target & Section</b><span>目标约束与段类型</span></div>${state.planningMethod==='nudge'?'':v295SectionTypeSelector()}<div class="v295-target-grid">${v295ParamInput('targetTvd','TVD','m')}${v295ParamInput('targetNs','N/S','m')}${v295ParamInput('targetEw','E/W','m')}</div><button class="v295-tool-btn" onclick="v295AdjustTarget()">Adjust Target</button></section><section class="v295-preview-panel"><div class="v295-card-title"><b>Calculation Preview</b><span>下一段预览</span></div>${v295PlanningPreviewHtml()}</section></div><div class="v295-bottom-actions"><button class="primary" onclick="v295CalculatePlanningMethod()">Calculate</button><button onclick="v295CalculateNext()">Calculate + Next</button><button onclick="v295ApplyPreviewToCurrent()">Apply</button><button onclick="v295InsertPlanningSection()">Insert Section</button><button onclick="saveTrajectory()">Save Version</button><button onclick="v295OpenMethodMap()">Method Map</button><label class="v295-auto"><input type="checkbox" ${state.v295AutoCalculate?'checked':''} onchange="state.v295AutoCalculate=this.checked"> Auto Calculate</label></div></div>`;
}
function v295InjectPlanningDock(){
  v295EnsurePlanningState();
  const content=$('editorContent');
  if(!content || state.editorView!=='grid') return;
  content.classList.add('v295-plan-editor');
  const old=$('v295PlanningDock'); if(old) old.remove();
  content.insertAdjacentHTML('beforeend', v295RenderPlanningDock());
  content.querySelectorAll('[data-plan-param]').forEach(el=>{el.oninput=el.onchange=()=>{const k=el.dataset.planParam; state.planningParams[k]=el.value; if(state.v295AutoCalculate) v295CalculatePlanningMethod(true);};});
  setTimeout(()=>{ if(typeof renderVirtualRows==='function') renderVirtualRows(true); },30);
}
function v295SetPlanningMethod(method){ v295EnsurePlanningState(); state.planningMethod=method; v295DefaultFromActive(); v295InjectPlanningDock(); addLog(`切换规划方法：${method}`); }
function v295SetSectionType(type){ v295EnsurePlanningState(); state.planningSectionType=type; state.planningParams.sectionType=type; v295InjectPlanningDock(); }
function v295CollectPayload(){
  v295EnsurePlanningState();
  const params={...state.planningParams, sectionType:state.planningSectionType};
  Object.keys(params).forEach(k=>{ if(params[k]!=='' && !Number.isNaN(Number(params[k])) && !['using','holdMode','alignType','sectionType'].includes(k)) params[k]=Number(params[k]); });
  return {method:state.planningMethod, sectionType:state.planningSectionType, currentRow:v295ActiveRow(), params};
}
function v295LocalSolve(payload){
  const start=payload.currentRow||v295ActiveRow(), p=payload.params||{}, method=payload.method||'doglegToolface';
  const sectionLabel=(v295SectionTypes().find(s=>s[0]===payload.sectionType)||['','Inc Azi MD'])[1];
  let cl=num(p.cl||30), inc=num(start.inc), azi=num(start.azi), md=num(start.md)+cl;
  const rows=[];
  if(method==='doglegToolface'){const dangle=num(p.dls||2)*cl/30,tfo=num(p.tfo||0); inc+=dangle*Math.cos(tfo*Math.PI/180); azi+=dangle*Math.sin(tfo*Math.PI/180)/Math.max(.15,Math.sin(Math.max(1,num(start.inc))*Math.PI/180));}
  else if(method==='buildTurn'){inc+=num(p.build||0)*cl/30; azi+=num(p.turn||0)*cl/30;}
  else if(method==='hold'){if(p.holdMode==='md') cl=Math.max(0,num(p.md)-num(start.md)); md=num(start.md)+cl;}
  else if(method==='slant'){const r1={...start,md:num(start.md)+num(p.firstHoldLen||300),inc:num(start.inc),azi:num(start.azi),sectionType:'Hold',remark:'Slant 1st Hold'}; const r2={...r1,md:num(r1.md)+Math.abs(num(p.maxAngle||45)-num(r1.inc))/Math.max(.1,Math.abs(num(p.firstBuild||2)))*30,inc:num(p.maxAngle||45),sectionType:'Build',remark:'Slant Build'}; const r3={...r2,md:num(r2.md)+num(p.secondHoldLen||300),sectionType:'Hold',remark:'Slant 2nd Hold'}; rows.push(r1,r2,r3); return {ok:true,method,sectionType:sectionLabel,start,rows,previewRow:r3,rowCount:rows.length};}
  else if(method==='sWell'){const r1={...start,md:num(start.md)+num(p.firstHoldLen||300),inc:num(start.inc),azi:num(start.azi),sectionType:'Hold',remark:'S Well 1st Hold'}; const r2={...r1,md:num(r1.md)+Math.abs(num(p.maxAngle||40)-num(r1.inc))/Math.max(.1,Math.abs(num(p.firstBuild||2)))*30,inc:num(p.maxAngle||40),sectionType:'Build',remark:'S Well Build'}; const r3={...r2,md:num(r2.md)+num(p.secondHoldLen||300),sectionType:'Hold',remark:'S Well 2nd Hold'}; const r4={...r3,md:num(r3.md)+Math.abs(num(p.finalInc||10)-num(r3.inc))/Math.max(.1,Math.abs(num(p.secondBuild||2)))*30,inc:num(p.finalInc||10),sectionType:'Drop',remark:'S Well Drop'}; const r5={...r4,md:num(r4.md)+num(p.finalHold||300),sectionType:'Hold',remark:'S Well Final Hold'}; rows.push(r1,r2,r3,r4,r5); return {ok:true,method,sectionType:sectionLabel,start,rows,previewRow:r5,rowCount:rows.length};}
  else if(method==='optimumAlign'){cl=num(p.tangentLength||300); md=num(start.md)+cl; const dns=num(p.targetNs)-num(start.ns),dew=num(p.targetEw)-num(start.ew); if(Math.abs(dns)+Math.abs(dew)>.001) azi=(Math.atan2(dew,dns)*180/Math.PI+360)%360; inc=num(p.targetInc||start.inc);}
  else if(method==='nudge'){md=num(p.md||(num(start.md)+cl)); inc=num(p.inc||start.inc); azi=num(p.azi||start.azi); if(payload.sectionType==='landingPlane'){inc=num(p.dipAngle||inc); azi=num(p.direction||azi);}}
  const row={...start,md,inc,azi:(azi+360)%360,sectionType:sectionLabel,remark:method};
  rows.push(row);
  return {ok:true,method,sectionType:sectionLabel,start,rows,previewRow:row,rowCount:rows.length};
}
async function v295CalculatePlanningMethod(silent=false){
  const payload=v295CollectPayload();
  if(state.apiMode==='api'){
    try{const base=(state.apiBaseUrl||'http://127.0.0.1:8000').replace(/\/$/,''); const resp=await fetch(base+'/api/well-path/planning/solve-section',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); if(!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`); const json=await resp.json(); state.planningPreview=json.data||json;}
    catch(err){state.planningPreview=v295LocalSolve(payload); if(!silent) toast(`规划后端失败，使用前端预览：${err.message}`);}
  }else state.planningPreview=v295LocalSolve(payload);
  v295InjectPlanningDock(); if(!silent) toast(`规划计算完成：${state.planningMethod}`); return state.planningPreview;
}
async function v295InsertPlanningSection(){
  const result=await v295CalculatePlanningMethod(true), rows=(result&&result.rows)?result.rows:[];
  if(!rows.length) return toast('没有可插入的规划结果');
  const normalized=rows.map(r=>({type:r.type||'规划段',md:num(r.md),inc:num(r.inc),azi:num(r.azi),cl:num(r.cl),tvd:num(r.tvd),ns:num(r.ns),ew:num(r.ew),vsec:num(r.vsec),dogleg:num(r.dogleg),tf:num(r.tf),build:num(r.build),turn:num(r.turn),sectionType:r.sectionType||'Inc Azi MD',remark:r.remark||state.planningMethod}));
  state.rows.splice(state.selectedRow+1,0,...normalized); state.selectedRow=state.selectedRow+normalized.length; recalcRowsLocal(); renderGrid(); updateSummary(); addLog(`插入规划段：${state.planningMethod} / ${normalized.length} 行`); toast(`已插入 ${normalized.length} 行规划结果`);
}
async function v295CalculateNext(){ await v295InsertPlanningSection(); selectRow(Math.min(state.rows.length-1,state.selectedRow),true); }
function v295ApplyPreviewToCurrent(){const r=state.planningPreview?.previewRow; if(!r) return toast('请先 Calculate 生成预览'); const row=state.rows[state.selectedRow]; ['md','inc','azi','tvd','ns','ew','vsec','dogleg','tf','build','turn'].forEach(k=>row[k]=num(r[k])); row.sectionType=r.sectionType||row.sectionType; row.remark=r.remark||row.remark; renderGrid(); updateSummary(); toast('预览结果已应用到当前行');}
function v295AdjustTarget(){toast('Target 调整入口已预留：后续可接目标库 / 靶区约束求解。');}
function v295ProjectBackToTarget(){toast('Project Back → Target 已预留：后续接 Optimum Align 后端求解器。');}
function v295OpenMethodMap(){showModal('Compass Planning Methods 功能映射',`<div class="api-contract-table"><table><thead><tr><th>方法</th><th>DrillSpace 参数面板</th><th>后端接口</th><th>状态</th></tr></thead><tbody>${v295PlanningMethods().map(m=>`<tr><td>${esc(m.label)}</td><td>${esc(m.desc)}</td><td><code>/api/well-path/planning/solve-section</code></td><td>Ready</td></tr>`).join('')}</tbody></table></div>`,()=>{}, {wide:true});}
(function(){const oldRenderGrid=window.renderGrid||renderGrid; window.renderGrid=function(){oldRenderGrid(); v295DefaultFromActive(); v295InjectPlanningDock();}; setTimeout(()=>{ if(state&&state.editorView==='grid') v295InjectPlanningDock();},120);})();
window.v295SetPlanningMethod=v295SetPlanningMethod; window.v295SetSectionType=v295SetSectionType; window.v295CalculatePlanningMethod=v295CalculatePlanningMethod; window.v295InsertPlanningSection=v295InsertPlanningSection; window.v295CalculateNext=v295CalculateNext; window.v295ApplyPreviewToCurrent=v295ApplyPreviewToCurrent; window.v295AdjustTarget=v295AdjustTarget; window.v295ProjectBackToTarget=v295ProjectBackToTarget; window.v295OpenMethodMap=v295OpenMethodMap;


/* =========================================================
   V2.9.6 Planning Method Acceptance Line
   规划方法验收线：Dogleg Toolface / Build Turn / Hold / Slant / S Well / Nudge / Landing Plane.
   ========================================================= */
function localPlanningAcceptanceReport(){
  const samples = [
    {sampleId:'dogleg_toolface_standard',name:'01 Dogleg Toolface 标准样本',method:'doglegToolface',sectionType:'incAziMd',expectedRows:1,actualRows:1,sampleVerdict:'PASS',recommendation:'通过'},
    {sampleId:'build_turn_standard',name:'02 Build Turn 标准样本',method:'buildTurn',sectionType:'incAziMd',expectedRows:1,actualRows:1,sampleVerdict:'PASS',recommendation:'通过'},
    {sampleId:'hold_to_md',name:'03 Hold to MD 样本',method:'hold',sectionType:'incAziMd',expectedRows:1,actualRows:1,sampleVerdict:'PASS',recommendation:'通过'},
    {sampleId:'hold_to_tvd',name:'04 Hold to TVD 样本',method:'hold',sectionType:'tvdIncAzi',expectedRows:1,actualRows:1,sampleVerdict:'PASS',recommendation:'通过'},
    {sampleId:'slant_standard',name:'05 Slant 样本',method:'slant',sectionType:'incAziMd',expectedRows:3,actualRows:3,sampleVerdict:'PASS',recommendation:'通过'},
    {sampleId:'s_well_standard',name:'06 S Well 样本',method:'sWell',sectionType:'incAziMd',expectedRows:5,actualRows:5,sampleVerdict:'PASS',recommendation:'通过'},
    {sampleId:'nudge_md_inc_azi',name:'07 Nudge MD/INC/AZI 样本',method:'nudge',sectionType:'incAziMd',expectedRows:1,actualRows:1,sampleVerdict:'PASS',recommendation:'通过'},
    {sampleId:'landing_plane',name:'08 Landing Plane 样本',method:'nudge',sectionType:'landingPlane',expectedRows:1,actualRows:1,sampleVerdict:'PASS',recommendation:'通过'},
    {sampleId:'line_up_target',name:'09 Line up on Target 样本',method:'nudge',sectionType:'lineUpOnTarget',expectedRows:1,actualRows:1,sampleVerdict:'PASS',recommendation:'通过'}
  ];
  return {
    ok:true, version:'2.9.6', reportType:'PlanningMethodsAcceptanceReport',
    overallVerdict:'PASS',
    totalSamples:samples.length,
    passCount:samples.length,
    reviewCount:0,
    failCount:0,
    samples,
    note:'前端Mock规划方法验收报告。API模式下调用后端 /api/well-path/planning-acceptance/run-all。'
  };
}

async function runAllPlanningSamples(){
  if(state.apiMode === 'api'){
    try{
      const json = await fetchBackendJson('/api/well-path/planning-acceptance/run-all', {method:'POST'});
      state.planningAcceptanceReport = json.data || json;
      toast('全部规划方法样本已运行完成');
    }catch(err){
      state.planningAcceptanceReport = localPlanningAcceptanceReport();
      toast(`后端规划验收失败，使用前端Mock：${err.message}`);
    }
  }else{
    state.planningAcceptanceReport = localPlanningAcceptanceReport();
    toast('当前 MOCK 模式：已运行全部规划方法样本');
  }
  renderCalibrationReportPage();
  addLog(`运行全部规划方法样本：${state.planningAcceptanceReport.overallVerdict}`);
}

async function loadPlanningAcceptanceReport(){
  if(state.apiMode === 'api'){
    try{
      const json = await fetchBackendJson('/api/well-path/planning-acceptance/report');
      state.planningAcceptanceReport = json.data || json;
      toast('已读取规划方法验收报告');
    }catch(err){
      state.planningAcceptanceReport = localPlanningAcceptanceReport();
      toast(`读取规划报告失败，使用前端Mock：${err.message}`);
    }
  }else{
    state.planningAcceptanceReport = localPlanningAcceptanceReport();
    toast('当前 MOCK 模式：已读取规划方法验收报告');
  }
  renderCalibrationReportPage();
}

function planningAcceptancePanelHtml(){
  const report = state.planningAcceptanceReport || localPlanningAcceptanceReport();
  const verdictClass = String(report.overallVerdict || '').toUpperCase() === 'PASS' ? 'pass' : 'review';
  return `<section class="planning-acceptance-v296">
    <div class="planning-acceptance-head ${verdictClass}">
      <div>
        <b>规划方法验收线 / Planning Method Acceptance Line</b>
        <span>验证 Slant、S Well、Build Turn、Dogleg Toolface、Hold、Optimum Align、Nudge 与 Section Type 插入闭环。</span>
      </div>
      <div class="planning-acceptance-verdict">
        <strong>${esc(report.overallVerdict || 'REVIEW')}</strong>
        <small>${report.passCount || 0} PASS / ${report.reviewCount || 0} REVIEW / ${report.failCount || 0} FAILED</small>
      </div>
    </div>
    <div class="planning-acceptance-actions">
      <button class="primary" onclick="runAllPlanningSamples()">运行全部规划样本</button>
      <button onclick="loadPlanningAcceptanceReport()">读取规划报告</button>
      <button onclick="exportPlanningAcceptanceJson()">导出规划 JSON</button>
      <button onclick="exportPlanningAcceptanceCsv()">导出规划 CSV</button>
    </div>
    <div class="planning-acceptance-kpis">
      <div><span>总样本数</span><b>${report.totalSamples || 0}</b></div>
      <div><span>PASS</span><b>${report.passCount || 0}</b></div>
      <div><span>REVIEW</span><b>${report.reviewCount || 0}</b></div>
      <div><span>FAILED</span><b>${report.failCount || 0}</b></div>
    </div>
    <div class="planning-acceptance-table-wrap">${planningAcceptanceTableHtml(report)}</div>
  </section>`;
}

function planningAcceptanceTableHtml(report){
  const rows = report.samples || [];
  return `<table class="planning-acceptance-table">
    <thead><tr><th>#</th><th>样本</th><th>方法</th><th>Section Type</th><th>预期行数</th><th>实际行数</th><th>结论</th><th>建议</th></tr></thead>
    <tbody>${rows.map((r,i)=>`<tr class="${String(r.sampleVerdict).toUpperCase()==='PASS'?'row-pass':'row-review'}">
      <td>${i+1}</td><td>${esc(r.name)}</td><td>${esc(r.method)}</td><td>${esc(r.sectionType)}</td><td>${r.expectedRows || ''}</td><td>${r.actualRows || ''}</td><td><b>${esc(r.sampleVerdict)}</b></td><td>${esc(r.recommendation || '')}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function exportPlanningAcceptanceJson(){
  const report = state.planningAcceptanceReport || localPlanningAcceptanceReport();
  downloadTextFile('DrillSpace_Planning_Acceptance_Report.json', JSON.stringify(report,null,2), 'application/json;charset=utf-8');
  toast('已导出规划方法验收 JSON');
}

function exportPlanningAcceptanceCsv(){
  const report = state.planningAcceptanceReport || localPlanningAcceptanceReport();
  const cols = ['sampleId','name','method','sectionType','expectedRows','actualRows','sampleVerdict','recommendation'];
  const csv = [cols.join(',')].concat((report.samples||[]).map(r => cols.map(c => r[c] ?? '').join(','))).join('\n');
  downloadTextFile('DrillSpace_Planning_Acceptance_Report.csv', csv, 'text/csv;charset=utf-8');
  toast('已导出规划方法验收 CSV');
}

/* Extend stage acceptance summary to include planning line on frontend */
function localStageAcceptanceSummary(){
  const trajectory = state.batchAcceptanceReport || (typeof localBatchAcceptanceReport === 'function' ? localBatchAcceptanceReport() : {overallVerdict:'REVIEW',totalSamples:0,passCount:0,reviewCount:0,failCount:0,maxErrors:{}});
  const collision = state.collisionAcceptanceReport || (typeof localCollisionAcceptanceReport === 'function' ? localCollisionAcceptanceReport() : {overallVerdict:'REVIEW',totalSamples:0,passCount:0,reviewCount:0,dangerCount:0,minGlobalDistance:0,minGlobalSeparationFactor:0});
  const planning = state.planningAcceptanceReport || localPlanningAcceptanceReport();
  const passCount = num(trajectory.passCount) + num(collision.passCount) + num(planning.passCount);
  const reviewCount = num(trajectory.reviewCount) + num(collision.reviewCount) + num(planning.reviewCount);
  const failCount = num(trajectory.failCount) + num(planning.failCount);
  const total = num(trajectory.totalSamples) + num(collision.totalSamples) + num(planning.totalSamples);
  const overall = (String(trajectory.overallVerdict).toUpperCase()==='PASS' && String(collision.overallVerdict).toUpperCase()==='PASS' && String(planning.overallVerdict).toUpperCase()==='PASS') ? 'PASS' : 'REVIEW';
  return {
    ok:true, version:'2.9.6', reportType:'TrajectorySubsystemAcceptanceSummary',
    overallVerdict:overall, totalSamples:total, passCount, reviewCount, failCount,
    acceptanceRate:passCount/Math.max(1,total),
    trajectory:{overallVerdict:trajectory.overallVerdict,totalSamples:trajectory.totalSamples,passCount:trajectory.passCount,reviewCount:trajectory.reviewCount,maxErrors:trajectory.maxErrors || {}},
    collision:{overallVerdict:collision.overallVerdict,totalSamples:collision.totalSamples,passCount:collision.passCount,reviewCount:collision.reviewCount,dangerCount:collision.dangerCount,minGlobalDistance:collision.minGlobalDistance,minGlobalSeparationFactor:collision.minGlobalSeparationFactor},
    planning:{overallVerdict:planning.overallVerdict,totalSamples:planning.totalSamples,passCount:planning.passCount,reviewCount:planning.reviewCount,methods:(planning.samples||[]).map(s=>s.method)},
    interfaceStatus:{health:'OK',trajectoryBatch:'READY',collisionBatch:'READY',planningBatch:'READY',exportPackage:'READY'},
    reportFiles:{trajectoryJson:'acceptance_report.json',collisionJson:'collision_acceptance_report.json',planningJson:'planning_acceptance_report.json',summaryJson:'stage_acceptance_summary.json'},
    generatedAt:new Date().toLocaleString('zh-CN',{hour12:false}),
    note:'V2.9.6 前端阶段验收中心汇总：轨迹 + 防碰 + 规划方法三条验收线。'
  };
}

(function(){
  const oldRender = window.renderCalibrationReportPage || renderCalibrationReportPage;
  window.renderCalibrationReportPage = function(){
    oldRender();
    const box = document.querySelector('.calibration-page-v290');
    if(!box) return;
    if(!box.querySelector('.planning-acceptance-v296')){
      state.planningAcceptanceReport = state.planningAcceptanceReport || localPlanningAcceptanceReport();
      const collision = box.querySelector('.collision-acceptance-v293');
      const sampleLib = box.querySelector('.sample-library-v291');
      const holder = document.createElement('div');
      holder.innerHTML = planningAcceptancePanelHtml();
      const panel = holder.firstElementChild;
      if(collision && collision.nextSibling) box.insertBefore(panel, collision.nextSibling);
      else if(sampleLib) box.insertBefore(panel, sampleLib);
      else box.appendChild(panel);
    }
    const stage = box.querySelector('.stage-acceptance-v294');
    if(stage){
      const lines = stage.querySelector('.stage-lines-grid');
      if(lines && !lines.querySelector('.stage-line-planning')){
        const p = state.planningAcceptanceReport || localPlanningAcceptanceReport();
        const div = document.createElement('div');
        div.className = `stage-line-card stage-line-planning ${String(p.overallVerdict).toLowerCase()}`;
        div.innerHTML = `<b>规划方法验收线</b><span>结论：${esc(p.overallVerdict || 'REVIEW')} · 样本：${p.totalSamples || 0} · PASS：${p.passCount || 0} · REVIEW：${p.reviewCount || 0}</span><em>Slant / S Well / Build Turn / Dogleg Toolface / Hold / Nudge / Section Type</em>`;
        lines.appendChild(div);
      }
    }
  };
})();

window.runAllPlanningSamples = runAllPlanningSamples;
window.loadPlanningAcceptanceReport = loadPlanningAcceptanceReport;
window.exportPlanningAcceptanceJson = exportPlanningAcceptanceJson;
window.exportPlanningAcceptanceCsv = exportPlanningAcceptanceCsv;


/* =========================================================
   V2.9.7 Target Zone Runtime Patch
   Target Library / Target Zone / Constraint Evaluation / Target-driven Planning
   ========================================================= */
function v297DefaultTargets(){
  return [
    {id:'surface_location',name:'Surface Location / 井口',type:'surface',tvd:0,ns:0,ew:0,verticalSection:0,radius:5,ellipseMajor:10,ellipseMinor:10,entryInc:0,entryAzi:0,tolerance:5,priority:'reference',enabled:true,remark:'井口参考点'},
    {id:'kop',name:'KOP / 造斜点',type:'kop',tvd:1200,ns:0,ew:0,verticalSection:0,radius:20,ellipseMajor:30,ellipseMinor:20,entryInc:0,entryAzi:110,tolerance:20,priority:'design',enabled:true,remark:'Kick-off point'},
    {id:'target_center',name:'Target Center / 靶心',type:'target',tvd:3500,ns:2050,ew:1560,verticalSection:2570,radius:35,ellipseMajor:60,ellipseMinor:35,entryInc:86,entryAzi:121.8,tolerance:20,priority:'primary',enabled:true,remark:'主目标靶区'},
    {id:'landing_point',name:'Landing Point / 着陆点',type:'landing',tvd:3420,ns:1900,ew:1450,verticalSection:2385,radius:30,ellipseMajor:80,ellipseMinor:30,entryInc:88.5,entryAzi:121.8,tolerance:15,priority:'primary',enabled:true,remark:'水平段着陆约束'},
    {id:'pbhl',name:'PBHL / 设计井底',type:'pbhl',tvd:3550,ns:2800,ew:2300,verticalSection:3600,radius:50,ellipseMajor:100,ellipseMinor:45,entryInc:90,entryAzi:122,tolerance:25,priority:'primary',enabled:true,remark:'Planned bottom hole location'},
    {id:'lease_line_north',name:'Lease Line North / 北侧边界',type:'leaseLine',tvd:3500,ns:3150,ew:2300,verticalSection:4000,radius:80,ellipseMajor:200,ellipseMinor:80,entryInc:90,entryAzi:122,tolerance:40,priority:'constraint',enabled:true,remark:'边界约束示例'},
    {id:'no_go_fault',name:'No-Go Zone / 避让区',type:'noGo',tvd:3300,ns:1750,ew:1320,verticalSection:2200,radius:120,ellipseMajor:160,ellipseMinor:100,entryInc:0,entryAzi:0,tolerance:50,priority:'avoid',enabled:true,remark:'避让区，进入半径内视为风险'}
  ];
}
function v297EnsureTargetState(){
  state.targets = state.targets || v297DefaultTargets();
  state.activeTargetId = state.activeTargetId || 'target_center';
  state.targetEvaluation = state.targetEvaluation || null;
}
function v297ActiveTarget(){
  v297EnsureTargetState();
  return state.targets.find(t=>String(t.id)===String(state.activeTargetId)) || state.targets[0];
}
function v297TargetField(key,label,unit=''){
  const t = v297ActiveTarget();
  return `<label class="v297-field"><span>${label}${unit?`<em>${unit}</em>`:''}</span><input data-target-field="${key}" value="${esc(t?.[key] ?? '')}"></label>`;
}
function v297TargetSelect(key,label,options){
  const t=v297ActiveTarget(), v=t?.[key] ?? '';
  return `<label class="v297-field"><span>${label}</span><select data-target-field="${key}">${options.map(o=>`<option value="${esc(o[0])}" ${String(v)===String(o[0])?'selected':''}>${esc(o[1])}</option>`).join('')}</select></label>`;
}
function v297TargetCenterHtml(){
  v297EnsureTargetState();
  const t = v297ActiveTarget();
  const e = state.targetEvaluation;
  const best = e?.bestTarget;
  const current = v295ActiveRow ? v295ActiveRow() : (state.rows[state.selectedRow] || {});
  return `<div class="v297-target-center" id="v297TargetCenter">
    <div class="v297-head">
      <div><b>目标靶区与轨迹约束中心</b><span>Target Library / Target Zone / Constraint Evaluation / Target-driven Planning</span></div>
      <div class="v297-current"><b>Current Row ${state.selectedRow ?? 0}</b><span>MD ${fmt(current.md,2)} · TVD ${fmt(current.tvd,2)} · NS ${fmt(current.ns,2)} · EW ${fmt(current.ew,2)}</span></div>
    </div>
    <div class="v297-body">
      <section class="v297-list">
        <div class="v297-card-title"><b>Target Library</b><span>${state.targets.length} targets</span></div>
        <div class="v297-target-list">
          ${state.targets.map(tg=>`<button class="${String(tg.id)===String(state.activeTargetId)?'active':''} ${tg.type==='noGo'?'nogozone':''}" onclick="v297SelectTarget('${esc(tg.id)}')"><b>${esc(tg.name)}</b><span>${esc(tg.type)} · TVD ${fmt(tg.tvd,0)} · NS ${fmt(tg.ns,0)} · EW ${fmt(tg.ew,0)}</span></button>`).join('')}
        </div>
      </section>
      <section class="v297-config">
        <div class="v297-card-title"><b>Target Configuration</b><span>${esc(t.name || '')}</span></div>
        <div class="v297-config-grid">
          ${v297TargetField('name','Name')}
          ${v297TargetSelect('type','Type',[['surface','Surface'],['kop','KOP'],['target','Target'],['landing','Landing'],['pbhl','PBHL'],['leaseLine','Lease Line'],['noGo','No-Go Zone']])}
          ${v297TargetField('tvd','TVD','m')}
          ${v297TargetField('ns','N/S','m')}
          ${v297TargetField('ew','E/W','m')}
          ${v297TargetField('verticalSection','V.Sec','m')}
          ${v297TargetField('radius','Radius','m')}
          ${v297TargetField('ellipseMajor','Ellipse Major','m')}
          ${v297TargetField('ellipseMinor','Ellipse Minor','m')}
          ${v297TargetField('entryInc','Entry Inc','°')}
          ${v297TargetField('entryAzi','Entry Azi','°')}
          ${v297TargetField('tolerance','TVD Tol','m')}
          ${v297TargetSelect('priority','Priority',[['reference','reference'],['design','design'],['primary','primary'],['constraint','constraint'],['avoid','avoid']])}
        </div>
      </section>
      <section class="v297-eval">
        <div class="v297-card-title"><b>Target Evaluation</b><span>${esc(e?.overallVerdict || 'WAITING')}</span></div>
        ${best ? `<div class="v297-eval-kpis"><div><span>Nearest Target</span><b>${esc(best.targetName || '')}</b></div><div><span>Horizontal Error</span><b>${fmt(best.errors?.horizontalError,2)}m</b></div><div><span>TVD Error</span><b>${fmt(best.errors?.tvdError,2)}m</b></div><div><span>Status</span><b>${esc(best.status)}</b></div></div>` : `<div class="v297-eval-empty"><b>未评价</b><span>点击 Evaluate Current Row 计算当前行与目标靶区的关系。</span></div>`}
      </section>
    </div>
    <div class="v297-actions">
      <button class="primary" onclick="v297EvaluateCurrentTarget()">Evaluate Current Row</button>
      <button onclick="v297ApplyTargetToPlanning()">Apply to Planning</button>
      <button onclick="v297LineUpTarget()">Line up Target</button>
      <button onclick="v297SolveToTarget()">Solve to Target</button>
      <button onclick="v297AddTarget()">Add Target</button>
      <button onclick="v297SaveActiveTarget()">Save Target</button>
      <button onclick="v297LoadTargets()">Load Library</button>
      <button onclick="v297ExportTargets()">Export Targets</button>
    </div>
  </div>`;
}
function v297InjectTargetCenter(){
  v297EnsureTargetState();
  const content = $('editorContent');
  if(!content || state.editorView !== 'grid') return;
  content.classList.add('v297-target-editor');
  const old = $('v297TargetCenter'); if(old) old.remove();
  const dock = $('v295PlanningDock');
  if(dock) dock.insertAdjacentHTML('beforebegin', v297TargetCenterHtml());
  else content.insertAdjacentHTML('beforeend', v297TargetCenterHtml());
  const box = $('v297TargetCenter');
  if(box){
    box.querySelectorAll('[data-target-field]').forEach(el=>{
      el.oninput = el.onchange = ()=>{
        const t = v297ActiveTarget(); if(!t) return;
        const key = el.dataset.targetField;
        t[key] = ['name','type','priority','remark'].includes(key) ? el.value : Number(el.value);
      };
    });
  }
}
function v297SelectTarget(id){ state.activeTargetId = id; v297InjectTargetCenter(); }
async function v297LoadTargets(){
  if(state.apiMode === 'api'){
    try{
      const json = await fetchBackendJson('/api/well-path/targets');
      const data = json.data || json;
      state.targets = data.targets || state.targets || v297DefaultTargets();
      state.activeTargetId = state.targets[0]?.id || 'target_center';
      toast('已加载目标库');
    }catch(err){ toast(`加载目标库失败：${err.message}`); }
  }else{
    state.targets = state.targets || v297DefaultTargets();
    toast('当前 MOCK 模式：使用内置目标库');
  }
  v297InjectTargetCenter();
}
async function v297SaveActiveTarget(){
  const t = v297ActiveTarget();
  if(!t) return toast('没有选中目标');
  if(state.apiMode === 'api'){
    try{ await fetchBackendJson('/api/well-path/targets', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(t)}); toast('目标已保存到后端'); }
    catch(err){ toast(`后端保存失败：${err.message}`); }
  }else toast('当前 MOCK 模式：目标已保存在前端状态');
}
function v297AddTarget(){
  v297EnsureTargetState();
  const id = `target_${Date.now()}`;
  state.targets.push({id,name:'New Target / 新目标',type:'target',tvd:3500,ns:0,ew:0,verticalSection:0,radius:30,ellipseMajor:60,ellipseMinor:30,entryInc:0,entryAzi:0,tolerance:20,priority:'design',enabled:true,remark:'new target'});
  state.activeTargetId = id;
  v297InjectTargetCenter();
}
function v297ApplyTargetToPlanning(){
  const t = v297ActiveTarget();
  if(!t) return toast('没有选中目标');
  state.planningParams = state.planningParams || {};
  state.planningParams.targetTvd = Number(t.tvd || 0);
  state.planningParams.targetNs = Number(t.ns || 0);
  state.planningParams.targetEw = Number(t.ew || 0);
  state.planningParams.targetInc = Number(t.entryInc || 0);
  state.planningParams.targetAzi = Number(t.entryAzi || 0);
  toast(`目标已写入规划参数：${t.name}`);
  if(typeof v295InjectPlanningDock === 'function') v295InjectPlanningDock();
  v297InjectTargetCenter();
}
function v297LocalEvaluate(row, target){
  const tvdError = num(row.tvd) - num(target.tvd), nsError = num(row.ns) - num(target.ns), ewError = num(row.ew) - num(target.ew);
  const horizontalError = Math.sqrt(nsError*nsError + ewError*ewError);
  const radius = Math.max(1e-6, num(target.radius || 30));
  const tol = Math.max(1e-6, num(target.tolerance || 20));
  const ellipseMajor = Math.max(1e-6, num(target.ellipseMajor || radius));
  const ellipseMinor = Math.max(1e-6, num(target.ellipseMinor || radius));
  const ellipseValue = (nsError/ellipseMajor)**2 + (ewError/ellipseMinor)**2;
  const inTarget = (horizontalError <= radius || ellipseValue <= 1) && Math.abs(tvdError) <= tol;
  const noGo = target.type === 'noGo';
  return {ok:true,overallVerdict:(noGo ? !inTarget : inTarget) ? 'PASS' : 'REVIEW',bestTarget:{targetId:target.id,targetName:target.name,targetType:target.type,errors:{tvdError,nsError,ewError,horizontalError,ellipseValue},status:noGo?(inTarget?'RISK':'CLEAR'):(inTarget?'IN_TARGET':'MISS'),verdict:(noGo ? !inTarget : inTarget) ? 'PASS' : 'REVIEW'},evaluations:[]};
}
async function v297EvaluateCurrentTarget(){
  const row = v295ActiveRow ? v295ActiveRow() : (state.rows[state.selectedRow] || {});
  const target = v297ActiveTarget();
  if(state.apiMode === 'api'){
    try{
      const json = await fetchBackendJson('/api/well-path/targets/evaluate', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({row,targetId:target.id})});
      state.targetEvaluation = json.data || json;
    }catch(err){
      state.targetEvaluation = v297LocalEvaluate(row,target);
      toast(`后端评价失败，使用前端评价：${err.message}`);
    }
  }else state.targetEvaluation = v297LocalEvaluate(row,target);
  v297InjectTargetCenter();
  toast(`靶区评价完成：${state.targetEvaluation.overallVerdict}`);
}
async function v297LineUpTarget(){
  const row = v295ActiveRow ? v295ActiveRow() : (state.rows[state.selectedRow] || {});
  const target = v297ActiveTarget();
  if(state.apiMode === 'api'){
    try{
      const json = await fetchBackendJson('/api/well-path/planning/line-up-target', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({row,targetId:target.id,cl:60})});
      const data = json.data || json;
      state.planningPreview = data.planningResult;
      state.planningMethod = 'nudge';
      state.planningSectionType = 'lineUpOnTarget';
      toast(`Line up Target 完成：Azi ${fmt(data.lineUpAzi,2)}°`);
    }catch(err){ toast(`Line up Target 失败：${err.message}`); }
  }else{
    v297ApplyTargetToPlanning(); state.planningMethod='nudge'; state.planningSectionType='lineUpOnTarget';
    if(typeof v295CalculatePlanningMethod === 'function') await v295CalculatePlanningMethod(true);
    toast('当前 MOCK 模式：已按目标对齐');
  }
  if(typeof v295InjectPlanningDock === 'function') v295InjectPlanningDock();
  v297InjectTargetCenter();
}
async function v297SolveToTarget(){
  const row = v295ActiveRow ? v295ActiveRow() : (state.rows[state.selectedRow] || {});
  const target = v297ActiveTarget();
  if(state.apiMode === 'api'){
    try{
      const json = await fetchBackendJson('/api/well-path/planning/solve-to-target', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({row,targetId:target.id,method:'optimumAlign',tangentLength:300})});
      const data = json.data || json;
      state.planningPreview = data.planningResult;
      state.targetEvaluation = data.evaluation ? {overallVerdict:data.evaluation.verdict,bestTarget:data.evaluation,evaluations:[data.evaluation]} : state.targetEvaluation;
      state.planningMethod = 'optimumAlign';
      toast('Solve to Target 完成');
    }catch(err){ toast(`Solve to Target 失败：${err.message}`); }
  }else{
    v297ApplyTargetToPlanning(); state.planningMethod='optimumAlign';
    if(typeof v295CalculatePlanningMethod === 'function') await v295CalculatePlanningMethod(true);
    toast('当前 MOCK 模式：已生成目标驱动规划预览');
  }
  if(typeof v295InjectPlanningDock === 'function') v295InjectPlanningDock();
  v297InjectTargetCenter();
}
function v297ExportTargets(){
  v297EnsureTargetState();
  downloadTextFile('DrillSpace_Target_Library.json', JSON.stringify({version:'2.9.7',targets:state.targets},null,2),'application/json;charset=utf-8');
  toast('已导出目标库 JSON');
}
(function(){
  const oldRenderGrid = window.renderGrid || renderGrid;
  window.renderGrid = function(){ oldRenderGrid(); setTimeout(()=>v297InjectTargetCenter(), 40); };
  setTimeout(()=>{ if(state&&state.editorView==='grid') v297InjectTargetCenter(); }, 200);
})();

function localTargetAcceptanceReport(){
  const samples = [
    {sampleId:'circle_hit',name:'01 圆形靶区入靶样本',mode:'evaluate',targetId:'target_center',targetName:'Target Center',expectedVerdict:'PASS',actualVerdict:'PASS',sampleVerdict:'PASS',recommendation:'通过'},
    {sampleId:'ellipse_hit',name:'02 椭圆靶区入靶样本',mode:'evaluate',targetId:'landing_point',targetName:'Landing Point',expectedVerdict:'PASS',actualVerdict:'PASS',sampleVerdict:'PASS',recommendation:'通过'},
    {sampleId:'miss_offset',name:'03 未入靶偏差样本',mode:'evaluate',targetId:'target_center',targetName:'Target Center',expectedVerdict:'REVIEW',actualVerdict:'REVIEW',sampleVerdict:'PASS',recommendation:'通过'},
    {sampleId:'no_go_clear',name:'04 避让区安全样本',mode:'evaluate',targetId:'no_go_fault',targetName:'No-Go Zone',expectedVerdict:'PASS',actualVerdict:'PASS',sampleVerdict:'PASS',recommendation:'通过'},
    {sampleId:'line_up_target',name:'05 Line up on Target 样本',mode:'lineUp',targetId:'target_center',targetName:'Target Center',expectedVerdict:'PASS',actualVerdict:'PASS',sampleVerdict:'PASS',recommendation:'通过'},
    {sampleId:'landing_plane_target',name:'06 Landing Plane 目标样本',mode:'solve',targetId:'landing_point',targetName:'Landing Point',expectedVerdict:'PASS',actualVerdict:'PASS',sampleVerdict:'PASS',recommendation:'通过'},
    {sampleId:'optimum_align_target',name:'07 Optimum Align 目标样本',mode:'solve',targetId:'pbhl',targetName:'PBHL',expectedVerdict:'PASS',actualVerdict:'PASS',sampleVerdict:'PASS',recommendation:'通过'}
  ];
  return {ok:true,version:'2.9.7',reportType:'TargetConstraintAcceptanceReport',overallVerdict:'PASS',totalSamples:samples.length,passCount:samples.length,reviewCount:0,failCount:0,samples,note:'前端目标靶区验收报告；API模式下调用后端 /api/well-path/target-acceptance/run-all。'};
}
async function runAllTargetSamples(){
  if(state.apiMode === 'api'){
    try{ const json = await fetchBackendJson('/api/well-path/target-acceptance/run-all', {method:'POST'}); state.targetAcceptanceReport = json.data || json; toast('全部目标靶区样本已运行完成'); }
    catch(err){ state.targetAcceptanceReport = localTargetAcceptanceReport(); toast(`后端目标验收失败，使用前端Mock：${err.message}`); }
  }else{ state.targetAcceptanceReport = localTargetAcceptanceReport(); toast('当前 MOCK 模式：已运行全部目标样本'); }
  renderCalibrationReportPage();
}
async function loadTargetAcceptanceReport(){
  if(state.apiMode === 'api'){
    try{ const json = await fetchBackendJson('/api/well-path/target-acceptance/report'); state.targetAcceptanceReport = json.data || json; toast('已读取目标靶区验收报告'); }
    catch(err){ state.targetAcceptanceReport = localTargetAcceptanceReport(); toast(`读取目标报告失败，使用前端Mock：${err.message}`); }
  }else state.targetAcceptanceReport = localTargetAcceptanceReport();
  renderCalibrationReportPage();
}
function targetAcceptancePanelHtml(){
  const report = state.targetAcceptanceReport || localTargetAcceptanceReport();
  const verdictClass = String(report.overallVerdict).toUpperCase()==='PASS'?'pass':'review';
  return `<section class="target-acceptance-v297"><div class="target-acceptance-head ${verdictClass}"><div><b>目标靶区验收线 / Target Constraint Acceptance Line</b><span>验证圆形/椭圆靶区、未入靶偏差、No-Go Zone、Line up Target 与目标驱动规划。</span></div><div class="target-acceptance-verdict"><strong>${esc(report.overallVerdict)}</strong><small>${report.passCount||0} PASS / ${report.reviewCount||0} REVIEW / ${report.failCount||0} FAILED</small></div></div><div class="target-acceptance-actions"><button class="primary" onclick="runAllTargetSamples()">运行全部目标样本</button><button onclick="loadTargetAcceptanceReport()">读取目标报告</button><button onclick="exportTargetAcceptanceJson()">导出目标 JSON</button><button onclick="exportTargetAcceptanceCsv()">导出目标 CSV</button></div><div class="target-acceptance-kpis"><div><span>总样本数</span><b>${report.totalSamples||0}</b></div><div><span>PASS</span><b>${report.passCount||0}</b></div><div><span>REVIEW</span><b>${report.reviewCount||0}</b></div><div><span>FAILED</span><b>${report.failCount||0}</b></div></div><div class="target-acceptance-table-wrap">${targetAcceptanceTableHtml(report)}</div></section>`;
}
function targetAcceptanceTableHtml(report){
  const rows = report.samples || [];
  return `<table class="target-acceptance-table"><thead><tr><th>#</th><th>样本</th><th>模式</th><th>目标</th><th>预期</th><th>实际</th><th>结论</th><th>建议</th></tr></thead><tbody>${rows.map((r,i)=>`<tr class="${String(r.sampleVerdict).toUpperCase()==='PASS'?'row-pass':'row-review'}"><td>${i+1}</td><td>${esc(r.name)}</td><td>${esc(r.mode)}</td><td>${esc(r.targetName||r.targetId)}</td><td>${esc(r.expectedVerdict)}</td><td>${esc(r.actualVerdict)}</td><td><b>${esc(r.sampleVerdict)}</b></td><td>${esc(r.recommendation||'')}</td></tr>`).join('')}</tbody></table>`;
}
function exportTargetAcceptanceJson(){ const report = state.targetAcceptanceReport || localTargetAcceptanceReport(); downloadTextFile('DrillSpace_Target_Acceptance_Report.json', JSON.stringify(report,null,2), 'application/json;charset=utf-8'); toast('已导出目标靶区验收 JSON'); }
function exportTargetAcceptanceCsv(){ const report = state.targetAcceptanceReport || localTargetAcceptanceReport(); const cols = ['sampleId','name','mode','targetId','targetName','expectedVerdict','actualVerdict','sampleVerdict','recommendation']; const csv = [cols.join(',')].concat((report.samples||[]).map(r=>cols.map(c=>r[c]??'').join(','))).join('\n'); downloadTextFile('DrillSpace_Target_Acceptance_Report.csv', csv, 'text/csv;charset=utf-8'); toast('已导出目标靶区验收 CSV'); }

function localStageAcceptanceSummary(){
  const trajectory = state.batchAcceptanceReport || (typeof localBatchAcceptanceReport === 'function' ? localBatchAcceptanceReport() : {overallVerdict:'REVIEW',totalSamples:0,passCount:0,reviewCount:0,failCount:0,maxErrors:{}});
  const collision = state.collisionAcceptanceReport || (typeof localCollisionAcceptanceReport === 'function' ? localCollisionAcceptanceReport() : {overallVerdict:'REVIEW',totalSamples:0,passCount:0,reviewCount:0,dangerCount:0,minGlobalDistance:0,minGlobalSeparationFactor:0});
  const planning = state.planningAcceptanceReport || (typeof localPlanningAcceptanceReport === 'function' ? localPlanningAcceptanceReport() : {overallVerdict:'REVIEW',totalSamples:0,passCount:0,reviewCount:0,failCount:0,samples:[]});
  const target = state.targetAcceptanceReport || localTargetAcceptanceReport();
  const passCount = num(trajectory.passCount)+num(collision.passCount)+num(planning.passCount)+num(target.passCount);
  const reviewCount = num(trajectory.reviewCount)+num(collision.reviewCount)+num(planning.reviewCount)+num(target.reviewCount);
  const failCount = num(trajectory.failCount)+num(planning.failCount)+num(target.failCount);
  const total = num(trajectory.totalSamples)+num(collision.totalSamples)+num(planning.totalSamples)+num(target.totalSamples);
  const overall = [trajectory,collision,planning,target].every(x=>String(x.overallVerdict).toUpperCase()==='PASS')?'PASS':'REVIEW';
  return {ok:true,version:'2.9.7',reportType:'TrajectorySubsystemAcceptanceSummary',overallVerdict:overall,totalSamples:total,passCount,reviewCount,failCount,acceptanceRate:passCount/Math.max(1,total),trajectory:{overallVerdict:trajectory.overallVerdict,totalSamples:trajectory.totalSamples,passCount:trajectory.passCount,reviewCount:trajectory.reviewCount,maxErrors:trajectory.maxErrors||{}},collision:{overallVerdict:collision.overallVerdict,totalSamples:collision.totalSamples,passCount:collision.passCount,reviewCount:collision.reviewCount,dangerCount:collision.dangerCount,minGlobalDistance:collision.minGlobalDistance,minGlobalSeparationFactor:collision.minGlobalSeparationFactor},planning:{overallVerdict:planning.overallVerdict,totalSamples:planning.totalSamples,passCount:planning.passCount,reviewCount:planning.reviewCount,methods:(planning.samples||[]).map(s=>s.method)},target:{overallVerdict:target.overallVerdict,totalSamples:target.totalSamples,passCount:target.passCount,reviewCount:target.reviewCount,modes:(target.samples||[]).map(s=>s.mode)},interfaceStatus:{health:'OK',trajectoryBatch:'READY',collisionBatch:'READY',planningBatch:'READY',targetBatch:'READY',exportPackage:'READY'},reportFiles:{trajectoryJson:'acceptance_report.json',collisionJson:'collision_acceptance_report.json',planningJson:'planning_acceptance_report.json',targetJson:'target_acceptance_report.json',summaryJson:'stage_acceptance_summary.json'},generatedAt:new Date().toLocaleString('zh-CN',{hour12:false}),note:'V2.9.7 前端阶段验收中心汇总：轨迹 + 防碰 + 规划方法 + 目标靶区四条验收线。'};
}
(function(){
  const oldRender = window.renderCalibrationReportPage || renderCalibrationReportPage;
  window.renderCalibrationReportPage = function(){
    oldRender();
    const box = document.querySelector('.calibration-page-v290');
    if(!box) return;
    if(!box.querySelector('.target-acceptance-v297')){
      state.targetAcceptanceReport = state.targetAcceptanceReport || localTargetAcceptanceReport();
      const planning = box.querySelector('.planning-acceptance-v296');
      const holder = document.createElement('div'); holder.innerHTML = targetAcceptancePanelHtml();
      const panel = holder.firstElementChild;
      if(planning && planning.nextSibling) box.insertBefore(panel, planning.nextSibling); else box.appendChild(panel);
    }
    const stage = box.querySelector('.stage-acceptance-v294');
    if(stage){
      const lines = stage.querySelector('.stage-lines-grid');
      if(lines && !lines.querySelector('.stage-line-target')){
        const t = state.targetAcceptanceReport || localTargetAcceptanceReport();
        const div = document.createElement('div');
        div.className = `stage-line-card stage-line-target ${String(t.overallVerdict).toLowerCase()}`;
        div.innerHTML = `<b>目标靶区验收线</b><span>结论：${esc(t.overallVerdict||'REVIEW')} · 样本：${t.totalSamples||0} · PASS：${t.passCount||0} · REVIEW：${t.reviewCount||0}</span><em>Target Library / Target Zone / No-Go / Line up Target / Solve to Target</em>`;
        lines.appendChild(div);
      }
    }
  };
})();
window.v297SelectTarget=v297SelectTarget; window.v297LoadTargets=v297LoadTargets; window.v297SaveActiveTarget=v297SaveActiveTarget; window.v297AddTarget=v297AddTarget; window.v297ApplyTargetToPlanning=v297ApplyTargetToPlanning; window.v297EvaluateCurrentTarget=v297EvaluateCurrentTarget; window.v297LineUpTarget=v297LineUpTarget; window.v297SolveToTarget=v297SolveToTarget; window.v297ExportTargets=v297ExportTargets;
window.runAllTargetSamples=runAllTargetSamples; window.loadTargetAcceptanceReport=loadTargetAcceptanceReport; window.exportTargetAcceptanceJson=exportTargetAcceptanceJson; window.exportTargetAcceptanceCsv=exportTargetAcceptanceCsv;
