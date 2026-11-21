# Borehole Chlorination Monitoring System

Pump operators send a daily report from **KoboCollect**. **GitHub Actions** pulls the reports from the KoboToolbox API twice a day, then cleans and checks them. A static **dashboard on GitHub Pages** then shows chlorine use, FRC compliance, dosing, reporting and tablet stock for every borehole.

```
 KoboCollect (operator, offline OK)
        │  daily submission per borehole
        ▼
 KoboToolbox server ──API v2──►  GitHub Actions (06:17 & 18:17 WAT, or on demand)
                                   pipeline/build_data.py
                                   • strips personal fields   • de-duplicates (latest wins)
                                   • calculates volume, chlorine g, dose   • QA flags
                                        │ commits docs/data/*  (history of every update)
                                        ▼
                                 GitHub Pages dashboard  ──►  https://musabasha.github.io/ILC_Dashboard/
                                        │
                                        └─ daily_records.csv ──► Excel / Power BI (Power Query "From Web")
```

No server, database or paid hosting is needed. The pipeline uses only the Python standard library, and the dashboard is plain HTML/JS with no external libraries.

---

## What's in the repository

| Path | Purpose |
|---|---|
| `kobo/daily_chlorination_log.xlsx` | XLSForm – upload to KoboToolbox (validated with pyxform / ODK Validate) |
| `data/boreholes.csv` | **Borehole register** – the only file you normally edit (IDs, flow rate, design dose, population) |
| `pipeline/config.json` | Tablet products, FRC targets, alert thresholds |
| `pipeline/build_data.py` | Pulls Kobo data → `docs/data/dashboard_data.json`, `daily_records.csv`, `qa_rejected.csv` |
| `docs/` | The dashboard (`index.html`, `app.js`, `style.css`) – this folder is what GitHub Pages publishes |
| `.github/workflows/update-dashboard.yml` | Scheduled refresh + Pages deployment |
| `tools/make_xlsform.py` | Rebuilds the form's borehole choice lists from `data/boreholes.csv` |
| `tools/make_sample.py`, `sample/kobo_sample.json` | Demo data (5 boreholes, 45 days) used until Kobo is connected |

---

## Setup (about 30 minutes)

### 1. Register your boreholes
Edit `data/boreholes.csv`. Use one row per borehole, and follow the common site-ID format `BH-<STATE>-<LGA>-NNNN`.

| Column | Meaning |
|---|---|
| `borehole_id` | Unique ID, must match the Kobo choice exactly |
| `state_code`, `state`, `lga_code`, `lga` | Used for the form's cascading selects and the dashboard filters |
| `population` | People served |
| `pump_flow_m3h` | Measured pump flow. Used to calculate volume when the operator reports pump *hours* instead of meter readings |
| `tablet_product` | `tcca_200`, `hth_300` or `tcca_20` (defined in `pipeline/config.json`) |
| `design_dose_mgl` | Dose from the jar test (demand + target FRC) |

Then rebuild the form so the borehole list matches:
```bash
python tools/make_xlsform.py
```
You can also edit the `choices` sheet of the XLSForm by hand.

### 2. Deploy the form on KoboToolbox
1. Log in to your Kobo server, for example `https://kf.kobotoolbox.org` or `https://eu.kobotoolbox.org`. Use the one your organisation uses.
2. **New → Upload an XLSForm** → choose `kobo/daily_chlorination_log.xlsx` → **Deploy**.
3. Copy the **asset UID** from the project URL: `…/#/forms/`**`aBcD1234xyz`**`/summary`.
4. Get an **API token**: *Account settings → Security → API key*.
   Good practice: create a separate Kobo account with **view-only** access to this one project, and use *its* token. A leaked token then can't change or delete anything.
5. On operators' phones, set the server URL in KoboCollect, download the form, and submit one report per borehole per day.

### 3. Create the GitHub repository
1. Create a new repository and upload all the files in this folder, including the hidden `.github` folder.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Secrets and variables → Actions**:
   - *Secrets* tab → `KOBO_TOKEN` = your API token
   - *Variables* tab → `KOBO_SERVER` = e.g. `https://kf.kobotoolbox.org`, and `KOBO_ASSET_UID` = the form's UID
4. **Actions → "Update data and publish dashboard" → Run workflow.**
   The dashboard appears at `https://musabasha.github.io/ILC_Dashboard/`.

Until the secrets are set, the workflow publishes the sample data and the dashboard shows a "sample data" banner.

---

## Daily form – what operators report

Each report covers: date, borehole (State → LGA → Borehole), whether the borehole was pumped, water meter start/end (or pump hours), whether the chlorinator works, tablet product, **tablets added today**, optional before/after weighing, **tablets in store**, FRC at the tank outlet (required), FRC at a tap and in a household (optional), pH, turbidity, and problems.

The form shows the operator the chlorine added. It also shows a **warning** if tank FRC is below 0.5 mg/L or above 2 mg/L, so they act on the spot.

## Calculations

| Measure | Formula |
|---|---|
| Water pumped (m³) | meter end − meter start, *or* pump hours × register flow rate |
| Chlorine added (g) | tablets added × tablet weight × % available chlorine |
| Actual dose (mg/L) | Σ chlorine g ÷ Σ water m³ over the period. Tablets erode over several days, so dose is only meaningful over a period, not a single day |
| FRC adequate | test ≥ minimum target for that point (tank 0.5 · tap 0.2 · household 0.2 mg/L) |
| Reporting rate | reports received ÷ (boreholes × days) |
| Days of stock | tablets in store ÷ average tablets added per day over the last 28 days |

## Alerts on the dashboard

| Alert | Rule (edit thresholds in `pipeline/config.json`) |
|---|---|
| No report for N days | last report ≥ `late_report_days` (2) days before the period end |
| Chlorinator not working | latest report says so |
| Low tank FRC | < `compliance_target` (95%) of tank tests adequate. Shown as critical below 80% |
| Order tablets | days of stock < `stock_alert_days` (44 = 30-day lead time + 14-day buffer). Shown as critical at 14 days or fewer |
| Dose above/below design | actual dose differs from design by more than `dose_tolerance` (±20%) |

## Data protection – read before going live

* **GitHub Pages sites are public on the internet** unless your organisation has GitHub Enterprise Cloud with private Pages. The pipeline therefore publishes **only borehole-level operational data**. Device IDs, photos, GPS, free-text remarks and "other problem" text are dropped (see `PUBLIC_FIELDS` in `build_data.py`). The form collects no names or phone numbers.
* The register does not hold GPS coordinates on purpose. Exact locations of water points in displacement sites can be sensitive, so check with your protection colleagues before adding them.
* The Kobo token lives only in GitHub *Secrets*. Never put it in a file.
* If this level of openness isn't acceptable, keep the same pipeline but publish to an internal host, for example SharePoint or an Azure Static Web App behind sign-in.

## Use the data in Excel or Power BI
`https://musabasha.github.io/ILC_Dashboard/data/daily_records.csv` always holds the full, cleaned dataset.
In **Excel**: *Data → From Web*. In **Power BI**: *Get data → Web*. Paste the URL and refresh whenever you want.

## Run it locally
```bash
python pipeline/build_data.py --source sample      # or: --source kobo (with the env variables set)
python -m http.server 8000 -d docs                 # then open http://localhost:8000
```

## Maintenance notes
* **New borehole:** add a row to `boreholes.csv`, run `tools/make_xlsform.py`, re-upload the form in Kobo (*Replace form*, then redeploy), and push.
* **Change thresholds or add a tablet product:** edit `pipeline/config.json`. For a new product, also add it to the form's `product` list and to the `tab_weight_g` / `tab_avail_cl` calculations.
* **Corrections:** an operator can resubmit the same day's report. The latest submission replaces the earlier one. Submissions for boreholes that aren't in the register are listed in `docs/data/qa_rejected.csv`.
* GitHub may delay scheduled runs by a few minutes, and pauses schedules in repositories with no activity for 60 days. The workflow's own data commits normally keep it active. Use **Run workflow** for an immediate refresh.
