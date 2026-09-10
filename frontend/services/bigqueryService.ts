import { MarketBenchmark, MarketAnalysis } from '../types';

const MARKET_ANALYSIS_URL = "/api/bigquery/market-analysis";
const BQ_PROXY_URL = "/api/bigquery/query";
const CLOUD_FUNCTION_FALLBACK = "https://us-central1-finwise-506509.cloudfunctions.net/finwise-bq-api";

/**
 * LIVE BIGQUERY DEEP ANALYTICS
 * Fetches comprehensive market intelligence from finwise-506509.finwise_data:
 * - 30Y regime summary (CAGR, volatility, worst/best days)
 * - Current prices with trailing 1Y returns
 * - 30-day momentum and recent volatility
 * - Peak-to-trough max drawdowns with exact dates
 * - Full price range history (all-time highs/lows, data coverage)
 */

const assetNameMap: Record<string, string> = {
  'Gold_Spot': 'Gold & Precious Metals (GC=F)',
  'SP_500': 'US Equity S&P 500 (SPY)',
  'Nifty_50': 'Indian Equity Nifty 50 (^NSEI)',
  'US_30Yr_Yield': 'Fixed Income & Bonds (^TYX)',
};

function getRegimeLabel(momentum: number, volatility: number): string {
  if (momentum > 40) return '🔥 Strong Bull';
  if (momentum > 10) return '🟢 Uptrend';
  if (momentum > -15) return '🟡 Neutral';
  if (momentum > -40) return '🟠 Pullback';
  return '🔵 Oversold';
}

/**
 * Primary function: Fetches deep market analysis via the /api/bigquery/market-analysis endpoint.
 * Consolidates 5 parallel BigQuery SQL queries into a single enriched MarketBenchmark array.
 */
export const fetchMarketAnalysis = async (market: string): Promise<{ benchmarks: MarketBenchmark[], rawAnalysis: MarketAnalysis }> => {
  try {
    const response = await fetch(MARKET_ANALYSIS_URL);
    if (response.ok) {
      const analysis: MarketAnalysis & { success: boolean } = await response.json();
      if (analysis.success) {
        const benchmarks = buildEnrichedBenchmarks(analysis, market);
        return { benchmarks, rawAnalysis: analysis };
      }
    }
  } catch (err) {
    console.warn("[BigQuery Service] Market analysis endpoint failed, trying fallback:", err);
  }

  // Fallback: fetch just regime summary
  return fetchFallbackBenchmarks(market);
};

function buildEnrichedBenchmarks(analysis: MarketAnalysis, market: string): MarketBenchmark[] {
  const { regimeSummary, currentPrices, momentum30d, maxDrawdowns, priceRange } = analysis;

  // Index lookup helpers
  const priceMap = new Map(currentPrices.map(r => [r.asset_name, r]));
  const momentumMap = new Map(momentum30d.map(r => [r.asset_name, r]));
  const drawdownMap = new Map(maxDrawdowns.map(r => [r.asset_name, r]));
  const rangeMap = new Map(priceRange.map(r => [r.asset_name, r]));

  const benchmarks: MarketBenchmark[] = regimeSummary.map(regime => {
    const name = regime.asset_name;
    const price = priceMap.get(name);
    const mom = momentumMap.get(name);
    const dd = drawdownMap.get(name);
    const range = rangeMap.get(name);

    const momentum = Number(mom?.annualized_momentum_pct) || 0;
    const recentVol = Number(mom?.recent_volatility_pct) || 0;
    const currentPriceVal = Number(price?.current_price) || 0;
    const ath = Number(range?.all_time_high) || 0;
    const isYield = name === 'US_30Yr_Yield';
    const regimeLabel = isYield ? '🟢 Steady Yield' : getRegimeLabel(momentum, recentVol);
    const distFromATH = ath > 0 ? ((currentPriceVal - ath) / ath * 100).toFixed(1) : 'N/A';

    return {
      assetClass: assetNameMap[name] || name,
      cagr30Y: isYield ? currentPriceVal : (Number(regime.annualized_return_cagr) || 0),
      volatility_std: isYield ? 4.2 : (Number(regime.annualized_volatility) || 0),
      maxDrawdown: isYield ? 'Capital Preserved (Govt Backed)' : `${dd?.max_drawdown_pct || 'N/A'}% (${dd?.max_drawdown_date || 'N/A'})`,
      currentValuation: isYield ? `Fixed Yield: ${currentPriceVal}% | Low Risk` : `${regimeLabel} | ${distFromATH}% from ATH`,
      currentPrice: currentPriceVal,
      return1Y: isYield ? 5.26 : (Number(price?.return_1yr_pct) || 0),
      momentum30d: momentum,
      recentVolatility: recentVol,
      allTimeHigh: ath,
      allTimeLow: Number(range?.all_time_low) || 0,
      maxDrawdownPct: isYield ? 0 : (Number(dd?.max_drawdown_pct) || 0),
      maxDrawdownDate: dd?.max_drawdown_date || 'N/A',
      dataStartDate: range?.data_start_date || 'N/A',
      dataEndDate: range?.data_end_date || 'N/A',
      totalTradingDays: Number(range?.total_trading_days) || 0,
    };
  });

  // Sort by market preference
  if (market === 'IN') {
    benchmarks.sort((a, b) => (a.assetClass.includes('Nifty') ? -1 : b.assetClass.includes('Nifty') ? 1 : 0));
  } else if (market === 'US') {
    benchmarks.sort((a, b) => (a.assetClass.includes('S&P') ? -1 : b.assetClass.includes('S&P') ? 1 : 0));
  }

  return benchmarks;
}

async function fetchFallbackBenchmarks(market: string): Promise<{ benchmarks: MarketBenchmark[], rawAnalysis: MarketAnalysis }> {
  // Try local proxy
  try {
    const response = await fetch(BQ_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: "SELECT * FROM `finwise-506509.finwise_data.regime_summary` ORDER BY annualized_return_cagr DESC" })
    });
    if (response.ok) {
      const result = await response.json();
      if (result.success && Array.isArray(result.rows) && result.rows.length > 0) {
        const benchmarks = result.rows.map((row: any) => ({
          assetClass: assetNameMap[row.asset_name] || row.asset_name,
          cagr30Y: Number(row.annualized_return_cagr) || 0,
          volatility_std: Number(row.annualized_volatility) || 0,
          maxDrawdown: `${row.worst_single_day_crash || 'N/A'}% (Single-Day)`,
          currentValuation: 'Live BQ (Summary Only)',
        }));
        const emptyAnalysis: MarketAnalysis = { timestamp: new Date().toISOString(), regimeSummary: result.rows, currentPrices: [], momentum30d: [], maxDrawdowns: [], priceRange: [] };
        return { benchmarks, rawAnalysis: emptyAnalysis };
      }
    }
  } catch (err) {
    console.warn("[BigQuery Service] Local proxy fallback failed:", err);
  }

  // Cloud Function fallback
  const response = await fetch(`${CLOUD_FUNCTION_FALLBACK}?market=${market}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch live BigQuery data. API returned status: ${response.status}`);
  }
  const data = await response.json();
  const benchmarks = data.map((row: any) => ({
    assetClass: assetNameMap[row.asset_name] || row.asset_name || 'Unknown',
    cagr30Y: Number(row.annualized_return_cagr) || 0,
    volatility_std: Number(row.annualized_volatility) || 0,
    maxDrawdown: row.worst_single_day_crash ? `${row.worst_single_day_crash}% (Single-Day)` : 'N/A',
    currentValuation: 'Cloud Function Fallback',
  }));
  const emptyAnalysis: MarketAnalysis = { timestamp: new Date().toISOString(), regimeSummary: data, currentPrices: [], momentum30d: [], maxDrawdowns: [], priceRange: [] };
  return { benchmarks, rawAnalysis: emptyAnalysis };
}

/**
 * Legacy compatibility wrapper
 */
export const fetchHistoricalBenchmarks = async (market: string): Promise<MarketBenchmark[]> => {
  const { benchmarks } = await fetchMarketAnalysis(market);
  return benchmarks;
};

/**
 * Fetch top individual stocks for a specific category from BigQuery
 */
export const fetchTopStocksByCategory = async (category: string, market: string = 'IN') => {
  try {
    const response = await fetch(`/api/bigquery/top-stocks?category=${encodeURIComponent(category)}&market=${encodeURIComponent(market)}`);
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.rows) {
        return data.rows;
      }
    }
  } catch (err) {
    console.warn("[BigQuery Service] Failed to fetch top stocks:", err);
  }
  return [];
};

/**
 * Fetch live Macroeconomic indicators & detected regime from BigQuery
 */
export const fetchMacroRegime = async () => {
  try {
    const response = await fetch('/api/bigquery/macro-regime');
    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        return data.regime;
      }
    }
  } catch (err) {
    console.warn("[BigQuery Service] Failed to fetch macro regime:", err);
  }
  return null;
};

/**
 * Data Health & Freshness Check
 * Queries the latest data dates across all 4 BigQuery tables.
 * Used to display a "Data as of" badge on the dashboard.
 */
export interface DataHealthTable {
  table: string;
  latestDate: string;
  totalRows: number;
  daysStale: number;
  isFresh: boolean;
}

export interface DataHealthResponse {
  success: boolean;
  timestamp: string;
  overallFresh: boolean;
  stalestTable: string;
  stalestDays: number;
  tables: DataHealthTable[];
}

export const fetchDataHealth = async (): Promise<DataHealthResponse | null> => {
  try {
    const response = await fetch('/api/bigquery/data-health');
    if (response.ok) {
      const data: DataHealthResponse = await response.json();
      if (data.success) {
        return data;
      }
    }
  } catch (err) {
    console.warn("[BigQuery Service] Failed to fetch data health:", err);
  }
  return null;
};
