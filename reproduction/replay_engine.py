from pathlib import Path
import time
import numpy as np
import abm_simulation as sim
BETA=2.; STEP=5; START=0; END=37000
def execute(graph,nodes,paths,scenario,indices,depart,weather,ox,oy,capture=True):
    pe,pl,pq,ec=sim.compile_paths(graph,nodes,paths[scenario]);coords=nodes[['x','y']].to_numpy(); n=len(indices)
    segment=np.zeros(n,dtype=np.int32);progress=np.zeros(n);arrivals=np.full(n,np.nan);solar=np.zeros(n);ambient=np.zeros(n);frames=[]
    hour_solar=weather.shortwave_radiation.to_numpy();hour_at=weather.apparent_temperature.to_numpy(); elapsed_start=time.monotonic()
    max_end=int(depart.max()+24*3600)
    for t in range(0,max_end+STEP,STEP):
        active=np.flatnonzero((depart<=t)&np.isnan(arrivals))
        if not len(active):
            if t>depart.max(): break
            if capture and START<=t<=END: frames.append([])
            continue
        occupancy=np.zeros(len(ec),dtype=np.int32)
        for a in active:occupancy[pe[indices[a]][segment[a]]]+=1
        if capture and START<=t<=END:
            position=[]
            for a in active:
                i=indices[a];j=segment[a];e=pe[i][j];length=pl[i][j];route=paths[scenario][i]
                frac=progress[a]/length; p=coords[route[j]]*(1-frac)+coords[route[j+1]]*frac
                slow=int(1/(1+BETA*max(0,occupancy[e]-1)/max(length,5.))<.95)
                position.append([int(a),round(float(p[0]-ox),1),round(float(p[1]-oy),1),slow])
            frames.append(position)
        for a in active:
            i=indices[a];remaining=float(STEP);elapsed=0.
            while remaining>1e-9 and segment[a]<len(pe[i]):
                j=segment[a];e=pe[i][j];length=pl[i][j]
                density=max(0,occupancy[e]-(1 if elapsed==0 else 0))/max(length,5.)
                velocity=sim.SPEED/(1+BETA*density)
                used=min(remaining,(length-progress[a])/velocity)
                hour=min(int((9*3600+t+elapsed)//3600),23)
                solar[a]+=hour_solar[hour]*used*pq[i][j]/1000
                ambient[a]+=max(hour_at[hour]-32,0)*used/60
                progress[a]+=used*velocity;remaining-=used;elapsed+=used
                if progress[a]>=length-1e-8:
                    segment[a]+=1;progress[a]=0.
                    if segment[a]==len(pe[i]):arrivals[a]=t+elapsed
                else:break
        if np.isfinite(arrivals).all(): break
    assert np.isfinite(arrivals).all(),f'{scenario}: {np.sum(~np.isfinite(arrivals))} unfinished after 24h drain'
    
    lengths=np.array([sum(pl[i]) for i in indices]); travel=arrivals-depart
    result={'mean_travel_time_s':float(travel.mean()),'mean_solar_kj_m2':float(solar.mean()),'mean_ambient_degree_min':float(ambient.mean()),'mean_length_m':float(lengths.mean()),'completed':int(np.isfinite(arrivals).sum()),'n':n,'max_arrival_s_since_0900':float(arrivals.max()),'mean_active_in_window':float(np.mean([len(f) for f in frames])) if capture else None,'max_active_in_window':max(map(len,frames)) if capture else None,'runtime_s':round(time.monotonic()-elapsed_start,2)}
    return frames,result,arrivals,solar,ambient,lengths

