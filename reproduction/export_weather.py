"""Export the 24-hour radiation/apparent-temperature series used by the day replay.

Reads the same ERA5-Seamless grid the original analysis used and picks the
hottest 09:00-18:00 apparent-temperature day of 2025, matching abm_simulation.
"""
from pathlib import Path
import json

import pandas as pd

from paths import RAW

DATE = '2025-07-17'
OUT = Path(__file__).resolve().parents[1] / 'data' / 'day-weather.json'

raw = json.loads((RAW / 'era5seamless_22.3_114.2_2021_2025.json').read_text(encoding='utf-8'))
weather = pd.DataFrame(raw['hourly'])
weather['time'] = pd.to_datetime(weather.time)
weather = weather[weather.time.dt.year.eq(2025)].copy()
weather['day'] = weather.time.dt.floor('D')
weather['hour'] = weather.time.dt.hour
day = weather[weather.day.eq(pd.Timestamp(DATE))].set_index('hour').sort_index()
if len(day) != 24 or day[['shortwave_radiation', 'apparent_temperature']].isna().any().any():
    raise SystemExit('weather day is incomplete')
series = [{'radiation': round(float(radiation), 1), 'apparent': round(float(apparent), 1)}
          for radiation, apparent in zip(day.shortwave_radiation, day.apparent_temperature)]
OUT.write_text(json.dumps(series), encoding='utf-8')
print('wrote', OUT, len(series), 'hours')
