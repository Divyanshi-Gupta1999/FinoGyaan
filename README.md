# FinoGyaan: Autonomous Multi-Agent Wealth Advisor

[![Live Application](https://img.shields.io/badge/Live_App-https%3A%2F%2Ffinogyaan.web.app-blue?style=for-the-badge&logo=google-cloud)](https://finogyaan.web.app)
[![Google Cloud](https://img.shields.io/badge/Google_Cloud-Vertex_AI_%7C_BigQuery_%7C_Cloud_Run-4285F4?style=for-the-badge&logo=googlecloud&logoColor=white)](https://cloud.google.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

> **Democratizing institutional-grade financial planning.** FinoGyaan combines Google Gemini 2.5 on Vertex AI with a ground-truth data warehouse of 725,800+ historical and macroeconomic records in Google Cloud BigQuery (1985–2026) to deliver personalized, mathematically sound, zero-hallucination wealth advice.

---

## 🌐 Live Production Links

* **Primary Application URL:** [**`https://finogyaan.web.app`**](https://finogyaan.web.app)
* **Backup Firebase URL:** [**`https://finogyaan.firebaseapp.com`**](https://finogyaan.firebaseapp.com)
* **Direct Google Cloud Run URL:** [**`https://finogyaan-187888203867.us-central1.run.app`**](https://finogyaan-187888203867.us-central1.run.app)

---

## 🌟 Key Features

1. **Personalized Goal-Based Wealth Planning:** Calibrates risk and distributes capital across 6 major asset classes (Equities, Mutual Funds, Bonds, Fixed Deposits, Gold/Silver, and Alternative Growth).
2. **Deterministic Financial Projections (Zero Hallucination):** Uses 40-year historical BigQuery CAGRs and volatility standard deviations at `temperature: 0.0` to generate 30-year probabilistic Bull (75th percentile), Base (50th percentile), and Bear (25th percentile) trajectories.
3. **Historical Crisis Stress-Testing:** Simulates portfolio survival across past financial crises (2008 Great Recession, 2020 COVID Shock) with peak-to-trough drawdowns and recovery durations.
4. **Dual-Market Stock & ETF Picks:** Real-time algorithmic ranking across US markets (S&P 500 / NASDAQ) and Indian indices (NSE / BSE) filtered by 1-year trailing returns and Sharpe ratios.
5. **Interactive Conversational Copilot:** Plain-English scenario testing (e.g., *"What happens if I take a 6-month career sabbatical in 3 years?"*) with formatted typography and actionable recommendations.
6. **Live Macroeconomic Pulse Engine:** Real-time monitoring of US CPI Inflation, Fed Funds Rates, 10Y-2Y Yield Curve spreads, and VIX Volatility directly from BigQuery.

---

## 🏗️ System Architecture

```text
+-----------------------------------------------------------------------+
|                      1. CLIENT PRESENTATION TIER                      |
|  * React 19 + TypeScript + Vite + TailwindCSS + Recharts              |
|  * Primary URL: https://finogyaan.web.app                             |
|  * Firebase Hosting: Global CDN Edge Caching & Auto-Rewrites          |
+-----------------------------------------------------------------------+
                                   |
                                   v
+-----------------------------------------------------------------------+
|                 2. APPLICATION TIER (Google Cloud Run)                |
|  * Microservice: finogyaan (node:20-slim)                             |
|  * GoogleAuth ADC: Secure IAM Token Minting                           |
|  * Vertex AI Proxy: Rate Limiting, Failover & SSRF Firewall           |
|  * BigQuery REST API: /api/bigquery/macro-regime & top-stocks         |
+-----------------------------------------------------------------------+
                     |                                   |
                     v                                   v
+---------------------------------------+ +-----------------------------+
|         3. MULTI-AGENT FLEET          | |  4. DATA GROUND-TRUTH TIER  |
|          (Google Vertex AI)           | |    (Google Cloud BigQuery)  |
|                                       | |                             |
| * Agent 1: Macro Strategist           | | * Dataset: finwise_data     |
|   (Gemini 2.5 Pro)                    | | * Scale: 725,800+ records   |
| * Agent 2: Quant Modeler              | |                             |
|   (Deterministic Math)                | | * Tables:                   |
| * Agent 3: Stress-Tester              | |   - individual_stock_history|
|   (Gemini 2.5 Pro)                    | |     (632,773 rows - NSE & US|
| * Agent 4: Asset Picker               | |   - macro_economic_ind.     |
|   (Gemini 2.5 Flash + BQ)             | |     (60,889 rows - CPI/FRED)|
| * Agent 5: Copilot Chat               | |   - market_regime_history   |
|   (Gemini 2.5 Flash)                  | |     (32,141 rows)           |
|                                       | |   - regime_summary          |
|                                       | |     (Live Macro Indicators) |
+---------------------------------------+ +-----------------------------+
                                                         ^
                                                         |
                                          +-----------------------------+
                                          | 5. AUTOMATED PIPELINE TIER  |
                                          | * Cloud Scheduler (1:30 UTC)|
                                          | * Cloud Function (Gen 2):   |
                                          |   finwise-daily-ingest      |
                                          +-----------------------------+
```

---

## 🛠️ Tech Stack

* **Frontend:** React 19, Vite, TypeScript, TailwindCSS, Recharts, Lucide Icons, ReactMarkdown
* **Multi-Agent AI:** Google Vertex AI (Gemini 2.5 Pro & Gemini 2.5 Flash)
* **Data Warehouse:** Google Cloud BigQuery (725,800+ records)
* **Compute & Hosting:** Google Cloud Run, Docker (`node:20-slim`), Firebase Hosting
* **Data Pipeline:** Cloud Functions 2nd Gen (Python 3.11), Cloud Scheduler

---

## 🚀 Local Development Setup

### 1. Prerequisites
* [Google Cloud SDK (`gcloud` CLI)](https://cloud.google.com/sdk/docs/install)
* Node.js v20+ and npm

### 2. Authenticate Google Cloud
```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project finwise-506509
```

### 3. Install & Start Locally
```bash
# Install root, backend, and frontend dependencies
npm run install-all

# Start both backend and frontend development servers concurrently
npm run dev
```

* **Frontend:** `http://localhost:5173`
* **Backend API:** `http://localhost:5000`

---

## 🚢 Deployment

To build the production bundle and deploy to Google Cloud Run and Firebase Hosting:

```bash
chmod +x deploy.sh
./deploy.sh
```

---

## 📄 License
This project is open-source and available under the [MIT License](LICENSE).
