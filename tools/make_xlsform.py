"""Builds kobo/daily_chlorination_log.xlsx (XLSForm for KoboToolbox / KoboCollect).

Edit the BOREHOLES / LGAS lists below (or edit the 'choices' sheet directly in Excel)
so the form matches data/boreholes.csv. Borehole IDs must be identical in both.
"""
import csv
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

ROOT = Path(__file__).resolve().parents[1]

survey_cols = ["type", "name", "label", "hint", "required", "relevant", "constraint",
               "constraint_message", "calculation", "default", "appearance", "choice_filter"]

S = []


def q(type_, name, label="", **kw):
    row = {"type": type_, "name": name, "label": label}
    row.update(kw)
    S.append(row)


q("start", "start")
q("end", "end")
q("today", "today")

q("begin_group", "grp_site", "Site and day")
q("date", "report_date", "Date of this report", required="yes", default="today()",
  constraint=". <= today() and . >= today() - 7",
  constraint_message="Date cannot be in the future or more than 7 days ago.")
q("select_one state", "state", "State", required="yes")
q("select_one lga", "lga", "LGA", required="yes", choice_filter="state=${state}")
q("select_one borehole", "borehole_id", "Borehole", required="yes", choice_filter="lga=${lga}",
  hint="If the borehole is not listed, contact the WASH IM officer.")
q("select_one role", "reporter_role", "Who is reporting?", required="yes")
q("select_one yesno", "pumped", "Was the borehole pumped today?", required="yes")
q("end_group", "")

q("begin_group", "grp_pump", "Water pumped", relevant="${pumped}='yes'")
q("select_one volmethod", "vol_method", "How do you know how much water was pumped?", required="yes")
q("decimal", "meter_start", "Water meter reading at START of the day (m³)", required="yes",
  relevant="${vol_method}='meter'", constraint=". >= 0")
q("decimal", "meter_end", "Water meter reading at END of the day (m³)", required="yes",
  relevant="${vol_method}='meter'", constraint=". >= ${meter_start} and . - ${meter_start} <= 500",
  constraint_message="End reading must be higher than the start reading (and less than 500 m³ more).")
q("decimal", "pump_hours", "Hours the pump ran today", required="yes",
  relevant="${vol_method}='hours'", constraint=". > 0 and . <= 24",
  hint="Volume will be calculated from the pump flow rate in the borehole register.")
q("calculate", "volume_meter_m3", calculation="if(${vol_method}='meter', ${meter_end} - ${meter_start}, '')")
q("note", "note_volume", "Water pumped today: ${volume_meter_m3} m³", relevant="${vol_method}='meter'")
q("end_group", "")

q("begin_group", "grp_chlor", "Chlorinator and tablets")
q("select_one yesno", "chlorinator_working", "Is the inline chlorinator working?", required="yes")
q("select_one product", "tablet_product", "Which tablets are used?", required="yes")
q("integer", "tablets_added", "Number of tablets ADDED to the chlorinator today", required="yes",
  constraint=". >= 0 and . <= 50", constraint_message="Enter a number between 0 and 50.",
  hint="Enter 0 if no tablets were added today.")
q("select_one yesno", "weighed", "Did you weigh the tablets in the chamber today? (calibration day)")
q("decimal", "weight_before", "Weight of tablets in chamber BEFORE pumping (g)", required="yes",
  relevant="${weighed}='yes'", constraint=". > 0")
q("decimal", "weight_after", "Weight of tablets in chamber AFTER pumping (g)", required="yes",
  relevant="${weighed}='yes'", constraint=". >= 0 and . <= ${weight_before}",
  constraint_message="After-weight cannot be more than before-weight.")
q("integer", "stock_tablets", "Tablets remaining in store (count them)", required="yes",
  constraint=". >= 0 and . <= 5000")
q("calculate", "tab_weight_g",
  calculation="if(${tablet_product}='tcca_200', 200, if(${tablet_product}='hth_300', 300, if(${tablet_product}='tcca_20', 20, 0)))")
q("calculate", "tab_avail_cl",
  calculation="if(${tablet_product}='tcca_200', 0.9, if(${tablet_product}='hth_300', 0.7, if(${tablet_product}='tcca_20', 0.9, 0)))")
q("calculate", "chlorine_added_g", calculation="${tablets_added} * ${tab_weight_g} * ${tab_avail_cl}")
q("note", "note_chlorine", "Chlorine added today: ${chlorine_added_g} g")
q("end_group", "")

q("begin_group", "grp_frc", "Chlorine test (DPD)", relevant="${pumped}='yes'")
q("decimal", "frc_tank", "Free residual chlorine at TANK OUTLET (mg/L)", required="yes",
  constraint=". >= 0 and . <= 5", constraint_message="FRC must be between 0 and 5 mg/L.",
  hint="Take the sample at least 30 minutes after chlorination.")
q("note", "note_frc_low",
  "⚠️ FRC is below 0.5 mg/L. Check the chlorinator and tablets now and inform the WASH officer.",
  relevant="${frc_tank} != '' and ${frc_tank} < 0.5")
q("note", "note_frc_high",
  "⚠️ FRC is above 2 mg/L. Reduce flow through the chlorinator and re-test.",
  relevant="${frc_tank} != '' and ${frc_tank} > 2")
q("decimal", "frc_tap", "FRC at a TAP STAND (mg/L) – if tested", constraint=". >= 0 and . <= 5")
q("text", "tap_id", "Tap stand ID", relevant="${frc_tap} != ''")
q("decimal", "frc_hh", "FRC in a HOUSEHOLD container (mg/L) – if tested", constraint=". >= 0 and . <= 5")
q("decimal", "ph", "pH – if tested", constraint=". >= 4 and . <= 10")
q("decimal", "turbidity", "Turbidity (NTU) – if tested", constraint=". >= 0 and . <= 1000")
q("end_group", "")

q("begin_group", "grp_issues", "Problems")
q("select_multiple issue", "issues", "Any problems today?", required="yes",
  constraint="not(selected(., 'none') and count-selected(.) > 1)",
  constraint_message="'No problems' cannot be combined with other answers.")
q("text", "issue_other", "Describe the other problem", required="yes", relevant="selected(${issues}, 'other')")
q("text", "remarks", "Remarks", appearance="multiline")
q("image", "photo", "Photo of the chlorinator or DPD reading (optional)")
q("end_group", "")

# ---------------- choices ----------------
boreholes = list(csv.DictReader(open(ROOT / "data" / "boreholes.csv", encoding="utf-8")))
states = {}
lgas = {}
for b in boreholes:
    states[b["state_code"]] = b["state"]
    lgas[b["lga_code"]] = (b["lga"], b["state_code"])

C = []  # list_name, name, label, state, lga
for code, lab in states.items():
    C.append(("state", code, lab, "", ""))
for code, (lab, st) in lgas.items():
    C.append(("lga", code, lab, st, ""))
for b in boreholes:
    C.append(("borehole", b["borehole_id"], f'{b["borehole_name"]} ({b["borehole_id"]})', b["state_code"], b["lga_code"]))
C += [
    ("role", "operator", "Pump / chlorinator operator", "", ""),
    ("role", "wash_officer", "WASH officer", "", ""),
    ("role", "hygiene_promoter", "Hygiene promoter", "", ""),
    ("yesno", "yes", "Yes", "", ""),
    ("yesno", "no", "No", "", ""),
    ("volmethod", "meter", "Water meter", "", ""),
    ("volmethod", "hours", "Pump running hours (no meter)", "", ""),
    ("product", "tcca_200", "TCCA 90% – 200 g tablet", "", ""),
    ("product", "hth_300", "Calcium hypochlorite 70% – 300 g tablet", "", ""),
    ("product", "tcca_20", "TCCA 90% – 20 g tablet", "", ""),
    ("issue", "none", "No problems", "", ""),
    ("issue", "no_tablets", "No tablets / stock-out", "", ""),
    ("issue", "chlorinator_blocked", "Chlorinator blocked or damaged", "", ""),
    ("issue", "pump_breakdown", "Pump or generator breakdown", "", ""),
    ("issue", "leak", "Leak in tank or pipes", "", ""),
    ("issue", "taste_complaint", "Community complaints about chlorine taste", "", ""),
    ("issue", "no_dpd", "No DPD tablets / tester", "", ""),
    ("issue", "other", "Other", "", ""),
]

wb = Workbook()
ws = wb.active
ws.title = "survey"
ws.append(survey_cols)
for r in S:
    ws.append([r.get(c, "") for c in survey_cols])
wc = wb.create_sheet("choices")
wc.append(["list_name", "name", "label", "state", "lga"])
for r in C:
    wc.append(list(r))
wt = wb.create_sheet("settings")
wt.append(["form_title", "form_id", "version", "instance_name"])
wt.append(["Daily Borehole Chlorination Log", "daily_chlorination_log", "2026112101",
           "concat(${borehole_id}, ' – ', ${report_date})"])
for sh in wb.worksheets:
    for c in sh[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F4E79")
    for col in sh.columns:
        sh.column_dimensions[col[0].column_letter].width = 22
ws.column_dimensions["C"].width = 55
ws.column_dimensions["I"].width = 60
out = ROOT / "kobo" / "daily_chlorination_log.xlsx"
wb.save(out)
print("wrote", out)
