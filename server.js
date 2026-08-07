require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const USD_TO_COP = 4200;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

const syncRoutes = require('./sync-routes');
app.locals.broadcast = null;

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    const init = { products: [], orders: [], flashSale: { enabled: false, title: 'Flash Sale', subtitle: 'Ofertas por tiempo limitado', endTime: '', couponEnabled: false, couponCode: 'NEX10', couponDescription: '10% OFF en tu primer pedido' }, syncJobs: [], syncLogs: [], syncConfig: { defaultProfitMargin: 35, autoSyncEnabled: false, autoSyncIntervalMinutes: 60, maxProductsPerSync: 500, providers: { aliexpress: { enabled: false, profitMargin: 35 }, amazon: { enabled: false, profitMargin: 35 }, alibaba: { enabled: false, profitMargin: 35 } } } };
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
    return init;
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const sseClients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(msg);
}
app.locals.broadcast = broadcast;

app.get('/api/sse', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('\n');
  sseClients.add(res);
  const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15000);
  req.on('close', () => { sseClients.delete(res); clearInterval(keepalive); });
});

// ─── Products CRUD ───
app.get('/api/products', (req, res) => res.json(readDB().products));
app.post('/api/products', (req, res) => {
  const db = readDB();
  const product = { id: Date.now(), ...req.body, sold: req.body.sold ?? 0, rating: req.body.rating ?? 4.7 };
  db.products.unshift(product);
  writeDB(db);
  broadcast('product-added', product);
  res.json(product);
});
app.put('/api/products/:id', (req, res) => {
  const db = readDB();
  const idx = db.products.findIndex(p => p.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.products[idx] = { ...db.products[idx], ...req.body };
  writeDB(db);
  broadcast('product-updated', db.products[idx]);
  res.json(db.products[idx]);
});
app.delete('/api/products/:id', (req, res) => {
  const db = readDB();
  db.products = db.products.filter(p => p.id !== Number(req.params.id));
  writeDB(db);
  broadcast('product-deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
});

// ─── Orders CRUD ───
app.get('/api/orders', (req, res) => res.json(readDB().orders));
app.post('/api/orders', (req, res) => {
  const db = readDB();
  const order = { id: '#DP-' + Date.now(), status: 'Procesando', ...req.body };
  db.orders.unshift(order);
  writeDB(db);
  broadcast('order-added', order);
  res.json(order);
});
app.put('/api/orders/:id', (req, res) => {
  const db = readDB();
  const idx = db.orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.orders[idx] = { ...db.orders[idx], ...req.body };
  writeDB(db);
  broadcast('order-updated', db.orders[idx]);
  res.json(db.orders[idx]);
});
app.delete('/api/orders/:id', (req, res) => {
  const db = readDB();
  db.orders = db.orders.filter(o => o.id !== req.params.id);
  writeDB(db);
  broadcast('order-deleted', { id: req.params.id });
  res.json({ ok: true });
});

// ─── Flash Sale ───
app.get('/api/flashsale', (req, res) => res.json(readDB().flashSale || { enabled: false }));
app.put('/api/flashsale', (req, res) => {
  const db = readDB();
  db.flashSale = { ...db.flashSale, ...req.body };
  writeDB(db);
  broadcast('flashsale-updated', db.flashSale);
  res.json(db.flashSale);
});

// ─── URL Importer ───
const cheerio = require('cheerio');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html,application/xhtml+xml' },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return fetchUrl(res.headers.location).then(resolve).catch(reject);
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function scrapeMeta(html, prop) {
  const $ = cheerio.load(html);
  return ($(`meta[property="${prop}"]`).attr('content') || $(`meta[name="${prop}"]`).attr('content') || '').trim();
}

function scrapeJsonLd(html) {
  const $ = cheerio.load(html);
  const results = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    try { results.push(JSON.parse($(el).html())); } catch {}
  });
  return results;
}

function extractFromJsonLd(html, field) {
  const items = scrapeJsonLd(html);
  for (const item of items) {
    if (item['@type'] === 'Product' || item['@type'] === 'ItemPage') {
      if (field === 'title') return item.name || item.headline || '';
      if (field === 'description') return item.description || '';
      if (field === 'image') return typeof item.image === 'string' ? item.image : (item.image?.url || (Array.isArray(item.image) ? item.image[0] : ''));
      if (field === 'price') {
        const arr = Array.isArray(item.offers) ? item.offers : [item.offers];
        for (const o of arr) if (o?.price) return String(o.price);
      }
      if (field === 'currency') {
        const arr = Array.isArray(item.offers) ? item.offers : [item.offers];
        for (const o of arr) if (o?.priceCurrency) return o.priceCurrency;
      }
    }
  }
  return '';
}

function scrapePrice(html) {
  const priceLd = extractFromJsonLd(html, 'price');
  if (priceLd) return priceLd;

  const $ = cheerio.load(html);
  const selectors = ['[property="og:price:amount"]', '[itemprop="price"]', '.price', '#price',
    '[class*="price"]', '[class*="Price"]', '.sale-price', '.product-price',
    '[data-testid="price"]', '[data-automation="price"]'];
  for (const sel of selectors) {
    const val = $(sel).first().attr('content') || $(sel).first().text().trim();
    if (val) {
      const num = val.replace(/[^0-9.]/g, '');
      if (num && parseFloat(num) > 0) return num;
    }
  }

  const patterns = [
    /"price"[^:]*:\s*"([^"]+)"/, /"price"[^:]*:\s*([\d.]+)/,
    /"sale_price"[^:]*:\s*"([^"]+)"/, /"current_price"[^:]*:\s*"([^"]+)"/,
    /"priceText"[^:]*:\s*"([^"]+)"/, /"product_price"[^:]*:\s*"([^"]+)"/,
    /"originalPrice"[^:]*:\s*"([^"]+)"/, /"minPrice"[^:]*:\s*([\d.]+)/,
    /"maxPrice"[^:]*:\s*([\d.]+)/, /"finalPrice"[^:]*:\s*([\d.]+)/,
    /regular_price["']\s*:\s*["']([^"']+)/, /sale_price["']\s*:\s*["']([^"']+)/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const cleaned = m[1].replace(/,/g, '');
      if (/^\d+(\.\d+)?$/.test(cleaned) && parseFloat(cleaned) > 0) return cleaned;
    }
  }
  return '';
}

function scrapeImages(html) {
  const $ = cheerio.load(html);
  const urls = new Set();

  const ldImage = extractFromJsonLd(html, 'image');
  if (ldImage) { ldImage.split(',').forEach(u => { if (u.match(/^https?:\/\//i)) urls.add(u); }); }
  scrapeJsonLd(html).forEach(item => {
    if (item['@type'] === 'Product' && Array.isArray(item.image))
      item.image.forEach(i => { if (typeof i === 'string' && i.match(/^https?:\/\//i)) urls.add(i); else if (i?.url) urls.add(i.url); });
  });

  const ogImage = scrapeMeta(html, 'og:image');
  if (ogImage) urls.add(ogImage);

  $('img').each((i, el) => {
    let src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (src.startsWith('//')) src = 'https:' + src;
    if (src.startsWith('/') && !src.startsWith('//')) src = 'https:' + src;
    if (src.match(/^https?:\/\//i) && !src.includes('logo') && !src.includes('icon') && !src.includes('data:image'))
      urls.add(src.split('?')[0]);
  });

  const patterns = [
    /"image"[^:]*:\s*"([^"]+)"[,\}]/g, /"imgUrl"[^:]*:\s*"([^"]+)"[,\}]/g,
    /"main_image"[^:]*:\s*"([^"]+)"/, /"primary_image"[^:]*:\s*"([^"]+)"/,
    /"product_main_image_url"[^:]*:\s*"([^"]+)"/, /"imageUrl"[^:]*:\s*"([^"]+)"/,
  ];
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(html)) !== null) {
      let val = m[1].replace(/\\"/g, '').replace(/\\\//g, '/');
      if (val.startsWith('//')) val = 'https:' + val;
      if (val.startsWith('/') && !val.startsWith('//')) val = 'https:' + val;
      if (val.match(/^https?:\/\//i) && !val.includes('data:image')) urls.add(val.split('?')[0].split('\\')[0]);
    }
  }
  return [...urls].slice(0, 5);
}

function extractAliExpressId(url) {
  const m = url.match(/\/item\/(\d+)\.html/i) || url.match(/aliexpress.*?\/(\d{10,20})/i);
  return m ? m[1] : null;
}

function extractAmazonAsin(url) {
  const m = url.match(/\/(?:dp|product|gp\/product)\/([A-Z0-9]{10})/i);
  return m ? m[1] : null;
}

app.post('/api/import-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    const html = await fetchUrl(url);
    let platform = 'Otro';
    if (/temu\.com/i.test(url)) platform = 'Temu';
    else if (/aliexpress/i.test(url)) platform = 'AliExpress';
    else if (/amazon\./i.test(url)) platform = 'Amazon';

    let title = extractFromJsonLd(html, 'title') || scrapeMeta(html, 'og:title') || scrapeMeta(html, 'twitter:title') || '';
    let image = extractFromJsonLd(html, 'image') || scrapeMeta(html, 'og:image') || scrapeMeta(html, 'twitter:image') || '';
    let description = extractFromJsonLd(html, 'description') || scrapeMeta(html, 'og:description') || scrapeMeta(html, 'twitter:description') || '';
    let price = scrapePrice(html);
    let currency = extractFromJsonLd(html, 'currency') || '';
    const images = scrapeImages(html);

    if (!title) {
      const tMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (tMatch) title = tMatch[1].replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim();
    }

    if (platform === 'AliExpress') {
      const productId = extractAliExpressId(url);
      if (productId) {
        try {
          const AliExpressProvider = require('./providers/aliexpress');
          const provider = new AliExpressProvider();
          if (provider.isConfigured) {
            const detail = await provider.getDetail(productId);
            if (detail) {
              title = detail.title || title;
              price = detail.price || price;
              if (detail.image) image = detail.image;
              if (detail.images && detail.images.length > 0) {
                images.push(...detail.images.slice(0, 5));
              }
              if (!description) description = detail.title || '';
            }
          }
        } catch {}
      }
    }

    if (platform === 'Amazon') {
      const asin = extractAmazonAsin(url);
      if (asin) {
        try {
          const AmazonProvider = require('./providers/amazon');
          const provider = new AmazonProvider();
          if (provider.isConfigured) {
            const detail = await provider.getDetail(asin);
            if (detail) {
              title = detail.title || title;
              price = detail.price || price;
              if (detail.image) image = detail.image;
              if (!description) description = detail.description || '';
            }
          }
        } catch {}
      }
    }

    const csr = !title && !price && html.length > 0 && !html.includes('<title>');
    res.json({ title: title.trim(), image, description: description.trim(), price, currency, images, platform, csr });
  } catch (e) {
    res.json({ title: '', image: '', description: '', price: '', images: [], platform: 'Otro', error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ═══ ALIEXPRESS AFFILIATE API ═══
// ═══════════════════════════════════════════════════════════════════

function signAliExpress(params, appSecret) {
  const sorted = Object.keys(params).sort().reduce((acc, key) => { acc[key] = params[key]; return acc; }, {});
  const str = appSecret + Object.keys(sorted).map(k => k + sorted[k]).join('') + appSecret;
  return crypto.createHash('md5').update(str, 'utf8').digest('hex').toUpperCase();
}

function aliExpressRequest(method, extraParams) {
  return new Promise((resolve, reject) => {
    const appKey = process.env.ALIEXPRESS_APP_KEY;
    const appSecret = process.env.ALIEXPRESS_APP_SECRET;
    const trackingId = process.env.ALIEXPRESS_TRACKING_ID || '';
    if (!appKey || !appSecret) return reject(new Error('AliExpress API not configured'));

    const now = new Date();
    const timestamp = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0') + ' ' +
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0') + ':' +
      String(now.getSeconds()).padStart(2, '0');

    const params = {
      app_key: appKey,
      method,
      sign_method: 'md5',
      timestamp,
      format: 'json',
      v: '2.0',
      ...extraParams,
    };
    if (trackingId) params.tracking_id = trackingId;
    params.sign = signAliExpress(params, appSecret);

    const postData = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    const options = {
      hostname: 'api-sg.aliexpress.com',
      path: '/sync',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', 'Content-Length': Buffer.byteLength(postData) },
    };

    const req = https.request(options, (resp) => {
      let data = '';
      resp.on('data', (chunk) => { data += chunk; });
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON from AliExpress')); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

app.post('/api/search-aliexpress', async (req, res) => {
  const { keywords, page = 1, pageSize = 20 } = req.body;
  if (!keywords) return res.status(400).json({ error: 'Keywords required' });
  try {
    const AliExpressProvider = require('./providers/aliexpress');
    const provider = new AliExpressProvider();
    if (!provider.isConfigured) return res.json({ products: [], total: 0, error: 'AliExpress API not configured' });
    const result = await provider.search({ keywords, page, pageSize });
    res.json(result);
  } catch (e) {
    res.json({ products: [], total: 0, error: e.message });
  }
});

app.post('/api/product-detail-aliexpress', async (req, res) => {
  const { productId } = req.body;
  if (!productId) return res.status(400).json({ error: 'Product ID required' });
  try {
    const AliExpressProvider = require('./providers/aliexpress');
    const provider = new AliExpressProvider();
    if (!provider.isConfigured) return res.json({ error: 'AliExpress API not configured' });
    const detail = await provider.getDetail(productId);
    if (!detail) return res.status(404).json({ error: 'Product not found' });
    res.json(detail);
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ═══ AMAZON CREATORS API (PA-API v5 compatible) ═══
// ═══════════════════════════════════════════════════════════════════

app.post('/api/search-amazon', async (req, res) => {
  const { keywords, page = 1 } = req.body;
  if (!keywords) return res.status(400).json({ error: 'Keywords required' });
  const credentialId = process.env.AMAZON_CREDENTIAL_ID;
  const credentialSecret = process.env.AMAZON_CREDENTIAL_SECRET;
  if (!credentialId || !credentialSecret) {
    return res.json({ products: [], total: 0, error: 'Amazon API not configured. Register at affiliate-program.amazon.com' });
  }
  try {
    const amazonPaapi = require('amazon-paapi');
    const commonParameters = {
      AccessKey: credentialId,
      SecretKey: credentialSecret,
      PartnerTag: process.env.AMAZON_PARTNER_TAG,
      Marketplace: 'www.amazon.com',
      PartnerType: 'Associates',
    };
    const requestParameters = {
      Keywords: keywords,
      SearchIndex: 'All',
      ItemCount: 10,
      Resources: ['Images.Primary.Medium', 'ItemInfo.Title', 'Offers.Listings.Price', 'CustomerReviews.Count', 'CustomerReviews.StarRating'],
    };
    const data = await amazonPaapi.SearchItems(commonParameters, requestParameters);
    const items = data?.SearchResult?.Items || [];
    const products = items.map(item => ({
      id: item.ASIN,
      title: item.ItemInfo?.Title?.DisplayValue || '',
      price: item.Offers?.Listings?.[0]?.Price?.Amount || 0,
      originalPrice: item.Offers?.Listings?.[0]?.Price?.Amount || 0,
      image: item.Images?.Primary?.Medium?.URL || '',
      rating: item.CustomerReviews?.StarRating?.Value || 0,
      orders: item.CustomerReviews?.TotalReviews || 0,
      url: item.DetailPageURL || '',
      asin: item.ASIN,
    }));
    res.json({ products, total: products.length, page });
  } catch (e) {
    res.json({ products: [], total: 0, error: e.message });
  }
});

// ─── Sync Module Routes ───
app.use('/api/sync', syncRoutes);

// ═══════════════════════════════════════════════════════════════════
// ═══ ALIEXPRESS DROP SHIPPING API (OAuth) ═══
// ═══════════════════════════════════════════════════════════════════

const ALIEXPRESS_APP_KEY = process.env.ALIEXPRESS_APP_KEY;
const ALIEXPRESS_APP_SECRET = process.env.ALIEXPRESS_APP_SECRET;

// OAuth Authorize - redirect user to AliExpress
app.get('/api/aliexpress/auth', (req, res) => {
  if (!ALIEXPRESS_APP_KEY) return res.status(400).send('AliExpress App Key not configured');
  const redirectUri = process.env.ALIEXPRESS_REDIRECT_URI || `http://localhost:${PORT}/api/aliexpress/callback`;
  const state = crypto.randomBytes(16).toString('hex');
  app.locals.aliExpressState = state;
  const url = `https://api-sg.aliexpress.com/oauth/authorize?response_type=code&force_auth=true&client_id=${ALIEXPRESS_APP_KEY}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  res.redirect(url);
});

app.get('/api/aliexpress/callback', async (req, res) => {
  console.log('AliExpress callback query:', JSON.stringify(req.query));
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Missing authorization code: ' + JSON.stringify(req.query));
  try {
    const token = await exchangeAliExpressCode(code);
    console.log('AliExpress token response:', JSON.stringify(token).slice(0, 500));
    app.locals.aliExpressToken = token;
    global.__aliexpressToken = token;
    // Also persist to db.json for backup
    try {
      const db = readDB();
      db.aliexpressAuth = { ...token, updatedAt: new Date().toISOString() };
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch {}
    const tokHtml = `<html><body style="font-family:sans-serif;padding:40px;max-width:600px;margin:auto">
      <h2 style="color:#059669">✅ AliExpress conectado exitosamente</h2>
      <p>Ya puedes cerrar esta ventana y volver al panel admin.</p>
      <p style="margin-top:20px;font-size:12px;color:#6b7280">
        <strong>Para persistir el token tras redeployos, agrega en Render:</strong><br>
        <code style="background:#f3f4f6;padding:8px;border-radius:4px;display:block;margin:8px 0;font-size:11px;word-break:break-all">
        ALIEXPRESS_ACCESS_TOKEN=${token.access_token || JSON.stringify(token)}</code>
      </p>
      <script>if(window.opener)window.opener.postMessage({type:'aliexpress-connected',connected:true},'*');setTimeout(()=>window.close(),2000)</script>
    </body></html>`;
    res.send(tokHtml);
  } catch (e) {
    res.status(500).send('Error al conectar AliExpress: ' + e.message);
  }
});

app.get('/api/aliexpress/token-status', (req, res) => {
  // Check env var first (persists across deploys)
  if (process.env.ALIEXPRESS_ACCESS_TOKEN) {
    return res.json({ connected: true, expired: false, envVar: true });
  }
  const token = app.locals.aliExpressToken || global.__aliexpressToken;
  if (token && token.access_token) {
    const expired = token.expire_time && token.expire_time * 1000 < Date.now();
    return res.json({ connected: true, expired: !!expired, expiresAt: token.expire_time });
  }
  // Fallback: check db.json
  try {
    const db = readDB();
    const auth = db.aliexpressAuth;
    if (auth && auth.access_token) {
      app.locals.aliExpressToken = auth;
      global.__aliexpressToken = auth;
      const expired = auth.expire_time && auth.expire_time * 1000 < Date.now();
      return res.json({ connected: true, expired: !!expired, expiresAt: auth.expire_time });
    }
  } catch {}
  res.json({ connected: false });
});

app.post('/api/aliexpress/disconnect', (req, res) => {
  delete app.locals.aliExpressToken;
  delete global.__aliexpressToken;
  try {
    const db = readDB();
    delete db.aliexpressAuth;
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch {}
  res.json({ success: true });
});

function exchangeAliExpressCode(code) {
  return new Promise((resolve, reject) => {
    // AliExpress Dropshipping API: exchange code at /rest/auth/token/create with HMAC-SHA256 signed request
    const apiPath = '/auth/token/create';
    const params = {
      app_key: ALIEXPRESS_APP_KEY,
      sign_method: 'sha256',
      timestamp: Date.now().toString(),
      code,
    };
    const sortedKeys = Object.keys(params).sort();
    const signString = apiPath + sortedKeys.map(k => k + params[k]).join('');
    const sign = crypto.createHmac('sha256', ALIEXPRESS_APP_SECRET).update(signString).digest('hex').toUpperCase();
    params.sign = sign;
    const qs = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
    const req = https.request({
      hostname: 'api-sg.aliexpress.com', path: `/rest${apiPath}?${qs}`, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': 0 },
    }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        console.log('AliExpress token/create response:', data.slice(0, 1000));
        try {
          const j = JSON.parse(data);
          if (j.access_token) {
            // Normalize expiry to epoch seconds (matches _getToken checks)
            if (j.expires_in) j.expire_time = Math.floor(Date.now() / 1000) + Number(j.expires_in);
            return resolve(j);
          }
          reject(new Error('Token create failed: ' + data.slice(0, 300)));
        } catch {
          reject(new Error('Invalid token response: ' + data.slice(0, 300)));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function getAliExpressAccessToken() {
  const db = readDB();
  const auth = db.aliexpressAuth;
  if (!auth || !auth.access_token) return null;
  if (auth.expire_time && auth.expire_time < Date.now()) return null;
  return auth.access_token;
}

// ─── API Status ───
app.get('/api/status', (req, res) => {
  res.json({
    aliExpress: !!(process.env.ALIEXPRESS_APP_KEY && process.env.ALIEXPRESS_APP_SECRET),
    amazon: !!(process.env.AMAZON_CREDENTIAL_ID && process.env.AMAZON_CREDENTIAL_SECRET),
    alibaba: !!(process.env.ALIEXPRESS_APP_KEY && process.env.ALIEXPRESS_APP_SECRET),
  });
});

app.listen(PORT, () => {
  console.log(`NEXONE server running at http://localhost:${PORT}`);
});
