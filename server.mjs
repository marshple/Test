import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);

const TOP_N = 5;

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toPct(prob) {
  return `${(safeNumber(prob) * 100).toFixed(1)}%`;
}

function money(num) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(safeNumber(num));
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

async function fetchTopPolymarket(limit = TOP_N) {
  const url = `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=${limit}&order=volume&ascending=false`;
  const data = await fetchJson(url);

  return data.slice(0, limit).map((market) => {
    const question = market.question || market.slug || 'Untitled market';
    const volume = safeNumber(market.volume ?? market.volumeNum);
    const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
    const outcomePrices = Array.isArray(market.outcomePrices)
      ? market.outcomePrices.map(Number)
      : [];

    let leader = 'n/a';
    if (outcomes.length && outcomePrices.length === outcomes.length) {
      const pairs = outcomes.map((name, i) => ({ name, price: safeNumber(outcomePrices[i]) }));
      pairs.sort((a, b) => b.price - a.price);
      leader = `${pairs[0].name} (${toPct(pairs[0].price)})`;
    }

    return {
      platform: 'Polymarket',
      title: question,
      volume,
      link: market.url || `https://polymarket.com/event/${market.slug}`,
      snapshot: `Leading outcome: ${leader}. 24h volume ${money(volume)}.`,
    };
  });
}

function normalizeKalshiMarket(raw) {
  const title = raw.title || raw.subtitle || raw.ticker || 'Untitled market';
  const yes = safeNumber(raw.yes_sub_title || raw.yes_price || raw.last_price || raw.last_price_yes) / 100;
  const no = safeNumber(raw.no_price || 100 - safeNumber(raw.last_price_yes)) / 100;
  const volume = safeNumber(raw.volume || raw.dollar_volume || raw.notional_value || raw.open_interest);
  const leader = yes >= no ? `YES (${toPct(yes)})` : `NO (${toPct(no)})`;

  return {
    platform: 'Kalshi',
    title,
    volume,
    link: raw.url || (raw.ticker ? `https://kalshi.com/markets/${raw.ticker.toLowerCase()}` : 'https://kalshi.com/markets'),
    snapshot: `Leading side: ${leader}. Total volume ${money(volume)}.`,
  };
}

async function fetchTopKalshi(limit = TOP_N) {
  const endpoints = [
    `https://api.elections.kalshi.com/trade-api/v2/markets?limit=${Math.max(limit * 4, 20)}&status=open`,
    `https://trading-api.kalshi.com/trade-api/v2/markets?limit=${Math.max(limit * 4, 20)}&status=open`,
    `https://api.kalshi.com/trade-api/v2/markets?limit=${Math.max(limit * 4, 20)}&status=open`,
  ];

  let payload;
  let lastError;

  for (const endpoint of endpoints) {
    try {
      payload = await fetchJson(endpoint);
      if (payload) break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!payload) {
    throw lastError || new Error('Unable to fetch Kalshi data');
  }

  const markets = Array.isArray(payload.markets)
    ? payload.markets
    : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload)
        ? payload
        : [];

  return markets
    .map(normalizeKalshiMarket)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, limit);
}

function buildHighlights(markets) {
  if (!markets.length) return ['No markets available right now.'];

  const byPlatform = markets.reduce((acc, market) => {
    acc[market.platform] = acc[market.platform] || [];
    acc[market.platform].push(market);
    return acc;
  }, {});

  const lines = [];
  for (const [platform, list] of Object.entries(byPlatform)) {
    const top = list[0];
    lines.push(`${platform}: most active market is “${top.title}” at ${money(top.volume)} volume.`);
  }

  const overall = [...markets].sort((a, b) => b.volume - a.volume)[0];
  lines.push(`Overall activity leader: ${overall.platform} — “${overall.title}”.`);

  return lines;
}

async function getDailySummary() {
  const [polymarketResult, kalshiResult] = await Promise.allSettled([
    fetchTopPolymarket(),
    fetchTopKalshi(),
  ]);

  const markets = [];
  const errors = [];

  if (polymarketResult.status === 'fulfilled') {
    markets.push(...polymarketResult.value);
  } else {
    errors.push(`Polymarket: ${polymarketResult.reason.message}`);
  }

  if (kalshiResult.status === 'fulfilled') {
    markets.push(...kalshiResult.value);
  } else {
    errors.push(`Kalshi: ${kalshiResult.reason.message}`);
  }

  return {
    generatedAt: new Date().toISOString(),
    highlights: buildHighlights(markets),
    markets,
    errors,
  };
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/api/summary') {
      const payload = await getDailySummary();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
      return;
    }

    const cleanPath = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = path.join(publicDir, cleanPath);

    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const ext = path.extname(filePath);
    const body = await readFile(filePath);

    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Daily market summary app running at http://localhost:${PORT}`);
});
