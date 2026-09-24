"""
FinWise AI — Market Regime History Ingestion Pipeline
=====================================================
Incrementally ingests the 4 core index benchmarks into BigQuery table
`finwise-506509.finwise_data.market_regime_history`.

Assets:
  - SPY   → SP_500        (S&P 500 Index via ETF)
  - ^NSEI → Nifty_50      (NSE Nifty 50 Index)
  - GC=F  → Gold_Spot     (Gold Futures Spot Price)
  - ^TYX  → US_30Yr_Yield (US 30-Year Treasury Yield)

Strategy:
  1. Query BigQuery for MAX(trade_date) per asset_name
  2. Fetch only new data since (max_date + 1 day) from Yahoo Finance
  3. WRITE_APPEND new rows (with dedup safety DELETE before insert)
"""

import yfinance as yf
import pandas as pd
import datetime
import subprocess
from google.cloud import bigquery
from google.oauth2.credentials import Credentials

PROJECT_ID = "finwise-506509"
DATASET_ID = "finwise_data"
TABLE_ID = "market_regime_history"
TABLE_REF = f"{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}"

# These asset names must match the assetNameMap in frontend/services/bigqueryService.ts
REGIME_ASSETS = [
    {"symbol": "SPY",   "asset_name": "SP_500",        "description": "S&P 500 Index (via SPY ETF)"},
    {"symbol": "^NSEI", "asset_name": "Nifty_50",      "description": "NSE Nifty 50 Index"},
    {"symbol": "GC=F",  "asset_name": "Gold_Spot",     "description": "Gold Futures Spot Price"},
    {"symbol": "^TYX",  "asset_name": "US_30Yr_Yield", "description": "US 30-Year Treasury Yield"},
]

# Full historical backfill start date (only used when table is empty for an asset)
BACKFILL_START_DATE = "1985-01-01"


def get_credentials():
    """Get Google Cloud credentials (supports Cloud Functions ADC + local gcloud CLI)."""
    try:
        import google.auth
        credentials, _ = google.auth.default()
        return credentials
    except Exception:
        try:
            token = subprocess.check_output(
                ["gcloud", "auth", "print-access-token"]
            ).decode("utf-8").strip()
            return Credentials(token)
        except Exception as e:
            print(f"  [Auth] Failed to get credentials: {e}")
            return None



def get_latest_dates(client: bigquery.Client) -> dict:
    """
    Query BigQuery for the most recent trade_date per asset_name.
    Returns a dict: { 'SP_500': datetime.date(2026, 8, 29), ... }
    """
    query = f"""
        SELECT asset_name, MAX(trade_date) as latest_date
        FROM `{TABLE_REF}`
        GROUP BY asset_name
    """
    try:
        result = client.query(query).result()
        return {
            row.asset_name: row.latest_date
            for row in result
        }
    except Exception as e:
        print(f"  [BQ] Could not fetch latest dates (table may not exist yet): {e}")
        return {}


def delete_overlap_rows(client: bigquery.Client, asset_name: str, from_date: datetime.date):
    """
    Safety dedup: delete any rows for this asset from from_date onward
    before appending. Handles partial/failed prior runs.
    """
    query = f"""
        DELETE FROM `{TABLE_REF}`
        WHERE asset_name = '{asset_name}'
          AND trade_date >= '{from_date.isoformat()}'
    """
    try:
        client.query(query).result()
    except Exception:
        pass  # Table may not exist on first run


def fetch_asset_data(asset: dict, start_date: str, end_date: str) -> list:
    """Fetch daily close prices from Yahoo Finance for a single asset."""
    sym = asset["symbol"]
    asset_name = asset["asset_name"]
    try:
        ticker = yf.Ticker(sym)
        df = ticker.history(start=start_date, end=end_date, auto_adjust=True)
        if df.empty:
            print(f"  [{asset_name}] No new data from Yahoo Finance.")
            return []

        df = df.reset_index()
        df["Date"] = pd.to_datetime(df["Date"]).dt.tz_localize(None).dt.date

        rows = []
        for _, row in df.iterrows():
            close_val = float(row["Close"])
            if pd.notnull(close_val) and close_val > 0:
                rows.append({
                    "asset_name": asset_name,
                    "trade_date": row["Date"],
                    "close_price": round(close_val, 4),
                })
        print(f"  [{asset_name}] Fetched {len(rows)} new rows ({start_date} → {end_date})")
        return rows
    except Exception as e:
        print(f"  [{asset_name}] Error fetching from Yahoo Finance: {e}")
        return []


def run(dry_run: bool = False) -> dict:
    """
    Main entry point for market_regime_history ingestion.
    
    Returns:
        dict with keys: table, rows_appended, errors, assets_updated
    """
    print("=" * 60)
    print("  Market Regime History — Incremental Ingestion")
    print(f"  Table: {TABLE_REF}")
    print("=" * 60)

    creds = get_credentials()
    if not creds:
        return {"table": TABLE_ID, "rows_appended": 0, "errors": ["Auth failed"]}

    client = bigquery.Client(project=PROJECT_ID, credentials=creds)
    end_date = datetime.datetime.now().strftime("%Y-%m-%d")

    # Get latest dates per asset from BigQuery
    latest_dates = get_latest_dates(client)
    print(f"\n  Current data coverage in BigQuery:")
    for asset in REGIME_ASSETS:
        latest = latest_dates.get(asset["asset_name"], "NO DATA")
        print(f"    {asset['asset_name']}: latest = {latest}")

    # Fetch new data for each asset
    all_rows = []
    errors = []
    assets_updated = []

    for asset in REGIME_ASSETS:
        latest = latest_dates.get(asset["asset_name"])
        if latest:
            # Incremental: start from next day after latest
            start_date = (latest + datetime.timedelta(days=1)).isoformat()
        else:
            # Full backfill: no data exists for this asset
            start_date = BACKFILL_START_DATE
            print(f"  [{asset['asset_name']}] No existing data — full backfill from {BACKFILL_START_DATE}")

        # Skip if already up to date
        if latest and latest >= datetime.date.today() - datetime.timedelta(days=1):
            print(f"  [{asset['asset_name']}] Already up to date (latest: {latest})")
            continue

        rows = fetch_asset_data(asset, start_date, end_date)
        if rows:
            all_rows.extend(rows)
            assets_updated.append(asset["asset_name"])
        elif not latest:
            errors.append(f"{asset['asset_name']}: backfill returned no data")

    if not all_rows:
        print("\n  No new rows to append. All assets are up to date.")
        return {"table": TABLE_ID, "rows_appended": 0, "errors": errors, "assets_updated": []}

    if dry_run:
        print(f"\n  [DRY RUN] Would append {len(all_rows)} rows to {TABLE_REF}")
        return {"table": TABLE_ID, "rows_appended": 0, "errors": errors, "assets_updated": assets_updated, "dry_run": True}

    # Safety dedup: remove any overlapping rows before appending
    for asset_name in assets_updated:
        asset_rows = [r for r in all_rows if r["asset_name"] == asset_name]
        if asset_rows:
            min_date = min(r["trade_date"] for r in asset_rows)
            delete_overlap_rows(client, asset_name, min_date)

    # Upload to BigQuery
    df = pd.DataFrame(all_rows)
    schema = [
        bigquery.SchemaField("asset_name", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("trade_date", "DATE", mode="REQUIRED"),
        bigquery.SchemaField("close_price", "FLOAT", mode="REQUIRED"),
    ]

    job_config = bigquery.LoadJobConfig(
        schema=schema,
        write_disposition="WRITE_APPEND",
    )

    print(f"\n  Uploading {len(df)} new rows to {TABLE_REF}...")
    job = client.load_table_from_dataframe(df, TABLE_REF, job_config=job_config)
    job.result()

    print(f"  SUCCESS: Appended {job.output_rows} rows to {TABLE_REF}")
    return {
        "table": TABLE_ID,
        "rows_appended": job.output_rows,
        "errors": errors,
        "assets_updated": assets_updated,
    }


if __name__ == "__main__":
    import sys
    dry = "--dry-run" in sys.argv
    result = run(dry_run=dry)
    print(f"\nResult: {result}")
