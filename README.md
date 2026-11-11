# 三站全天三维回放（港大 / 金钟 / 旺角）

这是 `http://127.0.0.1:8769/?station=HKU` 那个站的源码，也是项目里唯一维护的三维网页版本。
页面按 2025-07-17 全天回放 10,000 人假设客流，日照随时间变化，建筑投影用于示意。

## 在线访问

- 站点：https://fengjiawei126.github.io/mtr-heat-walk/?station=HKU （换 `?station=MOK` / `?station=ADM` 切站）
- 仓库：https://github.com/fengjiawei126/mtr-heat-walk —— 本目录就是仓库根，推到 `main` 后 GitHub Pages 会自动重新发布（约 1 分钟）。
- 托管为静态站点，无需服务器；`data/*.gz` 由浏览器端 `DecompressionStream` 解压，换托管平台时需确认 `.gz` 以二进制原样返回。

## 打开

```bash
python3 open_day_replay.py            # 默认港大，也可加站号：python3 open_day_replay.py MOK
# 或者
python3 -m http.server 8770 --directory web/day-replay
```

浏览器访问 `http://127.0.0.1:8770/?station=HKU`（站号可换 `MOK` / `ADM`）。

## 界面与语言

- 界面（页头、侧栏、回放条、按钮）为黑白灰配色；地图画布保留热力与路线颜色。
- 右上角 `中文 / EN` 按钮切换中英文，默认英文，选择会记在浏览器 localStorage。站点标题、面板、按钮、提示、图例标签都会跟着切。

## 展示模式

右上「展示模式」：0.5× 回放；地图常显**路径改变最大的 10 条路线**（白=最短路径，紫=低辐射路径），只保留对应行人；按右侧排名自动连播，也可点编号手动切换。

- 路径改变 = 基准与优化两条路线的几何偏离（每段中点量到另一条折线的最短距离，按段长加权、双向平均，米）。
- 排名优先覆盖不同 OD；改路 OD 不足 10 条时用同一 OD 的次优行人补足（港大 7 条、金钟 12 条、旺角 22 条）。

## 结构

- `index.html / app.js / styles.css / daylight.js`：页面与三维回放（Three.js 在 `vendor/`）。
- `data/{MOK,ADM,HKU}/geometry.json`：路网与建筑；`replay.json.gz`：全天逐 5 秒轨迹与个体指标。
- `data/day-weather.json`：逐小时短波辐射与体感温度。

## 重新导出数据

在项目根目录（需要项目 `requirements.txt` 依赖与已缓存原始数据）：

```bash
python3 web/day-replay/reproduction/export_day.py MOK web/day-replay/data/MOK
python3 web/day-replay/reproduction/export_day.py ADM web/day-replay/data/ADM
python3 web/day-replay/reproduction/export_day.py HKU web/day-replay/data/HKU
python3 web/day-replay/reproduction/export_weather.py
```

`paths.py` 自动定位项目的 `data/processed` 等目录；`abm_simulation.py` 相对项目版增加了 `station_id` 参数，`replay_engine.py` 负责全天帧。
数据与结论仍受原报告口径约束：假设情景、非实测客流。
