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
  const currency = getCurrencyStr(profile.market);
  const marketContext = buildMarketContext(benchmarks, macroRegime);
  
  const prompt = `
    You are FinWise, an elite autonomous AI wealth advisor powered by live Google Cloud BigQuery datasets (finwise-506509.finwise_data).
    You have access to 20+ years of REAL historical market data and live macroeconomic indicators (Inflation, Fed Policy Rates, Yield Curve spreads, VIX).
    
    USER PROFILE:
    - Target Market: ${profile.market}
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
    3. Use the 30Y CAGR and VOLATILITY to set long-term expected returns per asset class.
    4. Use MAX DRAWDOWN data to calibrate risk — S&P crashed -56.78% in 2009, Nifty crashed -59.86% in 2008.
    5. Consider the user's risk tolerance and horizon when weighting between growth and safety.
    6. Allocate using EXACTLY these 6 categories (even if 0%): Gold/Silver, Mutual Funds, Bonds, Fixed Deposit, Stocks, Alternative Growth.
    7. Ensure percentages sum to 100%.
    8. Provide 3-4 prioritized monthly action steps grounded in the current macro and market data.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: prompt,
    config: {
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
    You are FinWise's Narrative Synthesizer Agent.
    Write a professional financial strategy narrative and a Macro Regime & Rate Cycle Analysis.
    ALL your analysis must be grounded in the REAL BigQuery data provided below.
    
    Profile: Market ${profile.market}, Objective ${profile.objective}, Risk ${profile.riskProfile}, Horizon ${profile.goalHorizon} years.
    Allocation: ${JSON.stringify(allocation.assetAllocation)}
    
    [LIVE GOOGLE CLOUD BIGQUERY MARKET INTELLIGENCE — 660,000+ records, 2005-2026]
    ${marketContext}
    
    INSTRUCTIONS:
    1. Write a 2-3 paragraph narrative explaining the strategy. Reference SPECIFIC numbers from the BigQuery data (e.g., "Gold's 30Y CAGR of 12.61% combined with its current 39.8% 1Y momentum...").
    2. For the Regime Analysis, use the EXACT max drawdown percentages and dates from BigQuery:
       - Reference actual drawdown dates (e.g., "S&P 500 peaked-to-trough -56.78% hitting bottom on March 9, 2009")
       - Calculate approximate portfolio impact using the user's allocation weights
       - Estimate recovery times based on the data coverage
    3. Do NOT make up drawdown numbers — use only the figures provided above.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: prompt,
    config: {
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
    You are FinWise, an elite autonomous AI wealth advisor.
    The user has selected the asset category "${category}" from their portfolio for a deep dive.
    
    User Profile: Market ${profile.market}, Risk Profile ${profile.riskProfile}, Goal Horizon: ${profile.goalHorizon} years.
    
    [SPECIFIC BIGQUERY DATA FOR ${category.toUpperCase()}]:
    ${JSON.stringify(categoryData, null, 2)}
    
    [FULL MARKET CONTEXT]:
    ${marketContext}

    Recommend how to split their investment *within* this specific category based on the BigQuery risk metrics, current momentum, and 1Y returns.
    Provide 3 concise key takeaways explaining the strategy, and specific sub-allocations that sum to 100%.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
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
  return JSON.parse(cleanJson) as CategoryRecommendation;
};
// Asset Picker Agent
export const getSpecificAssetRecommendations = async (mainCategory: string, subCategory: string, profile: UserProfile): Promise<SpecificAssetPick[]> => {
  // Try to get real stocks from BigQuery based on category and target market
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

  const prompt = `
    You are FinWise, an elite autonomous AI wealth advisor.
    The user selected main category "${mainCategory}" and sub-category "${subCategory}".
    
    Based on their profile (Market: ${profile.market}, Risk: ${profile.riskProfile}, Horizon: ${profile.goalHorizon} years), provide the TOP specific asset recommendations for this sub-category.
    
    ${bqContext}
    
    If BigQuery data is provided above, YOU MUST USE IT. 
    If not, provide your best recommendations using real market tickers.
    
    Provide Symbol, Name, Estimated Current Price, Past Performance (e.g. 1Y return), Future Prediction, and Reasoning.
    You MUST return exactly the same number of items as the BigQuery data (if provided), or exactly 10 items if no BigQuery data is provided.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
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
  return JSON.parse(cleanJson) as SpecificAssetPick[];
};

// Conversational Advisor Agent
export const initChatSession = (profile: UserProfile, allocation: AllocationData, projections: Projection[], narrativeData: NarrativeData, benchmarks: MarketBenchmark[], macroRegime?: MacroRegimeState | null) => {
  const marketContext = buildMarketContext(benchmarks, macroRegime);
  currentChatSession = ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: `
        You are FinWise, an elite AI wealth advisor backed by live BigQuery datasets (finwise-506509.finwise_data).
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
