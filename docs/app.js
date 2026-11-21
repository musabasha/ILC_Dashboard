/* Borehole chlorination dashboard – static, no dependencies.
   Reads data/dashboard_data.json produced by pipeline/build_data.py. */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const NS = "http://www.w3.org/2000/svg";
  const fmt0 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
  const fmt1 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmt2 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (v) => (v == null ? "—" : Math.round(v * 100) + "%");
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dLabel = (iso) => `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]}`;
  const dLong = (iso) => `${dLabel(iso)} ${iso.slice(0, 4)}`;
  const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
  const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) ?? 0), 0);
  const cssVar = (n) => getComputedStyle($(".viz-root")).getPropertyValue(n).trim();
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let DATA, CFG, PROD, BH_BY_ID, SLOT = {};
  const state = { lga: "all", bh: "all", preset: 30, from: null, to: null, anchor: null };

  // ------------------------------------------------------------------ tooltip
  const tip = $("#tooltip");
  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  const tRow = (key, label, val) => `<div class="t-row"><span>${key || ""}${esc(label)}</span><b>${val}</b></div>`;
  const keyDot = (color, line) => `<span class="key${line ? " line" : ""}" style="background:${color}"></span> `;

  // ------------------------------------------------------------------ svg helpers
  function el(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function niceStep(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }
  function scaleMax(v) { const st = niceStep((v > 0 ? v : 1) / 4); return Math.ceil((v > 0 ? v : 1) / st - 1e-9) * st; }
  function ticks(max) { const st = niceStep(max / 4); const out = []; for (let t = 0; t <= max + 1e-9; t += st) out.push(+t.toFixed(6)); return out; }
  function tickFmt(v) { return v >= 10000 ? fmt0.format(v / 1000) + "K" : (v % 1 === 0 ? fmt0.format(v) : fmt1.format(v)); }
  function topRoundedBar(x, y, w, h, r = 4) {
    if (h <= 0) return "";
    r = Math.min(r, h, w / 2);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function rightRoundedBar(x, y, w, h, r = 4) {
    if (w <= 0) return "";
    r = Math.min(r, w, h / 2);
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }
  function frame(container, height, m) {
    container.innerHTML = "";
    const W = Math.max(280, container.clientWidth);
    const svg = el("svg", { width: W, height, viewBox: `0 0 ${W} ${height}`, role: "img" });
    container.appendChild(svg);
    return { svg, W, H: height, iw: W - m.l - m.r, ih: height - m.t - m.b, m };
  }
  function yAxis(f, max, fmtFn = tickFmt) {
    const g = el("g", {}, f.svg);
    for (const t of ticks(max)) {
      const y = f.m.t + f.ih - (t / max) * f.ih;
      el("line", { x1: f.m.l, x2: f.m.l + f.iw, y1: y, y2: y, stroke: t === 0 ? cssVar("--axis") : cssVar("--grid"), "stroke-width": 1 }, g);
      const tx = el("text", { x: f.m.l - 8, y: y + 4, "text-anchor": "end", class: "tick" }, g);
      tx.textContent = fmtFn(t);
    }
  }
  function xDateTicks(f, days, xOf) {
    const step = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(f.iw / 70))));
    days.forEach((d, i) => {
      if (i % step !== 0) return;
      const t = el("text", { x: xOf(i), y: f.H - 6, "text-anchor": "middle", class: "tick" }, f.svg);
      t.textContent = dLabel(d);
    });
  }
  function legend(container, items) {
    const div = document.createElement("div");
    div.className = "legend";
    div.innerHTML = items.map((i) => `<span><span class="key${i.line ? " line" : ""}${i.empty ? " empty" : ""}" style="${i.empty ? "" : "background:" + i.color}"></span>${esc(i.label)}</span>`).join("");
    container.prepend(div);
  }

  // ------------------------------------------------------------------ data selection
  function selected() {
    const bhs = DATA.boreholes.filter((b) => (state.lga === "all" || b.lga === state.lga) && (state.bh === "all" || b.borehole_id === state.bh));
    const ids = new Set(bhs.map((b) => b.borehole_id));
    const recs = DATA.records.filter((r) => ids.has(r.borehole_id) && r.date >= state.from && r.date <= state.to);
    const days = [];
    for (let d = state.from; d <= state.to; d = addDays(d, 1)) days.push(d);
    return { bhs, ids, recs, days };
  }

  function boreholeStats(b, recs, days) {
    const mine = recs.filter((r) => r.borehole_id === b.borehole_id);
    const tank = mine.filter((r) => r.frc_tank != null);
    const t = CFG.frc_targets_mgl;
    const adequacy = (arr, key, min) => (arr.length ? arr.filter((r) => r[key] >= min).length / arr.length : null);
    const vol = sum(mine, (r) => r.volume_m3);
    const chl = sum(mine, (r) => r.chlorine_g);
    const tabs = sum(mine, (r) => r.tablets_added);
    // stock & consumption are evaluated at the end of the period, across all records
    const hist = DATA.records.filter((r) => r.borehole_id === b.borehole_id && r.date <= state.to);
    const last = hist[hist.length - 1];
    const lastStock = [...hist].reverse().find((r) => r.stock_tablets != null);
    const winStart = addDays(state.to, -(CFG.stock_window_days - 1));
    const winTabs = sum(hist.filter((r) => r.date >= winStart), (r) => r.tablets_added);
    const perDay = winTabs / CFG.stock_window_days;
    const daysStock = lastStock && perDay > 0 ? lastStock.stock_tablets / perDay : null;
    const dose = vol > 0 ? chl / vol : null;
    const dev = dose != null && b.design_dose_mgl ? (dose - b.design_dose_mgl) / b.design_dose_mgl : null;
    const s = {
      b, mine, reports: mine.length, expected: days.length, vol, chl, tabs, dose, dev,
      tankAdeq: adequacy(tank, "frc_tank", t.tank.min), nTank: tank.length,
      tapAdeq: adequacy(mine.filter((r) => r.frc_tap != null), "frc_tap", t.tap.min),
      hhAdeq: adequacy(mine.filter((r) => r.frc_hh != null), "frc_hh", t.household.min),
      lastDate: last ? last.date : null, last, stock: lastStock ? lastStock.stock_tablets : null, perDay, daysStock,
    };
    // alerts: [level, label]
    const a = [];
    if (!last || daysBetween(last.date, state.to) >= CFG.late_report_days) a.push(["critical", last ? `No report for ${daysBetween(last.date, state.to)} days` : "Never reported"]);
    if (last && last.chlorinator_working === false) a.push(["critical", "Chlorinator not working"]);
    if (s.tankAdeq != null && s.tankAdeq < CFG.compliance_target) a.push([s.tankAdeq < 0.8 ? "critical" : "serious", `Low tank FRC (${pct(s.tankAdeq)} adequate)`]);
    if (daysStock != null && daysStock < CFG.stock_alert_days) a.push([daysStock <= 14 ? "critical" : "warning", `Order tablets (${fmt0.format(daysStock)} days left)`]);
    else if (lastStock && lastStock.stock_tablets === 0) a.push(["critical", "Out of tablets"]);
    if (dev != null && Math.abs(dev) > CFG.dose_tolerance) a.push(["warning", `Dose ${dev > 0 ? "above" : "below"} design (${dev > 0 ? "+" : ""}${Math.round(dev * 100)}%)`]);
    s.alerts = a;
    return s;
  }

  // ------------------------------------------------------------------ KPIs
  function renderKpis(sel, stats) {
    const chl = sum(sel.recs, (r) => r.chlorine_g), vol = sum(sel.recs, (r) => r.volume_m3), tabs = sum(sel.recs, (r) => r.tablets_added);
    const tank = sel.recs.filter((r) => r.frc_tank != null);
    const adeq = tank.length ? tank.filter((r) => r.frc_tank >= CFG.frc_targets_mgl.tank.min).length / tank.length : null;
    const hh = sel.recs.filter((r) => r.frc_hh != null);
    const hhAdeq = hh.length ? hh.filter((r) => r.frc_hh >= CFG.frc_targets_mgl.household.min).length / hh.length : null;
    const rate = sel.bhs.length && sel.days.length ? sel.recs.length / (sel.bhs.length * sel.days.length) : null;
    const withAlerts = stats.filter((s) => s.alerts.length).length;
    const kg = chl / 1000;
    const tiles = [
      { hero: true, label: "Chlorine used", value: (kg >= 10 ? fmt0 : fmt1).format(kg) + " kg", detail: `${fmt0.format(tabs)} tablets · ${sel.days.length} days · ${fmt1.format(kg / Math.max(1, sel.days.length))} kg/day` },
      { label: "Water treated", value: fmt0.format(vol) + " m³", detail: `${fmt0.format(vol / Math.max(1, sel.days.length))} m³/day` },
      { label: "Average dose", value: vol > 0 ? fmt2.format(chl / vol) + " mg/L" : "—", detail: "chlorine added ÷ water pumped" },
      { label: "Tank FRC adequate", value: pct(adeq), detail: `${tank.length} tests ≥ ${CFG.frc_targets_mgl.tank.min} mg/L · target ${pct(CFG.compliance_target)}` },
      { label: "Household FRC adequate", value: pct(hhAdeq), detail: `${hh.length} tests ≥ ${CFG.frc_targets_mgl.household.min} mg/L` },
      { label: "Reporting rate", value: pct(rate), detail: `${sel.recs.length} of ${sel.bhs.length * sel.days.length} borehole-days` },
      { label: "Boreholes with alerts", value: `${withAlerts} of ${sel.bhs.length}`, detail: "see status table" },
    ];
    $("#kpis").innerHTML = tiles.map((t) => `<div class="kpi${t.hero ? " hero" : ""}"><div class="label">${t.label}</div><div class="value">${t.value}</div><div class="detail">${t.detail}</div></div>`).join("");
  }

  // ------------------------------------------------------------------ chart: chlorine use
  function dailyTotals(sel) {
    const by = {};
    for (const d of sel.days) by[d] = { chl: 0, tabs: 0, vol: 0, frc: [], n: 0 };
    for (const r of sel.recs) {
      const o = by[r.date]; if (!o) continue;
      o.chl += r.chlorine_g || 0; o.tabs += r.tablets_added || 0; o.vol += r.volume_m3 || 0; o.n++;
      if (r.frc_tank != null) o.frc.push(r.frc_tank);
    }
    return sel.days.map((d, i) => {
      const o = by[d];
      let s7 = 0; for (let k = Math.max(0, i - 6); k <= i; k++) s7 += by[sel.days[k]].chl;
      return { d, ...o, avg7: i >= 6 ? s7 / 7 : null, frcMean: o.frc.length ? o.frc.reduce((a, b) => a + b, 0) / o.frc.length : null };
    });
  }

  function renderUse(sel, daily) {
    const box = $("#chUse");
    const f = frame(box, 260, { t: 12, r: 12, b: 26, l: 48 });
    f.svg.setAttribute("aria-label", "Daily chlorine added in grams, with 7-day average");
    if (!sel.recs.length) { box.innerHTML = `<div class="empty-msg">No reports in this period.</div>`; return; }
    const max = scaleMax(Math.max(...daily.map((d) => Math.max(d.chl, d.avg7 || 0))));
    yAxis(f, max);
    const band = f.iw / daily.length;
    const bw = Math.max(2, Math.min(24, band - 2));
    const xOf = (i) => f.m.l + band * i + band / 2;
    const yOf = (v) => f.m.t + f.ih - (v / max) * f.ih;
    const c1 = cssVar("--series-1"), c2 = cssVar("--series-2");
    daily.forEach((d, i) => {
      if (d.chl > 0) el("path", { d: topRoundedBar(xOf(i) - bw / 2, yOf(d.chl), bw, f.m.t + f.ih - yOf(d.chl)), fill: c1 }, f.svg);
    });
    let p = "";
    daily.forEach((d, i) => { if (d.avg7 != null) p += (p ? "L" : "M") + xOf(i) + "," + yOf(d.avg7); });
    if (p) el("path", { d: p, fill: "none", stroke: c2, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, f.svg);
    xDateTicks(f, sel.days, xOf);
    // hover layer: crosshair + tooltip
    const cross = el("line", { y1: f.m.t, y2: f.m.t + f.ih, stroke: cssVar("--axis"), "stroke-width": 1, visibility: "hidden" }, f.svg);
    daily.forEach((d, i) => {
      const hit = el("rect", { x: f.m.l + band * i, y: f.m.t, width: band, height: f.ih, fill: "transparent" }, f.svg);
      hit.addEventListener("mousemove", (ev) => {
        cross.setAttribute("x1", xOf(i)); cross.setAttribute("x2", xOf(i)); cross.setAttribute("visibility", "visible");
        showTip(`<div class="t-title">${dLong(d.d)}</div>` +
          tRow(keyDot(c1), "Chlorine added", fmt0.format(d.chl) + " g") +
          tRow(keyDot(c2, true), "7-day average", d.avg7 != null ? fmt0.format(d.avg7) + " g/day" : "—") +
          tRow("", "Tablets added", fmt0.format(d.tabs)) +
          tRow("", "Water pumped", fmt0.format(d.vol) + " m³") +
          tRow("", "Reports", `${d.n} of ${sel.bhs.length}`), ev);
      });
      hit.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
    });
    legend(box, [{ label: "Chlorine added (g)", color: c1 }, { label: "7-day average (g/day)", color: c2, line: true }]);
  }

  // ------------------------------------------------------------------ chart: FRC
  function renderFrc(sel, daily) {
    const box = $("#chFrc");
    const t = CFG.frc_targets_mgl.tank;
    const perBh = sel.bhs.length <= 8;
    $("#frcNote").textContent = `Shaded band = target ${t.min}–${t.max} mg/L after ≥30 min contact. ` + (perBh ? "One line per borehole; gaps are days without a test." : "Daily mean across selected boreholes (more than 8 selected).");
    const f = frame(box, 260, { t: 12, r: 12, b: 26, l: 48 });
    f.svg.setAttribute("aria-label", "Free residual chlorine at tank outlet over time");
    const series = perBh
      ? sel.bhs.map((b) => {
          const m = {}; sel.recs.filter((r) => r.borehole_id === b.borehole_id && r.frc_tank != null).forEach((r) => (m[r.date] = r.frc_tank));
          return { name: b.borehole_name, color: cssVar(`--series-${SLOT[b.borehole_id]}`), vals: sel.days.map((d) => m[d] ?? null) };
        })
      : [{ name: "Mean tank FRC", color: cssVar("--series-1"), vals: daily.map((d) => d.frcMean) }];
    const all = series.flatMap((s) => s.vals).filter((v) => v != null);
    if (!all.length) { box.innerHTML = `<div class="empty-msg">No FRC tests in this period.</div>`; return; }
    const max = scaleMax(Math.max(2, ...all));
    const xOf = (i) => f.m.l + (sel.days.length === 1 ? f.iw / 2 : (f.iw * i) / (sel.days.length - 1));
    const yOf = (v) => f.m.t + f.ih - (v / max) * f.ih;
    el("rect", { x: f.m.l, width: f.iw, y: yOf(t.max), height: yOf(t.min) - yOf(t.max), fill: cssVar("--band") }, f.svg);
    yAxis(f, max, (v) => fmt1.format(v));
    const lbl = el("text", { x: f.m.l + f.iw - 4, y: yOf(t.max) - 4, "text-anchor": "end", class: "tick" }, f.svg);
    lbl.textContent = `Target ${t.min}–${t.max} mg/L`;
    for (const s of series) {
      let p = "", prev = false;
      s.vals.forEach((v, i) => { if (v == null) { prev = false; return; } p += (prev ? "L" : "M") + xOf(i) + "," + yOf(v); prev = true; });
      el("path", { d: p, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, f.svg);
      // isolated points (no neighbour) need a dot to be visible
      s.vals.forEach((v, i) => {
        if (v != null && s.vals[i - 1] == null && s.vals[i + 1] == null)
          el("circle", { cx: xOf(i), cy: yOf(v), r: 4, fill: s.color, stroke: cssVar("--surface-1"), "stroke-width": 2 }, f.svg);
      });
    }
    xDateTicks(f, sel.days, xOf);
    const cross = el("line", { y1: f.m.t, y2: f.m.t + f.ih, stroke: cssVar("--axis"), "stroke-width": 1, visibility: "hidden" }, f.svg);
    const dots = series.map((s) => el("circle", { r: 4, fill: s.color, stroke: cssVar("--surface-1"), "stroke-width": 2, visibility: "hidden" }, f.svg));
    const hit = el("rect", { x: f.m.l, y: f.m.t, width: f.iw, height: f.ih, fill: "transparent" }, f.svg);
    hit.addEventListener("mousemove", (ev) => {
      const bx = f.svg.getBoundingClientRect();
      const px = ev.clientX - bx.left;
      const i = Math.max(0, Math.min(sel.days.length - 1, Math.round(((px - f.m.l) / f.iw) * (sel.days.length - 1))));
      cross.setAttribute("x1", xOf(i)); cross.setAttribute("x2", xOf(i)); cross.setAttribute("visibility", "visible");
      let rows = "";
      series.forEach((s, k) => {
        const v = s.vals[i];
        if (v == null) { dots[k].setAttribute("visibility", "hidden"); }
        else { dots[k].setAttribute("cx", xOf(i)); dots[k].setAttribute("cy", yOf(v)); dots[k].setAttribute("visibility", "visible"); }
        const st = v == null ? "" : v < t.min ? " · below" : v > t.max ? " · above" : " · in target";
        rows += tRow(keyDot(s.color, true), s.name, v == null ? "no test" : fmt2.format(v) + st);
      });
      showTip(`<div class="t-title">${dLong(sel.days[i])}</div>${rows}`, ev);
    });
    hit.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); hideTip(); });
    if (series.length > 1) legend(box, series.map((s) => ({ label: s.name, color: s.color, line: true })));
  }

  // ------------------------------------------------------------------ chart: dose vs design
  function renderDose(stats) {
    const box = $("#chDose");
    const rows = stats.filter((s) => s.dose != null || s.b.design_dose_mgl);
    const rowH = 34;
    const f = frame(box, Math.max(80, rows.length * rowH + 34), { t: 6, r: box.clientWidth < 520 ? 92 : 110, b: 26, l: box.clientWidth < 520 ? 118 : 150 });
    f.svg.setAttribute("aria-label", "Actual chlorine dose versus design dose per borehole");
    if (!rows.length) { box.innerHTML = `<div class="empty-msg">No data.</div>`; return; }
    const max = scaleMax(Math.max(...rows.map((s) => Math.max(s.dose || 0, s.b.design_dose_mgl || 0))) * 1.05);
    const xOf = (v) => f.m.l + (v / max) * f.iw;
    for (const tv of ticks(max)) {
      el("line", { x1: xOf(tv), x2: xOf(tv), y1: f.m.t, y2: f.m.t + rows.length * rowH, stroke: tv === 0 ? cssVar("--axis") : cssVar("--grid") }, f.svg);
      const tx = el("text", { x: xOf(tv), y: f.H - 6, "text-anchor": "middle", class: "tick" }, f.svg); tx.textContent = fmt1.format(tv);
    }
    const c1 = cssVar("--series-1"), ink = cssVar("--text-primary"), sec = cssVar("--text-secondary");
    rows.forEach((s, i) => {
      const yc = f.m.t + i * rowH + rowH / 2;
      const name = el("text", { x: f.m.l - 10, y: yc + 4, "text-anchor": "end", "font-size": 12, fill: sec }, f.svg);
      name.textContent = s.b.borehole_name;
      if (s.dose != null) el("path", { d: rightRoundedBar(f.m.l, yc - 9, xOf(s.dose) - f.m.l, 18), fill: c1 }, f.svg);
      if (s.b.design_dose_mgl) el("line", { x1: xOf(s.b.design_dose_mgl), x2: xOf(s.b.design_dose_mgl), y1: yc - 13, y2: yc + 13, stroke: ink, "stroke-width": 2, "stroke-linecap": "round" }, f.svg);
      const v = el("text", { x: Math.max(xOf(s.dose || 0), xOf(s.b.design_dose_mgl || 0)) + 8, y: yc + 4, "font-size": 12, fill: ink }, f.svg);
      v.textContent = s.dose != null ? `${fmt2.format(s.dose)}${s.dev != null ? ` (${s.dev > 0 ? "+" : ""}${Math.round(s.dev * 100)}%)` : ""}` : "no pumping";
      const hit = el("rect", { x: 0, y: yc - rowH / 2, width: f.W, height: rowH, fill: "transparent" }, f.svg);
      hit.addEventListener("mousemove", (ev) => showTip(`<div class="t-title">${esc(s.b.borehole_name)}</div>` +
        tRow(keyDot(c1), "Actual dose", s.dose != null ? fmt2.format(s.dose) + " mg/L" : "—") +
        tRow(keyDot(ink, true), "Design dose", s.b.design_dose_mgl ? fmt2.format(s.b.design_dose_mgl) + " mg/L" : "—") +
        tRow("", "Difference", s.dev != null ? (s.dev > 0 ? "+" : "") + Math.round(s.dev * 100) + "%" : "—") +
        tRow("", "Chlorine added", fmt1.format(s.chl / 1000) + " kg") + tRow("", "Water pumped", fmt0.format(s.vol) + " m³"), ev));
      hit.addEventListener("mouseleave", hideTip);
    });
    legend(box, [{ label: "Actual dose (mg/L)", color: c1 }, { label: "Design dose", color: ink, line: true }]);
  }

  // ------------------------------------------------------------------ chart: heatmap
  function renderHeat(sel) {
    const box = $("#chHeat");
    const t = CFG.frc_targets_mgl.tank;
    const days = sel.days.slice(-90);
    const L = box.clientWidth < 520 ? 118 : 150, cellH = 18, gap = 2;
    box.innerHTML = "";
    const W = Math.max(280, box.clientWidth);
    const cw = Math.max(3, Math.min(18, (W - L - 4) / days.length - gap));
    const H = sel.bhs.length * (cellH + gap) + 26;
    const f = frame(box, H, { t: 0, r: 0, b: 26, l: L });
    f.svg.setAttribute("aria-label", "Daily reporting and tank FRC status per borehole");
    const cls = {
      within: { c: cssVar("--good"), l: "Within target" }, above: { c: cssVar("--warning"), l: "Above target" },
      below: { c: cssVar("--critical"), l: "Below target" }, notest: { c: cssVar("--axis"), l: "Reported, no FRC test / not pumped" },
    };
    const idx = {}; sel.recs.forEach((r) => (idx[r.borehole_id + "|" + r.date] = r));
    sel.bhs.forEach((b, row) => {
      const y = row * (cellH + gap);
      const n = el("text", { x: L - 10, y: y + 13, "text-anchor": "end", "font-size": 12, fill: cssVar("--text-secondary") }, f.svg);
      n.textContent = b.borehole_name;
      days.forEach((d, i) => {
        const r = idx[b.borehole_id + "|" + d];
        const x = L + i * (cw + gap);
        let k = null;
        if (r) k = r.frc_tank == null ? "notest" : r.frc_tank < t.min ? "below" : r.frc_tank > t.max ? "above" : "within";
        const c = el("rect", { x, y, width: cw, height: cellH, rx: 3, fill: k ? cls[k].c : "transparent", stroke: k ? "none" : cssVar("--grid"), "stroke-width": 1 }, f.svg);
        c.addEventListener("mousemove", (ev) => showTip(`<div class="t-title">${esc(b.borehole_name)} · ${dLong(d)}</div>` +
          (r ? tRow(keyDot(cls[k].c), cls[k].l, r.frc_tank != null ? fmt2.format(r.frc_tank) + " mg/L" : "") +
               tRow("", "Tablets added", r.tablets_added ?? "—") + tRow("", "Water", r.volume_m3 != null ? fmt0.format(r.volume_m3) + " m³" : "—") +
               (r.issues.length ? tRow("", "Issues", esc(r.issues.join(", ").replace(/_/g, " "))) : "")
             : tRow("", "No report", "")), ev));
        c.addEventListener("mouseleave", hideTip);
      });
    });
    const step = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor((W - L) / 70))));
    days.forEach((d, i) => { if (i % step === 0) { const tx = el("text", { x: L + i * (cw + gap) + cw / 2, y: H - 8, "text-anchor": "middle", class: "tick" }, f.svg); tx.textContent = dLabel(d); } });
    legend(box, [...Object.values(cls).map((c) => ({ label: c.l, color: c.c })), { label: "No report", empty: true }]);
    if (sel.days.length > 90) box.insertAdjacentHTML("beforeend", `<p class="note">Showing the last 90 days of the period.</p>`);
  }

  // ------------------------------------------------------------------ tables
  const ICON = { critical: "✕", serious: "!", warning: "▲", good: "✓" };
  function chip(level, label) { return `<span class="chip"><i class="${level}" style="background:var(--${level})">${ICON[level]}</i>${esc(label)}</span>`; }

  function renderTable(stats) {
    const head = `<tr><th>Borehole</th><th>Community</th><th>Alerts</th><th class="num">Reports</th><th class="num">Water (m³)</th><th class="num">Tablets</th>
      <th class="num">Chlorine (kg)</th><th class="num">Actual dose</th><th class="num">Design dose</th><th class="num">Tank FRC ok</th>
      <th class="num">Tap FRC ok</th><th class="num">HH FRC ok</th><th class="num">Stock (tabs)</th><th class="num">Days of stock</th><th>Last report</th></tr>`;
    const rows = stats.map((s) => `<tr>
      <td><b>${esc(s.b.borehole_name)}</b><br><span class="muted">${esc(s.b.borehole_id)}</span></td>
      <td>${esc(s.b.community)}<br><span class="muted">${esc(s.b.lga)}</span></td>
      <td class="alerts">${s.alerts.length ? s.alerts.map((a) => chip(a[0], a[1])).join("<br>") : chip("good", "OK")}</td>
      <td class="num">${s.reports} / ${s.expected}</td><td class="num">${fmt0.format(s.vol)}</td><td class="num">${fmt0.format(s.tabs)}</td>
      <td class="num">${fmt1.format(s.chl / 1000)}</td><td class="num">${s.dose != null ? fmt2.format(s.dose) : "—"}</td>
      <td class="num">${s.b.design_dose_mgl != null ? fmt2.format(s.b.design_dose_mgl) : "—"}</td>
      <td class="num">${pct(s.tankAdeq)}</td><td class="num">${pct(s.tapAdeq)}</td><td class="num">${pct(s.hhAdeq)}</td>
      <td class="num">${s.stock ?? "—"}</td><td class="num">${s.daysStock != null ? fmt0.format(s.daysStock) : "—"}</td>
      <td>${s.lastDate ? dLong(s.lastDate) : "—"}</td></tr>`).join("");
    $("#bhTable").innerHTML = `<thead>${head}</thead><tbody>${rows}</tbody>`;
  }

  function renderDayTable(daily) {
    const rows = [...daily].reverse().map((d) => `<tr><td>${dLong(d.d)}</td><td class="num">${d.n}</td><td class="num">${fmt0.format(d.vol)}</td>
      <td class="num">${fmt0.format(d.tabs)}</td><td class="num">${fmt0.format(d.chl)}</td><td class="num">${d.avg7 != null ? fmt0.format(d.avg7) : "—"}</td>
      <td class="num">${d.frcMean != null ? fmt2.format(d.frcMean) : "—"}</td></tr>`).join("");
    $("#dayTable").innerHTML = `<thead><tr><th>Date</th><th class="num">Reports</th><th class="num">Water (m³)</th><th class="num">Tablets added</th>
      <th class="num">Chlorine (g)</th><th class="num">7-day avg (g/day)</th><th class="num">Mean tank FRC (mg/L)</th></tr></thead><tbody>${rows}</tbody>`;
  }

  function downloadCsv(sel) {
    const cols = Object.keys(DATA.records[0] || {});
    const cell = (v) => { v = Array.isArray(v) ? v.join(" ") : v ?? ""; v = String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    const csv = [cols.join(","), ...sel.recs.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = `chlorination_${state.from}_to_${state.to}.csv`;
    a.click();
  }

  // ------------------------------------------------------------------ render all
  function render() {
    const sel = selected();
    const stats = sel.bhs.map((b) => boreholeStats(b, sel.recs, sel.days));
    const daily = dailyTotals(sel);
    renderKpis(sel, stats);
    renderUse(sel, daily);
    renderFrc(sel, daily);
    renderDose(stats);
    renderHeat(sel);
    renderTable(stats);
    renderDayTable(daily);
    $("#dlCsv").onclick = () => downloadCsv(sel);
    document.querySelectorAll(".presets button").forEach((b) => b.setAttribute("aria-pressed", String(String(state.preset) === b.dataset.days)));
    $("#fFrom").value = state.from; $("#fTo").value = state.to;
    $("#subtitle").textContent = `${sel.bhs.length} borehole${sel.bhs.length === 1 ? "" : "s"} · ${dLong(state.from)} – ${dLong(state.to)}`;
  }

  function setPreset(p) {
    state.preset = p;
    state.to = state.anchor;
    state.from = p === "all" ? DATA.meta.date_min || state.anchor : addDays(state.anchor, -(p - 1));
    render();
  }

  function fillBhSelect() {
    const list = DATA.boreholes.filter((b) => state.lga === "all" || b.lga === state.lga);
    $("#fBh").innerHTML = `<option value="all">All boreholes</option>` + list.map((b) => `<option value="${esc(b.borehole_id)}">${esc(b.borehole_name)}</option>`).join("");
    if (!list.some((b) => b.borehole_id === state.bh)) state.bh = "all";
    $("#fBh").value = state.bh;
  }

  function init(data) {
    DATA = data; CFG = data.meta.config; PROD = CFG.products;
    BH_BY_ID = Object.fromEntries(data.boreholes.map((b) => [b.borehole_id, b]));
    // colour follows the borehole, fixed by register order (never by rank in the current filter)
    data.boreholes.forEach((b, i) => (SLOT[b.borehole_id] = (i % 8) + 1));
    const today = new Date().toISOString().slice(0, 10);
    state.anchor = data.meta.source === "sample" ? data.meta.date_max : today;
    $("#demoBanner").hidden = data.meta.source !== "sample";
    const lgas = [...new Set(data.boreholes.map((b) => b.lga))].sort();
    $("#fLga").innerHTML = `<option value="all">All LGAs</option>` + lgas.map((l) => `<option>${esc(l)}</option>`).join("");
    fillBhSelect();
    $("#fLga").onchange = (e) => { state.lga = e.target.value; fillBhSelect(); render(); };
    $("#fBh").onchange = (e) => { state.bh = e.target.value; render(); };
    document.querySelectorAll(".presets button").forEach((b) => (b.onclick = () => setPreset(b.dataset.days === "all" ? "all" : +b.dataset.days)));
    $("#fFrom").onchange = (e) => { if (e.target.value) { state.from = e.target.value; state.preset = null; if (state.from > state.to) state.to = state.from; render(); } };
    $("#fTo").onchange = (e) => { if (e.target.value) { state.to = e.target.value; state.preset = null; if (state.to < state.from) state.from = state.to; render(); } };
    $("#themeToggle").onclick = () => {
      const root = document.documentElement;
      const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      root.dataset.theme = dark ? "light" : "dark";
      render();
    };
    const m = data.meta;
    $("#footer").innerHTML = `<p>Data updated ${esc(m.generated_at.replace("T", " ").replace("Z", " UTC"))} · source: ${m.source === "sample" ? "sample data" : "KoboToolbox"} ·
      ${m.records_published} daily reports (${m.duplicates_replaced} duplicate submissions replaced by the latest, ${m.submissions_rejected} rejected – see data/qa_rejected.csv).</p>
      <p>Method: chlorine (g) = tablets added × tablet weight × % available chlorine. Dose (mg/L) = chlorine g ÷ water m³. Days of stock = tablets in store ÷ average tablets added per day over the last ${CFG.stock_window_days} days.
      FRC is adequate when ≥ the minimum target for the sampling point (tank ${CFG.frc_targets_mgl.tank.min}, tap ${CFG.frc_targets_mgl.tap.min}, household ${CFG.frc_targets_mgl.household.min} mg/L).</p>`;
    let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 150); });
    setPreset(30);
  }

  fetch("data/dashboard_data.json", { cache: "no-store" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch((e) => { $("#kpis").innerHTML = `<div class="banner">Could not load data/dashboard_data.json (${esc(e.message)}). Run the pipeline first.</div>`; });
})();
