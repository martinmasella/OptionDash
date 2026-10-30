/* OptionDash – GGAL short-vol strategies from the "Sabro" Google Sheet */
(() => {
  "use strict";

  const SHEET_ID = "1W2kTK4n10-fKWYRJmoffOnxdaibkL-7I5wduSHVlGvI";
  const SHEET_GID = "1007255744"; // hoja "Sabro"
  // JSONP (gviz) funciona incluso abriendo Index.html desde file://; los CSV quedan como respaldo.
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
  const pct = (n) => (n == null || !isFinite(n) ? "—" : `${(n * 100).toFixed(1)}%`);

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
  const intrinsic = (l, s) => (l.type === "C" ? Math.max(s - l.strike, 0) : Math.max(l.strike - s, 0));

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

    const slopeRight = legs.filter((l) => l.type === "C").reduce((a, l) => a + l.qty, 0);
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
      const profitTxt = a.maxProfit === Infinity ? "Ilimitada" : `$ ${fmt0(a.maxProfit * CONTRACT_SIZE)}`;
      const lossTxt = a.maxLoss === -Infinity ? "Ilimitada" : `$ ${fmt0(a.maxLoss * CONTRACT_SIZE)}`;
      const be = a.breakevens.length ? a.breakevens.map((b) => fmt0(b)).join(" / ") : "—";
      const range = a.breakevens.length === 2 ? `${pct(a.breakevens[0] / S - 1)} … +${pct(a.breakevens[1] / S - 1)}` : "—";
      // Rendimiento: prima cobrada (o pagada) sobre el valor del subyacente (spot × 100) que respalda un lote.
      const notional = S * CONTRACT_SIZE;
      const yieldPct = a.credit / S;
      const roiTxt = a.credit < 0 && isFinite(a.maxProfit) ? ` · ROI ${pct(a.maxProfit / -a.credit)}` : "";
      const yieldTxt = `${yieldPct >= 0 ? "+" : "−"}${pct(Math.abs(yieldPct))}`;

      card.innerHTML = `
        <div class="card-head">
          <div><h3>${st.name}</h3><div class="sub">${built.desc}</div></div>
          <div class="credit">
            <div class="label">${a.credit < 0 ? "Débito neto" : "Prima neta"}</div>
            <div class="value mono ${a.credit < 0 ? "neg" : ""}">${a.credit < 0 ? "−" : "+"}$ ${fmt(Math.abs(a.credit))}</div>
            <div class="per">× ${CONTRACT_SIZE} = $ ${fmt0(a.credit * CONTRACT_SIZE)} / lote</div>
            <div class="yield ${yieldPct < 0 ? "neg" : ""}">${yieldTxt} s/ GGAL ($ ${fmt0(notional)})${roiTxt}</div>
          </div>
        </div>
        <div class="metrics">
          ${metric(a.credit < 0 ? "Costo s/ subyacente" : "Rendimiento s/ subyacente", yieldTxt, yieldPct < 0 ? "red" : "green")}
          ${metric("Ganancia máx.", profitTxt, "green")}
          ${metric("Pérdida máx.", lossTxt, "red")}
          ${metric("Breakeven", be, "amber")}
          ${metric("Rango BE", range)}
        </div>
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
      state.spotChg = und.chg;
      state.lastUpdate = und.lastUpdate?.split(" ")[1] ?? null;

      state.expiries = buildChain(state.rows);
      if (!state.expiries.length) throw new Error("No se encontraron opciones GFG en la hoja");
      const keep = state.expiries.find((e) => e.code === state.selected?.code);
      state.selected = keep ?? pickDefaultExpiry(state.expiries);

      renderHeader();
      const used = renderStrategies();
      renderChain(used);
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
    banner(state.selected.month % 2 ? `Atención: ${state.selected.label} es un vencimiento impar, normalmente sin liquidez.` : null);
  });

  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.color = "#8a93a8";
  refresh();
  setAuto(true);
})();
