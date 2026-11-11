"""Paired pedestrian microsimulation on the LandsD network around Mong Kok.

This is an illustrative scenario, not calibration or observed pedestrian traffic.
Run with Python, numpy, pandas, scipy and networkx from the project root.
"""
from pathlib import Path
import json
import numpy as np
import pandas as pd
import networkx as nx
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree
from pyproj import Transformer

from paths import ROOT, PRO, OUT, RAW
SEEDS=(11,22,33); BETAS=(0.,2.,8.); STEP=5; DAILY=1000; SPEED=1.; Q=.2
DATE=None

def make_graph(station_id):
    edges=pd.read_csv(PRO/'gov_3d_edges.csv.gz').fillna({'name':''})
    edges=edges.sort_values(['length_m','covered'],ascending=[True,False]).drop_duplicates(['u','v','direction']).reset_index(drop=True)
    nodes=pd.concat([edges[['u','x1','y1']].rename(columns={'u':'id','x1':'x','y1':'y'}),edges[['v','x2','y2']].rename(columns={'v':'id','x2':'x','y2':'y'})]).drop_duplicates('id').sort_values('id').reset_index(drop=True)
    ids=nodes.id.to_numpy();edges['ui']=np.searchsorted(ids,edges.u);edges['vi']=np.searchsorted(ids,edges.v)
    f=edges.direction.ge(0).to_numpy(); r=edges.direction.le(0).to_numpy();u=edges.ui.to_numpy();v=edges.vi.to_numpy();length=edges.length_m.to_numpy()
    arcs=pd.DataFrame({'u':np.r_[u[f],v[r]],'v':np.r_[v[f],u[r]],'length':np.r_[length[f],length[r]]}).sort_values('length').drop_duplicates(['u','v'])
    csr=coo_matrix((arcs.length,(arcs.u,arcs.v)),shape=(len(nodes),len(nodes))).tocsr()
    _,lab=connected_components(csr,directed=False);sizes=np.bincount(lab);good=np.flatnonzero(sizes[lab]>=20);tree=cKDTree(nodes.loc[good,['x','y']])
    st=pd.read_csv(PRO/'stations.csv');heavy=st[st.system.ne('Light Rail')];target=st.loc[st.station_id.eq(station_id)].iloc[0]
    entrances=pd.read_csv(PRO/'osm_entrances.csv');tr=Transformer.from_crs(4326,2326,always_xy=True);entrances['x'],entrances['y']=tr.transform(entrances.lon.to_numpy(),entrances.lat.to_numpy())
    _,near=cKDTree(heavy[['x','y']]).query(entrances[['x','y']].to_numpy());entrances['station']=heavy.iloc[near].station_id.to_numpy()
    selected=entrances[(np.hypot(entrances.x-target.x,entrances.y-target.y)<=400)&entrances.station.eq(station_id)]
    roots=[]
    for e in selected.itertuples():
        d,k=tree.query([e.x,e.y])
        if d<=40:roots.append(int(good[k]))
    roots=sorted(set(roots));assert roots
    dist=dijkstra(csr,indices=roots,directed=True,min_only=True,limit=950)
    inside=np.isfinite(dist);sub=edges[inside[edges.ui.to_numpy()]&inside[edges.vi.to_numpy()]]
    graph=nx.DiGraph()
    for e in sub.itertuples():
        attr=dict(length=e.length_m,covered=int(e.covered))
        if e.direction>=0:graph.add_edge(int(e.ui),int(e.vi),**attr)
        if e.direction<=0:graph.add_edge(int(e.vi),int(e.ui),**attr)
    for root in roots:graph.add_node(root)
    od=pd.read_csv(OUT/'simulated_od.csv');od=od[od.station_id.eq(station_id)].copy().reset_index(drop=True)
    od['target']=np.searchsorted(ids,od.origin_node.to_numpy())
    assert np.array_equal(ids[od.target],od.origin_node.to_numpy())
    _,base_paths=nx.multi_source_dijkstra(graph,roots,weight='length')
    selected_paths=[base_paths[int(n)] for n in od.target];baseline=list(selected_paths)
    def metrics(path):
        e=[graph[a][b] for a,b in zip(path[:-1],path[1:])]
        return np.array([sum(x['length'] for x in e),sum(x['length']*(Q if x['covered'] else 1) for x in e)])
    bm=np.array([metrics(p) for p in baseline]);best=bm.copy()
    for lam in [.25,.5,1,2,4,8,16]:
        _,paths=nx.multi_source_dijkstra(graph,roots,weight=lambda u,v,a:a['length']*(1+lam*(Q if a['covered'] else 1)))
        for i,n in enumerate(od.target):
            candidate=paths[int(n)];m=metrics(candidate)
            if m[0]<=1.15*bm[i,0]+1e-7 and m[1]<best[i,1]-1e-7:selected_paths[i]=candidate;best[i]=m
    for actual,col in [(bm[:,0],'baseline_m'),(bm[:,1],'baseline_exposed_m'),(best[:,0],'optimised_m'),(best[:,1],'optimised_exposed_m')]:
        if station_id == 'ADM':
            print('Recomputed ADM', col, 'max historical difference', float(np.max(np.abs(actual-od[col].to_numpy()))), flush=True)
        else:
            assert np.allclose(actual,od[col].to_numpy(),atol=1e-6),f'OD reproduction mismatch: {col}'
    print('Verified original paths and exposures:',len(od),'OD; roots',len(roots),flush=True)
    return graph,nodes,od,{'baseline':baseline,'optimised':selected_paths}

def weather_day():
    raw=json.loads((RAW/'era5seamless_22.3_114.2_2021_2025.json').read_text())
    weather=pd.DataFrame(raw['hourly']);weather['time']=pd.to_datetime(weather.time)
    weather=weather[weather.time.dt.year.eq(2025)].copy();weather['day']=weather.time.dt.floor('D');weather['hour']=weather.time.dt.hour
    hot=weather[weather.hour.between(9,18)].groupby('day').apparent_temperature.mean()
    chosen=pd.Timestamp(DATE) if DATE else hot.idxmax()
    w=weather[weather.day.eq(chosen)].set_index('hour').sort_index()
    if len(w)!=24 or w[['shortwave_radiation','apparent_temperature']].isna().any().any():raise ValueError('Incomplete weather day')
    return chosen,w

def compile_paths(graph,nodes,paths):
    coords=nodes[['x','y']].to_numpy();edge_id={};edge_coords=[];path_edges=[];path_lengths=[];path_q=[]
    for path in paths:
        es=[];ls=[];qs=[]
        for u,v in zip(path[:-1],path[1:]):
            edge=graph[u][v];key=tuple(sorted((u,v)))
            if key not in edge_id:
                edge_id[key]=len(edge_coords);edge_coords.append([int(u),int(v),*coords[u],*coords[v]])
            es.append(edge_id[key]);ls.append(float(edge['length']));qs.append(Q if edge['covered'] else 1.)
        path_edges.append(np.array(es,dtype=int));path_lengths.append(np.array(ls));path_q.append(np.array(qs))
    return path_edges,path_lengths,path_q,np.array(edge_coords)

def run(graph,nodes,od,paths,depart,indices,beta,weather):
    path_edges,path_lengths,path_q,edge_coords=compile_paths(graph,nodes,paths)
    n=len(indices);segment=np.zeros(n,dtype=int);progress=np.zeros(n);arrivals=np.full(n,np.nan);solar=np.zeros(n);ambient=np.zeros(n);edge_person_seconds=np.zeros(len(edge_coords));edge_entries=np.zeros(len(edge_coords),dtype=int)
    max_end=int(depart.max()+7200);hour_solar=weather.shortwave_radiation.to_numpy();hour_at=weather.apparent_temperature.to_numpy()
    for t in range(0,max_end+STEP,STEP):
        active=np.flatnonzero((depart<=t)&np.isnan(arrivals))
        if not len(active):continue
        occupancy=np.zeros(len(edge_coords),dtype=int)
        for a in active:
            i=indices[a];occupancy[path_edges[i][segment[a]]]+=1
        for a in active:
            i=indices[a];remaining=float(STEP);elapsed=0.
            while remaining>1e-9 and segment[a]<len(path_edges[i]):
                j=segment[a];e=path_edges[i][j];length=path_lengths[i][j]
                # Other travelers on the same physical link, sampled at the step start.
                # The 5m denominator floor suppresses artificial divergence on tiny links.
                density=max(0,occupancy[e]-(1 if elapsed==0 else 0))/max(length,5.)
                velocity=SPEED/(1+beta*density)
                used=min(remaining,(length-progress[a])/velocity)
                if progress[a]<1e-10:edge_entries[e]+=1
                hour=min(int((9*3600+t+elapsed)//3600),23)
                solar[a]+=hour_solar[hour]*used*path_q[i][j]/1000
                ambient[a]+=max(hour_at[hour]-32,0)*used/60
                edge_person_seconds[e]+=used;progress[a]+=used*velocity;remaining-=used;elapsed+=used
                if progress[a]>=length-1e-8:
                    segment[a]+=1;progress[a]=0.
                    if segment[a]==len(path_edges[i]):arrivals[a]=t+elapsed
                else:break
        if np.isfinite(arrivals).all():break
    expected=np.array([sum(path_lengths[i]) for i in indices]);travel=arrivals-depart;delay=travel-expected/SPEED
    return dict(arrivals=arrivals,travel=travel,delay=delay,solar=solar,ambient=ambient,length=expected,edge_coords=edge_coords,edge_entries=edge_entries,edge_person_seconds=edge_person_seconds)

def main():
    graph,nodes,od,paths=make_graph();day,weather=weather_day();print('Weather day',day.date(),flush=True)
    agents=[];summaries=[];edge_tables=[]
    for seed in SEEDS:
        rng=np.random.default_rng(seed);indices=np.repeat(np.arange(len(od)),od.simulated_daily_trips.to_numpy(dtype=int));assert len(indices)==DAILY
        rng.shuffle(indices);depart=np.sort(rng.integers(0,10*3600//STEP,size=DAILY)*STEP);rng.shuffle(depart)
        for beta in BETAS:
            for scenario in ('baseline','optimised'):
                result=run(graph,nodes,od,paths[scenario],depart,indices,beta,weather)
                complete=np.isfinite(result['arrivals']);start=np.array([paths[scenario][i][0] for i in indices]);end=np.array([paths[scenario][i][-1] for i in indices])
                df=pd.DataFrame(dict(seed=seed,beta=beta,scenario=scenario,agent_id=np.arange(DAILY),origin_node=od.origin_node.to_numpy()[indices],departure_s=depart,departure_datetime=(day+pd.Timedelta(hours=9)+pd.to_timedelta(depart,unit='s')).astype(str),arrival_s=result['arrivals'],completed=complete,length_m=result['length'],travel_time_s=result['travel'],delay_s=result['delay'],solar_kj_m2=result['solar'],ambient_degree_min=result['ambient'],start_node=nodes.id.to_numpy()[start],end_node=nodes.id.to_numpy()[end]))
                agents.append(df);good=df[df.completed]
                summaries.append(dict(seed=seed,beta=beta,scenario=scenario,agents=DAILY,completed=int(complete.sum()),mean_travel_time_s=good.travel_time_s.mean(),mean_delay_s=good.delay_s.mean(),mean_solar_kj_m2=good.solar_kj_m2.mean(),mean_ambient_degree_min=good.ambient_degree_min.mean()))
                ec=result['edge_coords'];edge_tables.append(pd.DataFrame(dict(seed=seed,beta=beta,scenario=scenario,u=nodes.id.to_numpy()[ec[:,0].astype(int)],v=nodes.id.to_numpy()[ec[:,1].astype(int)],x1=ec[:,2],y1=ec[:,3],x2=ec[:,4],y2=ec[:,5],entries=result['edge_entries'],occupancy_person_seconds=result['edge_person_seconds'])))
                if beta==0:assert np.allclose(good.delay_s,0,atol=1e-7)
                print(seed,beta,scenario,'completed',int(complete.sum()),'solar',round(good.solar_kj_m2.mean(),2),'delay',round(good.delay_s.mean(),2),flush=True)
    agents=pd.concat(agents,ignore_index=True);summaries=pd.DataFrame(summaries);edges=pd.concat(edge_tables,ignore_index=True)
    keys=['seed','beta','agent_id'];a=agents[agents.scenario.eq('baseline')].set_index(keys).sort_index();b=agents[agents.scenario.eq('optimised')].set_index(keys).sort_index()
    assert a.index.equals(b.index) and (a[['origin_node','departure_s']]==b[['origin_node','departure_s']]).all().all()
    assert agents.completed.all(), 'Incomplete trajectories must be treated as censored; no completed-only aggregate should be interpreted as population total.'
    for name,frame in [('abm_agents.csv',agents),('abm_summary.csv',summaries),('abm_edges.csv',edges)]:frame.to_csv(OUT/name,index=False)
    sensitivity=summaries.groupby(['beta','scenario'],as_index=False).agg({'agents':'mean','completed':'sum','mean_travel_time_s':['mean','std'],'mean_delay_s':['mean','std'],'mean_solar_kj_m2':['mean','std'],'mean_ambient_degree_min':['mean','std']})
    sensitivity.columns=['_'.join(filter(None,c)) for c in sensitivity.columns];sensitivity.to_csv(OUT/'abm_sensitivity.csv',index=False)
    meta=dict(station='Mong Kok',weather_date=str(day.date()),temperature_source='ERA5-Seamless apparent temperature at 22.3,114.2',radiation_source='ERA5-Seamless global horizontal shortwave, preceding-hour mean',daily_agents=DAILY,departure_window='09:00–19:00 uniform',step_seconds=STEP,speed_m_s=SPEED,covered_transmission=Q,seeds=list(SEEDS),betas_m_per_person=list(BETAS),congestion='v = 1 / (1 + beta * other_people_on_same_physical_edge / max(edge_length_m,5)); occupancy sampled each time step',limitations=['beta scenarios are not calibrated and no observed pedestrian flow is used','physical-edge density ignores road width and external pedestrians','no explicit pedestrian capacity or FIFO queue; slowdown is continuous','occupancy for newly entered edges is held at the step-start snapshot','same station and destination and departures, but route may select a different station exit; inside-station access is excluded','fixed 2026 network and cover combined with real 2025 daily weather','results are a selected hot-day microsimulation, not an observed or annual total'])
    (OUT/'abm_metadata.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
    print('ABM completed and paired; beta=0 elapsed time equals path length / speed',flush=True)

if __name__=='__main__':main()
