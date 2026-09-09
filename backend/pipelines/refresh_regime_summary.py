"""
FinWise AI — Regime Summary Refresh
====================================
Recomputes the `regime_summary` materialized table from `market_regime_history`
after daily ingestion. This table powers the top-level market intelligence
dashboard with 30-year CAGR, volatility, and crash statistics.

Strategy:
  CREATE OR REPLACE TABLE `regime_summary` using aggregated analytics
  from the full `market_regime_history` table.
"""

import subprocess
from google.cloud import bigquery
from google.oauth2.credentials import Credentials

PROJECT_ID = "finwise-506509"
DATASET_ID = "finwise_data"
TABLE_REF = f"{PROJECT_ID}.{DATASET_ID}.regime_summary"
SOURCE_TABLE = f"{PROJECT_ID}.{DATASET_ID}.market_regime_history"


def get_credentials():
    """Get Google Cloud credentials via gcloud CLI token."""
    try:
        token = subprocess.check_output(
            ["gcloud", "auth", "print-access-token"]
        ).decode("utf-8").strip()
        return Credentials(token)
    except Exception as e:
        print(f"  [Auth] Failed to get gcloud token: {e}")
        return None


REGIME_SUMMARY_SQL = f"""
CREATE OR REPLACE TABLE `{TABLE_REF}` AS
WITH daily_returns AS (
    SELECT
        asset_name,
        trade_date,
        close_price,
        LAG(close_price) OVER (PARTITION BY asset_name ORDER BY trade_date) AS prev_close,
        SAFE_DIVIDE(
            close_price - LAG(close_price) OVER (PARTITION BY asset_name ORDER BY trade_date),
            LAG(close_price) OVER (PARTITION BY asset_name ORDER BY trade_date)
        ) AS daily_return
    FROM `{SOURCE_TABLE}`
),
asset_stats AS (
    SELECT
        asset_name,
        COUNT(*) AS total_trading_days,
        MIN(trade_date) AS data_start_date,
        MAX(trade_date) AS data_end_date,
        -- Annualized Return (CAGR) from first to last close price
        ROUND(
            (POWER(
                SAFE_DIVIDE(
                    ARRAY_AGG(close_price ORDER BY trade_date DESC LIMIT 1)[OFFSET(0)],
                    ARRAY_AGG(close_price ORDER BY trade_date ASC LIMIT 1)[OFFSET(0)]
                ),
                SAFE_DIVIDE(252.0, COUNT(*))
            ) - 1) * 100,
            2
        ) AS annualized_return_cagr,
        -- Annualized Volatility
        ROUND(STDDEV(daily_return) * SQRT(252) * 100, 2) AS annualized_volatility,
        -- Worst & Best Single Day
        ROUND(MIN(daily_return) * 100, 4) AS worst_single_day_crash,
        ROUND(MAX(daily_return) * 100, 4) AS best_single_day_gain,
        -- Average Daily Return
        ROUND(AVG(daily_return) * 100, 6) AS avg_daily_return_pct
    FROM daily_returns dr
    WHERE daily_return IS NOT NULL
    GROUP BY asset_name
)
SELECT
    asset_name,
    total_trading_days,
    data_start_date,
    data_end_date,
    annualized_return_cagr,
    annualized_volatility,
    worst_single_day_crash,
    best_single_day_gain,
    avg_daily_return_pct
FROM asset_stats
ORDER BY annualized_return_cagr DESC
"""


def run(dry_run: bool = False) -> dict:
    """
    Recompute the regime_summary table from market_regime_history.
    
    Returns:
        dict with keys: table, status, error
    """
    print("=" * 60)
    print("  Regime Summary — Refresh / Recompute")
    print(f"  Target: {TABLE_REF}")
    print(f"  Source: {SOURCE_TABLE}")
    print("=" * 60)

    if dry_run:
        print("\n  [DRY RUN] Would execute CREATE OR REPLACE TABLE query")
        print(f"  SQL preview (first 200 chars):\n  {REGIME_SUMMARY_SQL[:200]}...")
        return {"table": "regime_summary", "status": "dry_run", "error": None}

    creds = get_credentials()
    if not creds:
        return {"table": "regime_summary", "status": "failed", "error": "Auth failed"}

    client = bigquery.Client(project=PROJECT_ID, credentials=creds)

    try:
        print("\n  Executing regime summary recomputation query...")
        job = client.query(REGIME_SUMMARY_SQL)
        job.result()  # Wait for completion
        print(f"  SUCCESS: regime_summary table refreshed.")

        # Verify row count
        count_result = client.query(f"SELECT COUNT(*) as cnt FROM `{TABLE_REF}`").result()
        row_count = list(count_result)[0].cnt
        print(f"  Verification: {row_count} asset summaries in regime_summary.")

        return {"table": "regime_summary", "status": "success", "rows": row_count, "error": None}
    except Exception as e:
        print(f"  ERROR: Failed to refresh regime_summary: {e}")
        return {"table": "regime_summary", "status": "failed", "error": str(e)}


if __name__ == "__main__":
    import sys
    dry = "--dry-run" in sys.argv
    result = run(dry_run=dry)
    print(f"\nResult: {result}")
