import { GoogleGenAI, Type, Chat } from '@google/genai';
import { UserProfile, AllocationData, Projection, CategoryRecommendation, SpecificAssetPick, MarketBenchmark, NarrativeData, MacroRegimeState } from '../types';
import { fetchTopStocksByCategory } from './bigqueryService';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY, vertexai: true });
let currentChatSession: Chat | null = null;

const getCurrencyStr = (market: string) => market === 'US' ? 'USD $' : 'INR ₹';

function buildMarketContext(benchmarks: MarketBenchmark[], macroRegime?: MacroRegimeState | null): string {
  let contextStr = benchmarks.map(b => {
    let ctx = `• ${b.assetClass}: 30Y CAGR ${b.cagr30Y}%, Volatility σ ${b.volatility_std}%, Max Drawdown ${b.maxDrawdown}`;
    if (b.currentPrice) ctx += `\n  Current Price: ${b.currentPrice.toLocaleString()}, 1Y Return: ${b.return1Y}%`;
    if (b.momentum30d !== undefined) ctx += `, 30D Momentum: ${b.momentum30d}% annualized`;
    if (b.allTimeHigh) ctx += `\n  All-Time High: ${b.allTimeHigh.toLocaleString()}, All-Time Low: ${b.allTimeLow?.toLocaleString()}`;
    if (b.totalTradingDays) ctx += `, Data: ${b.dataStartDate} to ${b.dataEndDate} (${b.totalTradingDays} trading days)`;
    return ctx;
  }).join('\n\n');

  if (macroRegime) {
    contextStr += `\n\n[LIVE MACROECONOMIC & RATE CYCLE INDICATORS — Federal Reserve & BigQuery]:
• Detected Macro Regime: ${macroRegime.title} (${macroRegime.badge})
• CPI Inflation Rate: ${macroRegime.cpiInflation}
• Policy Interest Rate (Fed Funds): ${macroRegime.fedFundsRate}
• Yield Curve 10Y-2Y Spread: ${macroRegime.yieldCurveSpread} (${macroRegime.yieldCurveStatus})
• CBOE Volatility Index (VIX): ${macroRegime.vixIndex}
• US Dollar Index (DXY): ${macroRegime.usDollarIndex}
• USD/INR Exchange Rate: ${macroRegime.usdInrRate}
• Unemployment Rate: ${macroRegime.unemploymentRate}`;
  }

  return contextStr;
}

// AGENT 1: The Macro Strategist — Grounded in Deep BigQuery Analytics
export const generateAllocationAgent = async (profile: UserProfile, benchmarks: MarketBenchmark[], macroRegime?: MacroRegimeState | null): Promise<AllocationData> => {
  const currency = '₹';
  const marketContext = buildMarketContext(benchmarks, macroRegime);
  
  const prompt = `
    You are FinoGyaan, an elite autonomous AI wealth advisor powered by live Google Cloud BigQuery datasets (finwise-506509.finwise_data).
    You have access to 20+ years of REAL historical market data and live macroeconomic indicators (Inflation, Fed Policy Rates, Yield Curve spreads, VIX).
    
    USER PROFILE:
    - Objective: ${profile.objective}
    - Risk Profile: ${profile.riskProfile}
    - Monthly Income: ${currency}${profile.income}
    - Monthly Fixed Expenses: ${currency}${profile.expenses}
    - Current Capital/Savings: ${currency}${profile.capital}
    - Target Goal Amount: ${profile.goalAmount > 0 ? currency + profile.goalAmount : 'Calculate based on objective'}
    - Goal Horizon: ${profile.goalHorizon} years

    [LIVE GOOGLE CLOUD BIGQUERY MARKET INTELLIGENCE — 660,000+ records, 2005-2026]
    ${marketContext}

    ANALYSIS INSTRUCTIONS:
    1. FACTOR IN MACROECONOMIC REGIME: Consider current inflation (${macroRegime?.cpiInflation || '2.9%'}), policy interest rates (${macroRegime?.fedFundsRate || '3.63%'}), and yield curve spread (${macroRegime?.yieldCurveSpread || '+0.39%'}).
    2. Examine the CURRENT MARKET REGIME: Look at 30-day momentum and 1Y returns.
    3. GLOBAL MULTI-MARKET WEALTH STRATEGY: Provide an institutional-grade asset allocation combining both high-growth Indian domestic opportunities and US / Global market exposure (e.g. S&P 500 / Nasdaq 100 tech leaders for dollar-hedge and global tech leadership alongside Indian domestic compounding).
    4. Use the 30Y CAGR and VOLATILITY to set long-term expected returns per asset class.
    5. Use MAX DRAWDOWN data to calibrate risk — S&P crashed -56.78% in 2009, Nifty crashed -59.86% in 2008.
    6. Consider the user's risk tolerance and horizon when weighting between growth and safety.
    7. Allocate using EXACTLY these 6 categories (even if 0%): Gold/Silver, Mutual Funds, Bonds, Fixed Deposit, Stocks, Alternative Growth. Percentages must sum to 100%.
    8. SMART CONCENTRATION RULE (FOR SMALL MONTHLY AMOUNTS < ${currency}10,000):
       If monthly investable surplus (Income - Expenses = ${currency}${Math.max(0, profile.income - profile.expenses)}) is under ${currency}10,000:
       DO NOT over-diversify across all 6 asset classes. Avoid splitting small capital into tiny 5% slices.
       Instead, CONCENTRATE 70-80% in core Mutual Funds / Index and 20-30% in Fixed Deposit / Liquid safety. Set niche categories (Alternative Growth, separate Stocks) to 0%.
    9. Provide 3-4 prioritized monthly action steps. Highlight both domestic compounding and US/global diversification where applicable. Keep each step concise, punchy, and actionable (under 20 words each). Do NOT write long paragraphs.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: prompt,
    config: {
      temperature: 0.0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          riskScore: { type: Type.NUMBER, description: 'Calculated risk score (1-100) based on profile and current market regime' },
          assetAllocation: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                assetClass: { type: Type.STRING },
                percentage: { type: Type.NUMBER },
                reasoning: { type: Type.STRING }
              }
            }
          },
          actionSteps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '3-4 prioritized monthly action steps grounded in current BigQuery market data.'
          }
        },
        required: ['riskScore', 'assetAllocation', 'actionSteps']
      }
    }
  });

  const cleanJson = response.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(cleanJson) as AllocationData;
};

// AGENT 2: The Quant Modeler — Deterministic Math from BigQuery CAGRs & Volatility
export const generateProjectionsAgent = async (profile: UserProfile, allocation: AllocationData, benchmarks: MarketBenchmark[]): Promise<Projection[]> => {
  // Calculate weighted portfolio return and volatility from BigQuery data
  let weightedCAGR = 0;
  let weightedVol = 0;

  allocation.assetAllocation.forEach(item => {
    const matchedBm = benchmarks.find(b =>
      b.assetClass.toLowerCase().includes(item.assetClass.toLowerCase()) ||
      (item.assetClass.toLowerCase().includes('stock') && b.assetClass.includes('Equity')) ||
      (item.assetClass.toLowerCase().includes('gold') && b.assetClass.includes('Gold')) ||
      (item.assetClass.toLowerCase().includes('bond') && (b.assetClass.includes('Bond') || b.assetClass.includes('Fixed Income'))) ||
      (item.assetClass.toLowerCase().includes('fixed deposit') && (b.assetClass.includes('Bond') || b.assetClass.includes('Fixed Income'))) ||
      (item.assetClass.toLowerCase().includes('mutual') && b.assetClass.includes('Equity'))
    ) || benchmarks[0];

    const weight = item.percentage / 100;
    weightedCAGR += weight * (matchedBm?.cagr30Y || 10);
    weightedVol += weight * (matchedBm?.volatility_std || 17);
  });

  const monthlyContribution = Math.max(0, profile.income - profile.expenses);
  const annualContribution = monthlyContribution * 12;
  const initialCapital = profile.capital;
  const years = Math.max(1, profile.goalHorizon || 10);

  // Compute scenario rates from BigQuery parameters
  const baseRate = Math.max(0.04, weightedCAGR / 100);
  const bullRate = baseRate + 0.35 * (weightedVol / 100);
  const bearRate = Math.max(0.01, baseRate - 0.40 * (weightedVol / 100));

  const projections: Projection[] = [];
  let currentBear = initialCapital;
  let currentBase = initialCapital;
  let currentBull = initialCapital;

  projections.push({ year: 0, bear: Math.round(currentBear), base: Math.round(currentBase), bull: Math.round(currentBull) });

  for (let year = 1; year <= years; year++) {
    currentBase = currentBase * (1 + baseRate) + annualContribution;
    currentBull = currentBull * (1 + bullRate) + annualContribution;
    currentBear = currentBear * (1 + bearRate) + annualContribution;
    projections.push({ year, bear: Math.round(currentBear), base: Math.round(currentBase), bull: Math.round(currentBull) });
  }

  return projections;
};

// AGENT 3: The Narrative Synthesizer — Grounded in Real Drawdowns & Dates
export const generateNarrativeAgent = async (profile: UserProfile, allocation: AllocationData, benchmarks: MarketBenchmark[], macroRegime?: MacroRegimeState | null): Promise<NarrativeData> => {
  const marketContext = buildMarketContext(benchmarks, macroRegime);

  const prompt = `
    You are FinoGyaan's Narrative Synthesizer Agent.
    Write a professional financial strategy narrative and a Macro Regime & Rate Cycle Analysis.
    ALL your analysis must be grounded in the REAL BigQuery data provided below.
    
    Profile: Globally Diversified Multi-Market Portfolio (Indian Domestic Growth + US/Global Equities & ETFs), Objective ${profile.objective}, Risk ${profile.riskProfile}, Horizon ${profile.goalHorizon} years.
    Allocation: ${JSON.stringify(allocation.assetAllocation)}
    
    [LIVE GOOGLE CLOUD BIGQUERY MARKET INTELLIGENCE — 660,000+ records, 2005-2026]
    ${marketContext}
    
    INSTRUCTIONS:
    1. Write a concise, scannable executive summary (3-4 crisp bullet points or short sentences). Focus on:
       • Core Growth Engine: Why the equity/fund allocation was chosen (blending high-growth Indian compounding and US/global tech leaders) with BigQuery 30Y CAGR.
       • Defensive Anchor: How gold, bonds, or fixed deposits protect capital.
       • Macroeconomic Alignment: How this fits current inflation and policy rates.
       CRITICAL: DO NOT write a single dense, heavy wall of text. Use clean bullet points or short line breaks for effortless scanning.
    2. For the Regime Analysis, use the EXACT max drawdown percentages and dates from BigQuery:
       - Reference actual drawdown dates (e.g., "S&P 500 peaked-to-trough -56.78% hitting bottom on March 9, 2009")
       - Calculate approximate portfolio impact using the user's allocation weights
       - Keep impact descriptions concise and direct.
    3. Do NOT make up drawdown numbers — use only the figures provided above.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: prompt,
    config: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          narrative: { type: Type.STRING },
          regimeAnalysis: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING, description: 'Summary of how the portfolio handles macro shocks, grounded in BigQuery drawdown data.' },
              historicalEvents: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    eventName: { type: Type.STRING, description: 'Crisis name with exact date from BigQuery' },
                    impact: { type: Type.STRING, description: 'Portfolio drawdown calculated from BigQuery max drawdown data and user allocation' },
                    recoveryTime: { type: Type.STRING, description: 'Estimated recovery time' }
                  }
                }
              }
            }
          }
        },
        required: ['narrative', 'regimeAnalysis']
      }
    }
  });

  const cleanJson = response.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(cleanJson) as NarrativeData;
};

// Sector Analyst Agent
export const getCategoryRecommendation = async (category: string, profile: UserProfile, benchmarks: MarketBenchmark[]): Promise<CategoryRecommendation> => {
  const categoryData = benchmarks.find(b => b.assetClass.includes(category) || category.includes(b.assetClass));
  const marketContext = buildMarketContext(benchmarks);

  const prompt = `
    You are FinoGyaan, an elite autonomous AI wealth advisor.
    The user has selected the asset category "${category}" from their portfolio for a deep dive.
    
    User Profile: Risk Profile ${profile.riskProfile}, Goal Horizon: ${profile.goalHorizon} years.
    
    [SPECIFIC BIGQUERY DATA FOR ${category.toUpperCase()}]:
    ${JSON.stringify(categoryData, null, 2)}
    
    [FULL MARKET CONTEXT]:
    ${marketContext}

    Recommend how to split their investment *within* this specific category based on the BigQuery risk metrics, current momentum, and 1Y returns.
    
    CRITICAL MULTI-MARKET REQUIREMENT:
    We provide a globally balanced portfolio providing assets from BOTH the Indian market (NSE) AND the US / Global market wherever possible.
    - If "${category}" is "Stocks" or "Equities":
      You MUST provide sub-categories covering BOTH Indian Equities (e.g. "Indian Bluechip & Large-Cap Equities", "Indian High-Growth / Midcap Equities") AND US Equities (e.g. "US Tech & Mega-Cap Growth", "US Global Industry Leaders").
    - If "${category}" is "Mutual Funds" or "Index Funds":
      You MUST provide distinct, non-overlapping sub-categories covering BOTH Domestic Indian Funds AND US / Global Index Funds:
      1. "Domestic Indian Core Large-Cap Index Funds" (Tracking Nifty 50 and bluechip domestic indices)
      2. "Indian Midcap & High-Growth Funds" (Tracking Nifty Midcap 150 and emerging growth)
      3. "US Tech & Nasdaq 100 Index ETFs" (Tracking Nasdaq 100 QQQ for global technology exposure)
      4. "US S&P 500 & Global Index ETFs" (Tracking broad US market VOO / SPY and global funds)
    - If "${category}" is "Bonds":
      Provide sub-categories covering both Domestic Indian G-Secs / Corporate Bonds and US Treasuries / Global Bond ETFs.
    - If "${category}" is "Gold/Silver":
      Provide liquid Gold ETFs and Silver ETFs.
      
    CRITICAL EXCLUSION: NEVER include "Physical Gold" or physical bullion as an option. Only recommend liquid, exchange-traded or sovereign financial instruments (e.g. Gold Exchange Traded Funds (ETFs), Silver Exchange Traded Funds (ETFs), Sovereign Gold Bonds (SGBs)).
    IMPORTANT: In sub-category names, NEVER include specific year ranges or timeframes in parentheses (e.g. use "Short-Term FDs", "Medium-Term FDs", "Long-Term FDs", "Liquid FDs" without parenthetical year ranges like "(1-2 years)" or "(5-7 years)", as each investor defines horizons differently).
    Provide 3 concise key takeaways explaining the strategy, and specific sub-allocations that sum to 100%.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      temperature: 0.0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING },
          keyTakeaways: { type: Type.ARRAY, items: { type: Type.STRING } },
          subCategories: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                percentage: { type: Type.NUMBER },
                reasoning: { type: Type.STRING }
              }
            }
          }
        },
        required: ['category', 'keyTakeaways', 'subCategories']
      }
    }
  });

  const cleanJson = response.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
  const rec = JSON.parse(cleanJson) as CategoryRecommendation;

  // Strict programmatic exclusion of any "Physical Gold" or physical bullion options
  if (rec.subCategories && rec.subCategories.length > 0) {
    rec.subCategories = rec.subCategories.filter(
      sub => !sub.name.toLowerCase().includes('physical')
    );
    // Re-normalize percentages to strictly sum to 100%
    const total = rec.subCategories.reduce((acc, curr) => acc + curr.percentage, 0);
    if (total > 0 && total !== 100) {
      rec.subCategories = rec.subCategories.map(sub => ({
        ...sub,
        percentage: Math.round((sub.percentage / total) * 100)
      }));
      const adjustedTotal = rec.subCategories.reduce((acc, curr) => acc + curr.percentage, 0);
      if (adjustedTotal !== 100 && rec.subCategories.length > 0) {
        rec.subCategories[0].percentage += (100 - adjustedTotal);
      }
    }
  }

  return rec;
};
// Asset Picker Agent
export const getSpecificAssetRecommendations = async (mainCategory: string, subCategory: string, profile: UserProfile): Promise<SpecificAssetPick[]> => {
  // Try to get real stocks from BigQuery based on category (supporting both Indian and US instruments)
  const bqTopStocks = await fetchTopStocksByCategory(subCategory, profile.market);
  
  let bqContext = '';
  if (bqTopStocks && bqTopStocks.length > 0) {
    bqContext = `
    [LIVE BIGQUERY TOP STOCKS DATA]:
    The following are the actual top-performing stocks fetched from BigQuery for this category:
    ${JSON.stringify(bqTopStocks, null, 2)}
    
    You MUST use these exact stocks and their current prices/returns for your recommendations. Focus your reasoning on explaining WHY these stocks performed the way they did.
    `;
  }

  const marketRule = `MULTI-MARKET CAPABILITY:
FinoGyaan advises across BOTH the Indian domestic market (NSE/BSE) AND the US/Global market.
- If the subcategory refers to Indian assets (e.g. Indian Large-Cap, Nifty Index), recommend Indian instruments (.NS tickers or Indian fund names, priced in ₹).
- If the subcategory refers to US/Global assets (e.g. US Tech Giants, S&P 500, Nasdaq 100), recommend US-listed instruments (e.g. QQQ, VOO, SPY, NVDA, AAPL, MSFT, priced in $).
- If the subcategory is mixed or general (e.g. Index ETFs, Technology Equities), you can recommend top performers from BOTH Indian and US markets!`;

  const prompt = `
    You are FinoGyaan, an elite autonomous AI wealth advisor.
    The user selected main category "${mainCategory}" and sub-category "${subCategory}".
    
    Based on their profile (Risk: ${profile.riskProfile}, Horizon: ${profile.goalHorizon} years), provide the TOP specific asset recommendations for this sub-category.
    
    ${marketRule}

    ${bqContext}
    
    SELECTION QUANTITY & COMPREHENSIVENESS:
    You MUST return between 4 and 6 top-tier, high-conviction asset picks for this sub-category.
    - If BigQuery data is provided above, you MUST include those exact BigQuery assets first (grounded with their exact symbol, name, price, and return).
    - Complement them with leading real-world institutional instruments matching the category so the user always gets a comprehensive selection:
      * For "Indian Midcap / Flexicap Funds": Include MID150BEES.NS alongside leading real-world midcap/flexicap funds (e.g. Parag Parikh Flexi Cap Fund, HDFC Mid-Cap Opportunities Fund, Motilal Oswal Midcap Fund, Quant Mid Cap Fund).
      * For "Domestic Indian Index Funds": Include NIFTYBEES.NS, BANKBEES.NS, JUNIORBEES.NS alongside UTI Nifty 50 Index Fund or HDFC Nifty 50 Index Fund.
    - CRITICAL: Maintain strict separation between categories. NEVER include midcap funds in the large-cap core index tab, or large-cap index funds in the midcap tab.

    CRITICAL FIELD FORMAT RULES:
    1. 'symbol': MUST be a short 2-6 character ticker (e.g. "SGB", "GOLDBEES.NS", "GLD", "MID150BEES.NS", "PPFAS"). NEVER put phrases like "SGB Tax Benefits" or "SGB Safety" as the symbol.
    2. 'name': The official name of the asset (e.g. "Sovereign Gold Bond 2023-24 Series IV", "RBI Sovereign Gold Bond", "Parag Parikh Flexi Cap Fund").
    3. 'currentPriceEstimate': MUST be a concise numeric price under 15 characters (e.g. "₹7,450 / g", "₹130.05", "$422.60", or "2.5% + Gold"). NEVER write descriptive sentences or paragraphs in currentPriceEstimate (DO NOT write "Reflects prevailing gold prices at issue" or "Denominated in grams"). Put all explanations in 'reasoning'.
    4. For Sovereign Gold Bonds (SGBs): Recommend actual RBI Sovereign Gold Bond tranches or series (e.g. "SGB 2023-24 Series IV", "SGB 2024-25 Series I", "SGB 2023-24 Series III"). Set symbol to "SGB" or "SGB-RBI". Set price to prevailing gold rate like "₹7,450 / g".
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      temperature: 0.0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            symbol: { type: Type.STRING },
            name: { type: Type.STRING },
            currentPriceEstimate: { type: Type.STRING },
            pastPerformance: { type: Type.STRING },
            futurePrediction: { type: Type.STRING },
            reasoning: { type: Type.STRING }
          },
          required: ['symbol', 'name', 'currentPriceEstimate', 'pastPerformance', 'futurePrediction', 'reasoning']
        }
      }
    }
  });

  const cleanJson = response.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
  const parsedPicks = JSON.parse(cleanJson) as SpecificAssetPick[];

  // Strict Real-Time Data Reconciler:
  // If BigQuery returned actual market records, lock the displayed price and 1Y trailing return to the exact BigQuery values
  if (bqTopStocks && bqTopStocks.length > 0) {
    const cleanSym = (s: string) => (s || '').trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
    return parsedPicks.map(pick => {
      const pSym = (pick.symbol || '').trim().toUpperCase();
      const pName = (pick.name || '').trim().toLowerCase();

      const matchedBq = bqTopStocks.find((b: any) => {
        const bSym = (b.symbol || '').trim().toUpperCase();
        const bName = (b.name || '').trim().toLowerCase();

        // 1. Exact ticker symbol match (e.g. "GOLDBEES.NS" === "GOLDBEES.NS", "GLD" === "GLD")
        if (bSym === pSym) return true;
        // 2. Base ticker match without exchange suffix (e.g. "GOLDBEES" === "GOLDBEES")
        if (cleanSym(bSym) === cleanSym(pSym)) return true;
        // 3. Exact full company / ETF name match
        if (bName && pName && (bName === pName || bName.replace(/\s+/g, '') === pName.replace(/\s+/g, ''))) return true;

        return false;
      });

      if (matchedBq && matchedBq.current_price !== undefined) {
        const retNum = parseFloat(matchedBq.return_1yr_pct);
        const retSign = retNum >= 0 ? '+' : '';
        const priceNum = parseFloat(matchedBq.current_price);
        const isIndian = (matchedBq.symbol && matchedBq.symbol.endsWith('.NS')) || 
                         (matchedBq.category && matchedBq.category.toLowerCase().startsWith('in'));
        const currSign = isIndian ? '₹' : '$';
        return {
          ...pick,
          symbol: matchedBq.symbol,
          name: matchedBq.name || pick.name,
          currentPriceEstimate: isNaN(priceNum) ? pick.currentPriceEstimate : `${currSign}${priceNum.toLocaleString()}`,
          pastPerformance: isNaN(retNum) ? pick.pastPerformance : `${retSign}${retNum.toFixed(2)}% (1Y Return)`
        };
      }
      return pick;
    });
  }

  return parsedPicks;
};

// Conversational Advisor Agent
export const initChatSession = (profile: UserProfile, allocation: AllocationData, projections: Projection[], narrativeData: NarrativeData, benchmarks: MarketBenchmark[], macroRegime?: MacroRegimeState | null) => {
  const marketContext = buildMarketContext(benchmarks, macroRegime);
  currentChatSession = ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      temperature: 0.2,
      systemInstruction: `
        You are FinoGyaan, an elite AI wealth advisor backed by live BigQuery datasets (finwise-506509.finwise_data).
        You have analyzed 660,000+ records of historical market data and live macroeconomic indicators (Inflation, Fed Policy Rates, Yield Curve spreads, VIX).
        
        User Profile: ${JSON.stringify(profile)}
        Risk Score: ${allocation.riskScore}
        Allocation: ${allocation.assetAllocation.map(a => `${a.assetClass} (${a.percentage}%)`).join(', ')}
        Narrative Context: ${narrativeData.narrative}
        
        [LIVE BIGQUERY MARKET & MACRO INTELLIGENCE]:
        ${marketContext}
        
        When answering:
        - Reference specific BigQuery numbers (CAGR, drawdowns, current prices, momentum, inflation, interest rates)
        - Provide data-grounded advice, not generic financial advice
        - Structure your response cleanly with short paragraphs and clear bullet points
        - Do NOT use triple asterisks (never output '***'); use clean, standard bold titles on bullet points (e.g. * **Emergency Buffer:** ...)
        - Keep answers concise, direct, and easy to read on screen
      `,
    }
  });
};

export const sendChatMessage = async (message: string): Promise<string> => {
  if (!currentChatSession) {
    throw new Error("Chat session not initialized. Please generate a plan first.");
  }
  const response = await currentChatSession.sendMessage({ message });
  return response.text;
};
