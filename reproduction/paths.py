"""Locate the project data directories when the replay scripts run from this bundle.

The replay scripts were originally exported next to a Codex preview copy; this
module lets them find `project/data` whether they are run from the bundle root,
from `web/day-replay`, or from a standalone export folder.
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = None
for candidate in (HERE, *HERE.parents):
    if (candidate / 'data' / 'processed').is_dir():
        ROOT = candidate
        break
    if (candidate / 'project' / 'data' / 'processed').is_dir():
        ROOT = candidate / 'project'
        break
if ROOT is None:
    raise SystemExit('找不到项目数据目录 data/processed，请从项目根目录运行导出脚本。')
PRO = ROOT / 'data' / 'processed'
OUT = ROOT / 'data' / 'results'
RAW = ROOT / 'data' / 'raw'
