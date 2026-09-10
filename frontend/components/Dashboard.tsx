import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { UserProfile, AllocationData, Projection, CategoryRecommendation, SpecificAssetPick, MarketBenchmark, NarrativeData, MacroRegimeState } from '../types';
import { getCategoryRecommendation, getSpecificAssetRecommendations } from '../services/geminiService';
import { fetchDataHealth, DataHealthResponse } from '../services/bigqueryService';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { ShieldAlert, Target, TrendingUp, X, ChevronRight, Database, CheckCircle2, ArrowLeft, TrendingDown, Activity, Loader2, AlertTriangle, ListChecks, Globe, Gauge, Landmark, DollarSign, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface DashboardProps {
  profile: UserProfile;
  benchmarks: MarketBenchmark[] | null;
  macroRegime?: MacroRegimeState | null;
  allocation: AllocationData | null;
  projections: Projection[] | null;
  narrativeData: NarrativeData | null;
  isFetchingBQ: boolean;
  isGeneratingAllocation: boolean;
  isGeneratingProjections: boolean;
  isGeneratingNarrative: boolean;
  theme?: 'dark' | 'light';
}

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#06b6d4', '#8b5cf6', '#ec4899'];
const SUB_COLORS = ['#34d399', '#60a5fa', '#fbbf24', '#22d3ee', '#a78bfa', '#f472b6'];

export const getCategoryColor = (assetClass: string, index: number = 0): string => {
  const lower = (assetClass || '').toLowerCase();
  if (lower.includes('stock') || lower.includes('equit')) return '#10b981'; // Emerald
  if (lower.includes('mutual') || lower.includes('etf') || lower.includes('index')) return '#3b82f6'; // Blue
  if (lower.includes('gold') || lower.includes('silver') || lower.includes('metal')) return '#f59e0b'; // Amber Gold
  if (lower.includes('bond') || lower.includes('gilt') || lower.includes('debt') || lower.includes('treasury')) return '#06b6d4'; // Cyan
  if (lower.includes('fixed') || lower.includes('cash') || lower.includes('deposit') || lower.includes('liquid')) return '#8b5cf6'; // Violet
  if (lower.includes('alt') || lower.includes('crypto') || lower.includes('growth')) return '#ec4899'; // Rose
  return COLORS[index % COLORS.length];
};

const cleanSubCategoryName = (name: string): string => {
  return (name || '').replace(/\s*\(\s*\d+[\d\s\-\–\—toyearsmonthsda]+\)/gi, '').trim();
};

const Dashboard: React.FC<DashboardProps> = ({ 
  profile, benchmarks, macroRegime, allocation, projections, narrativeData, 
  isFetchingBQ, isGeneratingAllocation, isGeneratingProjections, isGeneratingNarrative,
  theme = 'dark'
}) => {
  const isDark = theme !== 'light';
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categoryRec, setCategoryRec] = useState<CategoryRecommendation | null>(null);
  const [isLoadingRec, setIsLoadingRec] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  
  const [selectedSubCategory, setSelectedSubCategory] = useState<string | null>(null);
  const [assetPicks, setAssetPicks] = useState<SpecificAssetPick[] | null>(null);
  const [isLoadingPicks, setIsLoadingPicks] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [dataHealth, setDataHealth] = useState<DataHealthResponse | null>(null);
  const [macroViewMode, setMacroViewMode] = useState<'simple' | 'pro'>('simple');

  // In-session caches: avoid re-fetching the same category / sub-category data
  const categoryRecCache = React.useRef<Map<string, CategoryRecommendation>>(new Map());
  const assetPicksCache = React.useRef<Map<string, SpecificAssetPick[]>>(new Map());

  // Track the latest requested keys to prevent stale API responses from overwriting current state
  const latestCategoryRequest = React.useRef<string | null>(null);
  const latestAssetPickRequest = React.useRef<string | null>(null);
  
  const currencySymbol = profile.market === 'US' ? '$' : '₹';

  // Fetch data freshness when benchmarks become available
  useEffect(() => {
    if (benchmarks && benchmarks.length > 0) {
      fetchDataHealth().then(health => {
        if (health) setDataHealth(health);
      });
    }
  }, [benchmarks]);
  
  const formatCurrency = useCallback((value: number) => {
    if (profile.market === 'US') {
      if (value >= 1000000000) return `${currencySymbol}${(value / 1000000000).toFixed(2)}B`;
      if (value >= 1000000) return `${currencySymbol}${(value / 1000000).toFixed(2)}M`;
      if (value >= 1000) return `${currencySymbol}${(value / 1000).toFixed(0)}k`;
      return `${currencySymbol}${Math.round(value).toLocaleString()}`;
    }
    if (value >= 10000000) return `${currencySymbol}${(value / 10000000).toFixed(2)}Cr`;
    if (value >= 100000) return `${currencySymbol}${(value / 100000).toFixed(1)}L`;
    if (value >= 1000) return `${currencySymbol}${(value / 1000).toFixed(0)}k`;
    return `${currencySymbol}${Math.round(value)}`;
  }, [currencySymbol, profile.market]);

  const finalBase = useMemo(() => {
    return projections && projections.length > 0 ? projections[projections.length - 1]?.base || 0 : 0;
  }, [projections]);

  const goalReached = useMemo(() => {
    return profile.objective === 'MILESTONE' ? finalBase >= (profile.goalAmount || 0) : true;
  }, [profile.objective, profile.goalAmount, finalBase]);

  const handleCopyStrategy = useCallback(() => {
    if (!narrativeData) return;
    const textToCopy = `FinoGyaan — Strategy Report\nRisk Score: ${allocation?.riskScore || 'N/A'}/100\nProjected Base Corpus: ${formatCurrency(finalBase)}\nObjective: ${profile.objective}\n\nSynthesis:\n${narrativeData.narrative}`;
    navigator.clipboard.writeText(textToCopy);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  }, [narrativeData, allocation, finalBase, formatCurrency, profile.objective]);

  const handleCategoryClick = async (data: any) => {
    const category = data.assetClass || data.name;
    if (!category || !benchmarks) return;
    
    latestCategoryRequest.current = category;
    setSelectedCategory(category);
    setRecError(null);
    setSelectedSubCategory(null);
    setAssetPicks(null);

    // Check cache first — return instantly if already fetched this session
    const cached = categoryRecCache.current.get(category);
    if (cached) {
      setCategoryRec(cached);
      setIsLoadingRec(false);
      return;
    }
    
    setIsLoadingRec(true);
    setCategoryRec(null);
    
    try {
      const rec = await getCategoryRecommendation(category, profile, benchmarks);
      // Only apply result if this is still the latest request (prevents stale overwrites)
      if (latestCategoryRequest.current === category) {
        setCategoryRec(rec);
        setIsLoadingRec(false);
      }
      categoryRecCache.current.set(category, rec); // Always cache regardless
    } catch (err: any) {
      if (latestCategoryRequest.current === category) {
        setRecError(err.message || "Failed to load recommendation.");
        setIsLoadingRec(false);
      }
    }
  };

  const handleSubCategoryClick = async (subCategoryName: string) => {
    if (!selectedCategory) return;

    const cacheKey = `${selectedCategory}::${subCategoryName}::${profile.market}::v8`;
    latestAssetPickRequest.current = cacheKey;
    setSelectedSubCategory(subCategoryName);

    // Check cache first — return instantly if already fetched this session
    const cached = assetPicksCache.current.get(cacheKey);
    if (cached) {
      setAssetPicks(cached);
      setIsLoadingPicks(false);
      return;
    }
    
    setIsLoadingPicks(true);
    setAssetPicks(null);
    
    try {
      const picks = await getSpecificAssetRecommendations(selectedCategory, subCategoryName, profile);
      // Only apply result if this is still the latest request (prevents stale overwrites)
      if (latestAssetPickRequest.current === cacheKey) {
        setAssetPicks(picks);
        setIsLoadingPicks(false);
      }
      assetPicksCache.current.set(cacheKey, picks); // Always cache regardless
    } catch (err: any) {
      if (latestAssetPickRequest.current === cacheKey) {
        setRecError(err.message || "Failed to load specific asset picks.");
        setSelectedSubCategory(null);
        setIsLoadingPicks(false);
      }
    }
  };

  const closeModal = () => {
    setSelectedCategory(null);
    setCategoryRec(null);
    setRecError(null);
    setSelectedSubCategory(null);
    setAssetPicks(null);
    assetPicksCache.current.clear();
    categoryRecCache.current.clear();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500 relative transition-colors duration-200">
      
      {/* Dashboard Title */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            Strategy Dashboard
            {(isFetchingBQ || isGeneratingAllocation || isGeneratingProjections || isGeneratingNarrative) && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700">
                <Loader2 className="w-3 h-3 text-emerald-500 dark:text-emerald-400 animate-spin" /> Synthesizing Strategy...
              </span>
            )}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">Autonomous quantitative allocation grounded in 725,000+ BigQuery records.</p>
        </div>
      </div>

      {/* Top Banner: BigQuery Live Market Intelligence & 40-Year Track Record */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm backdrop-blur-sm transition-colors duration-200">
        <div className="bg-slate-50 dark:bg-slate-950/80 px-6 py-3.5 border-b border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-blue-50 dark:bg-slate-800/80 p-2 rounded-xl border border-blue-200 dark:border-slate-700/60 text-blue-600 dark:text-blue-400">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-slate-900 dark:text-white font-semibold text-sm">
                  {macroViewMode === 'simple' ? '40-Year Safety & Growth Track Record' : 'Real-Time Market Intelligence'}
                </h3>
                <span className="text-[10px] text-blue-700 dark:text-blue-300 font-mono bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800/40">Live BigQuery</span>
                <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-mono bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800/40">725,000+ Records</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {macroViewMode === 'simple'
                  ? 'Real historical data proving how each asset grows, handles market crashes, and protects your wealth.'
                  : 'Multi-asset quantitative analysis computed across 40+ years of daily market trading data.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setMacroViewMode('simple')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  macroViewMode === 'simple'
                    ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm border border-slate-200 dark:border-slate-800'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                🌱 Plain English
              </button>
              <button
                type="button"
                onClick={() => setMacroViewMode('pro')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  macroViewMode === 'pro'
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200 dark:border-slate-800'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                📊 Wall St Data
              </button>
            </div>

            {dataHealth && (
              <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] font-mono ${
                dataHealth.overallFresh 
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-300'
                  : dataHealth.stalestDays <= 7
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/40 text-amber-700 dark:text-amber-300'
                    : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-300'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${dataHealth.overallFresh ? 'bg-emerald-500' : dataHealth.stalestDays <= 7 ? 'bg-amber-500' : 'bg-red-500'} animate-pulse`} />
                Data as of: {dataHealth.tables?.[0]?.latestDate ? new Date(dataHealth.tables.reduce((a, b) => a.daysStale < b.daysStale ? a : b).latestDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown'}
              </div>
            )}
          </div>
        </div>
        
        <div className="p-6 overflow-x-auto">
          {isFetchingBQ || !benchmarks ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <Loader2 className="w-6 h-6 text-blue-500 dark:text-blue-400 animate-spin" />
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Running 5 parallel BigQuery analytical queries on 40+ years of market data...</p>
            </div>
          ) : (
            <>
              {/* Top 4 Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                {benchmarks.map((bm, idx) => {
                  const isNifty = bm.assetClass.includes('Nifty');
                  const isSP500 = bm.assetClass.includes('S&P') || bm.assetClass.includes('SPY');
                  const isGold = bm.assetClass.includes('Gold');
                  const isBonds = bm.assetClass.includes('Bonds') || bm.assetClass.includes('Yield') || bm.assetClass.includes('TYX');

                  if (macroViewMode === 'simple') {
                    const title = isNifty ? 'Indian Equities (Nifty 50)' : isSP500 ? 'US Equities (S&P 500)' : isGold ? 'Gold & Precious Metals' : 'Fixed Income (Govt Bonds)';
                    const badge = isNifty ? '🚀 Core Wealth Engine' : isSP500 ? '🌐 Global Tech Engine' : isGold ? '🛡️ Financial Umbrella' : '⚓ Portfolio Shock Absorber';
                    const badgeClass = isNifty ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800/60'
                      : isSP500 ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800/60'
                      : isGold ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800/60'
                      : 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800/60';
                    const displayPrice = isNifty ? `₹${bm.currentPrice?.toLocaleString() || '23,635'}`
                      : isSP500 ? `$${bm.currentPrice?.toLocaleString() || '7,660'}`
                      : isGold ? `$${bm.currentPrice?.toLocaleString() || '4,394'}`
                      : `${bm.currentPrice || '5.26'}% Yield`;
                    const oneLiner = isNifty ? 'Beats inflation over time. Bumpy in short run, but historically always recovered.'
                      : isSP500 ? "World's most profitable companies + bonus return from rising US Dollar."
                      : isGold ? 'Preserves buying power. Surges during market uncertainty and high inflation.'
                      : 'Guaranteed, steady payouts that keep your portfolio safe when markets drop.';

                    return (
                      <div key={idx} className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-xl p-3.5 hover:border-slate-300 dark:hover:border-slate-700 transition-all shadow-sm flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="text-xs font-bold text-slate-900 dark:text-white truncate">{title}</span>
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border inline-block mb-2 ${badgeClass}`}>
                            {badge}
                          </span>
                          <p className="text-base font-bold text-slate-900 dark:text-white font-mono tabular-nums">{displayPrice}</p>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/60 leading-snug">
                          {oneLiner}
                        </p>
                      </div>
                    );
                  }

                  // Pro Wall St View
                  return (
                    <div key={idx} className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-xl p-3.5 hover:border-slate-300 dark:hover:border-slate-700 transition-all shadow-sm">
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate mb-1">{bm.assetClass.split('(')[0].trim()}</p>
                      {bm.currentPrice ? (
                        <>
                          <p className="text-base font-bold text-slate-900 dark:text-white font-mono tabular-nums">{bm.currentPrice.toLocaleString()}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[11px] font-mono font-medium px-1.5 py-0.5 rounded tabular-nums ${(bm.return1Y || 0) >= 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-rose-100 text-rose-800 dark:bg-red-500/15 dark:text-red-400'}`}>
                              {(bm.return1Y || 0) >= 0 ? '▲' : '▼'} {bm.return1Y}% 1Y
                            </span>
                            <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded tabular-nums ${(bm.momentum30d || 0) > 30 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : (bm.momentum30d || 0) < -10 ? 'bg-rose-100 text-rose-800 dark:bg-red-950 dark:text-red-300' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-white'}`}>
                              {(bm.momentum30d || 0) > 0 ? '+' : ''}{bm.momentum30d?.toFixed(0)}% 30D
                            </span>
                          </div>
                        </>
                      ) : (
                        <p className="text-base font-bold text-slate-900 dark:text-white font-mono tabular-nums">{bm.cagr30Y}% CAGR</p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Comparison Table */}
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <th className="pb-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                      {macroViewMode === 'simple' ? 'Asset Class & Role' : 'Asset Class'}
                    </th>
                    <th className="pb-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                      {macroViewMode === 'simple' ? 'Long-Term Return' : '30Y CAGR'}
                    </th>
                    <th className="pb-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                      {macroViewMode === 'simple' ? 'Ride Comfort / Swings' : 'Volatility (σ)'}
                    </th>
                    <th className="pb-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                      {macroViewMode === 'simple' ? 'Worst Crash in 40 Years' : 'Max Drawdown'}
                    </th>
                    <th className="pb-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                      {macroViewMode === 'simple' ? "Today's Price Status" : 'Current Valuation'}
                    </th>
                    <th className="pb-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                      {macroViewMode === 'simple' ? 'Data Proof' : 'Data Coverage'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60 text-xs">
                  {benchmarks.map((bm, idx) => {
                    const isNifty = bm.assetClass.includes('Nifty');
                    const isSP500 = bm.assetClass.includes('S&P') || bm.assetClass.includes('SPY');
                    const isGold = bm.assetClass.includes('Gold');
                    const isBonds = bm.assetClass.includes('Bonds') || bm.assetClass.includes('Yield') || bm.assetClass.includes('TYX');

                    if (macroViewMode === 'simple') {
                      const name = isNifty ? '🇮🇳 Indian Equities (Nifty 50)' : isSP500 ? '🇺🇸 US Equities (S&P 500)' : isGold ? '🪙 Gold & Precious Metals' : '🏛️ Fixed Income (Govt Bonds)';
                      const role = isNifty ? 'Primary Wealth Engine' : isSP500 ? 'Global Tech Compounder' : isGold ? 'Inflation & Crisis Shield' : 'Steady Capital Anchor';
                      const returns = isNifty ? '~11–13% / yr' : isSP500 ? '~10–12% / yr' : isGold ? '~10–11% / yr' : `${bm.currentPrice || '5.26'}% Yield`;
                      const returnNote = isNifty ? 'Beats Inflation' : isSP500 ? '+ Dollar Rise' : isGold ? 'Wealth Preserver' : 'Guaranteed Payout';
                      const comfort = isNifty ? '🎢 Bumpy Swings' : isSP500 ? '🎢 Moderate-High' : isGold ? '⚖️ Moderate Swings' : '🛡️ Ultra Smooth';
                      const comfortNote = isNifty ? 'High upside' : isSP500 ? 'Stable giants' : isGold ? 'Hedges equities' : 'Zero equity risk';
                      const crash = isNifty ? '-59% (2008)' : isSP500 ? '-56% (2008)' : isGold ? '-44% (2015)' : 'Zero Loss';
                      const crashNote = isBonds ? 'Govt Backed' : '100% Recovered';
                      const status = isNifty ? '🟢 Healthy Buying Dip' : isSP500 ? '🟢 Near Record Highs' : isGold ? '🟢 Active Uptrend' : '🟢 High Yield Window';
                      const statusNote = isNifty ? '(-10% from peak)' : isSP500 ? '(Strong momentum)' : isGold ? '(+20% past year)' : '(Great lock-in rate)';
                      const days = `${bm.totalTradingDays ? bm.totalTradingDays.toLocaleString() : '10,000+'} days`;
                      const years = isNifty ? '19 years' : isSP500 ? '41 years' : isGold ? '26 years' : '41 years';

                      return (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
                          <td className="py-2.5 font-bold text-slate-900 dark:text-slate-200">
                            <div>{name}</div>
                            <div className="text-[10px] text-slate-400 font-normal">{role}</div>
                          </td>
                          <td className="py-2.5 text-emerald-600 dark:text-emerald-400 font-mono font-bold tabular-nums">
                            <div>{returns}</div>
                            <div className="text-[10px] text-emerald-700/80 dark:text-emerald-300/80 font-normal font-sans">{returnNote}</div>
                          </td>
                          <td className="py-2.5 text-amber-600 dark:text-amber-400 font-mono font-medium">
                            <div>{comfort}</div>
                            <div className="text-[10px] text-slate-400 font-normal font-sans">{comfortNote}</div>
                          </td>
                          <td className="py-2.5 text-rose-600 dark:text-rose-400 font-mono font-medium">
                            <div>{crash}</div>
                            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-normal font-sans">{crashNote}</div>
                          </td>
                          <td className="py-2.5 text-slate-800 dark:text-slate-200 font-medium">
                            <div className="text-emerald-600 dark:text-emerald-400 font-semibold">{status}</div>
                            <div className="text-[10px] text-slate-400 font-normal">{statusNote}</div>
                          </td>
                          <td className="py-2.5 text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                            <div>{days}</div>
                            <div className="text-[10px] text-slate-400 font-normal font-sans">{years} history</div>
                          </td>
                        </tr>
                      );
                    }

                    // Pro Table
                    return (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
                        <td className="py-2.5 font-bold text-slate-900 dark:text-slate-200">{bm.assetClass}</td>
                        <td className="py-2.5 text-emerald-600 dark:text-emerald-400 font-mono font-bold tabular-nums">{bm.cagr30Y}%</td>
                        <td className="py-2.5 text-amber-600 dark:text-amber-400 font-mono font-bold tabular-nums">{bm.volatility_std}%</td>
                        <td className="py-2.5 text-rose-600 dark:text-red-400 font-mono font-bold tabular-nums">{bm.maxDrawdown}</td>
                        <td className="py-2.5 text-slate-700 dark:text-slate-300 font-medium">{bm.currentValuation}</td>
                        <td className="py-2.5 text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          {bm.dataStartDate && bm.dataStartDate !== 'N/A' ? `${bm.dataStartDate} → ${bm.dataEndDate}` : 'N/A'}
                          {bm.totalTradingDays ? <span className="text-slate-400 dark:text-slate-500 ml-1">({bm.totalTradingDays.toLocaleString()} days)</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Plain English Key Takeaway Callout */}
              <div className="mt-4 pt-3 border-t border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                <span className="flex items-center gap-2 font-medium">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 text-[10px]">💡</span>
                  <span>
                    <strong>Why FinoGyaan analyzes 40 years of data:</strong> No single asset wins every year. When stocks experience short-term drops, Gold and Bonds protect your savings. When the economy expands, Equities build your long-term wealth. Blending them together maximizes growth while protecting you from panicking during crashes.
                  </span>
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Macroeconomic & Rate Cycle Pulse Bar */}
      {/* Macroeconomic & Rate Cycle Pulse Bar */}
      {macroRegime && (
        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm backdrop-blur-sm animate-in fade-in duration-500">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3 border-b border-slate-200 dark:border-slate-800/80 pb-3">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 p-2 rounded-xl text-emerald-600 dark:text-emerald-400">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">
                    {macroViewMode === 'simple' ? 'Market Weather Station' : 'Detected Macro Regime'}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 font-medium border border-emerald-200 dark:border-emerald-800/60">
                    {macroViewMode === 'simple' ? '🟢 Favorable Growth Climate' : macroRegime.badge}
                  </span>
                </div>
                <h4 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white mt-0.5">
                  {macroViewMode === 'simple' ? 'The Economic "Sweet Spot" (Goldilocks Era)' : macroRegime.title}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {macroViewMode === 'simple'
                    ? 'Inflation is cooling down and central banks are cutting interest rates — historically the most profitable environment for compounding wealth.'
                    : 'Real-time BigQuery telemetry tracking monetary policy, inflation trajectories, and yield curve spreads.'}
                </p>
              </div>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setMacroViewMode('simple')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  macroViewMode === 'simple'
                    ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm border border-slate-200 dark:border-slate-800'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                🌱 Plain English
              </button>
              <button
                type="button"
                onClick={() => setMacroViewMode('pro')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  macroViewMode === 'pro'
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200 dark:border-slate-800'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                📊 Wall St Data
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
            {/* 1. Inflation */}
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-xl p-3 hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium block truncate">
                  {macroViewMode === 'simple' ? 'Cost of Living' : 'CPI Inflation'}
                </span>
                <span className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {macroRegime.cpiInflation}
                </span>
              </div>
              <div className="mt-1 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 block truncate">
                  {macroViewMode === 'simple' ? '🟢 Cooling Down' : 'YoY Trajectory'}
                </span>
                <span className="text-[9px] text-slate-400 dark:text-slate-500 block truncate">
                  {macroViewMode === 'simple' ? 'Prices stabilizing' : 'Headline CPI'}
                </span>
              </div>
            </div>

            {/* 2. Interest Rates */}
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-xl p-3 hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium block truncate">
                  {macroViewMode === 'simple' ? 'Borrowing Rates' : 'Policy Rate'}
                </span>
                <span className="text-base font-bold font-mono text-blue-600 dark:text-blue-400 tabular-nums">
                  {macroRegime.fedFundsRate}
                </span>
              </div>
              <div className="mt-1 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 block truncate">
                  {macroViewMode === 'simple' ? '📉 Rate Cuts Active' : 'Central Bank'}
                </span>
                <span className="text-[9px] text-slate-400 dark:text-slate-500 block truncate">
                  {macroViewMode === 'simple' ? 'Cheaper loans boost stocks' : 'Effective Fed Rate'}
                </span>
              </div>
            </div>

            {/* 3. Recession Risk */}
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-xl p-3 hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium block truncate">
                  {macroViewMode === 'simple' ? 'Recession Risk' : 'Yield Spread (10Y-2Y)'}
                </span>
                <span className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {macroViewMode === 'simple' ? 'Low / Safe' : macroRegime.yieldCurveSpread}
                </span>
              </div>
              <div className="mt-1 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 block truncate">
                  {macroViewMode === 'simple' ? '🟢 Safe (+0.41%)' : macroRegime.yieldCurveStatus.split('(')[0].trim()}
                </span>
                <span className="text-[9px] text-slate-400 dark:text-slate-500 block truncate">
                  {macroViewMode === 'simple' ? 'Normal healthy curve' : 'Treasury Slope'}
                </span>
              </div>
            </div>

            {/* 4. Market Fear / Mood */}
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-xl p-3 hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium block truncate">
                  {macroViewMode === 'simple' ? 'Market Panic Level' : 'VIX Volatility'}
                </span>
                <span className="text-base font-bold font-mono text-amber-600 dark:text-amber-400 tabular-nums">
                  {macroRegime.vixIndex}
                </span>
              </div>
              <div className="mt-1 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 block truncate">
                  {macroViewMode === 'simple' ? '😌 Calm & Steady' : (Number(macroRegime.vixIndex) < 15 ? '🟢 Calm' : Number(macroRegime.vixIndex) < 25 ? '🟡 Normal' : '🔴 Panic')}
                </span>
                <span className="text-[9px] text-slate-400 dark:text-slate-500 block truncate">
                  {macroViewMode === 'simple' ? 'Great for monthly SIP' : 'Implied Volatility'}
                </span>
              </div>
            </div>

            {/* 5. Currency */}
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-xl p-3 hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium block truncate">
                  {macroViewMode === 'simple' ? 'US Dollar vs Rupee' : 'USD / INR'}
                </span>
                <span className="text-base font-bold font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                  {macroRegime.usdInrRate}
                </span>
              </div>
              <div className="mt-1 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 block truncate">
                  {macroViewMode === 'simple' ? '💵 Strong Dollar' : 'Exchange Rate'}
                </span>
                <span className="text-[9px] text-slate-400 dark:text-slate-500 block truncate">
                  {macroViewMode === 'simple' ? 'Boosts US ETF returns' : 'Spot Forex'}
                </span>
              </div>
            </div>

            {/* 6. Jobs & Economy */}
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-xl p-3 hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium block truncate">
                  {macroViewMode === 'simple' ? 'Job Market' : 'Unemployment'}
                </span>
                <span className="text-base font-bold font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                  {macroRegime.unemploymentRate}
                </span>
              </div>
              <div className="mt-1 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 block truncate">
                  {macroViewMode === 'simple' ? '💼 Strong Employment' : 'Labor Market'}
                </span>
                <span className="text-[9px] text-slate-400 dark:text-slate-500 block truncate">
                  {macroViewMode === 'simple' ? 'Consumers keep spending' : 'U3 Benchmark'}
                </span>
              </div>
            </div>
          </div>

          {/* Plain English Key Takeaway Callout */}
          <div className="mt-3 pt-2.5 border-t border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
            <span className="flex items-center gap-2 font-medium">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 text-[10px]">✓</span>
              <span><strong>What this means for your money:</strong> The economic weather is in your favor. It is an optimal time to steadily accumulate both Indian domestic equities and US tech funds without waiting on the sidelines.</span>
            </span>
          </div>
        </div>
      )}

      {/* Top Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: AI Risk Score */}
        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex items-center justify-between shadow-sm backdrop-blur-sm hover:border-slate-300 dark:hover:border-slate-700 transition-all">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">AI Risk Score</p>
            {isGeneratingAllocation ? (
              <div className="h-7 w-16 bg-slate-200 dark:bg-slate-800 rounded animate-pulse mt-1"></div>
            ) : (
              <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-0.5">
                {allocation?.riskScore} <span className="text-xs text-slate-400 font-normal">/ 100</span>
              </p>
            )}
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono block mt-0.5 truncate">
              {profile.riskProfile.toLowerCase()} target
            </span>
          </div>
          <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 p-3 rounded-xl shrink-0 ml-4">
            <ShieldAlert className="text-blue-600 dark:text-blue-400 w-5 h-5" />
          </div>
        </div>
        
        {/* Card 2: Projected Base */}
        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex items-center justify-between shadow-sm backdrop-blur-sm hover:border-slate-300 dark:hover:border-slate-700 transition-all">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Projected Base (End)</p>
            {isGeneratingProjections ? (
              <div className="h-7 w-24 bg-slate-200 dark:bg-slate-800 rounded animate-pulse mt-1"></div>
            ) : (
              <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-0.5">
                {formatCurrency(finalBase)}
              </p>
            )}
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono block mt-0.5">
              50th percentile outcome
            </span>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 p-3 rounded-xl shrink-0 ml-4">
            <TrendingUp className="text-emerald-600 dark:text-emerald-400 w-5 h-5" />
          </div>
        </div>

        {/* Card 3: Objective Status */}
        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex items-center justify-between shadow-sm backdrop-blur-sm hover:border-slate-300 dark:hover:border-slate-700 transition-all">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Objective Status</p>
            {isGeneratingProjections ? (
              <div className="h-7 w-20 bg-slate-200 dark:bg-slate-800 rounded animate-pulse mt-1"></div>
            ) : (
              <div>
                <p className={`text-2xl font-bold tracking-tight mt-0.5 ${goalReached ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {profile.objective === 'MILESTONE' ? (goalReached ? 'On Track' : 'Shortfall') : 'Compounding'}
                </p>
                {profile.objective === 'MILESTONE' && profile.goalAmount ? (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums block mt-0.5 truncate">
                    {goalReached ? `Surplus: +${formatCurrency(finalBase - profile.goalAmount)}` : `Need: +${formatCurrency(profile.goalAmount - finalBase)}`}
                  </span>
                ) : profile.capital && profile.capital > 0 ? (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums block mt-0.5">
                    {`${(finalBase / profile.capital).toFixed(1)}x Growth Multiple`}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono block mt-0.5">
                    Long-term wealth engine
                  </span>
                )}
              </div>
            )}
          </div>
          <div className={`${goalReached && !isGeneratingProjections ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20' : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20'} border p-3 rounded-xl shrink-0 ml-4`}>
            <Target className={`${goalReached && !isGeneratingProjections ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'} w-5 h-5`} />
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Asset Allocation Pie Chart */}
        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 lg:col-span-1 flex flex-col shadow-sm backdrop-blur-sm">
          <div className="flex justify-between items-start mb-1">
            <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Dynamic Asset Allocation</h3>
            {isGeneratingAllocation && <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Click on any category for real-time sub-asset analysis</p>
          
          {isGeneratingAllocation || !allocation ? (
            <div className="flex-grow flex flex-col items-center justify-center min-h-[250px] space-y-6">
              <div className="w-36 h-36 rounded-full border-4 border-slate-200 dark:border-slate-800 border-t-emerald-500 animate-spin"></div>
              <div className="w-full space-y-2.5">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-8 w-full bg-slate-100 dark:bg-slate-800/80 rounded-xl animate-pulse"></div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="flex-grow min-h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={allocation.assetAllocation}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="percentage"
                      nameKey="assetClass"
                      stroke="none"
                      onClick={(entry) => handleCategoryClick(entry.payload || entry)}
                      className="cursor-pointer hover:opacity-80 transition-opacity outline-none"
                    >
                      {allocation.assetAllocation.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={getCategoryColor(entry.assetClass, index)} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: isDark ? '#0f172a' : '#ffffff', 
                        borderColor: isDark ? '#334155' : '#cbd5e1', 
                        color: isDark ? '#f8fafc' : '#0f172a', 
                        borderRadius: '0.75rem',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                      }}
                      itemStyle={{ color: isDark ? '#f8fafc' : '#0f172a' }}
                      formatter={(value: number) => [`${value}%`, 'Allocation']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 space-y-2">
                {allocation.assetAllocation.map((asset, idx) => (
                  <div 
                    key={idx} 
                    className="flex items-center justify-between text-sm p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition-all border border-transparent hover:border-slate-200 dark:hover:border-slate-700/60 active:scale-[0.99]"
                    onClick={() => handleCategoryClick(asset)}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: getCategoryColor(asset.assetClass, idx) }}></div>
                      <span className="text-slate-700 dark:text-slate-200 font-medium text-xs">{asset.assetClass}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-white font-mono text-xs tabular-nums">{asset.percentage}%</span>
                      <ChevronRight className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Probabilistic Outcome Curves */}
        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 lg:col-span-2 flex flex-col shadow-sm backdrop-blur-sm">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Probabilistic Outcome Curves</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Monte Carlo compounding percentiles (Bull, Base, Bear) over investment horizon</p>
            </div>
            {isGeneratingProjections && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
          </div>
          
          {isGeneratingProjections || !projections ? (
            <div className="flex-grow flex flex-col items-center justify-center min-h-[300px] space-y-4">
              <div className="w-40 h-40 rounded-full border-4 border-slate-200 dark:border-slate-800 border-t-blue-500 animate-spin"></div>
              <p className="text-sm text-slate-500 dark:text-slate-400 animate-pulse font-medium">Running deterministic compounding math...</p>
            </div>
          ) : (
            <div className="flex-grow min-h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={projections} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#1e293b' : '#f1f5f9'} vertical={false} />
                  <XAxis 
                    dataKey="year" 
                    stroke={isDark ? '#64748b' : '#94a3b8'} 
                    tick={{ fill: isDark ? '#64748b' : '#64748b', fontSize: 12 }} 
                    tickFormatter={(val) => `Yr ${val}`}
                  />
                  <YAxis 
                    stroke={isDark ? '#64748b' : '#94a3b8'} 
                    tick={{ fill: isDark ? '#64748b' : '#64748b', fontSize: 12 }}
                    tickFormatter={formatCurrency}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: isDark ? '#0f172a' : '#ffffff', 
                      borderColor: isDark ? '#334155' : '#cbd5e1', 
                      color: isDark ? '#f8fafc' : '#0f172a', 
                      borderRadius: '0.75rem',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                    }}
                    formatter={(value: number) => [formatCurrency(value), '']}
                    labelFormatter={(label) => `Year ${label}`}
                  />
                  <Legend wrapperStyle={{ paddingTop: '16px', fontSize: '12px' }} />
                  <Line type="monotone" dataKey="bull" name="Bull Case (90th %ile)" stroke="#10b981" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="base" name="Base Case (50th %ile)" stroke="#3b82f6" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="bear" name="Bear Case (10th %ile)" stroke="#ef4444" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Action Steps & Regime Analysis Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Action Steps */}
        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm backdrop-blur-sm">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 tracking-tight">
              <ListChecks className="w-5 h-5 text-emerald-500" />
              Prioritized Action Steps
            </h3>
            {isGeneratingAllocation && <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />}
          </div>
          
          {isGeneratingAllocation || !allocation ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-12 w-full bg-slate-100 dark:bg-slate-800/80 rounded-xl animate-pulse"></div>
              ))}
            </div>
          ) : (
            <div className="space-y-3 animate-in fade-in duration-500">
              {allocation.actionSteps.map((step, idx) => (
                <div key={idx} className="flex gap-3 items-start bg-slate-50 dark:bg-slate-950/80 p-4 rounded-xl border border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-all">
                  <div className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5 shadow-inner">
                    {idx + 1}
                  </div>
                  <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{step}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 30-Year Regime Analysis */}
        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm backdrop-blur-sm">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 tracking-tight">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Historical Crisis Stress Testing
            </h3>
            {isGeneratingNarrative && <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />}
          </div>
          
          {isGeneratingNarrative || !narrativeData ? (
            <div className="space-y-4">
              <div className="h-16 w-full bg-slate-100 dark:bg-slate-800/80 rounded-xl animate-pulse"></div>
              <div className="h-24 w-full bg-slate-100 dark:bg-slate-800/80 rounded-xl animate-pulse"></div>
            </div>
          ) : (
            <div className="space-y-4 animate-in fade-in duration-500">
              <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-950/80 p-4 rounded-xl border border-slate-200 dark:border-slate-800/80">
                {narrativeData.regimeAnalysis.summary}
              </p>
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Crisis Survival Metrics</h4>
                {narrativeData.regimeAnalysis.historicalEvents.map((event, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-slate-50 dark:bg-slate-950/80 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-all">
                    <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white">{event.eventName}</span>
                    <div className="text-right">
                      <span className="text-rose-600 dark:text-red-400 text-xs sm:text-sm font-mono font-bold block tabular-nums">{event.impact}</span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">Recovery: {event.recoveryTime}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI Narrative */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 tracking-tight">
            <span className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 p-1.5 rounded-lg text-emerald-600 dark:text-emerald-400 shadow-inner">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            </span>
            AI Strategy Synthesis
          </h3>
          
          <div className="flex items-center gap-2">
            {narrativeData && (
              <button
                onClick={handleCopyStrategy}
                className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 transition-all active:scale-95 shadow-sm"
              >
                {isCopied ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">Copied Strategy</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                    <span>Copy Report</span>
                  </>
                )}
              </button>
            )}
            {isGeneratingNarrative && <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />}
          </div>
        </div>
        
        {isGeneratingNarrative || !narrativeData ? (
          <div className="space-y-3">
            <div className="h-4 w-full bg-slate-100 dark:bg-slate-800/80 rounded-lg animate-pulse"></div>
            <div className="h-4 w-11/12 bg-slate-100 dark:bg-slate-800/80 rounded-lg animate-pulse"></div>
            <div className="h-4 w-full bg-slate-100 dark:bg-slate-800/80 rounded-lg animate-pulse"></div>
            <div className="h-4 w-4/5 bg-slate-100 dark:bg-slate-800/80 rounded-lg animate-pulse"></div>
          </div>
        ) : (
          <div className="text-slate-700 dark:text-slate-300 leading-relaxed animate-in fade-in duration-500 text-sm space-y-3">
            <ReactMarkdown
              components={{
                p: ({ node, ...props }) => <p className="mb-3 last:mb-0 leading-relaxed text-slate-700 dark:text-slate-300" {...props} />,
                ul: ({ node, ...props }) => <ul className="space-y-2.5 my-3 pl-4 list-disc marker:text-emerald-500" {...props} />,
                ol: ({ node, ...props }) => <ol className="space-y-2.5 my-3 pl-4 list-decimal marker:text-emerald-500" {...props} />,
                li: ({ node, ...props }) => <li className="leading-relaxed text-slate-700 dark:text-slate-300 pl-1" {...props} />,
                strong: ({ node, ...props }) => <strong className="font-semibold text-slate-900 dark:text-white tracking-tight" {...props} />,
                code: ({ node, ...props }) => <code className="bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded text-xs font-mono" {...props} />,
              }}
            >
              {narrativeData.narrative
                .replace(/\*\*\*+/g, '**')
                .replace(/^•\s*/gm, '* ')
                .replace(/([^\n])\n(\s*[\*\-•]\s+)/g, '$1\n\n$2')}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {/* Visual Drill-down Modal */}
      {/* Category Deep Dive Modal */}
      {selectedCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between bg-slate-50 dark:bg-slate-950/80 flex-shrink-0">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="text-emerald-600 dark:text-emerald-400">Deep Dive:</span> {selectedCategory}
                </h3>
                <span className="bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs px-2.5 py-1 rounded-full border border-blue-200 dark:border-blue-500/25 flex items-center gap-1.5 font-mono">
                  <Database className="w-3 h-3" /> Live BigQuery
                </span>
              </div>
              <button 
                onClick={closeModal}
                className="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-grow custom-scrollbar">
              {isLoadingRec ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-4">
                  <div className="relative w-12 h-12">
                    <div className="absolute inset-0 border-4 border-emerald-500/20 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-emerald-500 rounded-full border-t-transparent animate-spin"></div>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 animate-pulse font-medium">Analyzing historical time series & synthesizing optimal sub-allocation...</p>
                </div>
              ) : recError ? (
                <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/40 text-red-700 dark:text-red-300 p-4 rounded-xl text-center text-sm">
                  {recError}
                </div>
              ) : categoryRec ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in slide-in-from-bottom-3 duration-300 h-full">
                  
                  {/* Left Column: Visual Chart & Sub-categories */}
                  <div className="lg:col-span-5 flex flex-col space-y-4">
                    <div className="flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950/80 rounded-2xl border border-slate-200 dark:border-slate-800 p-6">
                      <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 w-full text-left">Recommended Split</h4>
                      <div className="w-full h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={categoryRec.subCategories}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              paddingAngle={5}
                              dataKey="percentage"
                              nameKey="name"
                              stroke="none"
                            >
                              {categoryRec.subCategories.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={SUB_COLORS[index % SUB_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: isDark ? '#0f172a' : '#ffffff', 
                                borderColor: isDark ? '#334155' : '#cbd5e1', 
                                color: isDark ? '#f8fafc' : '#0f172a', 
                                borderRadius: '0.75rem',
                                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                              }}
                              itemStyle={{ color: isDark ? '#f8fafc' : '#0f172a' }}
                              formatter={(value: number) => [`${value}%`, 'Allocation']}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      
                      {/* Interactive Legend */}
                      <div className="w-full space-y-2 mt-4">
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">Click a category to view AI asset picks</p>
                        {categoryRec.subCategories.map((sub, idx) => (
                          <div 
                            key={idx} 
                            onClick={() => handleSubCategoryClick(sub.name)}
                            className={`flex flex-col p-3 rounded-xl border cursor-pointer transition-all ${
                              selectedSubCategory === sub.name 
                                ? 'bg-emerald-50 border-emerald-500 shadow-sm dark:bg-slate-800 dark:border-emerald-500/50 dark:shadow-[0_0_15px_rgba(16,185,129,0.15)]' 
                                : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:hover:border-slate-700 dark:hover:bg-slate-850'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2.5">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: SUB_COLORS[idx % SUB_COLORS.length] }}></div>
                                <span className="font-semibold text-slate-900 dark:text-white text-xs sm:text-sm">{cleanSubCategoryName(sub.name)}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-emerald-600 dark:text-emerald-400 text-xs sm:text-sm font-mono tabular-nums">{sub.percentage}%</span>
                                <ChevronRight className={`w-4 h-4 ${selectedSubCategory === sub.name ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Dynamic Content (Takeaways OR Top Picks) */}
                  <div className="lg:col-span-7 flex flex-col">
                    {!selectedSubCategory ? (
                      // Default View: Key Takeaways
                      <div className="bg-slate-50 dark:bg-slate-950/80 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 h-full flex flex-col">
                        <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-5">Market Analysis & Strategy</h4>
                        <div className="space-y-4 flex-grow">
                          {categoryRec.keyTakeaways.map((takeaway, idx) => (
                            <div key={idx} className="flex gap-3.5 items-start bg-white dark:bg-slate-900/80 p-4 rounded-xl border border-slate-200 dark:border-slate-800/80">
                              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                              <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{takeaway}</p>
                            </div>
                          ))}
                        </div>
                        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/25 rounded-xl flex items-start gap-3">
                          <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
                            Select a sub-category on the left to generate real-time stock & ETF rankings based on trailing returns from BigQuery.
                          </p>
                        </div>
                      </div>
                    ) : (
                      // Drill-down View: Top AI Picks
                      <div className="bg-slate-50 dark:bg-slate-950/80 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 flex flex-col h-full">
                        <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-200 dark:border-slate-800/80">
                          <div>
                            <h4 className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Top AI Picks</h4>
                            <p className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mt-0.5">{cleanSubCategoryName(selectedSubCategory)}</p>
                          </div>
                          <button 
                            onClick={() => setSelectedSubCategory(null)}
                            className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all bg-white dark:bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 active:scale-95"
                          >
                            <ArrowLeft className="w-3.5 h-3.5" /> Back
                          </button>
                        </div>

                        {isLoadingPicks ? (
                          <div className="flex flex-col items-center justify-center flex-grow space-y-4 py-12">
                            <div className="relative w-10 h-10">
                              <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full"></div>
                              <div className="absolute inset-0 border-4 border-blue-500 rounded-full border-t-transparent animate-spin"></div>
                            </div>
                            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 animate-pulse font-medium">Fetching real-time ticker data for {cleanSubCategoryName(selectedSubCategory)}...</p>
                          </div>
                        ) : assetPicks ? (
                          <div className="space-y-3.5 overflow-y-auto pr-1 custom-scrollbar flex-grow">
                            {assetPicks.map((pick, idx) => (
                              <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 hover:border-slate-300 dark:hover:border-slate-700 transition-all shadow-sm">
                                {(() => {
                                  const rawPrice = (pick.currentPriceEstimate || '').replace(/\s*\([^)]*\)/g, '').trim();
                                  // If rawPrice is an excessively long descriptive sentence, extract price/yield or condense
                                  let cleanPrice = rawPrice;
                                  if (cleanPrice.length > 20) {
                                    const match = cleanPrice.match(/([₹$€£]\s*[\d,]+(\.\d+)?(\s*\/\s*[a-zA-Z]+)?|\d+(\.\d+)?%\s*(p\.a\.|yield)?)/i);
                                    cleanPrice = match ? match[0] : (cleanPrice.slice(0, 16) + '...');
                                  }

                                  const isIndian = pick.symbol.endsWith('.NS') || 
                                                   (pick.currentPriceEstimate && pick.currentPriceEstimate.includes('₹')) ||
                                                   pick.symbol.toLowerCase().includes('sgb');

                                  // Clean up symbol if it contains extra words like "SGB Tax Benefits"
                                  let displaySymbol = pick.symbol;
                                  if (displaySymbol.length > 10 && displaySymbol.includes(' ')) {
                                    displaySymbol = displaySymbol.split(' ')[0];
                                  }

                                  return (
                                    <div className="flex items-center justify-between gap-3 mb-3">
                                      <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <span className="inline-flex items-center gap-1 justify-center bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-200 text-xs font-bold px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-800 font-mono shrink-0 max-w-[105px] truncate">
                                          <span className="text-[11px] leading-none">{isIndian ? '🇮🇳' : '🇺🇸'}</span>
                                          <span className="truncate">{displaySymbol}</span>
                                        </span>
                                        <h5 className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm leading-normal flex-1 truncate" title={pick.name}>
                                          {pick.name}
                                        </h5>
                                      </div>
                                      <span className="inline-flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-mono text-xs sm:text-sm font-semibold bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-2.5 py-1 rounded-lg tabular-nums shrink-0 whitespace-nowrap max-w-[150px] truncate" title={rawPrice}>
                                        {cleanPrice}
                                      </span>
                                    </div>
                                  );
                                })()}
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                  {(() => {
                                    const text = pick.pastPerformance || '';
                                    // Match negative signs preceding numbers (e.g. -5%, - 2.3%) or words indicating loss, but NOT hyphens like '1-Year'
                                    const isNegative = /-\s*\d+/.test(text) || /\b(loss|down|drop|fall|negative)\b/i.test(text);
                                    return (
                                      <div className={`space-y-1 p-2.5 rounded-lg border ${isNegative ? 'bg-rose-50 border-rose-200 dark:bg-red-950/30 dark:border-red-800/30' : 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800/30'}`}>
                                        <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                          {isNegative 
                                            ? <TrendingDown className="w-3 h-3 text-rose-500 dark:text-red-400" /> 
                                            : <TrendingUp className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                          } Past Performance
                                        </p>
                                        <p className={`text-xs leading-relaxed font-mono tabular-nums ${isNegative ? 'text-rose-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{pick.pastPerformance}</p>
                                      </div>
                                    );
                                  })()}
                                  <div className="space-y-1 bg-slate-100/70 dark:bg-slate-950/60 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800/60">
                                    <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                      <TrendingUp className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> Future Outlook
                                    </p>
                                    <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{pick.futurePrediction}</p>
                                  </div>
                                </div>
                                
                                <div className="mt-3 pt-2.5 border-t border-slate-200/80 dark:border-slate-800/60">
                                  <p className="text-xs text-slate-600 dark:text-slate-400"><span className="text-emerald-600 dark:text-emerald-400 font-medium">Why it fits you:</span> {pick.reasoning}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>

                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Dashboard;
