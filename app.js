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
  $('#replaySource').textContent = '全天仿真 · 5 秒步长';
  play.textContent = playing ? '暂停' : '播放';
  play.setAttribute('aria-label', playing ? '暂停播放' : '开始播放');
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
// 展示模式：把路径改变最大的 10 条路线常显在两张地图上，选中一条高亮。
function renderPresentationPaths(){
  for(const view of views){
    const prior=view.scene.getObjectByName('presentationPaths');
    if(prior){view.scene.remove(prior);for(const mesh of prior.children){mesh.geometry.dispose();mesh.material.dispose()}}
    if(!presentation||!presentationTop.length)continue;
    const layer=new THREE.Group();layer.name='presentationPaths';
    const color=view.key==='baseline'?'#fff8de':'#bda8ff';
    // 先铺深色描边再铺彩色线，10 条路线互相叠加时仍然可读。
    for(const item of presentationTop)layer.add(pathMesh(crowd.od_paths[view.key][item.route],12,'#0b1420',8,.45));
    for(const item of presentationTop){
      const active = item.id === selected;
      layer.add(pathMesh(crowd.od_paths[view.key][item.route], active ? 9 : 7, color, active ? 10 : 9, active ? .98 : .8));
    }
    view.scene.add(layer);
  }
}
function updateSelected(){
  const idx=crowd.agent_od_index[selected], a=crowd.agent_metrics.baseline, b=crowd.agent_metrics.optimised;
  const reduction=(1-b.solar_kj_m2[selected]/a.solar_kj_m2[selected])*100;
  document.querySelectorAll('#routeRanking button').forEach(button => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.agent) === selected));
  });
  const routeIndex=presentation?presentationTop.findIndex(entry=>entry.id===selected):-1;
  const presentationItem=routeIndex>=0?presentationTop[routeIndex]:null;
  $('#selectedTitle').textContent=presentationItem?('路线 '+(routeIndex+1)+' · 行人 '+selected):('行人 '+selected);
  if(presentationItem){
    $('#selectedCaption').textContent='两条路线几何偏离 '+presentationItem.deviation.toFixed(1)+' 米 · 同一站点与目的地';
  }else{
    $('#selectedCaption').textContent=selected===crowd.focus_agent.agent_id?'示例行人 · 两条路线的目的地相同':'同一站点和目的地，出口可能不同';
  }
  $('#selectedBase').textContent=a.solar_kj_m2[selected].toFixed(1);$('#selectedOpt').textContent=b.solar_kj_m2[selected].toFixed(1);$('#selectedChange').textContent=(reduction>=0?'−':'+')+Math.abs(reduction).toFixed(1)+'%';
  $('#selectedChange').classList.toggle('increase', reduction < 0);
  $('#selectionInfo').innerHTML = `<div><dt>路线长度</dt><dd>${Math.round(a.length_m[selected])} → ${Math.round(b.length_m[selected])} 米</dd></div>
    <div><dt>步行耗时</dt><dd>${Math.round(a.travel_time_s[selected])} → ${Math.round(b.travel_time_s[selected])} 秒</dd></div>`;
  for(const v of views){const prior=v.scene.getObjectByName('focusPath');if(prior){v.scene.remove(prior);for(const m of prior.children){m.geometry.dispose();m.material.dispose()}}
    const path=crowd.od_paths[v.key][idx], route=new THREE.Group();route.name='focusPath';route.add(pathMesh(path,17,'#0b1420',11));route.add(pathMesh(path,8,v.key==='baseline'?'#fff8de':'#bda8ff',12));v.scene.add(route);
  }
  renderPresentationPaths();
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
function setupPresentation() {
  presentationTop = buildPresentation();
  presentationIds = new Set(presentationTop.map(item => item.id));
  presentationSequence = [...presentationTop];  // 自动连播按右侧排名顺序
  const ranking = $('#routeRanking');
  presentationTop.forEach(({ id, deviation }, index) => {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.agent = id;
    const departure = timeLabel(crowd.frame_start + crowd.agent_departure_s[id], true);
    button.innerHTML = `<span>路线 ${index + 1}<small>行人 ${id} · ${departure} 出发</small></span><strong>偏离 ${Math.round(deviation)} 米</strong>`;
    button.addEventListener('click', () => {
      focusPresentation(presentationSequence.findIndex(item => item.id === id));
    });
    row.append(button);
    ranking.append(row);
  });
  const toggle = $('#presentationToggle');
  toggle.disabled = false;
  toggle.addEventListener('click', () => {
    presentation = !presentation;
    toggle.setAttribute('aria-pressed', String(presentation));
    toggle.textContent = presentation ? '退出展示模式' : '展示模式';
    $('#presentationPanel').hidden = !presentation;
    document.body.classList.toggle('presentation', presentation);
    $('#focusReset').textContent = presentation ? '回到第 1 位' : '返回示例';
    if (presentation) {
      previousSpeed = speed;
      setSpeed(.1);
      $('#loadStatus').textContent = '展示模式：地图常显路径改变最大的 10 条路线（白=最短路径，紫=低辐射路径），只保留对应行人；0.1× 慢速回放，自动连播。';
      focusPresentation(0);
    } else {
      setSpeed(previousSpeed || 1);
      $('#loadStatus').textContent = '三站采用同一天、同一气象网格与每日万人情景。09:00 开始出发，阴影为建筑模型示意。';
      updateSelected();
      updateUI();
    }
  });
}
$('#heatToggle').addEventListener('click',()=>{const button=$('#heatToggle');const enabled=button.getAttribute('aria-pressed')!=='true';for(const v of views)v.scene.getObjectByName('solarRoads').visible=enabled;button.setAttribute('aria-pressed',String(enabled));button.classList.toggle('active',enabled)});
$('#focusReset').addEventListener('click',()=>{if(presentation){focusPresentation(0)}else{selected=crowd.focus_agent.agent_id;updateSelected();updateUI()}});
$('#viewAngle').addEventListener('click',()=>setView(false));$('#viewTop').addEventListener('click',()=>setView(true));$('#viewReset').addEventListener('click',()=>setView(false));
window.addEventListener('resize',()=>{for(const v of [...views,heroView])if(v)resizeView(v)});
const stationNames = {MOK:'旺角', ADM:'金钟', HKU:'港大'};
const requestedStation = new URLSearchParams(location.search).get('station');
const station = Object.hasOwn(stationNames, requestedStation) ? requestedStation : 'MOK';
document.querySelector('h1').textContent = stationNames[station] + '步行热暴露';
document.title = stationNames[station] + '步行热暴露';
document.querySelectorAll('[data-station]').forEach(link => link.setAttribute('aria-current', link.dataset.station === station ? 'page' : 'false'));
async function readReplay() {
  const response = await fetch('data/' + station + '/replay.json.gz');
  if (!response.ok) throw Error('轨迹读取失败');
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
  const ma=crowd.metrics_full_day_seed11.baseline,mb=crowd.metrics_full_day_seed11.optimised;
  const change = (after, before) => {
    const percent = 100 * (after / before - 1);
    return `${percent < 0 ? '−' : '+'}${Math.abs(percent).toFixed(1)}%`;
  };
  $('#dailyMean').innerHTML = `<div><dt>人均短波辐射</dt><dd>${change(mb.mean_solar_kj_m2, ma.mean_solar_kj_m2)}</dd></div>
    <div><dt>人均步行耗时</dt><dd>${change(mb.mean_travel_time_s, ma.mean_travel_time_s)}</dd></div>`;
  $('#crowdLabel').textContent='每日 10,000 人的假设客流';$('#loadStatus').textContent='三站采用同一天、同一气象网格与每日万人情景。09:00 开始出发，阴影为建筑模型示意。';
  setupPresentation();
  requestAnimationFrame(tick);
}).catch(err=>{$('#loadStatus').textContent='三维场景加载失败，请刷新页面或检查浏览器的图形加速设置。';play.disabled=true;console.error('3D scene unavailable',err)});




