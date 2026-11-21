#!/usr/bin/env python3
"""Pull Daily Borehole Chlorination Log submissions from KoboToolbox and build the
static data files the dashboard reads (docs/data/*.json, *.csv).

Usage:
  python pipeline/build_data.py --source kobo     # needs KOBO_SERVER, KOBO_ASSET_UID, KOBO_TOKEN
  python pipeline/build_data.py --source sample   # uses sample/kobo_sample.json (demo)

Standard library only – no pip install needed.
"""
import argparse
import csv
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "data"

# Fields published to the (public) dashboard. Anything not listed here is dropped:
# device IDs, photos, GPS, free-text remarks (unless publish_free_text is true).
PUBLIC_FIELDS = [
    "date", "borehole_id", "pumped", "vol_method", "volume_m3", "pump_hours",
    "chlorinator_working", "tablet_product", "tablets_added", "chlorine_g",
    "stock_tablets", "frc_tank", "frc_tap", "frc_hh", "ph", "turbidity",
    "issues", "weighed", "weight_eroded_g", "reporter_role", "kobo_id", "flags",
]
FREE_TEXT = ["issue_other", "remarks"]


def log(*a):
    print(*a, file=sys.stderr)


# ---------------------------------------------------------------- fetch
def fetch_kobo():
    server = os.environ.get("KOBO_SERVER", "https://kf.kobotoolbox.org").rstrip("/")
    uid = os.environ.get("KOBO_ASSET_UID")
    token = os.environ.get("KOBO_TOKEN")
    if not uid or not token:
        sys.exit("KOBO_ASSET_UID and KOBO_TOKEN must be set for --source kobo")
    url = f"{server}/api/v2/assets/{uid}/data/?format=json&limit=1000"
    results = []
    while url:
        req = urllib.request.Request(url, headers={"Authorization": f"Token {token}",
                                                   "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            page = json.load(r)
        results.extend(page.get("results", []))
        url = page.get("next")
        log(f"fetched {len(results)} / {page.get('count')}")
    return results


def fetch_sample():
    with open(ROOT / "sample" / "kobo_sample.json", encoding="utf-8") as f:
        return json.load(f)["results"]


# ---------------------------------------------------------------- transform
def flat(sub):
    """Strip Kobo group paths: 'grp_chlor/tablets_added' -> 'tablets_added'."""
    out = {}
    for k, v in sub.items():
        out[k if k.startswith("_") else k.split("/")[-1]] = v
    return out


def num(v):
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def clean(sub, reg, cfg):
    s = flat(sub)
    flags = []
    bh = s.get("borehole_id")
    date = (s.get("report_date") or "")[:10]
    if not bh or not date:
        return None, "missing borehole or date"
    if bh not in reg:
        return None, f"borehole {bh} not in data/boreholes.csv"
    b = reg[bh]
    pumped = s.get("pumped") == "yes"
    method = s.get("vol_method") if pumped else None
    hours = num(s.get("pump_hours"))
    vol = 0.0 if not pumped else None
    if method == "meter":
        a, z = num(s.get("meter_start")), num(s.get("meter_end"))
        if a is not None and z is not None:
            vol = z - a
            if vol < 0:
                flags.append("negative_volume")
                vol = None
    elif method == "hours" and hours is not None:
        flow = num(b.get("pump_flow_m3h"))
        vol = hours * flow if flow else None
        if vol is None:
            flags.append("no_flow_rate_in_register")
    if pumped and vol is not None:
        flow = num(b.get("pump_flow_m3h"))
        if flow and vol > flow * 24 * 1.1:
            flags.append("volume_above_pump_capacity")

    product = s.get("tablet_product") or b.get("tablet_product")
    p = cfg["products"].get(product)
    tabs = num(s.get("tablets_added"))
    chlorine = tabs * p["weight_g"] * p["avail_cl"] if (p and tabs is not None) else None
    if not p:
        flags.append("unknown_product")

    frc_tank = num(s.get("frc_tank"))
    if pumped and frc_tank is None:
        flags.append("frc_missing")
    wb, wa = num(s.get("weight_before")), num(s.get("weight_after"))
    issues = (s.get("issues") or "").split()

    rec = {
        "date": date,
        "borehole_id": bh,
        "pumped": pumped,
        "vol_method": method,
        "volume_m3": round(vol, 2) if vol is not None else None,
        "pump_hours": hours,
        "chlorinator_working": s.get("chlorinator_working") == "yes",
        "tablet_product": product,
        "tablets_added": int(tabs) if tabs is not None else None,
        "chlorine_g": round(chlorine, 1) if chlorine is not None else None,
        "stock_tablets": int(num(s.get("stock_tablets"))) if num(s.get("stock_tablets")) is not None else None,
        "frc_tank": frc_tank,
        "frc_tap": num(s.get("frc_tap")),
        "frc_hh": num(s.get("frc_hh")),
        "ph": num(s.get("ph")),
        "turbidity": num(s.get("turbidity")),
        "issues": [i for i in issues if i != "none"],
        "weighed": s.get("weighed") == "yes",
        "weight_eroded_g": (wb - wa) if (wb is not None and wa is not None) else None,
        "reporter_role": s.get("reporter_role"),
        "kobo_id": s.get("_id"),
        "flags": flags,
        "_submitted": s.get("_submission_time") or s.get("end") or "",
    }
    if cfg.get("publish_free_text"):
        for k in FREE_TEXT:
            rec[k] = s.get(k)
    return rec, None


def build(results, source):
    cfg = json.load(open(ROOT / "pipeline" / "config.json", encoding="utf-8"))
    reg_rows = list(csv.DictReader(open(ROOT / "data" / "boreholes.csv", encoding="utf-8")))
    reg = {r["borehole_id"]: r for r in reg_rows}

    rejected, recs = [], []
    for sub in results:
        rec, why = clean(sub, reg, cfg)
        if rec is None:
            rejected.append({"kobo_id": sub.get("_id"), "reason": why})
        else:
            recs.append(rec)

    # One report per borehole per day: keep the most recent submission.
    recs.sort(key=lambda r: r["_submitted"])
    latest, dups = {}, 0
    for r in recs:
        key = (r["borehole_id"], r["date"])
        if key in latest:
            dups += 1
            r["flags"].append("replaced_earlier_submission")
        latest[key] = r
    final = sorted(latest.values(), key=lambda r: (r["date"], r["borehole_id"]))
    fields = PUBLIC_FIELDS + (FREE_TEXT if cfg.get("publish_free_text") else [])
    final = [{k: r.get(k) for k in fields} for r in final]

    OUT.mkdir(parents=True, exist_ok=True)
    boreholes = [{
        "borehole_id": r["borehole_id"], "borehole_name": r["borehole_name"],
        "state": r["state"], "lga": r["lga"], "community": r["community"],
        "population": int(num(r["population"]) or 0),
        "pump_flow_m3h": num(r["pump_flow_m3h"]),
        "tablet_product": r["tablet_product"],
        "design_dose_mgl": num(r["design_dose_mgl"]),
        "status": r["status"],
    } for r in reg_rows]
    dates = [r["date"] for r in final]
    meta = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": source,
        "submissions_received": len(results),
        "records_published": len(final),
        "duplicates_replaced": dups,
        "submissions_rejected": len(rejected),
        "date_min": min(dates) if dates else None,
        "date_max": max(dates) if dates else None,
        "config": cfg,
    }
    json.dump({"meta": meta, "boreholes": boreholes, "records": final},
              open(OUT / "dashboard_data.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    with open(OUT / "daily_records.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in final:
            row = dict(r)
            row["issues"] = " ".join(r["issues"])
            row["flags"] = " ".join(r["flags"])
            w.writerow(row)
    with open(OUT / "qa_rejected.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["kobo_id", "reason"])
        w.writeheader()
        w.writerows(rejected)
    log(json.dumps({k: v for k, v in meta.items() if k != "config"}, indent=1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["kobo", "sample"], default="kobo")
    a = ap.parse_args()
    data = fetch_kobo() if a.source == "kobo" else fetch_sample()
    build(data, a.source)
