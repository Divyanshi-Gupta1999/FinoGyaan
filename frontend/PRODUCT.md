# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Financial advisors, wealth managers, and sophisticated wealth builders using AI to formulate, stress-test, and present institutional-grade investment plans to clients.

## Product Purpose
FinWise AI is an autonomous, data-grounded wealth advisory platform. It eliminates LLM hallucinations in financial planning by anchoring all portfolio allocations, projections, and asset recommendations to over 725,000 live and historical Google Cloud BigQuery records (1985–2026).

## Positioning
Unlike generic financial chatbots or static calculators, FinWise AI runs a multi-agent quantitative pipeline (Macro Strategist, Quant Modeler, Narrative Synthesizer, Asset Picker, Conversational Advisor) driven directly by live BigQuery SQL analytics, real-time macroeconomic indicators (FRED inflation, policy rates, yield curve spreads, VIX), and deterministic Monte Carlo compounding math.

## Operating Context
Used during wealth advisory client sessions, FIRE milestone planning, and portfolio rebalancing reviews. Advisors input client cash flows (income, expenses, capital, horizon, risk profile) and generate an end-to-end interactive dashboard with multi-asset allocations, probabilistic outcome curves, and sector drill-downs.

## Capabilities and Constraints
- Multi-Agent Orchestration: 4 specialized AI agents working sequentially and in parallel via Google Vertex AI (Gemini 2.5 Flash).
- Live BigQuery Integration: 725,000+ records across `market_regime_history`, `individual_stock_history`, `macro_economic_indicators`, and `regime_summary`.
- Macroeconomic Pulse Engine: Real-time tracking of CPI inflation (2.9%), central bank policy rates (3.63%), yield curve spreads (+0.39%), and CBOE VIX (14.4).
- Category Deep Dive: Subcategory allocation and ranking of top-performing stocks/ETFs across US and Indian markets.
- Probabilistic Fan Curves: Quant modeler generating 10th (Bear), 50th (Base), and 90th (Bull) percentile growth outcomes.
- Crisis Stress Testing: Quantifies portfolio drawdowns against historical crises (2008 GFC, 2020 Shock) with exact recovery timelines.

## Brand Commitments
- Name: FinoGyaan AI
- Theme: Modern dark mode aesthetic, sleek emerald & blue accents, glassmorphic panels, clear typographic hierarchy.
- Voice: Institutional, data-grounded, authoritative, and actionable.

## Evidence on Hand
- BigQuery dataset in Google Cloud project `finwise-506509` (`finwise_data`).
- Real price and macro data from 1985 to August 2026 across 130+ assets.
- Zero mock or simulated numbers in calculations.

## Product Principles
1. Grounded in Hard Data: Never hallucinate market CAGR, drawdowns, or stock prices; every metric must originate from BigQuery SQL.
2. Deterministic Compounding: Projections use quantitative financial mathematics, not generative AI guesswork.
3. Multi-Decade Risk Awareness: Emphasize downside protection, tail risk, and historical crisis survival alongside growth.
4. Actionable Advisor Velocity: Empower advisors to move from client intake to a fully synthesized, stress-tested proposal in seconds.
