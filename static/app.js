"use strict";

// ── State ─────────────────────────────────────────────────────────────────────
let strategies   = {};
let equityChart  = null;   // Chart.js instance
let candleChart  = null;   // LightweightCharts instance
let candleSeries = null;   // CandlestickSeries
let lastResult   = null;   // stored for share feature
let lastConfig   = {};     // stored for share feature

// ── Presets ───────────────────────────────────────────────────────────────────
const PRESETS = [
  {
    label:    "Trending Stock",
    ticker:   "NVDA",
    strategy: "bollinger",
    from:     "2023-01-01",
    to:       "2024-12-31",
    params:   { period: 20, std_dev: 2.0 },
    hint:     "Bollinger Bands · 2023–2024",
  },
  {
    label:    "Bull Market",
    ticker:   "AAPL",
    strategy: "sma_cross",
    from:     "2020-01-01",
    to:       "2023-12-31",
    params:   { fast: 10, slow: 30 },
    hint:     "SMA Crossover · 2020–2023",
  },
  {
    label:    "Low Volatility",
    ticker:   "SPY",
    strategy: "rsi",
    from:     "2019-01-01",
    to:       "2024-12-31",
    params:   { period: 14, oversold: 30, overbought: 70 },
    hint:     "RSI Reversion · 2019–2024",
  },
];

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Default "to" date = today
  document.getElementById("to-date").value = new Date().toISOString().slice(0, 10);

  strategies = await fetch("/api/strategies").then(r => r.json());
  populateStrategies();
  renderParams(document.getElementById("strategy-select").value);
  setupSymbolSearch();
  renderPresets();
  setupShareButton();

  document.getElementById("strategy-select").addEventListener("change", e => {
    renderParams(e.target.value);
  });

  document.getElementById("form").addEventListener("submit", e => {
    e.preventDefault();
    runBacktest();
  });
});

// ── Preset cards ──────────────────────────────────────────────────────────────
function renderPresets() {
  const grid = document.getElementById("preset-grid");
  PRESETS.forEach(preset => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset-card";
    btn.innerHTML = `
      <span class="preset-label">${preset.label}</span>
      <span class="preset-ticker">${preset.ticker}</span>
      <span class="preset-strategy">${(strategies[preset.strategy]?.label) || preset.strategy}</span>
      <span class="preset-period">${preset.hint}</span>
      <span class="preset-cta">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="5 3 19 12 5 21 5 3"/>
        </svg>
        Run this test
      </span>
    `;
    btn.addEventListener("click", () => applyPreset(preset));
    grid.appendChild(btn);
  });
}

function applyPreset(preset) {
  document.getElementById("symbol-input").value = preset.ticker;
  document.getElementById("from-date").value    = preset.from;
  document.getElementById("to-date").value      = preset.to;

  const sel = document.getElementById("strategy-select");
  sel.value = preset.strategy;
  renderParams(preset.strategy);

  // Set param values after renderParams generates the inputs
  Object.entries(preset.params).forEach(([key, val]) => {
    const el = document.getElementById(`param-${key}`);
    if (el) el.value = val;
  });

  runBacktest();
}

// ── Strategy dropdown ─────────────────────────────────────────────────────────
function populateStrategies() {
  const sel = document.getElementById("strategy-select");
  for (const [key, def] of Object.entries(strategies)) {
    const opt = document.createElement("option");
    opt.value       = key;
    opt.textContent = def.label;
    sel.appendChild(opt);
  }
}

// ── Dynamic parameter inputs ──────────────────────────────────────────────────
function renderParams(stratKey) {
  const def     = strategies[stratKey];
  const section = document.getElementById("params-section");
  const desc    = document.getElementById("strategy-desc");

  section.innerHTML = "";
  if (!def) return;

  desc.textContent = def.description || "";

  // Group params into rows of 2
  const params = def.params;
  for (let i = 0; i < params.length; i += 2) {
    const row = document.createElement("div");
    row.className = "param-row";
    [params[i], params[i + 1]].forEach(p => {
      if (!p) return;
      const field = document.createElement("div");
      field.className = "field";
      field.innerHTML = `
        <label for="param-${p.key}">${p.label}</label>
        <input id="param-${p.key}"
               name="param-${p.key}"
               type="number"
               value="${p.default}"
               min="${p.min ?? 1}"
               step="${p.step ?? 1}" />
      `;
      row.appendChild(field);
    });
    section.appendChild(row);
  }
}

// ── Symbol search autocomplete ────────────────────────────────────────────────
function setupSymbolSearch() {
  const input    = document.getElementById("symbol-input");
  const dropdown = document.getElementById("symbol-dropdown");
  let timer;

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { closeDropdown(); return; }
    timer = setTimeout(() => fetchSymbols(q), 280);
  });

  document.addEventListener("click", e => {
    if (!e.target.closest(".symbol-wrap")) closeDropdown();
  });

  async function fetchSymbols(q) {
    try {
      const res   = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const items = await res.json();
      showDropdown(items);
    } catch { closeDropdown(); }
  }

  function showDropdown(items) {
    dropdown.innerHTML = "";
    if (!items.length) { closeDropdown(); return; }
    items.forEach(item => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="sym">${item.symbol}</span><span class="name">${item.name}</span>`;
      li.addEventListener("click", () => {
        input.value = item.symbol;
        closeDropdown();
      });
      dropdown.appendChild(li);
    });
    dropdown.classList.remove("hidden");
  }

  function closeDropdown() { dropdown.classList.add("hidden"); }
}

// ── Run backtest ──────────────────────────────────────────────────────────────
async function runBacktest() {
  const symbol   = document.getElementById("symbol-input").value.trim().toUpperCase();
  const fromDate = document.getElementById("from-date").value;
  const toDate   = document.getElementById("to-date").value;
  const strategy = document.getElementById("strategy-select").value;
  const commission = parseFloat(document.getElementById("commission").value) / 100;
  const cash     = parseFloat(document.getElementById("cash").value);

  if (!symbol) return showError("Enter a symbol.");
  if (!fromDate || !toDate) return showError("Select a date range.");

  // Collect strategy params
  const def    = strategies[strategy];
  const params = {};
  (def?.params || []).forEach(p => {
    const el = document.getElementById(`param-${p.key}`);
    if (el) params[p.key] = parseFloat(el.value);
  });

  setLoading(true);
  clearError();

  try {
    const res  = await fetch("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, from_date: fromDate, to_date: toDate, strategy, commission, cash, params }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Backtest failed");
    lastConfig = { symbol, strategy, fromDate, toDate };
    renderResults(data, symbol);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

// ── Render results ────────────────────────────────────────────────────────────
function renderResults(data, symbol) {
  document.getElementById("empty-state").classList.add("hidden");
  document.getElementById("results").classList.remove("hidden");

  lastResult = data;
  renderVerdict(data.metrics, symbol);
  renderMetrics(data.metrics);
  renderCandleChart(data.price_data, data.trades, symbol);
  renderEquityChart(data.equity_curve);
  renderTradesTable(data.trades);
}

// ── Verdict banner ────────────────────────────────────────────────────────────
function renderVerdict(m, symbol) {
  const banner = document.getElementById("verdict-banner");
  const stratRet = m.return_pct;
  const bhRet    = m.buy_hold_return_pct;

  if (stratRet == null || bhRet == null) {
    banner.classList.add("hidden");
    return;
  }

  const diff   = stratRet - bhRet;
  const beat   = diff >= 0;
  const sign   = beat ? "+" : "";
  const cls    = beat ? "beat" : "lost";
  const label  = beat ? "Strategy beat Buy & Hold" : "Strategy underperformed Buy & Hold";

  banner.className = `verdict-banner ${cls}`;
  banner.innerHTML = `
    <div class="verdict-left">
      <div class="verdict-headline">${label} by ${sign}${diff.toFixed(1)}%</div>
      <div class="verdict-sub">${symbol} &bull; ${lastConfig.fromDate ?? ""} – ${lastConfig.toDate ?? ""}</div>
    </div>
    <div class="verdict-numbers">
      <div class="verdict-num">
        <span class="verdict-num-label">Strategy</span>
        <span class="verdict-num-value ${stratRet >= 0 ? "pos" : "neg"}">${stratRet >= 0 ? "+" : ""}${stratRet.toFixed(1)}%</span>
      </div>
      <div class="verdict-num">
        <span class="verdict-num-label">Buy &amp; Hold</span>
        <span class="verdict-num-value ${bhRet >= 0 ? "pos" : "neg"}">${bhRet >= 0 ? "+" : ""}${bhRet.toFixed(1)}%</span>
      </div>
    </div>
  `;
  banner.classList.remove("hidden");
}

// ── Share button ──────────────────────────────────────────────────────────────
function setupShareButton() {
  document.getElementById("share-btn").addEventListener("click", () => {
    if (!lastResult) return;
    const m        = lastResult.metrics;
    const { symbol, strategy, fromDate, toDate } = lastConfig;
    const label    = strategies[strategy]?.label ?? strategy;
    const from     = (fromDate ?? "").slice(0, 4);
    const to       = (toDate   ?? "").slice(0, 4);
    const ret      = m.return_pct      != null ? (m.return_pct >= 0 ? "+" : "") + m.return_pct.toFixed(1) + "%" : "—";
    const bh       = m.buy_hold_return_pct != null ? (m.buy_hold_return_pct >= 0 ? "+" : "") + m.buy_hold_return_pct.toFixed(1) + "%" : "—";
    const sharpe   = m.sharpe_ratio    != null ? m.sharpe_ratio.toFixed(2)    : "—";
    const dd       = m.max_drawdown_pct != null ? m.max_drawdown_pct.toFixed(1) + "%" : "—";
    const wr       = m.win_rate        != null ? m.win_rate.toFixed(1) + "%"  : "—";

    const text = [
      `${symbol} · ${label} (${from}–${to})`,
      `${"─".repeat(38)}`,
      `Return:        ${ret}`,
      `vs Buy & Hold: ${bh}`,
      `Sharpe Ratio:  ${sharpe}`,
      `Max Drawdown:  ${dd}`,
      `Win Rate:      ${wr}`,
      ``,
      `Tested free → ${window.location.href}`,
    ].join("\n");

    navigator.clipboard.writeText(text).then(() => {
      const btn  = document.getElementById("share-btn");
      const span = document.getElementById("share-btn-text");
      btn.classList.add("copied");
      span.textContent = "Copied!";
      setTimeout(() => {
        btn.classList.remove("copied");
        span.textContent = "Copy & Share";
      }, 2000);
    });
  });
}

// ── Metrics ───────────────────────────────────────────────────────────────────
const METRIC_DEFS = [
  { key: "return_pct",          label: "Return",         fmt: pct,     sign: true },
  { key: "buy_hold_return_pct", label: "Buy & Hold",     fmt: pct,     sign: true },
  { key: "max_drawdown_pct",    label: "Max Drawdown",   fmt: pct,     sign: true },
  { key: "sharpe_ratio",        label: "Sharpe Ratio",   fmt: dec2,    sign: false },
  { key: "win_rate",            label: "Win Rate",       fmt: pct,     sign: false },
  { key: "num_trades",          label: "Trades",         fmt: v => v,  sign: false },
  { key: "profit_factor",       label: "Profit Factor",  fmt: dec2,    sign: false },
  { key: "final_equity",        label: "Final Equity",   fmt: dollar,  sign: false },
  { key: "exposure_time",       label: "Exposure",       fmt: pct,     sign: false },
];

function renderMetrics(m) {
  const grid = document.getElementById("metrics-grid");
  grid.innerHTML = "";
  METRIC_DEFS.forEach(def => {
    const val  = m[def.key];
    const card = document.createElement("div");
    card.className = "metric-card";
    const cls = colorClass(val, def.key, def.sign);
    card.innerHTML = `
      <div class="metric-label">${def.label}</div>
      <div class="metric-value ${cls}">${val == null ? "—" : def.fmt(val)}</div>
    `;
    grid.appendChild(card);
  });
}

function colorClass(val, key, hasSigns) {
  if (val == null) return "neutral";
  if (key === "max_drawdown_pct") return val < 0 ? "negative" : "neutral";
  if (!hasSigns) return "neutral";
  return val >= 0 ? "positive" : "negative";
}

function pct(v)    { return (v >= 0 ? "+" : "") + v.toFixed(2) + "%"; }
function dec2(v)   { return v != null ? v.toFixed(2) : "—"; }
function dollar(v) { return "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 }); }

// ── Candlestick chart ─────────────────────────────────────────────────────────
function renderCandleChart(priceData, trades, symbol) {
  const container = document.getElementById("candle-chart");
  container.innerHTML = "";

  document.getElementById("symbol-badge").textContent = symbol;

  const chart = LightweightCharts.createChart(container, {
    layout:     { background: { color: "#141414" }, textColor: "#888" },
    grid:       { vertLines: { color: "#1e1e1e" }, horzLines: { color: "#1e1e1e" } },
    crosshair:  { mode: LightweightCharts.CrosshairMode.Normal },
    timeScale:  { borderColor: "#262626", timeVisible: true },
    rightPriceScale: { borderColor: "#262626" },
    width:  container.clientWidth,
    height: 320,
  });

  candleChart = chart;

  const series = chart.addCandlestickSeries({
    upColor:          "#3dcb7f",
    downColor:        "#f26d6d",
    borderUpColor:    "#3dcb7f",
    borderDownColor:  "#f26d6d",
    wickUpColor:      "#3dcb7f",
    wickDownColor:    "#f26d6d",
  });

  series.setData(priceData);

  // Trade markers
  const markers = [];
  trades.forEach(t => {
    markers.push({ time: t.entry_time, position: "belowBar", color: "#4f8ef7", shape: "arrowUp",   text: "B" });
    markers.push({ time: t.exit_time,  position: "aboveBar", color: "#f5c542", shape: "arrowDown", text: "S" });
  });
  markers.sort((a, b) => a.time.localeCompare(b.time));
  series.setMarkers(markers);

  chart.timeScale().fitContent();

  // Resize observer
  const ro = new ResizeObserver(() => {
    chart.applyOptions({ width: container.clientWidth });
  });
  ro.observe(container);
}

// ── Equity chart ──────────────────────────────────────────────────────────────
function renderEquityChart(equityData) {
  if (equityChart) { equityChart.destroy(); equityChart = null; }

  const ctx    = document.getElementById("equity-canvas").getContext("2d");
  const labels = equityData.map(d => d.time);
  const values = equityData.map(d => d.equity);

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, 296);
  gradient.addColorStop(0, "rgba(79,142,247,.25)");
  gradient.addColorStop(1, "rgba(79,142,247,.01)");

  equityChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data:            values,
        borderColor:     "#4f8ef7",
        borderWidth:     1.5,
        backgroundColor: gradient,
        pointRadius:     0,
        tension:         0,
        fill:            true,
      }],
    },
    options: {
      animation:    false,
      responsive:   true,
      maintainAspectRatio: false,
      interaction:  { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1c1c1c",
          borderColor:     "#262626",
          borderWidth:     1,
          titleColor:      "#888",
          bodyColor:       "#e8e8e8",
          callbacks: {
            label: ctx => " $" + ctx.parsed.y.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color:      "#555",
            maxTicksLimit: 8,
            font:       { size: 11 },
          },
          grid:  { color: "#1e1e1e" },
          border: { color: "#262626" },
        },
        y: {
          ticks: {
            color: "#555",
            font:  { size: 11 },
            callback: v => "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 }),
          },
          grid:  { color: "#1e1e1e" },
          border: { color: "#262626" },
        },
      },
    },
  });
}

// ── Trades table ──────────────────────────────────────────────────────────────
function renderTradesTable(trades) {
  const tbody   = document.getElementById("trades-body");
  const noMsg   = document.getElementById("no-trades-msg");
  const counter = document.getElementById("trade-count");

  tbody.innerHTML = "";
  counter.textContent = trades.length + (trades.length === 1 ? " trade" : " trades");

  if (!trades.length) {
    noMsg.classList.remove("hidden");
    return;
  }
  noMsg.classList.add("hidden");

  trades.forEach(t => {
    const isProfitable = t.pnl >= 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.entry_time}</td>
      <td>${t.exit_time}</td>
      <td>${t.size}</td>
      <td>$${t.entry_price.toFixed(2)}</td>
      <td>$${t.exit_price.toFixed(2)}</td>
      <td class="${isProfitable ? "pos" : "neg"}">${isProfitable ? "+" : ""}$${t.pnl.toFixed(2)}</td>
      <td class="${isProfitable ? "pos" : "neg"}">${isProfitable ? "+" : ""}${t.return_pct.toFixed(2)}%</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function setLoading(on) {
  const btn  = document.getElementById("run-btn");
  const text = document.getElementById("btn-text");
  const spin = document.getElementById("btn-spinner");
  btn.disabled = on;
  text.textContent = on ? "Running…" : "Run Backtest";
  spin.classList.toggle("hidden", !on);
}

function showError(msg) {
  const el = document.getElementById("error-msg");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function clearError() {
  document.getElementById("error-msg").classList.add("hidden");
}
