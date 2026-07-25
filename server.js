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

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    const init = { products: [], orders: [], flashSale: { enabled: false, title: 'Flash Sale', subtitle: 'Ofertas por tiempo limitado', endTime: '', couponEnabled: false, couponCode: 'NEX10', couponDescription: '10% OFF en tu primer pedido' } };
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

// ─── URL Importer (fallback) ───
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
      timeout: 10000,
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

app.post('/api/import-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    const html = await fetchUrl(url);
    const get = (prop) => {
      const patterns = [
        new RegExp(`<meta[^>]*property=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${prop}["']`, 'i'),
        new RegExp(`<meta[^>]*name=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i'),
      ];
      for (const p of patterns) { const m = html.match(p); if (m) return m[1]; }
      return '';
    };
    let platform = 'Otro';
    if (/temu\.com/i.test(url)) platform = 'Temu';
    else if (/aliexpress/i.test(url)) platform = 'AliExpress';
    else if (/amazon\./i.test(url)) platform = 'Amazon';
    res.json({ title: get('og:title'), image: get('og:image'), description: get('og:description'), price: '', platform });
  } catch (e) {
    res.json({ title: '', image: '', description: '', price: '', platform: 'Otro', error: e.message });
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
    const result = await aliExpressRequest('aliexpress.affiliate.product.query', {
      keywords,
      page_no: String(page),
      page_size: String(Math.min(pageSize, 50)),
      target_currency: 'USD',
      target_language: 'EN',
      ship_to_country: 'US',
      sort: 'LAST_VOLUME_DESC',
    });
    const resp = result?.aliexpress_affiliate_product_query_response;
    if (resp?.resp_code !== 200) return res.json({ products: [], total: 0, error: resp?.resp_msg || 'API Error' });
    const raw = resp?.result?.products?.product || [];
    const products = raw.map(p => ({
      id: p.product_id,
      title: p.product_title,
      price: p.sale_price || p.target_sale_price,
      originalPrice: p.target_original_price || p.original_price,
      image: p.product_main_image_url,
      images: p.product_images || [],
      rating: p.average_star || '4.7',
      orders: p.total_tranpro || 0,
      commission: p.commission_rate || '0',
      url: p.product_detail_url,
      shipping: p.shipping && p.shipping.days ? p.shipping.days + ' dias' : '',
      storeName: p.store_name || '',
    }));
    const total = resp?.result?.total_record_count || 0;
    res.json({ products, total, page, pageSize });
  } catch (e) {
    res.json({ products: [], total: 0, error: e.message });
  }
});

app.post('/api/product-detail-aliexpress', async (req, res) => {
  const { productId } = req.body;
  if (!productId) return res.status(400).json({ error: 'Product ID required' });
  try {
    const result = await aliExpressRequest('aliexpress.affiliate.productdetail.get', {
      product_ids: productId,
      target_currency: 'USD',
      target_language: 'EN',
      fields: 'product_main_image_url,product_title,sale_price,target_original_price,average_star,total_tranpro,product_detail_url,product_images',
    });
    const resp = result?.aliexpress_affiliate_productdetail_get_response;
    const p = resp?.result?.products?.[0];
    if (!p) return res.status(404).json({ error: 'Product not found' });
    res.json({
      id: p.product_id, title: p.product_title, price: p.sale_price || p.target_sale_price,
      originalPrice: p.target_original_price, image: p.product_main_image_url, images: p.product_images || [],
      rating: p.average_star, orders: p.total_tranpro, url: p.product_detail_url,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
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

// ─── API Status ───
app.get('/api/status', (req, res) => {
  res.json({
    aliExpress: !!(process.env.ALIEXPRESS_APP_KEY && process.env.ALIEXPRESS_APP_SECRET),
    amazon: !!(process.env.AMAZON_CREDENTIAL_ID && process.env.AMAZON_CREDENTIAL_SECRET),
  });
});

app.listen(PORT, () => {
  console.log(`NEXONE server running at http://localhost:${PORT}`);
});
