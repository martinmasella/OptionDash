/* OptionDash – GGAL short-vol strategies from the "Sabro" Google Sheet */
(() => {
  "use strict";

  const SHEET_ID = "1W2kTK4n10-fKWYRJmoffOnxdaibkL-7I5wduSHVlGvI";
  const SHEET_GID = "1007255744"; // hoja "Sabro"
  // JSONP (gviz) funciona incluso abriendo index.html desde file://; los CSV quedan como respaldo.
  const JSONP_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${SHEET_GID}&headers=0&tqx=out:json;responseHandler:`;
  const SOURCES = [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`,
  ];
  const UNDERLYING = "GGAL";
  const OPTION_PREFIX = "GFG";
  const CONTRACT_SIZE = 100;
  const REFRESH_MS = 30_000;
  const WING_PCT = 0.10;

  // BYMA month codes: 2 letters normally, 1 letter when the strike has 5 digits.
  const MONTH_CODES = {
    EN: 1, FE: 2, MR: 3, AB: 4, MY: 5, JN: 6, JL: 7, AG: 8, SE: 9, OC: 10, NO: 11, DI: 12,
    E: 1, F: 2, M: 3, A: 4, Y: 5, J: 6, L: 7, G: 8, S: 9, O: 10, N: 11, D: 12,
  };
  const MONTH_NAMES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  const $ = (sel) => document.querySelector(sel);
  const fmt = (n, d = 2) =>
    n == null || !isFinite(n) ? "—" : n.toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmt0 = (n) => fmt(n, 0);
  const pct = (n, d = 1) => (n == null || !isFinite(n) ? "—" : `${(n * 100).toFixed(d)}%`);
  const pct2 = (n) => pct(n, 2);

  const state = { rows: [], spot: null, spotChg: null, lastUpdate: null, expiries: [], selected: null, charts: [] };

  // ---------- CSV ----------
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  const num = (s) => {
    if (s == null) return NaN;
    const v = parseFloat(String(s).replace(/[^\d.\-]/g, ""));
    return isNaN(v) ? NaN : v;
  };

  // ---------- Fetch ----------
  function fetchJsonp(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const cb = `odCb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const script = document.createElement("script");
      const cleanup = () => { delete window[cb]; script.remove(); clearTimeout(t); };
      const t = setTimeout(() => { cleanup(); reject(new Error("timeout JSONP")); }, timeoutMs);
      window[cb] = (resp) => {
        cleanup();
        if (resp?.status !== "ok" || !resp.table) return reject(new Error(resp?.errors?.[0]?.detailed_message ?? "respuesta gviz inválida"));
        // Normalise to string matrix (formatted value when available) so parseRows is shared with CSV.
        const table = resp.table.rows.map((r) => (r.c ?? []).map((c) => (c == null ? "" : c.f ?? (c.v == null ? "" : String(c.v)))));
        if (!table.some((r) => r.some((c) => c.startsWith(OPTION_PREFIX)))) return reject(new Error("respuesta sin datos de opciones"));
        resolve(table);
      };
      script.onerror = () => { cleanup(); reject(new Error("no se pudo cargar gviz")); };
      script.src = `${JSONP_URL}${cb}&_=${Date.now()}`;
      document.head.appendChild(script);
    });
  }

  async function fetchSheet() {
    let lastErr;
    try { return await fetchJsonp(); } catch (e) { lastErr = e; }
    for (const url of SOURCES) {
      try {
        const res = await fetch(`${url}&_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!text.includes(OPTION_PREFIX)) throw new Error("respuesta sin datos de opciones");
        return parseCSV(text);
      } catch (e) { lastErr = e; }
    }
    throw lastErr ?? new Error("No se pudo leer el Google Sheet");
  }

  // Column layout: ticker,bidsize,bid,last,ask,asksize,... lastupdate. Detected from header, with fallback.
  function parseRows(table) {
    let col = { ticker: 1, bidsize: 2, bid: 3, last: 4, ask: 5, asksize: 6, chg: 11, lastupdate: 14 };
    const header = table.find((r) => r.some((c) => c.trim().toLowerCase() === "ticker"));
    if (header) {
      const idx = (name) => header.findIndex((c) => c.trim().toLowerCase() === name);
      const found = {
        ticker: idx("ticker"), bidsize: idx("bidsize"), bid: idx("bid"), last: idx("last"),
        ask: idx("ask"), asksize: idx("asksize"), chg: idx("chg%"), lastupdate: idx("lastupdate"),
      };
      if (found.ticker >= 0 && found.bid >= 0 && found.ask >= 0) col = { ...col, ...Object.fromEntries(Object.entries(found).filter(([, v]) => v >= 0)) };
    }
    return table
      .map((r) => ({
        ticker: (r[col.ticker] ?? "").trim(),
        bidSize: num(r[col.bidsize]), bid: num(r[col.bid]), last: num(r[col.last]),
        ask: num(r[col.ask]), askSize: num(r[col.asksize]), chg: num(r[col.chg]), lastUpdate: r[col.lastupdate] ?? "",
      }))
      .filter((r) => r.ticker);
  }

  // ---------- Options model ----------
  function thirdFriday(year, month1) {
    const d = new Date(year, month1 - 1, 1);
    const offset = (5 - d.getDay() + 7) % 7;
    return new Date(year, month1 - 1, 1 + offset + 14, 17, 0, 0);
  }

  function expiryFromCode(code, today = new Date()) {
    const month = MONTH_CODES[code];
    if (!month) return null;
    let year = today.getFullYear();
    let date = thirdFriday(year, month);
    if (date < today) { year++; date = thirdFriday(year, month); }
    return { code: `${year}-${String(month).padStart(2, "0")}`, month, year, date, label: `${MONTH_NAMES[month]} ${year}` };
  }

  function parseOption(row) {
    const m = row.ticker.match(/^GFG([CV])(\d+)([A-Z]{1,2})$/);
    if (!m) return null;
    const exp = expiryFromCode(m[3]);
    if (!exp) return null;
    const liquid = row.bid > 0 && row.ask > 0 && row.bidSize >= 1 && row.askSize >= 1;
    return { ...row, type: m[1] === "C" ? "C" : "P", strike: Number(m[2]), expiry: exp, liquid };
  }

  function buildChain(rows) {
    const byExp = new Map();
    for (const r of rows) {
      const o = parseOption(r);
      if (!o) continue;
      if (!byExp.has(o.expiry.code)) byExp.set(o.expiry.code, { ...o.expiry, strikes: new Map() });
      const ex = byExp.get(o.expiry.code);
      if (!ex.strikes.has(o.strike)) ex.strikes.set(o.strike, { strike: o.strike, C: null, P: null });
      ex.strikes.get(o.strike)[o.type] = o;
    }
    return [...byExp.values()]
      .map((ex) => ({ ...ex, strikes: [...ex.strikes.values()].sort((a, b) => a.strike - b.strike) }))
      .sort((a, b) => a.date - b.date);
  }

  // Rule: trade the nearest unexpired even-month OPEX (odd months have no liquidity).
  function pickDefaultExpiry(expiries) {
    const now = new Date();
    const live = expiries.filter((e) => e.date >= now);
    const even = live.filter((e) => e.month % 2 === 0 && e.strikes.some((s) => s.C?.liquid || s.P?.liquid));
    return (even[0] ?? live[0] ?? expiries[0]) ?? null;
  }

  // ---------- Strategy builders ----------
  const liquidStrikes = (ex, type) => ex.strikes.filter((s) => s[type]?.liquid).map((s) => s.strike);
  const nearest = (arr, target) => arr.length ? arr.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a)) : null;
  const opt = (ex, type, k) => ex.strikes.find((s) => s.strike === k)?.[type] ?? null;

  const leg = (ex, type, k, qty) => {
    const o = opt(ex, type, k);
    if (!o) return null;
    return { type, strike: k, qty, price: qty < 0 ? o.bid : o.ask, opt: o };
  };

  function straddle(ex, S) {
    const both = ex.strikes.filter((s) => s.C?.liquid && s.P?.liquid).map((s) => s.strike);
    const K = nearest(both, S);
    if (K == null) return null;
    return { legs: [leg(ex, "C", K, -1), leg(ex, "P", K, -1)], desc: `Venta CALL ${K} + venta PUT ${K}` };
  }

  function strangle(ex, S) {
    const Kp = nearest(liquidStrikes(ex, "P"), S * (1 - WING_PCT));
    const Kc = nearest(liquidStrikes(ex, "C"), S * (1 + WING_PCT));
    if (Kp == null || Kc == null || Kp >= Kc) return null;
    return { legs: [leg(ex, "P", Kp, -1), leg(ex, "C", Kc, -1)], desc: `Venta PUT ${Kp} (−${pct(1 - Kp / S)}) + venta CALL ${Kc} (+${pct(Kc / S - 1)})` };
  }

  // Long call butterfly: buy K1, sell 2×K2 (ATM), buy K3 — symmetric wings when possible.
  function butterfly(ex, S) {
    const ks = liquidStrikes(ex, "C");
    const K2 = nearest(ks, S);
    if (K2 == null) return null;
    const lower = ks.filter((k) => k < K2).sort((a, b) => b - a);
    const upper = ks.filter((k) => k > K2).sort((a, b) => a - b);
    if (!lower.length || !upper.length) return null;
    let K1 = null, K3 = null;
    for (const lo of lower) {
      const target = K2 + (K2 - lo);
      if (upper.includes(target)) { K1 = lo; K3 = target; break; }
    }
    const broken = K1 == null;
    if (broken) { K1 = lower[0]; K3 = upper[0]; }
    return {
      legs: [leg(ex, "C", K1, 1), leg(ex, "C", K2, -2), leg(ex, "C", K3, 1)],
      desc: `Compra CALL ${K1} + venta 2× CALL ${K2} + compra CALL ${K3}${broken ? " (alas asimétricas)" : ""}`,
    };
  }

  // Iron condor: short strikes ~10% away, long wings on the next liquid strike outward.
  function ironCondor(ex, S) {
    const puts = liquidStrikes(ex, "P"), calls = liquidStrikes(ex, "C");
    const Kps = nearest(puts, S * (1 - WING_PCT));
    const Kcs = nearest(calls, S * (1 + WING_PCT));
    if (Kps == null || Kcs == null || Kps >= Kcs) return null;
    const Kpl = puts.filter((k) => k < Kps).sort((a, b) => b - a)[0];
    const Kcl = calls.filter((k) => k > Kcs).sort((a, b) => a - b)[0];
    if (Kpl == null || Kcl == null) return null;
    return {
      legs: [leg(ex, "P", Kpl, 1), leg(ex, "P", Kps, -1), leg(ex, "C", Kcs, -1), leg(ex, "C", Kcl, 1)],
      desc: `Compra PUT ${Kpl} · venta PUT ${Kps} · venta CALL ${Kcs} · compra CALL ${Kcl}`,
    };
  }

  const STRATEGIES = [
    { id: "straddle", name: "Straddle vendido", accent: "linear-gradient(90deg,#7c5cff,#00d4ff)", build: straddle, hint: "Bases más ATM" },
    { id: "strangle", name: "Strangle vendido", accent: "linear-gradient(90deg,#00d4ff,#22e39a)", build: strangle, hint: "≈10% fuera del dinero" },
    { id: "butterfly", name: "Butterfly comprado", accent: "linear-gradient(90deg,#ffb84d,#ff4d6d)", build: butterfly, hint: "Cuerpo vendido en la base ATM" },
    { id: "condor", name: "Iron Condor vendido", accent: "linear-gradient(90deg,#ff4d6d,#7c5cff)", build: ironCondor, hint: "Cortos a ≈10%, alas siguientes" },
  ];

  // ---------- Payoff math ----------
  // "S" = acciones del subyacente: su valor a vencimiento es el propio precio.
  const intrinsic = (l, s) => (l.type === "C" ? Math.max(s - l.strike, 0) : l.type === "P" ? Math.max(l.strike - s, 0) : s);

  function analyze(legs, S) {
    const credit = legs.reduce((acc, l) => acc - l.qty * l.price, 0);
    const payoff = (s) => credit + legs.reduce((acc, l) => acc + l.qty * intrinsic(l, s), 0);
    const strikes = legs.map((l) => l.strike);
    const lo = Math.min(S * 0.6, Math.min(...strikes) * 0.9);
    const hi = Math.max(S * 1.4, Math.max(...strikes) * 1.1);
    const n = 240;
    const points = [];
    for (let i = 0; i <= n; i++) { const s = lo + ((hi - lo) * i) / n; points.push({ x: s, y: payoff(s) }); }
    for (const k of strikes) points.push({ x: k, y: payoff(k) });
    points.sort((a, b) => a.x - b.x);

    const breakevens = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if ((a.y <= 0 && b.y > 0) || (a.y >= 0 && b.y < 0)) {
        if (b.y === a.y) continue;
        breakevens.push(a.x + ((0 - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    }

    const slopeRight = legs.filter((l) => l.type !== "P").reduce((a, l) => a + l.qty, 0);
    const ys = points.map((p) => p.y).concat(payoff(0));
    let maxProfit = Math.max(...ys), maxLoss = Math.min(...ys);
    if (slopeRight > 0) maxProfit = Infinity;
    if (slopeRight < 0) maxLoss = -Infinity;

    return { credit, points, breakevens, maxProfit, maxLoss, payoff };
  }

  // ---------- Rendering ----------
  function renderHeader() {
    $("#spot").textContent = state.spot ? `$ ${fmt(state.spot)}` : "—";
    $("#spot").title = state.spotChg != null ? `Var. diaria: ${state.spotChg}%` : "";
    $("#lastUpdate").textContent = state.lastUpdate ?? new Date().toLocaleTimeString("es-AR");
    const sel = $("#expirySelect");
    sel.innerHTML = "";
    for (const ex of state.expiries) {
      const o = document.createElement("option");
      o.value = ex.code;
      o.textContent = `${ex.label}${ex.month % 2 ? " (impar)" : ""}`;
      o.selected = state.selected?.code === ex.code;
      sel.appendChild(o);
    }
    if (state.selected) {
      $("#expiryDate").textContent = state.selected.date.toLocaleDateString("es-AR");
      $("#chainExpiry").textContent = state.selected.label;
    }
  }

  function metric(k, v, cls = "") { return `<div class="metric"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`; }

  // Rendimiento: prima cobrada (o pagada) sobre el valor del subyacente (spot × 100) que respalda un lote.
  function yieldInfo(a, S) {
    const yieldPct = a.credit / S;
    return {
      yieldPct,
      yieldTxt: `${yieldPct >= 0 ? "+" : "−"}${pct(Math.abs(yieldPct))}`,
      roiTxt: a.credit < 0 && isFinite(a.maxProfit) ? ` · ROI ${pct(a.maxProfit / -a.credit)}` : "",
    };
  }

  function creditHTML(a, S) {
    const { yieldPct, yieldTxt, roiTxt } = yieldInfo(a, S);
    return `<div class="credit">
      <div class="label">${a.credit < 0 ? "Débito neto" : "Prima neta"}</div>
      <div class="value mono ${a.credit < 0 ? "neg" : ""}">${a.credit < 0 ? "−" : "+"}$ ${fmt(Math.abs(a.credit))}</div>
      <div class="per">× ${CONTRACT_SIZE} = $ ${fmt0(a.credit * CONTRACT_SIZE)} / lote</div>
      <div class="yield ${yieldPct < 0 ? "neg" : ""}">${yieldTxt} s/ GGAL ($ ${fmt0(S * CONTRACT_SIZE)})${roiTxt}</div>
    </div>`;
  }

  function metricsHTML(a, S) {
    const { yieldPct, yieldTxt } = yieldInfo(a, S);
    const profitTxt = a.maxProfit === Infinity ? "Ilimitada" : `$ ${fmt0(a.maxProfit * CONTRACT_SIZE)}`;
    const lossTxt = a.maxLoss === -Infinity ? "Ilimitada" : `$ ${fmt0(a.maxLoss * CONTRACT_SIZE)}`;
    const be = a.breakevens.length ? a.breakevens.map((b) => fmt0(b)).join(" / ") : "—";
    const range = a.breakevens.length === 2 ? `${pct(a.breakevens[0] / S - 1)} … +${pct(a.breakevens[1] / S - 1)}` : "—";
    return `<div class="metrics">
      ${metric(a.credit < 0 ? "Costo s/ subyacente" : "Rendimiento s/ subyacente", yieldTxt, yieldPct < 0 ? "red" : "green")}
      ${metric("Ganancia máx.", profitTxt, "green")}
      ${metric("Pérdida máx.", lossTxt, "red")}
      ${metric("Breakeven", be, "amber")}
      ${metric("Rango BE", range)}
    </div>`;
  }

  function legsTable(legs) {
    const rows = legs.map((l) => `
      <tr>
        <td><span class="side ${l.qty < 0 ? "sell" : "buy"}">${l.qty < 0 ? "VENDE" : "COMPRA"} ${Math.abs(l.qty)}</span></td>
        <td class="mono">${l.opt.ticker}</td>
        <td class="num mono">${fmt0(l.opt.bidSize)}</td>
        <td class="num mono ${l.qty < 0 ? "used" : ""}">${fmt(l.opt.bid)}</td>
        <td class="num mono">${fmt(l.opt.last)}</td>
        <td class="num mono ${l.qty > 0 ? "used" : ""}">${fmt(l.opt.ask)}</td>
        <td class="num mono">${fmt0(l.opt.askSize)}</td>
      </tr>`).join("");
    return `<table class="legs">
      <thead><tr><th>Operación</th><th>Contrato</th><th class="num">BidSz</th><th class="num">Bid</th><th class="num">Last</th><th class="num">Ask</th><th class="num">AskSz</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  function renderStrategies() {
    const grid = $("#strategies");
    grid.innerHTML = "";
    state.charts.forEach((c) => c.destroy());
    state.charts = [];
    const used = new Set();
    const chartJobs = [];
    const ex = state.selected, S = state.spot;
    if (!ex || !S) return used;

    STRATEGIES.forEach((st, i) => {
      const card = document.createElement("article");
      card.className = "card";
      card.style.setProperty("--card-accent", st.accent);
      card.style.animationDelay = `${i * 70}ms`;
      const built = st.build(ex, S);
      if (!built || built.legs.some((l) => !l)) {
        card.classList.add("empty");
        card.innerHTML = `<div class="card-head"><div><h3>${st.name}</h3><div class="sub">${st.hint}</div></div></div>
          <p>No hay contratos con puntas (≥1 lote en bid y ask) suficientes para armar esta estrategia en ${ex.label}.</p>`;
        grid.appendChild(card);
        return;
      }
      const a = analyze(built.legs, S);
      built.legs.forEach((l) => used.add(`${l.type}${l.strike}`));

      card.innerHTML = `
        <div class="card-head">
          <div><h3>${st.name}</h3><div class="sub">${built.desc}</div></div>
          ${creditHTML(a, S)}
        </div>
        ${metricsHTML(a, S)}
        <div class="chart-wrap"><canvas id="chart-${st.id}"></canvas></div>
        ${legsTable(built.legs)}`;
      grid.appendChild(card);
      chartJobs.push(() => drawChart(`chart-${st.id}`, a, S, built.legs));
    });
    // Charts are sized from their container; create them once the grid has its final layout.
    state.charts = chartJobs.map((job) => job());
    return used;
  }

  function drawChart(canvasId, a, S, legs) {
    const ctx = document.getElementById(canvasId);
    const pts = a.points.map((p) => ({ x: p.x, y: p.y * CONTRACT_SIZE }));
    const ys = pts.map((p) => p.y);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const pad = (yMax - yMin) * 0.1 || 1;
    return new Chart(ctx, {
      type: "line",
      data: {
        datasets: [
          {
            label: "P&L a vencimiento ($ / lote)",
            data: pts, parsing: false, pointRadius: 0, borderWidth: 2.5, tension: 0,
            borderColor: "#e6e9f2",
            fill: { target: { value: 0 }, above: "rgba(34,227,154,0.28)", below: "rgba(255,77,109,0.30)" },
          },
          {
            label: "Spot GGAL", data: [{ x: S, y: yMin - pad }, { x: S, y: yMax + pad }], parsing: false,
            borderColor: "#00d4ff", borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false,
          },
          {
            label: "Breakeven", data: a.breakevens.map((b) => ({ x: b, y: 0 })), parsing: false,
            showLine: false, pointRadius: 5, pointBackgroundColor: "#ffb84d", pointBorderColor: "#0b0f1a", pointBorderWidth: 2,
          },
          {
            label: "Strikes", data: legs.map((l) => ({ x: l.strike, y: a.payoff(l.strike) * CONTRACT_SIZE })), parsing: false,
            showLine: false, pointRadius: 4, pointStyle: "rectRot",
            pointBackgroundColor: legs.map((l) => (l.qty < 0 ? "#ff4d6d" : "#22e39a")), pointBorderColor: "#0b0f1a",
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
        interaction: { mode: "nearest", axis: "x", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => `GGAL $ ${fmt0(items[0].parsed.x)}`,
              label: (item) => item.datasetIndex === 0 ? ` P&L: $ ${fmt0(item.parsed.y)}` : ` ${item.dataset.label}`,
            },
          },
        },
        scales: {
          x: { type: "linear", grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#8a93a8", callback: (v) => fmt0(v), maxTicksLimit: 9 } },
          y: { min: yMin - pad, max: yMax + pad, grid: { color: (c) => (c.tick.value === 0 ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.05)") }, ticks: { color: "#8a93a8", callback: (v) => fmt0(v), maxTicksLimit: 6 } },
        },
      },
    });
  }

  function renderChain(used) {
    const tbody = $("#chainTable tbody");
    tbody.innerHTML = "";
    const ex = state.selected, S = state.spot;
    if (!ex) return;
    const atm = nearest(ex.strikes.map((s) => s.strike), S);
    const cell = (o, key, cls = "") => {
      const v = o ? o[key] : NaN;
      const liquid = o?.liquid ? "liquid" : "";
      return `<td class="${liquid} ${cls}">${key.endsWith("Size") ? fmt0(v) : fmt(v)}</td>`;
    };
    for (const s of ex.strikes) {
      const tr = document.createElement("tr");
      if (s.strike === atm) tr.classList.add("atm");
      const cUsed = used.has(`C${s.strike}`) ? "used-leg" : "", pUsed = used.has(`P${s.strike}`) ? "used-leg" : "";
      const cItm = s.strike < S ? "itm" : "", pItm = s.strike > S ? "itm" : "";
      tr.innerHTML =
        cell(s.C, "bidSize", `${cUsed} ${cItm}`) + cell(s.C, "bid", `${cUsed} ${cItm}`) + cell(s.C, "last", `${cUsed} ${cItm}`) + cell(s.C, "ask", `${cUsed} ${cItm}`) + cell(s.C, "askSize", `${cUsed} ${cItm}`) +
        `<td class="strike">${fmt0(s.strike)}</td>` +
        cell(s.P, "bidSize", `${pUsed} ${pItm}`) + cell(s.P, "bid", `${pUsed} ${pItm}`) + cell(s.P, "last", `${pUsed} ${pItm}`) + cell(s.P, "ask", `${pUsed} ${pItm}`) + cell(s.P, "askSize", `${pUsed} ${pItm}`);
      tbody.appendChild(tr);
    }
  }

  function banner(msg, isError = false) {
    const b = $("#banner");
    if (!msg) { b.classList.add("hidden"); return; }
    b.textContent = msg;
    b.classList.toggle("error", isError);
    b.classList.remove("hidden");
  }

  // ---------- Main ----------
  async function refresh() {
    const btn = $("#refreshBtn");
    btn.disabled = true; btn.textContent = "⟳ Cargando…";
    try {
      const table = await fetchSheet();
      state.rows = parseRows(table);

      const und = state.rows.find((r) => r.ticker.toUpperCase() === UNDERLYING) ?? state.rows.find((r) => r.ticker.toUpperCase().startsWith(UNDERLYING));
      if (!und) throw new Error(`No se encontró el subyacente ${UNDERLYING}`);
      state.spot = und.last > 0 ? und.last : (und.bid + und.ask) / 2;
      state.und = und;
      // Las opciones liquidan contado inmediato: para "bajo la par" se usa GGAL - CI si está en la hoja.
      state.undCI = state.rows.find((r) => /^GGAL\s*-?\s*CI$/i.test(r.ticker.trim())) ?? und;
      state.spotChg = und.chg;
      state.lastUpdate = und.lastUpdate?.split(" ")[1] ?? null;

      state.expiries = buildChain(state.rows);
      if (!state.expiries.length) throw new Error("No se encontraron opciones GFG en la hoja");
      const keep = state.expiries.find((e) => e.code === state.selected?.code);
      state.selected = keep ?? pickDefaultExpiry(state.expiries);

      renderHeader();
      const used = renderStrategies();
      renderChain(used);
      Builder.onData();
      Par.renderVisible();
      banner(state.selected.month % 2 ? `Atención: ${state.selected.label} es un vencimiento impar, normalmente sin liquidez.` : null);
    } catch (e) {
      console.error(e);
      banner(`Error al leer el Google Sheet: ${e.message}`, true);
    } finally {
      btn.disabled = false; btn.textContent = "↻ Actualizar";
    }
  }

  let timer = null;
  function setAuto(on) {
    clearInterval(timer);
    if (on) timer = setInterval(refresh, REFRESH_MS);
  }

  $("#refreshBtn").addEventListener("click", refresh);
  $("#autoRefresh").addEventListener("change", (e) => setAuto(e.target.checked));
  $("#expirySelect").addEventListener("change", (e) => {
    state.selected = state.expiries.find((x) => x.code === e.target.value) ?? state.selected;
    renderHeader();
    renderChain(renderStrategies());
    Par.renderVisible();
    banner(state.selected.month % 2 ? `Atención: ${state.selected.label} es un vencimiento impar, normalmente sin liquidez.` : null);
  });

  // ---------- Tabs ----------
  const TAB_KEY = "optiondash.tab";
  function showTab(name) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
    try { localStorage.setItem(TAB_KEY, name); } catch { /* storage no disponible */ }
    // Chart.js sólo mide contenedores visibles.
    if (name === "builder") Builder.render();
    else if (name === "puts") Par.render("P");
    else if (name === "calls") Par.render("C");
    else state.charts.forEach((c) => c.resize());
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

  // ---------- Estrategia armada (builder) ----------
  // Persistencia en localStorage: { current: {name, legs:[...]}, saved: { nombre: legs[] } }
  const Builder = (() => {
    const KEY = "optiondash.builder.v1";
    let data = { current: { name: "", legs: [] }, saved: {} };
    let chart = null;

    const load = () => { try { const raw = localStorage.getItem(KEY); if (raw) data = { ...data, ...JSON.parse(raw) }; } catch { /* ignore */ } };
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore */ } };

    const el = {
      name: $("#bName"), saved: $("#bSaved"), btnSave: $("#bSave"), btnNew: $("#bNew"), btnDel: $("#bDelete"),
      expiry: $("#bExpiry"), type: $("#bType"), strike: $("#bStrike"), side: $("#bSide"), qty: $("#bQty"), price: $("#bPrice"),
      quote: $("#bQuote"), add: $("#bAdd"), empty: $("#bEmpty"), result: $("#bResult"), summary: $("#bSummary"), legs: $("#bLegs tbody"),
    };

    // Cotización actual de una pata (acciones u opción), si está en la hoja.
    function quoteFor(leg) {
      if (leg.type === "S") {
        const r = state.rows.find((x) => x.ticker.toUpperCase() === UNDERLYING);
        return r ? { ticker: UNDERLYING, bid: r.bid, ask: r.ask, last: r.last } : null;
      }
      const ex = state.expiries.find((e) => e.code === leg.expiry);
      const o = ex?.strikes.find((s) => s.strike === leg.strike)?.[leg.type];
      return o ? { ticker: o.ticker, bid: o.bid, ask: o.ask, last: o.last } : null;
    }
    const marketPrice = (q, side) => (q ? (side > 0 ? (q.ask > 0 ? q.ask : q.last) : (q.bid > 0 ? q.bid : q.last)) : NaN);

    function fillExpiries() {
      const cur = el.expiry.value;
      el.expiry.innerHTML = state.expiries.map((e) => `<option value="${e.code}">${e.label}</option>`).join("");
      el.expiry.value = state.expiries.some((e) => e.code === cur) ? cur : (state.selected?.code ?? "");
      fillStrikes();
    }

    function fillStrikes() {
      const type = el.type.value;
      const isStock = type === "S";
      el.strike.disabled = isStock; el.expiry.disabled = isStock;
      if (isStock) { el.strike.innerHTML = `<option value="">—</option>`; updateQuote(); return; }
      const ex = state.expiries.find((e) => e.code === el.expiry.value);
      const cur = Number(el.strike.value);
      const strikes = ex ? ex.strikes.filter((s) => s[type]) : [];
      el.strike.innerHTML = strikes.map((s) => `<option value="${s.strike}">${fmt0(s.strike)}${s[type].liquid ? "" : " · sin puntas"}</option>`).join("");
      const atm = nearest(strikes.map((s) => s.strike), state.spot ?? 0);
      el.strike.value = strikes.some((s) => s.strike === cur) ? cur : (atm ?? "");
      updateQuote();
    }

    function formLeg() {
      const type = el.type.value, side = Number(el.side.value);
      return { type, side, expiry: type === "S" ? null : el.expiry.value, strike: type === "S" ? null : Number(el.strike.value) };
    }

    function updateQuote() {
      const l = formLeg();
      const q = quoteFor(l);
      el.quote.innerHTML = q ? `${q.ticker} · bid <b>${fmt(q.bid)}</b> · ask <b>${fmt(q.ask)}</b> · last ${fmt(q.last)}` : "Sin cotización";
      const mp = marketPrice(q, l.side);
      el.price.value = isFinite(mp) && mp > 0 ? mp.toFixed(2) : "";
    }

    function addLeg() {
      const l = formLeg();
      const qty = Math.max(1, Math.floor(Number(el.qty.value) || 1));
      const price = Number(el.price.value);
      if (!(price >= 0) || el.price.value === "") { el.price.focus(); return; }
      if (l.type !== "S" && !l.strike) return;
      const q = quoteFor(l);
      data.current.legs.push({ type: l.type, expiry: l.expiry, strike: l.strike, qty: qty * l.side, price, ticker: q?.ticker ?? (l.type === "S" ? UNDERLYING : `${l.type === "C" ? "CALL" : "PUT"} ${l.strike}`) });
      save(); render();
    }

    function fillSaved() {
      const names = Object.keys(data.saved).sort((a, b) => a.localeCompare(b));
      el.saved.innerHTML = `<option value="">Guardadas… (${names.length})</option>` + names.map((n) => `<option value="${n.replace(/"/g, "&quot;")}">${n}</option>`).join("");
      el.saved.value = data.saved[data.current.name] ? data.current.name : "";
      el.btnDel.disabled = !data.saved[data.current.name];
    }

    // Pata del builder → pata del motor de payoff. Acciones: strike = precio pagado y payoff por lote de 100.
    const toEngineLeg = (l) => ({ type: l.type, strike: l.type === "S" ? l.price : l.strike, qty: l.qty, price: l.price });

    function render() {
      fillSaved();
      el.name.value = data.current.name;
      const legs = data.current.legs;
      const S = state.spot;
      const has = legs.length > 0 && S > 0;
      el.empty.classList.toggle("hidden", has);
      el.result.classList.toggle("hidden", !has);
      if (chart) { chart.destroy(); chart = null; }
      if (!has) { el.legs.innerHTML = ""; return; }

      const a = analyze(legs.map(toEngineLeg), S);
      el.summary.innerHTML = `<div class="card-head"><div><h3>${data.current.name || "Estrategia sin nombre"}</h3><div class="sub">${legs.length} pata${legs.length === 1 ? "" : "s"} · GGAL $ ${fmt(S)}</div></div>${creditHTML(a, S)}</div>${metricsHTML(a, S)}`;

      el.legs.innerHTML = legs.map((l, i) => {
        const q = quoteFor(l);
        const net = -l.qty * l.price * CONTRACT_SIZE;
        return `<tr>
          <td><span class="side ${l.qty < 0 ? "sell" : "buy"}">${l.qty < 0 ? "VENDE" : "COMPRA"}</span></td>
          <td class="mono">${l.ticker}${l.type === "S" ? " (×100 acc.)" : ""}</td>
          <td class="num mono">${Math.abs(l.qty)}</td>
          <td class="num"><input class="input price-in" type="number" step="0.01" min="0" value="${l.price}" data-i="${i}" title="Precio editable" /></td>
          <td class="num mono">${fmt(q?.bid)}</td>
          <td class="num mono">${fmt(q?.ask)}</td>
          <td class="num mono ${net >= 0 ? "green" : "red"}">${net >= 0 ? "+" : "−"}$ ${fmt0(Math.abs(net))}</td>
          <td><button class="del" data-del="${i}" title="Quitar pata">✕</button></td>
        </tr>`;
      }).join("");

      if ($("#tab-builder").classList.contains("active")) chart = drawChart("chart-builder", a, S, legs.map(toEngineLeg));
    }

    el.legs.addEventListener("change", (e) => {
      const i = e.target.dataset.i;
      if (i == null) return;
      const v = Number(e.target.value);
      if (v >= 0) { data.current.legs[i].price = v; save(); render(); }
    });
    el.legs.addEventListener("click", (e) => {
      const i = e.target.dataset.del;
      if (i == null) return;
      data.current.legs.splice(Number(i), 1); save(); render();
    });
    el.add.addEventListener("click", addLeg);
    el.type.addEventListener("change", fillStrikes);
    el.expiry.addEventListener("change", fillStrikes);
    el.strike.addEventListener("change", updateQuote);
    el.side.addEventListener("change", updateQuote);
    el.name.addEventListener("input", () => { data.current.name = el.name.value; save(); fillSaved(); const h = el.summary.querySelector("h3"); if (h) h.textContent = data.current.name || "Estrategia sin nombre"; });
    el.btnSave.addEventListener("click", () => {
      const name = el.name.value.trim();
      if (!name) { el.name.focus(); el.name.placeholder = "Poné un nombre para guardar"; return; }
      data.current.name = name;
      data.saved[name] = JSON.parse(JSON.stringify(data.current.legs));
      save(); render();
    });
    el.btnNew.addEventListener("click", () => { data.current = { name: "", legs: [] }; save(); render(); });
    el.btnDel.addEventListener("click", () => {
      if (!data.saved[data.current.name]) return;
      if (!confirm(`¿Eliminar la estrategia guardada «${data.current.name}»?`)) return;
      delete data.saved[data.current.name]; save(); render();
    });
    el.saved.addEventListener("change", () => {
      const n = el.saved.value;
      if (!n || !data.saved[n]) return;
      data.current = { name: n, legs: JSON.parse(JSON.stringify(data.saved[n])) };
      save(); render();
    });

    load();
    return { onData() { fillExpiries(); render(); }, render };
  })();

  // ---------- PUTs / CALLs bajo la par ----------
  // PUT: compro GGAL (ask) + compro PUT (ask) → a vencimiento tengo asegurado al menos la Base.
  // CALL: compro GGAL (ask) + vendo CALL ITM (bid) → si me ejercen cobro la Base.
  // En ambos, resultado asegurado = Base − costo de armar; positivo = "bajo la par".
  const Par = (() => {
    const charts = { P: null, C: null };

    function compute(kind) {
      const ex = state.selected;
      const und = state.undCI ?? state.und;
      if (!ex || !und) return null;
      const sAsk = und.ask > 0 ? und.ask : state.spot;
      const isCI = und !== state.und;
      const days = Math.max(1, (ex.date - new Date()) / 86400000);
      // CALLs: sólo bases ITM (≤ GGAL); en las OTM el resultado depende de que la acción suba, no está asegurado.
      const rows = ex.strikes.filter((s) => s[kind] && (kind === "P" || s.strike <= sAsk)).map((s) => {
        const o = s[kind];
        const prem = kind === "P" ? o.ask : o.bid;
        const size = kind === "P" ? o.askSize : o.bidSize;
        const hasQuote = prem > 0 && size >= 1;
        const armar = hasQuote ? (kind === "P" ? sAsk + prem : sAsk - prem) : NaN;
        const res = s.strike - armar;
        const ratio = res / armar;
        return { o, strike: s.strike, hasQuote, armar, res, ratio, tna: ratio * 365 / days };
      });
      return { ex, sAsk, days, rows, isCI };
    }

    function render(kind) {
      const card = document.querySelector(`.par-card[data-kind="${kind}"]`);
      const tbody = card.querySelector("tbody");
      const d = compute(kind);
      if (charts[kind]) { charts[kind].destroy(); charts[kind] = null; }
      if (!d) { tbody.innerHTML = ""; return; }

      card.querySelector(".par-expiry").textContent = `${d.ex.label} · ${Math.round(d.days)} días`;
      const best = d.rows.filter((r) => r.hasQuote && r.res > 0).sort((a, b) => b.ratio - a.ratio)[0];
      card.querySelector(".par-spot").innerHTML = `
        <div class="label">GGAL${d.isCI ? " CI" : ""} ask</div>
        <div class="value mono" style="color:var(--accent2)">$ ${fmt(d.sAsk)}</div>
        <div class="per">${best ? `Mejor: ${best.o.ticker} · ${pct2(best.ratio)} (TNA ${pct2(best.tna)})` : "Ninguna base bajo la par con puntas"}</div>`;

      tbody.innerHTML = d.rows.map((r) => {
        const cls = !r.hasQuote ? "noq" : r.res > 0 ? "pos" : "neg";
        return `<tr class="${cls}">
          <td>${r.o.ticker}</td>
          <td class="base">${fmt0(r.strike)}</td>
          <td>${fmt0(r.o.bidSize)}</td><td>${fmt(r.o.bid)}</td><td>${fmt(r.o.ask)}</td><td>${fmt0(r.o.askSize)}</td>
          <td>${fmt(r.armar)}</td>
          <td class="res">${r.hasQuote ? `${r.res >= 0 ? "+" : "−"}$ ${fmt(Math.abs(r.res))}` : "—"}</td>
          <td class="res">${r.hasQuote ? `${r.res >= 0 ? "+" : "−"}$ ${fmt0(Math.abs(r.res) * CONTRACT_SIZE)}` : "—"}</td>
          <td class="res">${r.hasQuote ? pct2(r.ratio) : "—"}</td>
          <td class="res">${r.hasQuote ? pct2(r.tna) : "—"}</td>
        </tr>`;
      }).join("");

      if (!card.closest(".tab-panel").classList.contains("active")) return;
      const quoted = d.rows.filter((r) => r.hasQuote);
      const labels = quoted.map((r) => fmt0(r.strike));
      const vals = [...quoted.map((r) => r.strike), ...quoted.map((r) => r.armar), d.sAsk];
      const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.08 || 1;
      charts[kind] = new Chart(document.getElementById(`chart-par-${kind}`), {
        data: {
          labels,
          datasets: [
            {
              type: "bar", label: kind === "P" ? "Base (venta asegurada)" : "Base (cobro si ejercen)", data: quoted.map((r) => r.strike),
              backgroundColor: quoted.map((r) => (r.res > 0 ? "rgba(34,227,154,0.55)" : "rgba(255,77,109,0.45)")),
              borderColor: quoted.map((r) => (r.res > 0 ? "#22e39a" : "#ff4d6d")), borderWidth: 1.5, borderRadius: 4, order: 2,
            },
            {
              type: "line", label: "Breakeven (costo de armar)", data: quoted.map((r) => r.armar),
              borderColor: "#ffb84d", backgroundColor: "#ffb84d", borderWidth: 2.5, pointRadius: 4, pointStyle: "rectRot", tension: 0.25, order: 1,
            },
            {
              type: "line", label: "GGAL ask", data: quoted.map(() => d.sAsk),
              borderColor: "#00d4ff", borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, order: 0,
            },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: true, labels: { boxWidth: 12, usePointStyle: true } },
            tooltip: {
              callbacks: {
                title: (items) => `${quoted[items[0].dataIndex].o.ticker}`,
                label: (it) => ` ${it.dataset.label}: $ ${fmt(it.parsed.y)}`,
                afterBody: (items) => { const r = quoted[items[0].dataIndex]; return [`Resultado: ${r.res >= 0 ? "+" : "−"}$ ${fmt(Math.abs(r.res))} (${pct2(r.ratio)} · TNA ${pct2(r.tna)})`]; },
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#8a93a8" } },
            y: { min: lo - pad, max: hi + pad, grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#8a93a8", callback: (v) => fmt0(v) } },
          },
        },
      });
    }

    function renderVisible() {
      if ($("#tab-puts").classList.contains("active")) render("P");
      else if ($("#tab-calls").classList.contains("active")) render("C");
    }

    return { render, renderVisible };
  })();

  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.color = "#8a93a8";
  let savedTab = "auto";
  try { savedTab = localStorage.getItem(TAB_KEY) || "auto"; } catch { /* ignore */ }
  const hashTab = location.hash.slice(1);
  if (["auto", "builder", "puts", "calls"].includes(hashTab)) savedTab = hashTab;
  showTab(savedTab);
  refresh();
  setAuto(true);
})();
