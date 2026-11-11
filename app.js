import * as THREE from 'three';
import { buildReplay, sunAt, sunrise, sunset, timeLabel } from './daylight.js';
import { OrbitControls } from './vendor/OrbitControls.js';

const $ = s => document.querySelector(s);
const timeline = $('#timeline'), play = $('#play');
let data, heightData, crowd, weather, seconds = 14 * 3600, speed = 1, selected = null, last = 0;
let playing = false;
let presentation = false;
let presentationIds = new Set();
let presentationTop = [];
let presentationSequence = [];
let presentationIndex = 0;
let previousSpeed = 1;
let views = [], heroView, syncing = false;
const cameraPosition = new THREE.Vector3(650, 910, 920);
const markers = { normal: new THREE.Color('#f2f8f3'), slow: new THREE.Color('#ffd278'), selected: new THREE.Color('#bcacff') };

// ------------------------------------------------------------------ language
const stationNames = { en: { MOK: 'Mong Kok', ADM: 'Admiralty', HKU: 'HKU' }, zh: { MOK: '旺角', ADM: '金钟', HKU: '港大' } };
let lang = localStorage.getItem('mtr-lang') === 'zh' ? 'zh' : 'en';
let statusKey = 'loading';
const STRINGS = {
  en: {
    date: '17 July 2025', dateNote: 'Sunrise to sunset · Hong Kong time',
    presentation: 'Presentation', presentationExit: 'Exit presentation', stationsAria: 'Stations',
    infoSummary: 'About the model', infoTitle: 'About this map',
    infoP1: 'Map colours are modelled shortwave solar radiation, not measured street temperature. Weather comes from the hourly ERA5-Seamless grid; the model assumes 20% transmission through covered links and 100% outdoors. Covered is not zero exposure; areas outside the mapped network are not evaluated.',
    infoP2: 'Each day 10,000 pedestrians depart between 09:00 and 19:00 — an uncalibrated high-demand scenario, not observed traffic. Pedestrians, demand and congestion are simulated. Both scenarios compare the same trips; routes are computed first and then replayed, and walking inside stations is excluded. Building footprints come from OSM; heights mix estimates and defaults, and buildings are not used to compute real shadows. The network and pedestrians are shown on an illustrative ground plane, not real elevation.',
    infoP3: 'Drag to rotate and scroll to zoom. Both views stay synchronised.',
    linkWeather: 'Weather data ↗', linkNetwork: 'Pedestrian network ↗', linkBuildings: 'Building data ↗', langButton: '中文',
    mapWorkspaceAria: 'Route map comparison', mapControlsAria: 'Map controls',
    view3d: '3D', viewTop: 'Top view', viewReset: 'Reset view', radiation: 'Radiation layer',
    mapShort: 'Shortest path', mapLow: 'Low-radiation path', walking: 'walking',
    canvasShortAria: 'Shortest-path 3D map', canvasLowAria: 'Low-radiation 3D map',
    heatLegendAria: 'Shortwave radiation legend', shortwave: 'Shortwave radiation', covered: 'Covered', open: 'Uncovered',
    gridTemp: 'Grid apparent temperature', playbackAria: 'Replay controls',
    dayControls: 'Daylight and pedestrian replay', sunrise: 'Sunrise', sunset: 'Sunset',
    play: 'Play', pause: 'Pause', playAria: 'Play', pauseAria: 'Pause', replay: 'Replay',
    timelineAria: 'Simulation time', speedAria: 'Playback speed', resultsAria: 'Simulation results',
    individual: 'Individual route comparison', routeDefault: 'Pedestrian route',
    backExample: 'Back to example', backFirst: 'Back to route 1',
    cumulative: 'Cumulative shortwave radiation', shortRow: 'Shortest path', lowRow: 'Low-radiation path', changeRow: 'Change',
    topTen: 'Ten routes with the largest route change',
    topTenNote: 'Ranked by the geometric deviation between the shortest and low-radiation routes, prioritising different OD pairs and filling with next-best pedestrians when fewer than ten routes change. Only the current route is drawn; click a row to jump to that pedestrian\'s departure.',
    daily: 'Full-day simulation results', crowdLabel: 'Hypothetical 10,000 pedestrians per day',
    meanSolar: 'Mean shortwave radiation', meanTime: 'Mean walking time',
    legendPed: 'Simulated pedestrian', legendSlow: 'Congestion slowdown',
    loading: 'Building 3D scene…',
    ready: 'All three stations use the same day, weather grid and 10,000-person daily scenario. Departures start at 09:00; shadows are illustrative.',
    presentationStatus: 'Presentation: only the current route is shown (white = shortest path, violet = low-radiation path), only these 10 pedestrians are kept; 0.5× playback with auto-advance.',
    error: '3D scene unavailable. Refresh the page or check browser graphics acceleration.',
    replaySource: 'Full-day simulation · 5 s steps',
    routeRow: 'Route {n}', pedRow: 'Pedestrian {id} · departs {time}', deviationRow: '{n} m deviation',
    exposureSaved: '{n} kJ/m²', exposureSavedTitle: 'Reduction in cumulative heat exposure',
    routeTitle: 'Route {n} · pedestrian {id}', pedTitle: 'Pedestrian {id}',
    captionRoute: 'Two routes differ by {n} m on average · same station and destination',
    captionFocus: 'Example pedestrian · both routes share the destination',
    captionOther: 'Same station and destination; exits may differ',
    routeLength: 'Route length', walkTime: 'Walking time', metres: 'm', seconds: 's',
    titleSuffix: ' walking heat exposure',
  },
  zh: {
    date: '2025 年 7 月 17 日', dateNote: '日出至日落 · 香港时间',
    presentation: '展示模式', presentationExit: '退出展示模式', stationsAria: '车站',
    infoSummary: '模型说明', infoTitle: '关于这张地图',
    infoP1: '地图颜色是模型估计的太阳短波辐射强度，不是实测街道温度。天气来自 ERA5-Seamless 逐小时网格；模型假定有盖路段的辐射透过率为 20%，无遮盖为 100%。有盖并非零暴露；非路网区域未评估。',
    infoP2: '每日 10,000 人于 09:00–19:00 出发，为未校准的高人流假设情景，非实测客流。行人、出行需求和拥挤过程均为模拟。两情景比较同一批人的出行，路径先计算后回放，站内行程未计入。建筑轮廓来自 OSM；高度含楼层估算与缺省值，建筑并未用于计算真实日影。路网与行人显示在示意地面，不代表实际高程。',
    infoP3: '按住地图拖动可旋转，滚轮可缩放。两幅视角同步。',
    linkWeather: '天气数据 ↗', linkNetwork: '行人路网 ↗', linkBuildings: '建筑数据 ↗', langButton: 'EN',
    mapWorkspaceAria: '路线地图对照', mapControlsAria: '地图控制',
    view3d: '三维', viewTop: '俯视', viewReset: '重置视角', radiation: '辐射图层',
    mapShort: '最短路径', mapLow: '低辐射路径', walking: '人在路上',
    canvasShortAria: '最短路径三维地图', canvasLowAria: '低辐射三维地图',
    heatLegendAria: '短波辐射强度图例', shortwave: '短波辐射', covered: '有盖', open: '无遮盖',
    gridTemp: '网格体感温度', playbackAria: '回放控制',
    dayControls: '日照与行人回放', sunrise: '日出', sunset: '日落',
    play: '播放', pause: '暂停', playAria: '开始播放', pauseAria: '暂停播放', replay: '重播',
    timelineAria: '仿真时间', speedAria: '播放速度', resultsAria: '仿真结果',
    individual: '个体路线对比', routeDefault: '行人路径',
    backExample: '返回示例', backFirst: '回到第 1 位',
    cumulative: '全程累计短波辐射', shortRow: '最短路径', lowRow: '低辐射路径', changeRow: '变化',
    topTen: '路径改变最大的 10 条路线',
    topTenNote: '按基准与优化两条路线的几何偏离排序，优先覆盖不同 OD；不足 10 条时以次优行人补足。地图一次只显示当前路线，红色数字为该路线全程热暴露减少量；点击行可跳到该行人的出发时刻。',
    daily: '全天模拟结果', crowdLabel: '每日 10,000 人的假设客流',
    meanSolar: '人均短波辐射', meanTime: '人均步行耗时',
    legendPed: '模拟行人', legendSlow: '拥挤减速',
    loading: '正在加载三维场景…',
    ready: '三站采用同一天、同一气象网格与每日万人情景。09:00 开始出发，阴影为建筑模型示意。',
    presentationStatus: '展示模式：每次只显示当前路线（白=最短路径，紫=低辐射路径），只保留这 10 位行人；0.5× 回放，自动连播。',
    error: '三维场景加载失败，请刷新页面或检查浏览器的图形加速设置。',
    replaySource: '全天仿真 · 5 秒步长',
    routeRow: '路线 {n}', pedRow: '行人 {id} · {time} 出发', deviationRow: '偏离 {n} 米',
    exposureSaved: '{n} kJ/m²', exposureSavedTitle: '全程热暴露减少量',
    routeTitle: '路线 {n} · 行人 {id}', pedTitle: '行人 {id}',
    captionRoute: '两条路线几何偏离 {n} 米 · 同一站点与目的地',
    captionFocus: '示例行人 · 两条路线的目的地相同',
    captionOther: '同一站点和目的地，出口可能不同',
    routeLength: '路线长度', walkTime: '步行耗时', metres: '米', seconds: '秒',
    titleSuffix: '步行热暴露',
  },
};
function L(key, vars) {
  let text = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.split('{' + name + '}').join(String(value));
  return text;
}
function setStatus(key) { statusKey = key; const el = $('#loadStatus'); if (el) el.textContent = L(key); }
function updatePresentationButton() { const toggle = $('#presentationToggle'); if (toggle) toggle.textContent = presentation ? L('presentationExit') : L('presentation'); }
function applyStaticLanguage() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = L(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', L(el.dataset.i18nAria)));
  const toggle = $('#langToggle'); if (toggle) toggle.textContent = L('langButton');
}
function updateStationLabels() {
  const name = stationNames[lang][station];
  $('#pageTitle').textContent = name + L('titleSuffix');
  document.title = name + L('titleSuffix');
  document.querySelectorAll('[data-station]').forEach(link => { link.textContent = stationNames[lang][link.dataset.station]; link.setAttribute('aria-current', link.dataset.station === station ? 'page' : 'false'); });
}
function dailyMeanHTML() {
  const ma = crowd.metrics_full_day_seed11.baseline, mb = crowd.metrics_full_day_seed11.optimised;
  const change = (after, before) => { const percent = 100 * (after / before - 1); return `${percent < 0 ? '−' : '+'}${Math.abs(percent).toFixed(1)}%`; };
  return `<div><dt>${L('meanSolar')}</dt><dd>${change(mb.mean_solar_kj_m2, ma.mean_solar_kj_m2)}</dd></div>`
    + `<div><dt>${L('meanTime')}</dt><dd>${change(mb.mean_travel_time_s, ma.mean_travel_time_s)}</dd></div>`;
}

function buildWorld(data, heights){
  const group = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2600,2600),new THREE.MeshLambertMaterial({color:'#24272b'}));
  ground.receiveShadow = true;
  ground.rotation.x=-Math.PI/2; ground.position.y=-0.5; group.add(ground);
  const coords=[], colors=[];
  for(let i=0;i<data.buildings.length;i++){
    const poly=data.buildings[i]; if(poly.length<3) continue;
    const vertices=poly.map(p=>new THREE.Vector2(p[0],p[1]));
    if(vertices.length>1 && vertices[0].distanceToSquared(vertices[vertices.length-1])<0.001)vertices.pop();
    if(vertices.length<3) continue;
    let h=Number(heights.data[i][1]); if(!Number.isFinite(h)||h<=0)h=18;
    const faces=THREE.ShapeUtils.triangulateShape(vertices,[]);
    const put=(p,y,c)=>{coords.push(p.x,y,-p.y);colors.push(...c)};
    const roof=[0.078,0.083,0.091], wall=[0.045,0.049,0.055];
    for(const tri of faces)for(const k of tri)put(vertices[k],h,roof);
    for(let j=0;j<vertices.length;j++){
      const a=vertices[j],b=vertices[(j+1)%vertices.length];
      put(a,0,wall);put(b,0,wall);put(b,h,wall);put(a,0,wall);put(b,h,wall);put(a,h,wall);
    }
  }
  const bg=new THREE.BufferGeometry();bg.setAttribute('position',new THREE.Float32BufferAttribute(coords,3));bg.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));bg.computeVertexNormals();
  const buildings = new THREE.Mesh(bg, new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));
  buildings.castShadow = true;
  buildings.receiveShadow = true;
  group.add(buildings);
  const roadPositions=[],roadColors=[],high=new THREE.Color('#df9b68'),low=new THREE.Color('#68b5b1');
  for(const r of data.roads){
    const dx=r[2]-r[0],dz=-(r[3]-r[1]),length=Math.hypot(dx,dz);if(!length)continue;
    const nx=-dz/length*2.4,nz=dx/length*2.4, ax=r[0],az=-r[1],bx=r[2],bz=-r[3];
    const vertices=[[ax+nx,az+nz],[ax-nx,az-nz],[bx+nx,bz+nz],[bx+nx,bz+nz],[ax-nx,az-nz],[bx-nx,bz-nz]];
    const c=r[4]?low:high;for(const v of vertices){roadPositions.push(v[0],2,v[1]);roadColors.push(c.r,c.g,c.b)}
  }
  const rg=new THREE.BufferGeometry();rg.setAttribute('position',new THREE.Float32BufferAttribute(roadPositions,3));rg.setAttribute('color',new THREE.Float32BufferAttribute(roadColors,3));
  const roadLayer=new THREE.Mesh(rg,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,transparent:true,opacity:.88,depthTest:true}));roadLayer.name='solarRoads';roadLayer.renderOrder=5;group.add(roadLayer);
  const stationRadius = 500;
  const outline = new THREE.Group();
  outline.name = 'stationRange';
  for (const [width, color, order] of [[9, '#252b30', 20], [4, '#eef0eb', 21]]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(stationRadius - width / 2, stationRadius + width / 2, 192),
      new THREE.MeshBasicMaterial({
        color, side: THREE.DoubleSide, transparent: true, depthTest: false, depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1.4;
    ring.renderOrder = order;
    outline.add(ring);
  }
  group.add(outline);
  const station = new THREE.Group();
  let cylinder=new THREE.Mesh(new THREE.CylinderGeometry(15,15,3,32),new THREE.MeshLambertMaterial({color:'#d37a5e'}));cylinder.position.y=3;station.add(cylinder);
  let post=new THREE.Mesh(new THREE.CylinderGeometry(2,2,24,10),new THREE.MeshLambertMaterial({color:'#d37a5e'}));post.position.y=15;station.add(post);
  let ball=new THREE.Mesh(new THREE.SphereGeometry(7,12,8),new THREE.MeshLambertMaterial({color:'#f3e4cf'}));ball.position.y=30;station.add(ball); group.add(station);
  return group;
}

function makeView(canvas, key, world, interactive){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1,1.5));renderer.setClearColor('#24272b');
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#24272b');
  const fill = new THREE.HemisphereLight('#dfe9f4','#59606a',1.12);
  scene.add(fill);
  const light=new THREE.DirectionalLight('#e6e7e7',1.25);light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  Object.assign(light.shadow.camera, {left:-820,right:820,top:820,bottom:-820,near:5,far:3600});
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.normalBias = 1.7;
  scene.add(light);
  scene.add(world.clone());
  const camera=new THREE.PerspectiveCamera(42,1,1,7000);camera.position.copy(cameraPosition);camera.lookAt(0,0,0);
  let controls=null;
  if(interactive){controls=new OrbitControls(camera,canvas);controls.enablePan=false;controls.enableDamping=false;controls.minDistance=450;controls.maxDistance=3200;controls.maxPolarAngle=Math.PI/2.08;controls.update()}
  const replay = buildReplay(crowd, key);
  const maxAgents = replay.limit;
  const dots=new THREE.InstancedMesh(new THREE.SphereGeometry(10,12,8),new THREE.MeshLambertMaterial({color:'#ffffff',depthTest:false}),maxAgents);dots.count=0;dots.renderOrder=10;scene.add(dots);
  const view={canvas,renderer,scene,camera,controls,dots,key,replay,fill,light,ids:[]};
  if(controls)controls.addEventListener('change',()=>{
    if(syncing)return;syncing=true;
    for(const other of views)if(other!==view){other.camera.position.copy(camera.position);other.controls.target.copy(controls.target);other.controls.update()}
    syncing=false;
  });
  return view;
}
function resizeView(v){const rect=v.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;let w=Math.round(rect.width),h=Math.round(rect.height);v.renderer.setSize(w,h,false);v.camera.aspect=w/h;v.camera.updateProjectionMatrix()}
function updateAgents(v){
  let list=v.replay.positions(seconds);
  if(presentation&&presentationIds.size)list=list.filter(person=>presentationIds.has(person[0]));
  const matrix=new THREE.Matrix4();v.ids=[];
  for(let i=0;i<list.length;i++){
    const a=list[i],scale=selected===a[0]?1.6:1;
    matrix.compose(new THREE.Vector3(a[1],8,-a[2]),new THREE.Quaternion(),new THREE.Vector3(scale,scale,scale));
    v.dots.setMatrixAt(i,matrix);v.dots.setColorAt(i,selected===a[0]?markers.selected:(a[3]?markers.slow:markers.normal));v.ids.push(a[0]);
  }
  v.dots.count=list.length;v.dots.instanceMatrix.needsUpdate=true;if(v.dots.instanceColor)v.dots.instanceColor.needsUpdate=true;v.dots.computeBoundingSphere();
}
let lastLightMinute = -1;
function updateLighting() {
  const minute = Math.floor(seconds / 60);
  if (minute === lastLightMinute) return;
  lastLightMinute = minute;
  const [east, up, south] = sunAt(seconds);
  const strength = Math.max(0, up);
  const warm = new THREE.Color('#ffd09d').lerp(new THREE.Color('#f4f5ff'), Math.min(1, strength * 2));
  const hour = weather[Math.floor(seconds / 3600)];
  for (const view of views) {
    view.light.position.set(east * 1350, Math.max(up, .025) * 1350, south * 1350);
    view.light.intensity = .25 + strength * 1.3;
    view.light.color.copy(warm);
    view.fill.intensity = .82 + strength * .44;
    view.scene.background.set('#20242a').lerp(new THREE.Color('#353a40'), strength);
    view.scene.getObjectByName('solarRoads').material.opacity = .18 + .7 * Math.min(1, hour.radiation / 850);
    view.renderer.shadowMap.needsUpdate = true;
  }
  $('#coveredRadiation').textContent = Math.round(hour.radiation * .2);
  $('#openRadiation').textContent = Math.round(hour.radiation);
  $('#apparentTemperature').textContent = hour.apparent.toFixed(1) + '°C';
}
function updateUI() {
  timeline.value = Math.floor(seconds);
  timeline.setAttribute('aria-valuetext', timeLabel(seconds));
  $('#currentTime').textContent = timeLabel(seconds, true);
  $('#replaySource').textContent = L('replaySource');
  play.textContent = playing ? L('pause') : L('play');
  play.setAttribute('aria-label', playing ? L('pauseAria') : L('playAria'));
  views.forEach(updateAgents);
  $('#baseCount').textContent = views[0].dots.count;
  $('#optCount').textContent = views[1].dots.count;
  updateLighting();
}
function tick(now) {
  if (playing) {
    if (!last) last = now;
    if (now - last >= 60) {
      seconds = Math.min(sunset, seconds + (now - last) * speed * .24);
      last = now;
      if (seconds === sunset) playing = false;
      updateUI();
      if (presentation && playing && presentationSequence.length) {
        const item = presentationSequence[presentationIndex];
        if (seconds >= item.departure + item.duration + 5) focusPresentation(presentationIndex + 1);
      }
    }
  } else last = 0;
  for (const view of views) view.renderer.render(view.scene, view.camera);
  requestAnimationFrame(tick);
}
function setView(top){syncing=true;for(const v of views){v.camera.position.copy(top?new THREE.Vector3(0,1700,0.01):cameraPosition);v.controls.target.set(0,0,0);v.controls.update()}syncing=false;$('#viewAngle').classList.toggle('active',!top);$('#viewTop').classList.toggle('active',top);$('#viewAngle').setAttribute('aria-pressed',String(!top));$('#viewTop').setAttribute('aria-pressed',String(top))}
function pathMesh(path,width,color,order,opacity=1){
  const coords=[];for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=-(b[1]-a[1]),len=Math.hypot(dx,dz);if(!len)continue;const nx=-dz/len*width/2,nz=dx/len*width/2,az=-a[1],bz=-b[1];for(const p of [[a[0]+nx,az+nz],[a[0]-nx,az-nz],[b[0]+nx,bz+nz],[b[0]+nx,bz+nz],[a[0]-nx,az-nz],[b[0]-nx,bz-nz]])coords.push(p[0],5,p[1])}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(coords,3));const material=new THREE.MeshBasicMaterial({color,depthTest:false,side:THREE.DoubleSide});if(opacity<1){material.transparent=true;material.opacity=opacity}const mesh=new THREE.Mesh(geometry,material);mesh.renderOrder=order;return mesh;
}
function updateSelected(){
  const idx=crowd.agent_od_index[selected], a=crowd.agent_metrics.baseline, b=crowd.agent_metrics.optimised;
  const reduction=(1-b.solar_kj_m2[selected]/a.solar_kj_m2[selected])*100;
  document.querySelectorAll('#routeRanking button').forEach(button => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.agent) === selected));
  });
  const routeIndex=presentation?presentationTop.findIndex(entry=>entry.id===selected):-1;
  const presentationItem=routeIndex>=0?presentationTop[routeIndex]:null;
  $('#selectedTitle').textContent=presentationItem?L('routeTitle',{n:routeIndex+1,id:selected}):L('pedTitle',{id:selected});
  if(presentationItem){
    $('#selectedCaption').textContent=L('captionRoute',{n:presentationItem.deviation.toFixed(1)});
  }else{
    $('#selectedCaption').textContent=selected===crowd.focus_agent.agent_id?L('captionFocus'):L('captionOther');
  }
  $('#focusReset').textContent=presentation?L('backFirst'):L('backExample');
  $('#selectedBase').textContent=a.solar_kj_m2[selected].toFixed(1);$('#selectedOpt').textContent=b.solar_kj_m2[selected].toFixed(1);$('#selectedChange').textContent=(reduction>=0?'−':'+')+Math.abs(reduction).toFixed(1)+'%';
  $('#selectedChange').classList.toggle('increase', reduction < 0);
  $('#selectionInfo').innerHTML = `<div><dt>${L('routeLength')}</dt><dd>${Math.round(a.length_m[selected])} → ${Math.round(b.length_m[selected])} ${L('metres')}</dd></div>
    <div><dt>${L('walkTime')}</dt><dd>${Math.round(a.travel_time_s[selected])} → ${Math.round(b.travel_time_s[selected])} ${L('seconds')}</dd></div>`;
  for(const v of views){const prior=v.scene.getObjectByName('focusPath');if(prior){v.scene.remove(prior);for(const m of prior.children){m.geometry.dispose();m.material.dispose()}}
    const path=crowd.od_paths[v.key][idx], route=new THREE.Group();route.name='focusPath';route.add(pathMesh(path,17,'#0b1420',11));route.add(pathMesh(path,8,v.key==='baseline'?'#fff8de':'#bda8ff',12));v.scene.add(route);
  }
}
function bindSelection(view){let down;view.canvas.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY]});view.canvas.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const r=view.canvas.getBoundingClientRect();const pointer=new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);const ray=new THREE.Raycaster();ray.setFromCamera(pointer,view.camera);const hit=ray.intersectObject(view.dots);if(hit.length){selected=view.ids[hit[0].instanceId];updateSelected();updateUI()}})}


play.addEventListener('click',()=>{if (!views.length) return; if (!playing && seconds >= sunset) seconds = sunrise; playing=!playing;last=0;updateUI()});
$('#restart').addEventListener('click',()=>{if (!views.length) return; if(presentation){focusPresentation(0);return} seconds=sunrise;playing=true;last=0;updateUI()});
timeline.addEventListener('input',()=>{if (!views.length) return; seconds=Number(timeline.value);playing=false;last=0;updateUI()});
function setSpeed(value) {
  speed = value;
  last = 0;
  document.querySelectorAll('.speed-button').forEach(button => {
    const active = Number(button.dataset.speed) === speed;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
document.querySelectorAll('.speed-button').forEach(button => {
  button.addEventListener('click', () => setSpeed(Number(button.dataset.speed)));
});

// 路径改变量化：一条路线每段中点量到另一条路线折线的最短距离，按段长加权后双向平均（米）。
function midDistance(mid, path) {
  let best = Infinity;
  for (let index = 1; index < path.length; index++) {
    const start = path[index - 1], end = path[index];
    const dx = end[0] - start[0], dy = end[1] - start[1], lengthSq = dx * dx + dy * dy;
    let t = lengthSq ? ((mid[0] - start[0]) * dx + (mid[1] - start[1]) * dy) / lengthSq : 0;
    t = Math.max(0, Math.min(1, t));
    const distance = Math.hypot(mid[0] - (start[0] + t * dx), mid[1] - (start[1] + t * dy));
    if (distance < best) best = distance;
  }
  return best;
}
function oneWayDeviation(a, b) {
  let total = 0, weight = 0;
  for (let index = 1; index < a.length; index++) {
    const length = Math.hypot(a[index][0] - a[index - 1][0], a[index][1] - a[index - 1][1]);
    if (!length) continue;
    const mid = [(a[index][0] + a[index - 1][0]) / 2, (a[index][1] + a[index - 1][1]) / 2];
    total += length * midDistance(mid, b);
    weight += length;
  }
  return weight ? total / weight : 0;
}
function routeDeviation(a, b) {
  return (oneWayDeviation(a, b) + oneWayDeviation(b, a)) / 2;
}
// 同一 OD 的行人路径完全相同：优先覆盖不同 OD（每个 OD 取辐射下降最大者），
// 改变路径的 OD 不足 10 条时，用同一批 OD 的次优行人补足到 10 个人。
function buildPresentation() {
  const deviations = crowd.od_paths.baseline.map((points, index) => routeDeviation(points, crowd.od_paths.optimised[index]));
  const baselines = crowd.agent_metrics.baseline, optimised = crowd.agent_metrics.optimised;
  const reduction = id => baselines.solar_kj_m2[id] - optimised.solar_kj_m2[id];
  const routeOf = crowd.agent_od_index;
  const agentsByRoute = new Map();
  for (let id = 0; id < routeOf.length; id++) {
    const route = routeOf[id];
    if (!(deviations[route] > 1)) continue;
    if (!agentsByRoute.has(route)) agentsByRoute.set(route, []);
    agentsByRoute.get(route).push(id);
  }
  for (const ids of agentsByRoute.values()) ids.sort((a, b) => reduction(b) - reduction(a));
  const order = [...agentsByRoute.keys()].sort((a, b) => deviations[b] - deviations[a]);
  const picks = [];
  const describe = (id, route, deviation) => ({
    id, route, deviation, departure: crowd.frame_start + crowd.agent_departure_s[id],
    duration: Math.max(baselines.travel_time_s[id], optimised.travel_time_s[id])
  });
  for (const route of order) {
    if (picks.length >= 10) break;
    picks.push(describe(agentsByRoute.get(route)[0], route, deviations[route]));
  }
  for (let round = 1; picks.length < 10; round++) {
    let added = false;
    for (const route of order) {
      const ids = agentsByRoute.get(route);
      if (ids.length > round) {
        picks.push(describe(ids[round], route, deviations[route]));
        added = true;
      }
      if (picks.length >= 10) break;
    }
    if (!added) break;
  }
  return picks;
}

function focusPresentation(index) {
  if (!presentationSequence.length) return;
  presentationIndex = (index + presentationSequence.length) % presentationSequence.length;
  const item = presentationSequence[presentationIndex];
  selected = item.id;
  seconds = item.departure;
  playing = true;
  last = 0;
  updateSelected();
  updateUI();
}
function renderRanking() {
  const ranking = $('#routeRanking');
  if (!ranking) return;
  ranking.innerHTML = '';
  presentationTop.forEach(({ id, deviation }, index) => {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.agent = id;
    const departure = timeLabel(crowd.frame_start + crowd.agent_departure_s[id], true);
    const baselineSolar = crowd.agent_metrics.baseline.solar_kj_m2[id];
    const optimisedSolar = crowd.agent_metrics.optimised.solar_kj_m2[id];
    const saved = baselineSolar - optimisedSolar;
    const savedText = L('exposureSaved', { n: (saved < 0 ? '+' : '−') + Math.abs(saved).toFixed(1) });
    button.innerHTML = `<span>${L('routeRow', { n: index + 1 })}<small>${L('pedRow', { id, time: departure })}</small></span><span class="route-metrics"><strong>${L('deviationRow', { n: Math.round(deviation) })}</strong><em title="${L('exposureSavedTitle')}">${savedText}</em></span>`;
    button.addEventListener('click', () => {
      focusPresentation(presentationSequence.findIndex(item => item.id === id));
    });
    row.append(button);
    ranking.append(row);
  });
}
function setupPresentation() {
  presentationTop = buildPresentation();
  presentationIds = new Set(presentationTop.map(item => item.id));
  presentationSequence = [...presentationTop];  // 自动连播按右侧排名顺序
  const toggle = $('#presentationToggle');
  toggle.disabled = false;
  renderRanking();
  updatePresentationButton();
  toggle.addEventListener('click', () => {
    presentation = !presentation;
    toggle.setAttribute('aria-pressed', String(presentation));
    updatePresentationButton();
    $('#presentationPanel').hidden = !presentation;
    document.body.classList.toggle('presentation', presentation);
    if (presentation) {
      previousSpeed = speed;
      setSpeed(.5);
      setStatus('presentationStatus');
      focusPresentation(0);
    } else {
      setSpeed(previousSpeed || 1);
      setStatus('ready');
      updateSelected();
      updateUI();
    }
  });
}
$('#heatToggle').addEventListener('click',()=>{const button=$('#heatToggle');const enabled=button.getAttribute('aria-pressed')!=='true';for(const v of views)v.scene.getObjectByName('solarRoads').visible=enabled;button.setAttribute('aria-pressed',String(enabled));button.classList.toggle('active',enabled)});
$('#focusReset').addEventListener('click',()=>{if(presentation){focusPresentation(0)}else{selected=crowd.focus_agent.agent_id;updateSelected();updateUI()}});
$('#viewAngle').addEventListener('click',()=>setView(false));$('#viewTop').addEventListener('click',()=>setView(true));$('#viewReset').addEventListener('click',()=>setView(false));
window.addEventListener('resize',()=>{for(const v of [...views,heroView])if(v)resizeView(v)});
const requestedStation = new URLSearchParams(location.search).get('station');
const station = Object.hasOwn(stationNames.en, requestedStation) ? requestedStation : 'MOK';
applyStaticLanguage();
updateStationLabels();
setStatus('loading');
$('#langToggle').addEventListener('click', () => {
  lang = lang === 'en' ? 'zh' : 'en';
  localStorage.setItem('mtr-lang', lang);
  applyStaticLanguage();
  updateStationLabels();
  updatePresentationButton();
  if (crowd) {
    renderRanking();
    updateSelected();
    updateUI();
    $('#dailyMean').innerHTML = dailyMeanHTML();
    $('#crowdLabel').textContent = L('crowdLabel');
    setStatus(statusKey);
  }
});
async function readReplay() {
  const response = await fetch('data/' + station + '/replay.json.gz');
  if (!response.ok) throw Error('replay read failed');
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
}
Promise.all([fetch('data/' + station + '/geometry.json').then(r=>r.json()),readReplay(),fetch('data/day-weather.json').then(r=>r.json())]).then(([d,c,w])=>{
  data=d;heightData={data:d.heights};crowd=c;weather=w;selected=c.focus_agent.agent_id;
  timeline.min = sunrise;
  timeline.max = sunset;
  $('#sunrise').textContent = timeLabel(sunrise);
  $('#sunset').textContent = timeLabel(sunset);
  document.querySelectorAll('[data-time]').forEach(button => button.addEventListener('click', () => {
    seconds = { sunrise, sample: 14 * 3600, sunset }[button.dataset.time];
    playing = false; last = 0; updateUI();
  }));
  const world=buildWorld(d,heightData);views=[makeView($('#baselineMap'),'baseline',world,true),makeView($('#optimizedMap'),'optimised',world,true)];
  timeline.min = sunrise;
  timeline.max = sunset;
  $('#sunrise').textContent = timeLabel(sunrise);
  $('#sunset').textContent = timeLabel(sunset);
  document.querySelectorAll('[data-time]').forEach(button => button.addEventListener('click', () => {
    seconds = { sunrise, sample: 14 * 3600, sunset }[button.dataset.time];
    playing = false;
    last = 0;
    updateUI();
  }));
  for(const v of views)resizeView(v);views.forEach(bindSelection);updateSelected();updateUI();
  $('#dailyMean').innerHTML = dailyMeanHTML();
  $('#crowdLabel').textContent = L('crowdLabel');
  setupPresentation();
  setStatus('ready');
  requestAnimationFrame(tick);
}).catch(err=>{setStatus('error');play.disabled=true;console.error('3D scene unavailable',err)});




