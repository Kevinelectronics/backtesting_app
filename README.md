# Backtester — Free Strategy Backtesting Tool

A clean, fast web app to backtest trading strategies on any stock using real market data. Built with FastAPI + a lightweight JS frontend. No account required.

![Backtester screenshot](https://ik.imagekit.io/agbb7sr41/Captura%20de%20pantalla%202026-03-17%20110804.png)

---

## What it does

Run backtests on any ticker in seconds. Pick a strategy, set your date range, and get a full performance report instantly.

**Strategies included:**
| Strategy | Logic |
|---|---|
| SMA Crossover | Buy when fast SMA crosses above slow SMA |
| RSI Mean Reversion | Buy when oversold, sell when overbought |
| MACD Crossover | Buy/sell on MACD × signal line crossover |
| Bollinger Bands | Buy at lower band, sell at upper band |
| EMA + RSI Trend | Trend-following with RSI momentum filter |

**Metrics reported:**
- Total Return vs Buy & Hold
- Sharpe Ratio & Sortino Ratio
- Max Drawdown
- Win Rate & Profit Factor
- Full equity curve + candlestick chart with trade markers
- Trade-by-trade log

**UX highlights:**
- Beat-the-market verdict banner on every result
- One-click preset strategies (NVDA, AAPL, SPY) to get started instantly
- Copy & Share button — paste results directly to LinkedIn or Twitter
- Live symbol search autocomplete
- Dark UI, no clutter

---

## Tech stack

- **Backend:** Python · FastAPI · [backtesting.py](https://kernc.github.io/backtesting.py/)
- **Data:** [Financial Modeling Prep API](https://site.financialmodelingprep.com/pricing-plans?utm_source=blog&utm_medium=medium&utm_campaign=keving13) — real OHLCV data for 50,000+ tickers
- **Frontend:** Vanilla JS · Chart.js · Lightweight Charts (TradingView)

---

## Quickstart

### 1. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/backtester.git
cd backtester
pip install fastapi uvicorn backtesting pandas numpy matplotlib requests
```

### 2. Add your FMP API key

Open `main.py` and replace the key on line 29:

```python
FMP_API_KEY = "your_key_here"
```

> Get a free API key at **[financialmodelingprep.com](https://site.financialmodelingprep.com/pricing-plans?utm_source=blog&utm_medium=medium&utm_campaign=keving13)**

### 3. Run

```bash
uvicorn main:app --reload
```

Open `http://localhost:8000` in your browser.

---

## Data powered by Financial Modeling Prep

This tool uses the **[Financial Modeling Prep API](https://site.financialmodelingprep.com/pricing-plans?utm_source=blog&utm_medium=medium&utm_campaign=keving13)** for real-time and historical OHLCV data.

FMP covers:
- **50,000+ global tickers** — US stocks, ETFs, crypto, forex, commodities
- **30+ years** of historical daily data
- Real-time quotes, fundamentals, earnings, and more
- Simple REST API, generous free tier

> If you want to run more tickers or longer date ranges, **[upgrade your FMP plan here](https://site.financialmodelingprep.com/pricing-plans?utm_source=blog&utm_medium=medium&utm_campaign=keving13)**.

---

## Project structure

```
backtester/
├── main.py          # FastAPI backend — strategies, data fetching, backtest engine
└── static/
    ├── index.html   # App shell
    ├── style.css    # Dark theme styles
    └── app.js       # Frontend logic — charts, forms, share feature
```

---

## Extending

**Add a new strategy:** Create a class that extends `Strategy` in `main.py`, add it to the `STRATEGIES` dict, and register its params in `get_strategies()`.

**Change the data source:** Swap `fetch_ohlcv()` with any DataFrame that has `Open / High / Low / Close / Volume` columns.

---

## License

MIT
