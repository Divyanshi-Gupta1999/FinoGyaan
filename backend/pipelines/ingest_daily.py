"""
FinWise AI — Daily Ingestion Orchestrator
==========================================
Single entry point for running all daily BigQuery data ingestion jobs.
Designed to be called from:
  - Local CLI:   python -m pipelines.ingest_daily [--dry-run]
  - Cloud Function: from deploy/cloud_function/main.py

Execution Order:
  1. market_regime_history  (4 core index benchmarks)
  2. individual_stock_history (130+ US & Indian stocks/ETFs)
  3. macro_economic_indicators (FRED + market sentiment)
  4. regime_summary refresh (recompute materialized analytics)
"""

import os
import sys
import json
import datetime
import traceback

# Ensure backend directory is in sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# Import pipeline modules
from pipelines import ingest_market_regime
from pipelines import refresh_regime_summary


def run_stocks_incremental(dry_run: bool = False) -> dict:
    """
    Run the individual stock history ingestion in incremental mode.
    Wraps the existing ingest_stocks.py logic with incremental fetch.
    """
    import subprocess
    from google.cloud import bigquery
    from google.oauth2.credentials import Credentials

    PROJECT_ID = "finwise-506509"
    DATASET_ID = "finwise_data"
    TABLE_ID = "individual_stock_history"
    TABLE_REF = f"{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}"

    print("=" * 60)
    print("  Individual Stock History — Incremental Ingestion")
    print(f"  Table: {TABLE_REF}")
    print("=" * 60)

    try:
        import google.auth
        creds, _ = google.auth.default()
    except Exception:
        try:
            token = subprocess.check_output(
                ["gcloud", "auth", "print-access-token"]
            ).decode("utf-8").strip()
            creds = Credentials(token)
        except Exception as e:
            return {"table": TABLE_ID, "rows_appended": 0, "errors": [f"Auth failed: {e}"]}


    client = bigquery.Client(project=PROJECT_ID, credentials=creds)

    # Step 1: Get latest trade_date per symbol from BigQuery
    try:
        query = f"SELECT symbol, MAX(trade_date) as latest_date FROM `{TABLE_REF}` GROUP BY symbol"
        result = client.query(query).result()
        latest_dates = {row.symbol: row.latest_date for row in result}
        print(f"\n  Found existing data for {len(latest_dates)} symbols in BigQuery.")
    except Exception:
        latest_dates = {}
        print("\n  No existing data found (table may be empty or new).")

    # Step 2: Import the stock universe from ingest_stocks.py
    sys.path.insert(0, backend_dir)
    from ingest_stocks import STOCKS, fetch_single_ticker

    import concurrent.futures
    import pandas as pd

    end_date = datetime.datetime.now().strftime("%Y-%m-%d")
    tasks = []
    for category, stocks in STOCKS.items():
        for stock in stocks:
            sym = stock["symbol"]
            latest = latest_dates.get(sym)
            if latest and latest >= datetime.date.today() - datetime.timedelta(days=1):
                continue  # Already up to date
            start = (latest + datetime.timedelta(days=1)).isoformat() if latest else "2005-01-01"
            tasks.append((stock, category, start))

    if not tasks:
        print("  All stocks are up to date. Nothing to ingest.")
        return {"table": TABLE_ID, "rows_appended": 0, "errors": [], "assets_updated": []}

    print(f"  Fetching incremental data for {len(tasks)} symbols...")

    if dry_run:
        print(f"  [DRY RUN] Would fetch and append data for {len(tasks)} symbols.")
        return {"table": TABLE_ID, "rows_appended": 0, "errors": [], "dry_run": True}

    all_data = []
    errors = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        future_to_info = {
            executor.submit(fetch_single_ticker, stock, cat, start, end_date): stock["symbol"]
            for stock, cat, start in tasks
        }
        completed = 0
        for future in concurrent.futures.as_completed(future_to_info):
            sym = future_to_info[future]
            try:
                data = future.result()
                all_data.extend(data)
                completed += 1
                if completed % 20 == 0 or completed == len(tasks):
                    print(f"    Progress: {completed}/{len(tasks)} ({len(all_data):,} rows)")
            except Exception as exc:
                errors.append(f"{sym}: {exc}")

    if not all_data:
        print("  No new data fetched.")
        return {"table": TABLE_ID, "rows_appended": 0, "errors": errors}

    # Step 3: Dedup — batch delete overlapping rows for updated symbols
    symbols_to_update = list(set(r["symbol"] for r in all_data))
    if symbols_to_update:
        min_date = min(r["trade_date"] for r in all_data)
        symbols_formatted = ", ".join(f"'{sym}'" for sym in symbols_to_update)
        try:
            client.query(
                f"DELETE FROM `{TABLE_REF}` WHERE symbol IN ({symbols_formatted}) AND trade_date >= '{min_date}'"
            ).result()
        except Exception as e:
            print(f"  Warning during dedup delete: {e}")


    # Step 4: Append new rows
    df = pd.DataFrame(all_data)
    schema = [
        bigquery.SchemaField("symbol", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("name", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("category", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("trade_date", "DATE", mode="REQUIRED"),
        bigquery.SchemaField("close_price", "FLOAT", mode="REQUIRED"),
        bigquery.SchemaField("volume", "INTEGER", mode="NULLABLE"),
    ]
    job_config = bigquery.LoadJobConfig(schema=schema, write_disposition="WRITE_APPEND")

    print(f"\n  Uploading {len(df):,} new rows to {TABLE_REF}...")
    job = client.load_table_from_dataframe(df, TABLE_REF, job_config=job_config)
    job.result()

    print(f"  SUCCESS: Appended {job.output_rows:,} rows.")
    return {"table": TABLE_ID, "rows_appended": job.output_rows, "errors": errors}


def run_macro_incremental(dry_run: bool = False) -> dict:
    """
    Run the macroeconomic indicators ingestion in incremental mode.
    Wraps the existing ingest_macro.py logic with incremental fetch.
    """
    import subprocess
    from google.cloud import bigquery
    from google.oauth2.credentials import Credentials

    PROJECT_ID = "finwise-506509"
    DATASET_ID = "finwise_data"
    TABLE_ID = "macro_economic_indicators"
    TABLE_REF = f"{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}"

    print("=" * 60)
    print("  Macroeconomic Indicators — Incremental Ingestion")
    print(f"  Table: {TABLE_REF}")
    print("=" * 60)

    try:
        import google.auth
        creds, _ = google.auth.default()
    except Exception:
        try:
            token = subprocess.check_output(
                ["gcloud", "auth", "print-access-token"]
            ).decode("utf-8").strip()
            creds = Credentials(token)
        except Exception as e:
            return {"table": TABLE_ID, "rows_appended": 0, "errors": [f"Auth failed: {e}"]}


    client = bigquery.Client(project=PROJECT_ID, credentials=creds)

    # Get latest period_date per indicator
    try:
        query = f"SELECT indicator_code, MAX(period_date) as latest_date FROM `{TABLE_REF}` GROUP BY indicator_code"
        result = client.query(query).result()
        latest_dates = {row.indicator_code: row.latest_date for row in result}
        print(f"\n  Found existing data for {len(latest_dates)} indicators.")
    except Exception:
        latest_dates = {}
        print("\n  No existing data found.")

    sys.path.insert(0, backend_dir)
    from ingest_macro import fetch_fred_series, fetch_market_indicator
    import pandas as pd

    # FRED indicators
    fred_indicators = [
        ("CPIAUCSL", "Consumer Price Index (CPI Inflation)", "Inflation", "Index"),
        ("CPILFESL", "Core CPI (Ex-Food & Energy)", "Inflation", "Index"),
        ("FEDFUNDS", "Federal Funds Effective Rate", "Monetary Policy", "Percent"),
        ("T10Y2Y", "10Y Minus 2Y Treasury Yield Spread", "Yield Curve", "Percent Spread"),
        ("T10Y3M", "10Y Minus 3M Treasury Yield Spread", "Yield Curve", "Percent Spread"),
        ("UNRATE", "US Civilian Unemployment Rate", "Labor Market", "Percent"),
        ("M2SL", "M2 Money Supply", "Liquidity", "Billions USD"),
        ("DGS10", "10-Year Treasury Constant Maturity Rate", "Interest Rates", "Percent"),
        ("DGS2", "2-Year Treasury Constant Maturity Rate", "Interest Rates", "Percent"),
    ]

    # Market sentiment indicators
    market_indicators = [
        ("^VIX", "VIX", "CBOE Volatility Index (Market Fear)", "Market Sentiment", "Index"),
        ("DX-Y.NYB", "DXY", "US Dollar Currency Index", "Currencies", "Index"),
        ("INR=X", "USDINR", "US Dollar to Indian Rupee Exchange Rate", "Currencies", "INR per USD"),
        ("CL=F", "CRUDE_OIL", "WTI Crude Oil Spot Price", "Commodities", "USD per Barrel"),
        ("^TNX", "US10Y", "US 10-Year Treasury Note Yield", "Interest Rates", "Percent"),
    ]

    all_rows = []
    errors = []

    # Fetch FRED data (incremental filtering)
    for code, name, cat, unit in fred_indicators:
        latest = latest_dates.get(code)
        rows = fetch_fred_series(code, name, cat, unit)
        if latest:
            rows = [r for r in rows if r["period_date"] > latest]
        if rows:
            all_rows.extend(rows)

    # Fetch market indicators (incremental filtering)
    for sym, code, name, cat, unit in market_indicators:
        latest = latest_dates.get(code)
        rows = fetch_market_indicator(sym, code, name, cat, unit)
        if latest:
            rows = [r for r in rows if r["period_date"] > latest]
        if rows:
            all_rows.extend(rows)

    if not all_rows:
        print("\n  All macro indicators are up to date.")
        return {"table": TABLE_ID, "rows_appended": 0, "errors": errors}

    if dry_run:
        print(f"\n  [DRY RUN] Would append {len(all_rows)} macro rows.")
        return {"table": TABLE_ID, "rows_appended": 0, "errors": errors, "dry_run": True}

    # Dedup safety: batch delete overlapping rows for updated indicators
    indicators_to_update = list(set(r["indicator_code"] for r in all_rows))
    if indicators_to_update:
        min_date = min(r["period_date"] for r in all_rows)
        indicators_formatted = ", ".join(f"'{code}'" for code in indicators_to_update)
        try:
            client.query(
                f"DELETE FROM `{TABLE_REF}` WHERE indicator_code IN ({indicators_formatted}) AND period_date >= '{min_date}'"
            ).result()
        except Exception as e:
            print(f"  Warning during dedup delete: {e}")


    df = pd.DataFrame(all_rows)
    schema = [
        bigquery.SchemaField("indicator_code", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("indicator_name", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("category", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("period_date", "DATE", mode="REQUIRED"),
        bigquery.SchemaField("value", "FLOAT", mode="REQUIRED"),
        bigquery.SchemaField("unit", "STRING", mode="NULLABLE"),
    ]
    job_config = bigquery.LoadJobConfig(schema=schema, write_disposition="WRITE_APPEND")

    print(f"\n  Uploading {len(df):,} new macro rows to {TABLE_REF}...")
    job = client.load_table_from_dataframe(df, TABLE_REF, job_config=job_config)
    job.result()

    print(f"  SUCCESS: Appended {job.output_rows:,} rows.")
    return {"table": TABLE_ID, "rows_appended": job.output_rows, "errors": errors}


def run_all(dry_run: bool = False) -> dict:
    """
    Execute the full daily pipeline in order:
      1. market_regime_history
      2. individual_stock_history
      3. macro_economic_indicators
      4. regime_summary refresh
    """
    start_time = datetime.datetime.now()
    print("\n" + "█" * 60)
    print("  FinWise AI — Daily BigQuery Ingestion Pipeline")
    print(f"  Started: {start_time.isoformat()}")
    print(f"  Mode: {'DRY RUN' if dry_run else 'LIVE'}")
    print("█" * 60 + "\n")

    results = []

    # 1. Market Regime History (core 4 indices)
    try:
        print("\n[1/4] Market Regime History")
        r = ingest_market_regime.run(dry_run=dry_run)
        results.append(r)
    except Exception as e:
        results.append({"table": "market_regime_history", "error": str(e)})
        traceback.print_exc()

    # 2. Individual Stock History (130+ assets)
    try:
        print("\n[2/4] Individual Stock History")
        r = run_stocks_incremental(dry_run=dry_run)
        results.append(r)
    except Exception as e:
        results.append({"table": "individual_stock_history", "error": str(e)})
        traceback.print_exc()

    # 3. Macroeconomic Indicators
    try:
        print("\n[3/4] Macroeconomic Indicators")
        r = run_macro_incremental(dry_run=dry_run)
        results.append(r)
    except Exception as e:
        results.append({"table": "macro_economic_indicators", "error": str(e)})
        traceback.print_exc()

    # 4. Refresh regime_summary (must run after market_regime_history)
    try:
        print("\n[4/4] Regime Summary Refresh")
        r = refresh_regime_summary.run(dry_run=dry_run)
        results.append(r)
    except Exception as e:
        results.append({"table": "regime_summary", "error": str(e)})
        traceback.print_exc()

    # Summary
    end_time = datetime.datetime.now()
    duration = (end_time - start_time).total_seconds()

    summary = {
        "pipeline": "finwise-daily-ingest",
        "started": start_time.isoformat(),
        "completed": end_time.isoformat(),
        "duration_seconds": round(duration, 1),
        "dry_run": dry_run,
        "results": results,
        "overall_success": all(
            r.get("error") is None and not r.get("errors")
            for r in results
        ),
    }

    print("\n" + "█" * 60)
    print("  Pipeline Complete — Summary")
    print("█" * 60)
    print(json.dumps(summary, indent=2, default=str))

    return summary


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    run_all(dry_run=dry)
