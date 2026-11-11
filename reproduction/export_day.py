from pathlib import Path
import gzip, json, sys
import numpy as np
import pandas as pd
import abm_simulation as sim
from replay_engine import execute

station_id = sys.argv[1]
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
sim.DATE = '2025-07-17'
graph, nodes, od, paths = sim.make_graph(station_id)
_, weather = sim.weather_day()
station = pd.read_csv(sim.PRO/'stations.csv').set_index('station_id').loc[station_id]
origin = np.array([station.x, station.y])
coords = nodes[['x','y']].to_numpy()
rng = np.random.default_rng(11)
n = 10000
p = od.simulated_daily_trips.to_numpy(dtype=float)
indices = np.repeat(np.arange(len(od)), rng.multinomial(n, p/p.sum()))
rng.shuffle(indices)
depart = np.sort(rng.integers(0, 7200, size=n) * 5)
rng.shuffle(depart)

results = {}
individual = {}
route_coords = {}
frames = {}
for key in ('baseline', 'optimised'):
    series, stats, arrivals, solar, ambient, lengths = execute(
        graph, nodes, paths, key, indices, depart, weather, *origin)
    frames[key] = series
    individual[key] = {name: np.round(values, 4).tolist() for name, values in {
        'arrival_s': arrivals, 'solar_kj_m2': solar, 'ambient_degree_min': ambient,
        'length_m': lengths, 'travel_time_s': arrivals-depart}.items()}
    results[key] = stats
    route_coords[key] = [np.round(coords[route] - origin, 1).tolist() for route in paths[key]]
    print(station_id, key, len(series), stats['mean_solar_kj_m2'], flush=True)

both = set()
for a, b in zip(frames['baseline'][3600:3721], frames['optimised'][3600:3721]):
    both.update({person[0] for person in a} & {person[0] for person in b})
focus = max(both, key=lambda i: individual['baseline']['solar_kj_m2'][i]-individual['optimised']['solar_kj_m2'][i])
with gzip.open(out/'replay.json.gz', 'wt', compresslevel=3) as file:
    json.dump(dict(frames=frames, od_paths=route_coords, agent_od_index=indices.tolist(),
        agent_departure_s=depart.tolist(), agent_metrics=individual, focus_agent={'agent_id':focus},
        metrics_full_day_seed11=results, frame_start=32400, frame_step=5), file, separators=(',',':'))

roads = {}
for u,v,a in graph.edges(data=True):
    edge = tuple(sorted((u,v)))
    if edge in roads:
        continue
    points = np.round(coords[list(edge)]-origin,1).ravel().tolist()
    roads[edge] = [*points, a['covered']]
polygons = []
heights = []
for b in json.loads((sim.PRO/'osm_buildings.json').read_text()):
    polygon = np.asarray(b['coords'])
    if len(polygon)<3:
        continue
    local = polygon-origin
    if np.abs(local.mean(axis=0)).max() > 690 or np.abs(local).max() > 1100:
        continue
    polygons.append(np.round(local,1).tolist())
    heights.append([b['id'], b['height_m']])
(out/'geometry.json').write_text(json.dumps(dict(roads=list(roads.values()),buildings=polygons,heights=heights), separators=(',',':')))
