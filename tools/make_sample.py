"""Generates sample/kobo_sample.json – synthetic submissions shaped exactly like the
KoboToolbox API v2 /data/ response, so the dashboard can be demonstrated before real
data exists. Scenarios: one well-run site, one 'hours' site with no meter, one
over-dosing site, one chlorinator breakdown, one site running out of tablets.
"""
import json
import random
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
random.seed(42)
END = date(2026, 11, 21)
DAYS = 45
PROD = {"tcca_200": (200, 0.9), "hth_300": (300, 0.7)}

sites = {
    # id: product, flow, hours, actual dose, demand, method, report prob, stock start
    "BH-BO-JER-0001": dict(p="tcca_200", flow=6.0, hrs=12, dose=1.5, dem=0.65, m="meter", rp=0.97, stock=60),
    "BH-BO-JER-0002": dict(p="tcca_200", flow=4.0, hrs=9, dose=1.25, dem=0.55, m="hours", rp=0.93, stock=50),
    "BH-BO-MMC-0001": dict(p="hth_300", flow=4.5, hrs=8, dose=2.2, dem=0.8, m="meter", rp=0.95, stock=45),
    "BH-BO-MMC-0002": dict(p="tcca_200", flow=5.0, hrs=10, dose=1.3, dem=0.6, m="meter", rp=0.92, stock=55),
    "BH-BO-KDG-0001": dict(p="tcca_200", flow=3.5, hrs=8, dose=1.0, dem=0.45, m="meter", rp=0.78, stock=10),
}
results, nid = [], 100000
for bh, c in sites.items():
    wt, ac = PROD[c["p"]]
    acc, stock, meter = 0.0, c["stock"], round(random.uniform(800, 3000), 1)
    for i in range(DAYS):
        d = END - timedelta(days=DAYS - 1 - i)
        broken = bh == "BH-BO-MMC-0002" and date(2026, 11, 10) <= d <= date(2026, 11, 14)
        pump_down = random.random() < 0.03
        hrs = 0 if pump_down else max(2, c["hrs"] + random.uniform(-2, 1.5))
        vol = c["flow"] * hrs
        dose = 0 if broken else c["dose"] * random.uniform(0.85, 1.15)
        acc += vol * dose / ac                         # grams of product eroded
        added = 0
        if not broken and acc >= wt and stock > 0:
            added = min(int(acc // wt), stock)
            acc -= added * wt
        stock -= added
        if bh == "BH-BO-MMC-0001" and d == date(2026, 10, 28):
            stock += 40
        if bh == "BH-BO-JER-0002" and d == date(2026, 11, 3):
            stock += 30
        if bh == "BH-BO-JER-0001" and d == date(2026, 11, 12):
            stock += 30
        m_start, meter = meter, meter + vol
        if random.random() > c["rp"]:
            continue
        frc = max(0.0, round(dose - c["dem"] + random.uniform(-0.15, 0.15), 2)) if hrs else None
        issues = []
        if broken: issues.append("chlorinator_blocked")
        if pump_down: issues.append("pump_breakdown")
        if stock < 5: issues.append("no_tablets")
        if bh == "BH-BO-MMC-0001" and random.random() < 0.15: issues.append("taste_complaint")
        sub = {
            "_id": nid, "_uuid": f"uuid-{nid}", "deviceid": "collect:XXXX",
            "start": f"{d}T07:{random.randint(0,59):02d}:00.000+01:00",
            "end": f"{d}T07:{random.randint(0,59):02d}:30.000+01:00",
            "_submission_time": f"{d}T{random.randint(8,18):02d}:{random.randint(0,59):02d}:00",
            "grp_site/report_date": str(d), "grp_site/state": "BO",
            "grp_site/lga": bh.split("-")[2], "grp_site/borehole_id": bh,
            "grp_site/reporter_role": "operator",
            "grp_site/pumped": "yes" if hrs else "no",
            "grp_chlor/chlorinator_working": "no" if broken else "yes",
            "grp_chlor/tablet_product": c["p"],
            "grp_chlor/tablets_added": str(added),
            "grp_chlor/stock_tablets": str(max(stock, 0)),
            "grp_issues/issues": " ".join(issues) if issues else "none",
            "_attachments": [],
        }
        if hrs:
            sub["grp_pump/vol_method"] = c["m"]
            if c["m"] == "meter":
                sub["grp_pump/meter_start"] = f"{m_start:.1f}"
                sub["grp_pump/meter_end"] = f"{meter:.1f}"
            else:
                sub["grp_pump/pump_hours"] = f"{hrs:.1f}"
            sub["grp_frc/frc_tank"] = str(frc)
            if random.random() < 0.6:
                sub["grp_frc/frc_tap"] = str(max(0, round(frc - random.uniform(0.2, 0.45), 2)))
            if random.random() < 0.35:
                sub["grp_frc/frc_hh"] = str(max(0, round(frc - random.uniform(0.4, 0.75), 2)))
            sub["grp_frc/ph"] = f"{random.uniform(6.9, 7.6):.1f}"
        results.append(sub)
        nid += 1
        if random.random() < 0.03:      # a corrected re-submission later the same day
            dup = dict(sub); dup["_id"] = nid; nid += 1
            dup["_submission_time"] = f"{d}T20:15:00"
            results.append(dup)

# QA demo: one forced duplicate correction and one submission for an unregistered borehole
dup = dict(results[10]); dup["_id"] = nid; dup["_submission_time"] = dup["_submission_time"][:10] + "T21:00:00"
results.append(dup); nid += 1
bad = dict(results[11]); bad["_id"] = nid; bad["grp_site/borehole_id"] = "BH-BO-XXX-9999"; results.append(bad)
json.dump({"count": len(results), "next": None, "previous": None, "results": results},
          open(ROOT / "sample" / "kobo_sample.json", "w"), indent=0)
print(len(results), "sample submissions")
