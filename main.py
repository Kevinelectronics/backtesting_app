import matplotlib
matplotlib.use("Agg")  # headless – no display needed

import os
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Dict, Any

import requests
import pandas as pd
import numpy as np
from backtesting import Backtest, Strategy
from backtesting.lib import crossover

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="Backtester")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FMP_API_KEY = "your_api_key"
FMP_BASE    = "https://financialmodelingprep.com/api/v3"

# ── Indicator helpers ─────────────────────────────────────────────────────────

def _sma(arr, n: int):
    return pd.Series(arr).rolling(n).mean().values

def _rsi(arr, n: int):
    s     = pd.Series(arr)
    delta = s.diff()
    gain  = delta.clip(lower=0)
    loss  = -delta.clip(upper=0)
    avg_g = gain.ewm(com=n - 1, min_periods=n).mean()
    avg_l = loss.ewm(com=n - 1, min_periods=n).mean()
    rs    = avg_g / avg_l
    return (100 - 100 / (1 + rs)).values

# ── Strategies ────────────────────────────────────────────────────────────────

class SmaCrossStrategy(Strategy):
    fast: int = 10
    slow: int = 30

    def init(self):
        self.fast_ma = self.I(_sma, self.data.Close, self.fast)
        self.slow_ma = self.I(_sma, self.data.Close, self.slow)

    def next(self):
        if crossover(self.fast_ma, self.slow_ma):
            self.buy()
        elif crossover(self.slow_ma, self.fast_ma):
            self.position.close()


class RsiStrategy(Strategy):
    period:     int   = 14
    oversold:   float = 30.0
    overbought: float = 70.0

    def init(self):
        self.rsi_ind = self.I(_rsi, self.data.Close, self.period)

    def next(self):
        if self.rsi_ind[-1] < self.oversold and not self.position.size:
            self.buy()
        elif self.rsi_ind[-1] > self.overbought and self.position.size:
            self.position.close()


class MacdStrategy(Strategy):
    fast:          int = 12
    slow:          int = 26
    signal_period: int = 9

    def init(self):
        close  = pd.Series(self.data.Close)
        _macd  = (close.ewm(span=self.fast,   adjust=False).mean()
                - close.ewm(span=self.slow,   adjust=False).mean()).values
        _sig   = pd.Series(_macd).ewm(span=self.signal_period, adjust=False).mean().values
        self.macd_line = self.I(lambda: _macd)
        self.sig_line  = self.I(lambda: _sig)

    def next(self):
        if crossover(self.macd_line, self.sig_line):
            self.buy()
        elif crossover(self.sig_line, self.macd_line):
            self.position.close()


class BollingerStrategy(Strategy):
    period:  int   = 20
    std_dev: float = 2.0

    def init(self):
        close   = pd.Series(self.data.Close)
        mid     = close.rolling(self.period).mean()
        std     = close.rolling(self.period).std()
        _upper  = (mid + self.std_dev * std).values
        _lower  = (mid - self.std_dev * std).values
        self.upper = self.I(lambda: _upper)
        self.lower = self.I(lambda: _lower)

    def next(self):
        if self.data.Close[-1] < self.lower[-1] and not self.position.size:
            self.buy()
        elif self.data.Close[-1] > self.upper[-1] and self.position.size:
            self.position.close()


class EmaRsiStrategy(Strategy):
    """Trend-following: trade in direction of EMA, confirmed by RSI momentum."""
    ema_period:  int   = 50
    rsi_period:  int   = 14
    rsi_entry:   float = 55.0   # RSI must be above this to enter long

    def init(self):
        close      = pd.Series(self.data.Close)
        _ema       = close.ewm(span=self.ema_period, adjust=False).mean().values
        self.ema   = self.I(lambda: _ema)
        self.rsi_v = self.I(_rsi, self.data.Close, self.rsi_period)

    def next(self):
        above_ema = self.data.Close[-1] > self.ema[-1]
        if above_ema and self.rsi_v[-1] > self.rsi_entry and not self.position.size:
            self.buy()
        elif not above_ema and self.position.size:
            self.position.close()


STRATEGIES: Dict[str, type] = {
    "sma_cross": SmaCrossStrategy,
    "rsi":       RsiStrategy,
    "macd":      MacdStrategy,
    "bollinger": BollingerStrategy,
    "ema_rsi":   EmaRsiStrategy,
}

# ── FMP data fetcher ──────────────────────────────────────────────────────────

def fetch_ohlcv(symbol: str, from_date: str, to_date: str) -> pd.DataFrame:
    r = requests.get(
        f"{FMP_BASE}/historical-price-full/{symbol}",
        params={"from": from_date, "to": to_date, "apikey": FMP_API_KEY},
        timeout=20,
    )
    r.raise_for_status()
    data = r.json()
    if "historical" not in data or not data["historical"]:
        raise HTTPException(status_code=400, detail=f"No price data found for '{symbol}'")
    df = pd.DataFrame(data["historical"])
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").set_index("date")
    df = df.rename(columns={
        "open": "Open", "high": "High", "low": "Low",
        "close": "Close", "volume": "Volume",
    })
    return df[["Open", "High", "Low", "Close", "Volume"]]

# ── Serialisation helper ──────────────────────────────────────────────────────

def _safe(val):
    """Convert numpy scalars / NaN to plain Python types."""
    try:
        if pd.isna(val):
            return None
    except Exception:
        pass
    if isinstance(val, np.integer):
        return int(val)
    if isinstance(val, np.floating):
        return float(val)
    return val

# ── API endpoints ─────────────────────────────────────────────────────────────

@app.get("/api/search")
def search_symbols(q: str = Query(..., min_length=1)):
    try:
        r = requests.get(
            f"{FMP_BASE}/search",
            params={"query": q, "limit": 10, "apikey": FMP_API_KEY},
            timeout=10,
        )
        results = r.json() if r.ok else []
        return [{"symbol": x["symbol"], "name": x["name"]}
                for x in results if isinstance(x, dict)]
    except Exception:
        return []


@app.get("/api/strategies")
def get_strategies():
    return {
        "sma_cross": {
            "label": "SMA Crossover",
            "description": "Buy when fast SMA crosses above slow SMA, sell on reverse cross.",
            "params": [
                {"key": "fast",  "label": "Fast Period", "default": 10, "min": 2,  "step": 1},
                {"key": "slow",  "label": "Slow Period", "default": 30, "min": 5,  "step": 1},
            ],
        },
        "rsi": {
            "label": "RSI Mean Reversion",
            "description": "Buy when RSI is oversold, sell when overbought.",
            "params": [
                {"key": "period",     "label": "RSI Period",       "default": 14, "min": 2,  "step": 1},
                {"key": "oversold",   "label": "Oversold Level",   "default": 30, "min": 10, "step": 1},
                {"key": "overbought", "label": "Overbought Level", "default": 70, "min": 50, "step": 1},
            ],
        },
        "macd": {
            "label": "MACD Crossover",
            "description": "Buy when MACD line crosses above signal, sell on reverse.",
            "params": [
                {"key": "fast",          "label": "Fast EMA",      "default": 12, "min": 2,  "step": 1},
                {"key": "slow",          "label": "Slow EMA",      "default": 26, "min": 5,  "step": 1},
                {"key": "signal_period", "label": "Signal Period", "default": 9,  "min": 2,  "step": 1},
            ],
        },
        "bollinger": {
            "label": "Bollinger Bands",
            "description": "Buy at lower band, sell at upper band (mean reversion).",
            "params": [
                {"key": "period",  "label": "Period",         "default": 20,  "min": 5,   "step": 1  },
                {"key": "std_dev", "label": "Std Dev × Band", "default": 2.0, "min": 0.5, "step": 0.1},
            ],
        },
        "ema_rsi": {
            "label": "EMA + RSI Trend",
            "description": "Enter long above EMA when RSI confirms momentum.",
            "params": [
                {"key": "ema_period",  "label": "EMA Period",   "default": 50,   "min": 5,  "step": 1  },
                {"key": "rsi_period",  "label": "RSI Period",   "default": 14,   "min": 2,  "step": 1  },
                {"key": "rsi_entry",   "label": "RSI Threshold","default": 55.0, "min": 40, "step": 1  },
            ],
        },
    }


class BacktestRequest(BaseModel):
    symbol:     str
    from_date:  str
    to_date:    str
    strategy:   str
    commission: float            = 0.001   # 0.1 %
    cash:       float            = 10_000.0
    params:     Dict[str, Any]   = {}


@app.post("/api/backtest")
def run_backtest(req: BacktestRequest):
    if req.strategy not in STRATEGIES:
        raise HTTPException(status_code=400, detail="Unknown strategy")

    df = fetch_ohlcv(req.symbol, req.from_date, req.to_date)
    if len(df) < 60:
        raise HTTPException(status_code=400, detail="Not enough data – need at least 60 bars")

    StratClass = STRATEGIES[req.strategy]
    bt    = Backtest(df, StratClass, cash=req.cash, commission=req.commission, exclusive_orders=True)
    stats = bt.run(**req.params)

    # ── Equity curve ──────────────────────────────────────────────────────────
    ec           = stats["_equity_curve"]
    equity_data  = [
        {"time": str(idx.date()), "equity": round(float(v), 2)}
        for idx, v in ec["Equity"].items()
    ]

    # ── Drawdown series ───────────────────────────────────────────────────────
    drawdown_data = [
        {"time": str(idx.date()), "drawdown": round(float(v) * 100, 4)}
        for idx, v in ec["DrawdownPct"].items()
    ]

    # ── Trades ────────────────────────────────────────────────────────────────
    trades_df = stats["_trades"]
    trades    = []
    if trades_df is not None and not trades_df.empty:
        for _, row in trades_df.iterrows():
            trades.append({
                "entry_time":  str(row["EntryTime"].date()),
                "exit_time":   str(row["ExitTime"].date()),
                "size":        int(row["Size"]),
                "entry_price": round(float(row["EntryPrice"]), 4),
                "exit_price":  round(float(row["ExitPrice"]), 4),
                "pnl":         round(float(row["PnL"]), 2),
                "return_pct":  round(float(row["ReturnPct"]) * 100, 2),
            })

    # ── Price OHLC ────────────────────────────────────────────────────────────
    price_data = [
        {
            "time":  str(idx.date()),
            "open":  round(float(row["Open"]),  4),
            "high":  round(float(row["High"]),  4),
            "low":   round(float(row["Low"]),   4),
            "close": round(float(row["Close"]), 4),
        }
        for idx, row in df.iterrows()
    ]

    # ── Metrics ───────────────────────────────────────────────────────────────
    metrics = {
        "return_pct":          _safe(stats["Return [%]"]),
        "buy_hold_return_pct": _safe(stats["Buy & Hold Return [%]"]),
        "max_drawdown_pct":    _safe(stats["Max. Drawdown [%]"]),
        "sharpe_ratio":        _safe(stats["Sharpe Ratio"]),
        "sortino_ratio":       _safe(stats.get("Sortino Ratio")),
        "win_rate":            _safe(stats["Win Rate [%]"]),
        "num_trades":          _safe(stats["# Trades"]),
        "profit_factor":       _safe(stats.get("Profit Factor")),
        "final_equity":        _safe(stats["Equity Final [$]"]),
        "exposure_time":       _safe(stats.get("Exposure Time [%]")),
        "avg_trade_pct":       _safe(stats.get("Avg. Trade [%]")),
        "best_trade_pct":      _safe(stats.get("Best Trade [%]")),
        "worst_trade_pct":     _safe(stats.get("Worst Trade [%]")),
    }

    return {
        "metrics":      metrics,
        "equity_curve": equity_data,
        "drawdown":     drawdown_data,
        "trades":       trades,
        "price_data":   price_data,
    }

# ── Serve static frontend ─────────────────────────────────────────────────────

static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

@app.get("/")
def serve_index():
    return FileResponse(os.path.join(static_dir, "index.html"))

app.mount("/static", StaticFiles(directory=static_dir), name="static")
