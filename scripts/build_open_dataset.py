"""Build the committed Tamil Nadu EMU/MEMU extract from datameet/railways (CC0).

Source: https://github.com/datameet/railways  (CC0, snapshot ~2016)
Input:  data/open/{stations,trains,schedules}.json  (download with curl, see docs)
Output: backend/app/data/datameet_tn.json

Run days are NOT in this dataset (assumed daily by the app and labelled so).
Offsets are minutes from origin departure and already span midnight.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "open"
OUT = ROOT / "backend" / "app" / "data" / "datameet_tn.json"


def _load(name: str):
    return json.loads((SRC / name).read_text())


def minutes(hms: str | None) -> int | None:
    if not hms or hms == "None":
        return None
    h, m, *_ = hms.split(":")
    return int(h) * 60 + int(m)


def kind_of(name: str, typ: str) -> str:
    n = name.upper()
    if "MRTS" in n:
        return "MRTS"
    if "MEMU" in n or typ == "MEMU":
        return "MEMU"
    return "EMU"


def main() -> None:
    stations = {f["properties"]["code"]: f for f in _load("stations.json")["features"]}
    trains = _load("trains.json")["features"]
    rows: dict[str, list[dict]] = defaultdict(list)
    for r in _load("schedules.json"):
        rows[r["train_number"]].append(r)
    tn = {c for c, f in stations.items() if f["properties"].get("state") == "Tamil Nadu"}

    out_trains, used = [], set()
    for f in trains:
        p, n = f["properties"], f["properties"]["number"]
        nm = p["name"].upper()
        if not (any(k in nm for k in ("EMU", "MEMU", "MRTS")) or p["type"] in ("MEMU", "EMU")):
            continue
        sched = sorted(rows.get(n, []), key=lambda r: r["id"])
        if len(sched) < 2 or not any(r["station_code"] in tn for r in sched):
            continue
        origin = minutes(sched[0]["departure"])
        if origin is None:
            continue
        stops = []
        for i, r in enumerate(sched):
            day = (r.get("day") or 1) - 1
            arr, dep = minutes(r["arrival"]), minutes(r["departure"])
            arr_o = None if arr is None or i == 0 else day * 1440 + arr - origin
            dep_o = None if dep is None or i == len(sched) - 1 else day * 1440 + dep - origin
            if arr_o is not None and dep_o is None and i != len(sched) - 1:
                dep_o = arr_o
            stops.append({"code": r["station_code"], "arr": arr_o, "dep": dep_o})
            used.add(r["station_code"])
        out_trains.append(
            {
                "number": n,
                "name": p["name"],
                "kind": kind_of(p["name"], p["type"]),
                "origin_dep_min": origin,
                "stops": stops,
            }
        )

    out_stations = []
    for c in sorted(used):
        f = stations.get(c)
        pr = f["properties"] if f else {}
        geo = (f or {}).get("geometry")
        lng, lat = geo["coordinates"] if geo else (None, None)
        out_stations.append(
            {
                "code": c,
                "name": (pr.get("name") or c).title(),
                "lat": lat,
                "lng": lng,
                "zone": pr.get("zone"),
                "in_tn": c in tn,
            }
        )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "source": "datameet/railways (CC0, ~2016)",
                "stations": out_stations,
                "trains": out_trains,
            },
            separators=(",", ":"),
            ensure_ascii=False,
        )
    )
    print(
        f"{len(out_trains)} trains, {len(out_stations)} stations -> {OUT} "
        f"({OUT.stat().st_size // 1024} KiB)"
    )


if __name__ == "__main__":
    main()
