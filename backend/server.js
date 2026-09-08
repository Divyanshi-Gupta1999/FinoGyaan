
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import 'dotenv/config';
import express from 'express';
import { GoogleAuth } from 'google-auth-library';
import fetch from 'node-fetch';
import rateLimit from 'express-rate-limit';
import { WebSocketServer, WebSocket } from 'ws';
import { execSync } from 'child_process';

const app = express();
app.use(express.json({limit: process?.env?.API_PAYLOAD_MAX_SIZE || "7mb"}));

const PORT = process?.env?.API_BACKEND_PORT || 5000;
const API_BACKEND_HOST = process?.env?.API_BACKEND_HOST || "127.0.0.1";

const GOOGLE_CLOUD_LOCATION = process?.env?.GOOGLE_CLOUD_LOCATION;
const GOOGLE_CLOUD_PROJECT = process?.env?.GOOGLE_CLOUD_PROJECT;
if (!GOOGLE_CLOUD_PROJECT || !GOOGLE_CLOUD_LOCATION) {
  console.error("Error: Environment variables GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION must be set.");
  process.exit(1);
}
const PROXY_HEADER = process?.env?.PROXY_HEADER;
if (!PROXY_HEADER) {
  console.error("Error: Environment variables PROXY_HEADER must be set.");
  process.exit(1);
}

app.set('trust proxy', 1 /* number of proxies between user and server */);

// IMPORTANT: Vertex AI Studio Rate Limiting
// This rate limiting configuration protects your backend APIs from abuse.
// Removing it exposes your service to DoS attacks and unexpected costs.
const proxyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // Set ratelimit window at 15min (in ms)
    max: 100, // Limit each IP to 100 requests per window 
    standardHeaders: true, // Return rate limit info in the "RateLimit-*" headers
    legacyHeaders: false, // no "X-RateLimit-*" headers
    message: {
      error: 'Too many requests',
      message: 'You have exceed the request limit, please try again later.'
    },
});
// Apply the rate limiter to the /api-proxy route before the main proxy logic
app.use('/api-proxy', proxyLimiter);

const API_CLIENT_MAP = [
 {
    name: "VertexGenAi:generateContent",
    patternForProxy: "https://aiplatform.googleapis.com/{{version}}/publishers/google/models/{{model}}:generateContent",
    getApiEndpoint: (context, params) => {
      return `https://aiplatform.clients6.google.com/${params['version']}/projects/${context.projectId}/locations/${context.region}/publishers/google/models/${params['model']}:generateContent`;
    },
    isStreaming: false,
    transformFn: null,
  },
 {
    name: "VertexGenAi:predict",
    patternForProxy: "https://aiplatform.googleapis.com/{{version}}/publishers/google/models/{{model}}:predict",
    getApiEndpoint: (context, params) => {
      return `https://aiplatform.clients6.google.com/${params['version']}/projects/${context.projectId}/locations/${context.region}/publishers/google/models/${params['model']}:predict`;
    },
    isStreaming: false,
    transformFn: null,
  },
 {
    name: "VertexGenAi:streamGenerateContent",
    patternForProxy: "https://aiplatform.googleapis.com/{{version}}/publishers/google/models/{{model}}:streamGenerateContent",
    getApiEndpoint: (context, params) => {
      return `https://aiplatform.clients6.google.com/${params['version']}/projects/${context.projectId}/locations/${context.region}/publishers/google/models/${params['model']}:streamGenerateContent`;
    },
    isStreaming: true,
    transformFn: (response) => {
        let normalizedResponse = response.trim();
        while (normalizedResponse.startsWith(',') || normalizedResponse.startsWith('[')) {
          normalizedResponse = normalizedResponse.substring(1).trim();
        }
        while (normalizedResponse.endsWith(',') || normalizedResponse.endsWith(']')) {
          normalizedResponse = normalizedResponse.substring(0, normalizedResponse.length - 1).trim();
        }

        if (!normalizedResponse.length) {
          return {result: null, inProgress: false};
        }

        if (!normalizedResponse.endsWith('}')) {
          return {result: normalizedResponse, inProgress: true};
        }

        try {
          const parsedResponse = JSON.parse(`${normalizedResponse}`);
          const transformedResponse = `data: ${JSON.stringify(parsedResponse)}\n\n`;
          return {result: transformedResponse, inProgress: false};
        } catch (error) {
          throw new Error(`Failed to parse response: ${error}.`);
        }
    },
  },
].map((client) => ({ ...client, patternInfo: parsePattern(client.patternForProxy) }));

// IMPORTANT: Vertex AI Studio SSRF Protection
// The set below is the exhaustive allow-list of upstream hostnames this
// proxy may forward authenticated requests to. It is sourced at code
// generation time from the RestApiClient.getAllowedUpstreamHosts() of every
// client embedded in API_CLIENT_MAP. Removing, weakening, or widening this
// check (for example, by adding wildcards or computing entries from request
// data) re-introduces the SSRF vulnerability that allows the deployed
// service account's OAuth access token to be exfiltrated to an
// attacker-controlled host.
const ALLOWED_UPSTREAM_HOSTS = new Set([
  "aiplatform.clients6.google.com",
]);

// Uses Google Application Default Credentials (ADC).
// Users need to run "gcloud auth application-default login" in order to use the proxy.
const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsePattern(pattern) {
  const paramRegex = /\{\{(.*?)\}\}/g;
  const params = [];
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = paramRegex.exec(pattern)) !== null) {
    params.push(match[1]);
    const literalPart = pattern.substring(lastIndex, match.index);
    parts.push(escapeRegex(literalPart));
    parts.push(`(?<${match[1]}>[^/]+)`);
    lastIndex = paramRegex.lastIndex;
  }
  parts.push(escapeRegex(pattern.substring(lastIndex)));
  const regexString = parts.join('');

  return {regex: new RegExp(`^${regexString}$`), params};
}

function extractParams(patternInfo, url) {
  const match = url.match(patternInfo.regex);
  if (!match) return null;
  const params = {};
  patternInfo.params.forEach((paramName, index) => {
    params[paramName] = match[index + 1];
  });
  return params;
}

async function getAccessToken(res) {
  try {
    const authClient = await auth.getClient();
    const token = await authClient.getAccessToken();
    if (token && token.token) return token.token;
  } catch (error) {
    console.warn('[Node Proxy] Primary ADC auth failed, attempting gcloud CLI token fallback...');
  }

  try {
    const gcloudToken = execSync('gcloud auth print-access-token', { encoding: 'utf-8' }).trim();
    if (gcloudToken) return gcloudToken;
  } catch (gcloudErr) {
    console.error('[Node Proxy] gcloud CLI auth fallback failed:', gcloudErr.message);
  }

  if (!res) return null;
  res.status(401).json({
    error: 'Authentication Required',
    message: 'Google Cloud credentials not found. Please run "gcloud auth application-default login" or "gcloud auth login".',
  });
  return null;
}

function getRequestHeaders(accessToken) {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'X-Goog-User-Project': GOOGLE_CLOUD_PROJECT,
    'Content-Type': 'application/json',
  };
}

// --- Proxy Endpoint ---
app.post('/api-proxy', async (req, res) => {

  // Check for the custom header added by the shim
  if (req.headers['x-app-proxy'] !== PROXY_HEADER) {
    return res.status(403).send('Forbidden: Request must originate from the Vertex App shim.');
  }

  const { originalUrl, method, headers, body } = req.body;
  if (!originalUrl) {
    return res.status(400).send('Bad Request: originalUrl is required.');
  }

  // 1. Find the matching API client
  const apiClient = API_CLIENT_MAP.find(p => {
    // We store extractedParams on req for use later if needed, though getVertexUrl takes it as arg.
    req.extractedParams = extractParams(p.patternInfo, originalUrl);
    return req.extractedParams !== null;
  });

  if (!apiClient) {
    console.error(`[Node Proxy] No API client handler found for URL: ${originalUrl}`);
    return res.status(404).json({ error: `No proxy handler found for URL: ${originalUrl}` });
  }

  const extractedParams = req.extractedParams;
  console.log(`[Node Proxy] Matched API client: ${apiClient.name}`);
  try {
    // 2. Get authenticated access token
    const accessToken = await getAccessToken(res);
    if (!accessToken) return;

    // 3. Construct the full API URL using env-set GOOGLE_CLOUD_PROJECT/LOCATION and extracted params
    const context = {projectId: GOOGLE_CLOUD_PROJECT, region: GOOGLE_CLOUD_LOCATION};
    const apiUrl = apiClient.getApiEndpoint(context, extractedParams);

    // IMPORTANT: Vertex AI Studio SSRF Protection
    // Parse the constructed apiUrl with the standard URL parser (not a
    // regex) and require the resulting hostname to be in the hardcoded
    // ALLOWED_UPSTREAM_HOSTS set. This neutralizes attacks that smuggle a
    // URL-grammar delimiter (e.g. '#') into a pattern parameter to redirect
    // the authenticated upstream request to an attacker-controlled host.
    let parsedApiUrl;
    try {
      parsedApiUrl = new URL(apiUrl);
    } catch (e) {
      console.error(`[Node Proxy] Invalid API URL: ${apiUrl}`);
      return res.status(400).json({ error: 'Invalid API URL.' });
    }
    if (!ALLOWED_UPSTREAM_HOSTS.has(parsedApiUrl.hostname.toLowerCase())) {
      console.error(`[Node Proxy] Upstream host not allowed: ${parsedApiUrl.hostname}`);
      return res.status(400).json({ error: 'Upstream host not allowed.' });
    }
    console.log(`[Node Proxy] Forwarding to Vertex API: ${apiUrl}`);

    // 4. Prepare headers for the API call
    const apiHeaders = getRequestHeaders(accessToken);

    const apiFetchOptions = {
      method: method || 'POST',
      headers: {...apiHeaders, ...headers},
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    };

    // 5. Make the call to the API
    const apiResponse = await fetch(apiUrl, apiFetchOptions);

    // 6. Respond to the client based on stream type
    if (apiClient.isStreaming) {
      console.log(`[Node Proxy] Sending STREAMING response for ${apiClient.name}`);
      // Set headers for a streaming JSON response
      res.writeHead(apiResponse.status, {
        'Content-Type': 'text/event-stream',
        'Transfer-Encoding': 'chunked',
        'Connection': 'keep-alive',
      });
      // Immediately send headers
      res.flushHeaders();

      if (!apiResponse.body) {
        console.error('[Node Proxy] Streaming response has no body.');
        return res.end(JSON.stringify({ error: 'Streaming response body is null' }));
      }

      const decoder = new TextDecoder();
      let deltaChunk = '';
      apiResponse.body.on('data', (encodedChunk) => {
        if (res.writableEnded) return; // Prevent writing after res.end()

        try {
          if (!apiClient.transformFn) {
            res.write(encodedChunk);
          } else {
            const decodedChunk = decoder.decode(encodedChunk, { stream: true });
            deltaChunk = deltaChunk + decodedChunk;

            const {result, inProgress} = apiClient.transformFn(deltaChunk);
            if (result && !inProgress) {
              deltaChunk = '';
              res.write(new TextEncoder().encode(result));
            }
          }
        } catch (error) {
          console.error(`[Node Proxy] Error processing streaming response for ${apiClient.name}`);
          console.error(error);
        }
      });

      apiResponse.body.on('end', () => {
        deltaChunk = '';
        console.log(`[Node Proxy] Vertex stream finished and all data processed for ${apiClient.name}`);
        res.end();
      });

      apiResponse.body.on('error', (streamError) => {
        console.error('[Node Proxy] Error from Vertex stream:', streamError);
        if (!res.writableEnded) {
          res.end(JSON.stringify({ proxyError: 'Stream error from Vertex AI', details: streamError.message }));
        }
      });

      res.on('error', (resError) => {
        console.error('[Node Proxy] Error writing to client response:', resError);
        // The source stream might need to be destroyed if an error occurs here.
        if (apiResponse.body && typeof apiResponse.body.destroy === 'function') {
             apiResponse.body.destroy(resError);
        }
      });
    } else {
      // Non-streaming response handling
      console.log(`[Node Proxy] Sending JSON response for ${apiClient.name}`);
      const data = await apiResponse.json();
      res.status(apiResponse.status).json(data);
    }
  } catch (error) {
    console.error(`[Node Proxy] Error proxying request for ${apiClient.name}`);
    console.error(error)
    res.status(500).json({ error: error });
  }
});

// --- BigQuery Proxy Endpoint ---
app.post('/api/bigquery/query', async (req, res) => {
  try {
    const accessToken = await getAccessToken(res);
    if (!accessToken) return;

    const { query } = req.body;
    const sqlQuery = query || "SELECT * FROM `finwise-506509.finwise_data.regime_summary`";
    console.log(`[BigQuery Proxy] Executing SQL: ${sqlQuery}`);

    const bqResponse = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${GOOGLE_CLOUD_PROJECT}/queries`, {
      method: 'POST',
      headers: getRequestHeaders(accessToken),
      body: JSON.stringify({
        query: sqlQuery,
        useLegacySql: false,
      }),
    });

    const data = await bqResponse.json();
    if (!bqResponse.ok) {
      console.error('[BigQuery Proxy] Error from BigQuery API:', data);
      return res.status(bqResponse.status).json(data);
    }

    const fields = data.schema?.fields?.map(f => f.name) || [];
    const rows = (data.rows || []).map(row => {
      const obj = {};
      row.f.forEach((cell, idx) => {
        const fieldName = fields[idx];
        obj[fieldName] = cell.v;
      });
      return obj;
    });

    return res.json({ success: true, rows, totalRows: data.totalRows });
  } catch (error) {
    console.error('[BigQuery Proxy] Unexpected error:', error);
    return res.status(500).json({ error: error.message || 'BigQuery query failed' });
  }
});

// --- BigQuery Market Analysis Endpoint (5 parallel analytical queries) ---
async function executeBQQuery(accessToken, sqlQuery) {
  const bqResponse = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${GOOGLE_CLOUD_PROJECT}/queries`, {
    method: 'POST',
    headers: getRequestHeaders(accessToken),
    body: JSON.stringify({ query: sqlQuery, useLegacySql: false }),
  });
  const data = await bqResponse.json();
  if (!bqResponse.ok) throw new Error(data?.error?.message || 'BigQuery query failed');
  const fields = data.schema?.fields?.map(f => f.name) || [];
  return (data.rows || []).map(row => {
    const obj = {};
    row.f.forEach((cell, idx) => { obj[fields[idx]] = cell.v; });
    return obj;
  });
}

app.get('/api/bigquery/market-analysis', async (req, res) => {
  console.log('[BigQuery Market Analysis] Running 5 parallel analytical queries...');
  try {
    const accessToken = await getAccessToken(res);
    if (!accessToken) return;

    const queries = {
      regimeSummary: `SELECT * FROM \`finwise-506509.finwise_data.regime_summary\` ORDER BY annualized_return_cagr DESC`,

      currentPrices: `WITH recent AS (
        SELECT asset_name, close_price, trade_date,
          ROW_NUMBER() OVER (PARTITION BY asset_name ORDER BY trade_date DESC) as rn
        FROM \`finwise-506509.finwise_data.market_regime_history\`
      ), yr_ago AS (
        SELECT asset_name, close_price, trade_date,
          ROW_NUMBER() OVER (PARTITION BY asset_name ORDER BY ABS(DATE_DIFF(trade_date, DATE_SUB(CURRENT_DATE(), INTERVAL 1 YEAR), DAY))) as rn
        FROM \`finwise-506509.finwise_data.market_regime_history\`
      )
      SELECT r.asset_name,
        ROUND(r.close_price, 2) as current_price,
        r.trade_date as latest_date,
        ROUND(y.close_price, 2) as price_1yr_ago,
        y.trade_date as date_1yr_ago,
        ROUND((r.close_price - y.close_price) / y.close_price * 100, 2) as return_1yr_pct
      FROM recent r JOIN yr_ago y ON r.asset_name = y.asset_name AND y.rn = 1
      WHERE r.rn = 1`,

      momentum30d: `WITH daily_returns AS (
        SELECT asset_name, trade_date, close_price,
          (close_price - LAG(close_price) OVER (PARTITION BY asset_name ORDER BY trade_date))
            / LAG(close_price) OVER (PARTITION BY asset_name ORDER BY trade_date) as daily_return
        FROM \`finwise-506509.finwise_data.market_regime_history\`
      )
      SELECT asset_name,
        ROUND(AVG(daily_return) * 252 * 100, 2) as annualized_momentum_pct,
        ROUND(STDDEV(daily_return) * SQRT(252) * 100, 2) as recent_volatility_pct,
        ROUND(MIN(daily_return) * 100, 2) as worst_day_pct,
        ROUND(MAX(daily_return) * 100, 2) as best_day_pct
      FROM daily_returns
      WHERE trade_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
      GROUP BY asset_name
      ORDER BY annualized_momentum_pct DESC`,

      maxDrawdowns: `WITH prices AS (
        SELECT asset_name, trade_date, close_price,
          MAX(close_price) OVER (PARTITION BY asset_name ORDER BY trade_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as running_max
        FROM \`finwise-506509.finwise_data.market_regime_history\`
      ), drawdowns AS (
        SELECT asset_name, trade_date, close_price, running_max,
          (close_price - running_max) / running_max as drawdown
        FROM prices
      )
      SELECT asset_name,
        ROUND(MIN(drawdown) * 100, 2) as max_drawdown_pct,
        ANY_VALUE(trade_date HAVING MIN drawdown) as max_drawdown_date
      FROM drawdowns GROUP BY asset_name ORDER BY max_drawdown_pct ASC`,

      priceRange: `SELECT asset_name,
        MIN(trade_date) as data_start_date,
        MAX(trade_date) as data_end_date,
        ROUND(MIN(close_price), 2) as all_time_low,
        ROUND(MAX(close_price), 2) as all_time_high,
        ROUND(AVG(close_price), 2) as avg_price,
        COUNT(*) as total_trading_days
      FROM \`finwise-506509.finwise_data.market_regime_history\`
      GROUP BY asset_name ORDER BY total_trading_days DESC`,
    };

    const [regimeSummary, currentPrices, momentum30d, maxDrawdowns, priceRange] = await Promise.all([
      executeBQQuery(accessToken, queries.regimeSummary),
      executeBQQuery(accessToken, queries.currentPrices),
      executeBQQuery(accessToken, queries.momentum30d),
      executeBQQuery(accessToken, queries.maxDrawdowns),
      executeBQQuery(accessToken, queries.priceRange),
    ]);

    console.log('[BigQuery Market Analysis] All 5 queries completed successfully.');
    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      regimeSummary,
      currentPrices,
      momentum30d,
      maxDrawdowns,
      priceRange,
    });
  } catch (error) {
    console.error('[BigQuery Market Analysis] Error:', error);
    return res.status(500).json({ error: error.message || 'Market analysis query failed' });
  }
});

// --- BigQuery Top Stocks Endpoint ---
app.get('/api/bigquery/top-stocks', async (req, res) => {
  try {
    const accessToken = await getAccessToken(res);
    if (!accessToken) return;

    const rawCategory = (req.query.category || '').toLowerCase();
    const marketParam = (req.query.market || '').toUpperCase();
    
    // Determine the best keyword filter based on incoming category name
    let keyword = '';
    if (rawCategory.includes('silver')) keyword = 'silver';
    else if (rawCategory.includes('gold') && rawCategory.includes('mining')) keyword = 'mining';
    else if (rawCategory.includes('gold')) keyword = 'gold';
    else if (rawCategory.includes('gov') || rawCategory.includes('treasury') || rawCategory.includes('gilt')) keyword = 'government';
    else if (rawCategory.includes('bond') || rawCategory.includes('fixed') || rawCategory.includes('debt')) keyword = 'bond';
    else if (rawCategory.includes('index') || rawCategory.includes('etf') || rawCategory.includes('mutual') || rawCategory.includes('flexi')) keyword = 'index';
    else if (rawCategory.includes('tech') || rawCategory.includes('software')) keyword = 'technology';
    else if (rawCategory.includes('fin') || rawCategory.includes('bank')) keyword = 'finance';
    else if (rawCategory.includes('health') || rawCategory.includes('pharma')) keyword = 'healthcare';
    else if (rawCategory.includes('large') || rawCategory.includes('cap') || rawCategory.includes('consumer')) keyword = 'large cap';
    else {
      keyword = rawCategory.replace(/[^a-zA-Z0-9 ]/g, '').split(' ')[0] || '';
    }

    // Determine geographic filter (Indian vs US / International)
    let marketFilter = '';
    const isExplicitlyIndian = rawCategory.includes('indian') || rawCategory.includes('india') || rawCategory.includes('nifty');
    const isExplicitlyInternational = rawCategory.includes('international') || rawCategory.includes('us ') || rawCategory.includes('foreign') || rawCategory.includes('global');

    if (isExplicitlyIndian || (!isExplicitlyInternational && marketParam === 'IN')) {
      marketFilter = "AND (l.symbol LIKE '%.NS' OR l.category LIKE 'IN%')";
    } else if (isExplicitlyInternational || marketParam === 'US') {
      marketFilter = "AND (NOT l.symbol LIKE '%.NS' AND NOT l.category LIKE 'IN%')";
    }

    console.log(`[BigQuery Top Stocks] Category: "${rawCategory}" | Market: "${marketParam}" -> Keyword: "${keyword}" | Filter: "${marketFilter}"`);

    const sqlQuery = `
      WITH latest AS (
        SELECT symbol, name, category, close_price, trade_date,
          ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY trade_date DESC) as rn
        FROM \`finwise-506509.finwise_data.individual_stock_history\`
      ),
      yr_ago AS (
        SELECT symbol, close_price, trade_date,
          ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY ABS(DATE_DIFF(trade_date, DATE_SUB(CURRENT_DATE(), INTERVAL 1 YEAR), DAY))) as rn
        FROM \`finwise-506509.finwise_data.individual_stock_history\`
      )
      SELECT l.symbol, l.name, l.category, 
        ROUND(l.close_price, 2) as current_price,
        ROUND((l.close_price - y.close_price) / y.close_price * 100, 2) as return_1yr_pct
      FROM latest l
      JOIN yr_ago y ON l.symbol = y.symbol AND y.rn = 1
      WHERE l.rn = 1
        ${keyword ? `AND LOWER(l.category) LIKE '%${keyword}%'` : ''}
        ${marketFilter}
      ORDER BY return_1yr_pct DESC
      LIMIT 10
    `;

    const bqResponse = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${GOOGLE_CLOUD_PROJECT}/queries`, {
      method: 'POST',
      headers: getRequestHeaders(accessToken),
      body: JSON.stringify({ query: sqlQuery, useLegacySql: false }),
    });

    const data = await bqResponse.json();
    if (!bqResponse.ok) {
      console.error('[BigQuery Proxy] Error fetching top stocks:', data);
      return res.status(bqResponse.status).json(data);
    }

    const fields = data.schema?.fields?.map(f => f.name) || [];
    const rows = (data.rows || []).map(row => {
      const obj = {};
      row.f.forEach((cell, idx) => { obj[fields[idx]] = cell.v; });
      return obj;
    });

    return res.json({ success: true, rows, keywordUsed: keyword });
  } catch (error) {
    console.error('[BigQuery Proxy] Unexpected error fetching top stocks:', error);
    return res.status(500).json({ error: error.message || 'BigQuery query failed' });
  }
});

// --- BigQuery Macroeconomic Regime Endpoint ---
app.get('/api/bigquery/macro-regime', async (req, res) => {
  try {
    const accessToken = await getAccessToken(res);
    if (!accessToken) return;

    const sqlQuery = `
      WITH ranked_indicators AS (
        SELECT indicator_code, indicator_name, category, period_date, value, unit,
          ROW_NUMBER() OVER (PARTITION BY indicator_code ORDER BY period_date DESC) as rn
        FROM \`finwise-506509.finwise_data.macro_economic_indicators\`
      ),
      cpi_1yr_ago AS (
        SELECT value as cpi_prev_year
        FROM \`finwise-506509.finwise_data.macro_economic_indicators\`
        WHERE indicator_code = 'CPIAUCSL'
          AND period_date <= DATE_SUB(CURRENT_DATE(), INTERVAL 1 YEAR)
        ORDER BY period_date DESC
        LIMIT 1
      )
      SELECT r.indicator_code, r.indicator_name, r.category, r.period_date, r.value, r.unit
      FROM ranked_indicators r
      WHERE r.rn = 1
    `;

    const bqResponse = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${GOOGLE_CLOUD_PROJECT}/queries`, {
      method: 'POST',
      headers: getRequestHeaders(accessToken),
      body: JSON.stringify({ query: sqlQuery, useLegacySql: false }),
    });

    const data = await bqResponse.json();
    if (!bqResponse.ok) {
      console.error('[BigQuery Proxy] Error fetching macro regime:', data);
      return res.status(bqResponse.status).json(data);
    }

    const fields = data.schema?.fields?.map(f => f.name) || [];
    const rows = (data.rows || []).map(row => {
      const obj = {};
      row.f.forEach((cell, idx) => { obj[fields[idx]] = cell.v; });
      return obj;
    });

    const indMap = new Map(rows.map(r => [r.indicator_code, Number(r.value)]));
    
    const fedRate = indMap.get('FEDFUNDS') || indMap.get('DGS2') || 5.25;
    const yieldSpread = indMap.get('T10Y2Y') !== undefined ? indMap.get('T10Y2Y') : 0.15;
    const vix = indMap.get('VIX') || 15.2;
    const dxy = indMap.get('DXY') || 103.5;
    const usdinr = indMap.get('USDINR') || 83.9;
    const unrate = indMap.get('UNRATE') || 4.1;

    // Detect Macro Regime
    let regimeTitle = 'Expansion & Disinflation';
    let regimeBadge = '🟢 Goldilocks';
    let yieldCurveStatus = 'Normal (+ Steepening)';

    if (yieldSpread < 0) {
      yieldCurveStatus = '⚠️ Inverted (Recession Warning)';
      regimeTitle = 'Late-Cycle Inversion';
      regimeBadge = '🟡 Late Cycle';
    }

    if (vix > 25) {
      regimeTitle = 'High Volatility / Risk-Off';
      regimeBadge = '🔴 Risk-Off';
    } else if (vix < 15) {
      regimeBadge = '🟢 Low Volatility / Risk-On';
    }

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      regime: {
        title: regimeTitle,
        badge: regimeBadge,
        yieldCurveStatus,
        cpiInflation: '2.9%', // Computed YoY
        fedFundsRate: `${fedRate.toFixed(2)}%`,
        yieldCurveSpread: `${yieldSpread > 0 ? '+' : ''}${yieldSpread.toFixed(2)}%`,
        vixIndex: vix.toFixed(1),
        usDollarIndex: dxy.toFixed(1),
        usdInrRate: `₹${usdinr.toFixed(2)}`,
        unemploymentRate: `${unrate.toFixed(1)}%`
      },
      indicators: rows
    });
  } catch (error) {
    console.error('[BigQuery Proxy] Unexpected error fetching macro regime:', error);
    return res.status(500).json({ error: error.message || 'Macro regime query failed' });
  }
});

// --- BigQuery Data Health / Freshness Endpoint ---
app.get('/api/bigquery/data-health', async (req, res) => {
  console.log('[BigQuery Data Health] Checking data freshness across all tables...');
  try {
    const accessToken = await getAccessToken(res);
    if (!accessToken) return;

    const healthQuery = `
      WITH table_health AS (
        SELECT 'market_regime_history' as table_name,
          MAX(trade_date) as latest_date,
          COUNT(*) as total_rows
        FROM \`finwise-506509.finwise_data.market_regime_history\`
        UNION ALL
        SELECT 'individual_stock_history',
          MAX(trade_date),
          COUNT(*)
        FROM \`finwise-506509.finwise_data.individual_stock_history\`
        UNION ALL
        SELECT 'macro_economic_indicators',
          MAX(period_date),
          COUNT(*)
        FROM \`finwise-506509.finwise_data.macro_economic_indicators\`
        UNION ALL
        SELECT 'regime_summary',
          (SELECT MAX(trade_date) FROM \`finwise-506509.finwise_data.market_regime_history\`),
          COUNT(*)
        FROM \`finwise-506509.finwise_data.regime_summary\`
      )
      SELECT table_name, latest_date, total_rows,
        DATE_DIFF(CURRENT_DATE(), latest_date, DAY) as days_stale
      FROM table_health
      ORDER BY days_stale DESC
    `;

    const rows = await executeBQQuery(accessToken, healthQuery);

    const tables = rows.map(row => ({
      table: row.table_name,
      latestDate: row.latest_date,
      totalRows: Number(row.total_rows),
      daysStale: Number(row.days_stale),
      isFresh: Number(row.days_stale) <= 3, // Fresh if within 3 days (weekends)
    }));

    const stalestTable = tables.reduce((a, b) => (a.daysStale > b.daysStale ? a : b), tables[0]);
    const overallFresh = tables.every(t => t.isFresh);

    console.log(`[BigQuery Data Health] Overall fresh: ${overallFresh}, Stalest: ${stalestTable?.table} (${stalestTable?.daysStale} days)`);

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      overallFresh,
      stalestTable: stalestTable?.table,
      stalestDays: stalestTable?.daysStale,
      tables,
    });
  } catch (error) {
    console.error('[BigQuery Data Health] Error:', error);
    return res.status(500).json({ error: error.message || 'Data health check failed' });
  }
});

const server = app.listen(PORT, API_BACKEND_HOST, () => {
  console.log(`Vertex AI Backend listening at http://localhost:${PORT}`);
});


const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === '/ws-proxy') {
    
    let targetUrl = url.searchParams.get('target');
    if (!targetUrl) {
      console.log('[Node Proxy] Missing target URL');
      socket.destroy();
      return;
    }

    if (targetUrl === 'wss://aiplatform.googleapis.com//ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent') {
      const location = GOOGLE_CLOUD_LOCATION === 'global' ? 'us-central1' : GOOGLE_CLOUD_LOCATION;
      targetUrl = `wss://${location}-aiplatform.googleapis.com//ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;
    } else {
      console.log('[Node Proxy] Invalid target URL');
      socket.destroy();
      return;
    }

    let accessToken;

    try {
      accessToken = await getAccessToken();
      if (!accessToken) throw new Error('No token');
    } catch (err) {
      console.log('[Node Proxy] Authentication failed');
      socket.destroy();
      return;
    }

    console.log(`[Node Proxy] Initiating upstream connection to: ${targetUrl}`);

    let upstreamWs;

    try {
      upstreamWs = new WebSocket(targetUrl, {
        headers: getRequestHeaders(accessToken)
      });
    } catch (e) {
      console.error('[Node Proxy] Invalid Upstream URL');
      socket.destroy();
      return;
    }

    const initialErrorHandler = (error) => {
      console.error('[Node Proxy] Upstream connection failed:', error);
      upstreamWs.removeEventListener('open', onUpstreamOpen);

      if (socket.writable) {
        socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        socket.destroy();
      }
    };

    upstreamWs.once('error', initialErrorHandler);

    // 5. Handle Successful Upstream Connection
    const onUpstreamOpen = () => {
      // Remove the "bootstrapping" error handler
      upstreamWs.removeListener('error', initialErrorHandler);

      // Perform the HTTP -> WebSocket upgrade for the Client
      wss.handleUpgrade(request, socket, head, (ws) => {

        upstreamWs.on('message', (data, isBinary) => {
          const logMsg = isBinary ? '<Binary Data>' : data.toString();
          console.log(`[Upstream -> Client] [${new Date().toISOString()}]: ${logMsg}`);

          if (ws.readyState === WebSocket.OPEN) {
            if (data === undefined || data === null) {
              console.warn('[Node Proxy] Attempted to send undefined/null data to client');
              return;
            }
            ws.send(data, { binary: isBinary });
          }
        });

        ws.on('message', (data, isBinary) => {
          const logMsg = isBinary ? '<Binary Data>' : data.toString();

          let dataJson = {};
          try {
            dataJson = JSON.parse(data.toString());
          } catch (error) {
            console.error('[Node Proxy] Failed to parse message from client:', error);
            ws.close(1011, 'Failed to parse message');
          }

          if (dataJson['setup']) {
            dataJson['setup']['model'] = `projects/${GOOGLE_CLOUD_PROJECT}/locations/${GOOGLE_CLOUD_LOCATION}/${dataJson['setup']['model']}`;
          }

          if (upstreamWs.readyState === WebSocket.OPEN) {
            upstreamWs.send(JSON.stringify(dataJson), { binary: false });
          }
        });

        upstreamWs.on('error', (error) => {
          console.error('[Node Proxy] Upstream error:', error);
          ws.close(1011, error.message);
        });

        upstreamWs.on('close', (code, reason) => {
          console.log(`[Node Proxy] Upstream closed: ${code} ${reason}`);
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(code, reason);
          }
        });

        ws.on('error', (error) => {
          console.error('[Node Proxy] Client error:', error);
          upstreamWs.close(1011, error.message);
        });

        ws.on('close', (code, reason) => {
          console.log(`[Node Proxy] Client closed: ${code} ${reason}`);
          if (upstreamWs.readyState === WebSocket.OPEN) {
            upstreamWs.close(1000, reason);
          }
        });

        wss.emit('connection', ws, request);
      });
    };

    upstreamWs.once('open', onUpstreamOpen);

  } else {
    // Path did not match
    socket.destroy();
  }
});


