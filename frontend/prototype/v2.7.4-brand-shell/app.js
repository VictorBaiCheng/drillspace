/* DrillSpace V2.7.4 Brand Shell Polish + Trajectory Complete Industrial Editor
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
  collision: { minDistance: 38.6, minSF: 1.86, nearestWell: 'B-2井', risk: '中低' }
};

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
  { key:'importExport', name:'导入导出', route:'/TrajectoryImportExport', desc:'CSV/TXT预览、字段映射、异常行检查、正式上传' }
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
  addLog(`切换到${module.name}`);
}

function renderGrid(){
  state.editorView = 'grid';
  setActiveViewButton('grid');
  $('workbookTitle').textContent = '轨迹数据表 / Trajectory Data Sheet';
  $('rowCountLabel').textContent = `${state.rows.length} rows · editable · paste from Excel supported`;
  const content = $('editorContent');
  content.innerHTML = `<div class="sheet-wrap"><table class="trajectory-sheet"><thead><tr><th class="selector">选中</th><th class="idx">序号</th>${rowColumns.map(c=>`<th>${esc(c[1])}</th>`).join('')}</tr></thead><tbody>${state.rows.map((r,i)=>renderRow(r,i)).join('')}</tbody></table></div>`;
  const tbody = content.querySelector('tbody');
  tbody.addEventListener('click', e => {
    const tr = e.target.closest('tr');
    if(!tr) return;
    selectRow(Number(tr.dataset.index));
  });
  tbody.addEventListener('input', e => {
    const input = e.target.closest('input,select');
    if(!input) return;
    const tr = input.closest('tr');
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
  document.querySelectorAll('.trajectory-sheet tr').forEach(tr => tr.classList.toggle('selected', Number(tr.dataset.index) === state.selectedRow));
  renderRowProps();
  if(scroll){
    const tr = document.querySelector(`.trajectory-sheet tr[data-index="${state.selectedRow}"]`);
    if(tr) tr.scrollIntoView({block:'nearest'});
  }
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
  $('workbookTitle').textContent = '防碰扫描 / Anti-collision Scan';
  $('rowCountLabel').textContent = '法平面距离 / 最近距离 / 分离距 / 分离系数 / 误差椭球';
  const rows = state.rows.slice(0,16).map((r,i)=>({
    md: r.md,
    dist: 55 - i*1.2 + Math.sin(i)*3,
    sf: 2.4 - i*0.035 + Math.cos(i)*0.05,
    method: i%2?'最近距离':'法平面',
    neighbor: i%3?'B-2井':'B-3井'
  }));
  $('editorContent').innerHTML = `<div class="submodule-content">
    <div class="module-grid">
      <div class="module-tile"><b>法平面扫描法</b><p>沿参考轨迹法平面搜索比较井距离，输出最近点、曲面投影与风险段。</p><div class="btn-line"><button class="primary" onclick="callApiAction('flatScan')">调用 FrmFlatScanData</button><button onclick="showCollisionSettings()">设置</button></div></div>
      <div class="module-tile"><b>最近距离扫描法</b><p>计算参考井与比较井空间最近距离，支持水平面法与法平面法表示。</p><div class="btn-line"><button class="primary" onclick="callApiAction('nearestDistance')">调用 FrmDistanceData</button><button onclick="callApiAction('separationFactor')">分离系数</button></div></div>
      <div class="module-tile"><b>分离距 / 分离系数</b><p>以误差模型与井眼位置不确定性为基础，输出工程安全距离和分离系数。</p><div class="btn-line"><button onclick="callApiAction('separationDistance')">分离距</button><button onclick="callApiAction('separationFactor')">分离系数</button></div></div>
      <div class="module-tile"><b>误差椭球</b><p>接入误差源后生成井眼误差椭球，为防碰扫描提供不确定性边界。</p><div class="btn-line"><button onclick="callApiAction('errorSource')">误差源</button><button onclick="callApiAction('errorEllipsoid')">误差椭球</button></div></div>
    </div>
    <table class="collision-table" style="margin-top:10px"><thead><tr><th>MD</th><th>比较井</th><th>方法</th><th>中心距(m)</th><th>分离系数</th><th>风险等级</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${fmt(r.md,0)}</td><td>${r.neighbor}</td><td>${r.method}</td><td>${fmt(r.dist,2)}</td><td>${fmt(r.sf,2)}</td><td>${r.sf<1.5?'<b style="color:#c53333">高</b>':r.sf<2?'<b style="color:#b45309">中</b>':'低'}</td></tr>`).join('')}
    </tbody></table>
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
  $('editorContent').innerHTML = `<div class="submodule-content">${apiContractHtml()}<div class="btn-line" style="margin-top:10px"><button class="primary" onclick="toggleApiMode()">切换 Mock/API</button><button onclick="testApiConnection()">测试连接</button><button onclick="exportApiMap()">导出接口映射</button></div></div>`;
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
  if(['flatScan','nearestDistance','separationDistance','separationFactor','errorEllipsoid','verticalProfile','horizontalProjection','inclination','azimuth','dogleg','build','turn'].includes(key)) return [buildDisignDto(), {...buildDisignDto(), tid:'TRJ-B2-REF'}];
  return { pid:'P-Bohai-B-001', tid:'TRJ-A5123' };
}

function mockApiResult(key){
  if(key === 'calculateTable') return state.rows.map(r => ({...r}));
  if(key === 'listTrajectory') return state.trajectories;
  if(key.includes('separation') || key.includes('flat') || key.includes('nearest')) return { minDistance: state.collision.minDistance, minSF: state.collision.minSF, nearestWell: state.collision.nearestWell };
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
  addLog('保存轨迹版本 V2.7.4-A5123');
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
function showCollisionSettings(){
  showModal('防碰扫描设置', `<div class="modal-grid"><label>参考井<select><option>B-1井 设计轨迹</option></select></label><label>比较井<select><option>B-2井 邻井参考</option><option>B-3井 作业中</option></select></label><label>插值间隔(m)<input value="30"></label><label>搜索半径(m)<input value="100"></label><label>点大小<input value="4"></label><label>误差模型<select><option>ISCWSA MWD Rev5</option><option>自定义误差源</option></select></label></div>`, () => {toast('防碰扫描设置已应用'); callApiAction('flatScan');});
}
window.showDeviationSettings = showDeviationSettings;
window.showCollisionSettings = showCollisionSettings;

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
  addLog('打开 DrillSpace V2.7.4 品牌壳升级轨迹工业编辑器');
  addLog('加载 MyDrill well-path API 映射');
  addLog('加载 B-1井 设计轨迹 A5123');
  bind();
}

init();
