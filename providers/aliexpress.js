const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');
const ProviderAdapter = require('./base');

class AliExpressProvider extends ProviderAdapter {
  get name() { return 'AliExpress'; }
  get isConfigured() {
    return !!(process.env.ALIEXPRESS_APP_KEY && process.env.ALIEXPRESS_APP_SECRET);
  }
  get searchDelayMs() { return 500; }
  get maxPageSize() { return 50; }

  _getToken() {
    // Check env var first (persists across deploys)
    if (process.env.ALIEXPRESS_ACCESS_TOKEN) {
      return process.env.ALIEXPRESS_ACCESS_TOKEN;
    }
    // Check in-memory token (set by OAuth callback)
    if (global.__aliexpressToken?.access_token) {
      const t = global.__aliexpressToken;
      if (t.expire_time && t.expire_time * 1000 < Date.now()) return null;
      return t.access_token;
    }
    // Fallback: read from db.json
    try {
      const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
      const auth = db.aliexpressAuth;
      if (!auth || !auth.access_token) return null;
      if (auth.expire_time && auth.expire_time * 1000 < Date.now()) return null;
      global.__aliexpressToken = auth;
      return auth.access_token;
    } catch { return null; }
  }

  _sign(params, appSecret, apiPath) {
    const sorted = Object.keys(params).sort().reduce((a, k) => { a[k] = params[k]; return a; }, {});
    const kvp = Object.keys(sorted).map(k => k + sorted[k]).join('');
    // Dropshipping API uses HMAC-SHA256: path prefix for OP API (/auth/token/create), none for TOP (/sync)
    const signString = (apiPath || '') + kvp;
    return crypto.createHmac('sha256', appSecret).update(signString, 'utf8').digest('hex').toUpperCase();
  }

  _request(method, extraParams, useToken = true) {
    return new Promise((resolve, reject) => {
      const appKey = process.env.ALIEXPRESS_APP_KEY;
      const appSecret = process.env.ALIEXPRESS_APP_SECRET;
      if (!appKey || !appSecret) return reject(new Error('AliExpress API not configured'));

      const accessToken = useToken ? this._getToken() : null;
      if (useToken && !accessToken) return reject(new Error('AliExpress not connected. Go to Admin > Sync > Conectar AliExpress'));

      const now = new Date();
      const ts = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + ' ' +
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0');

      const params = {
        app_key: appKey, method, sign_method: 'sha256', timestamp: ts,
        format: 'json', v: '2.0', ...extraParams,
      };
      if (useToken && accessToken) params.session = accessToken;
      params.sign = this._sign(params, appSecret);

      const postData = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
      const req = https.request({
        hostname: 'api-sg.aliexpress.com', path: '/sync', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', 'Content-Length': Buffer.byteLength(postData) },
      }, (resp) => {
        let data = '';
        resp.on('data', (c) => { data += c; });
        resp.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Invalid JSON from AliExpress: ' + data.slice(0, 400))); }
        });
      });
      req.on('error', reject);
      req.setTimeout(20000, () => { req.destroy(new Error('Timeout en llamada a AliExpress (20s)')); });
      req.write(postData);
      req.end();
    });
  }

  async search({ keywords, category, page = 1, pageSize = 20 }) {
    const query = keywords || category || '';
    const result = await this._request('aliexpress.ds.text.search', {
      keyWord: query,
      local: 'en_US',
      countryCode: 'US',
      currency: 'USD',
      pageSize: String(Math.min(pageSize, this.maxPageSize)),
      pageIndex: String(page),
    });
    const resp = result?.aliexpress_ds_text_search_response || result?.aliexpress_ds_product_search_response;
    if (!resp) return { products: [], total: 0, error: result?.error_response?.msg || 'API Error' };
    const data = resp?.data || resp?.result || resp;
    const prods = data?.products;
    let raw = [];
    if (Array.isArray(prods)) raw = prods;
    else if (prods && Array.isArray(prods.selection_search_product)) raw = prods.selection_search_product;
    else if (prods && Array.isArray(prods.list)) raw = prods.list;
    else if (Array.isArray(data?.product_list)) raw = data.product_list;
    else if (Array.isArray(data?.list)) raw = data.list;
    return {
      products: raw.map(p => this.mapProduct(p)),
      total: data?.totalCount || data?.total_count || data?.total_num || data?.total || raw.length,
      page, pageSize,
    };
  }

  async rawSearch(extraParams = {}) {
    return this._request('aliexpress.ds.text.search', extraParams);
  }

  async getDetail(productId) {
    const result = await this._request('aliexpress.ds.product.get', {
      product_id: String(productId),
      local_country: 'US',
      local_language: 'en',
    });
    const resp = result?.aliexpress_ds_product_get_response;
    const p = resp?.result;
    if (!p) return null;
    return this.mapProduct(p);
  }

  _categoryFor(p) {
    const firstId = String(p.cate_id || p.cateId || '').split(',')[0];
    const idMap = {
      '200000343': 'Moda', '200000345': 'Moda', '200000346': 'Moda', '200000347': 'Moda', '200000348': 'Moda',
      '200000778': 'Moda', '200000779': 'Moda', '200000791': 'Moda', '200000790': 'Moda',
      '201336103': 'Moda', '200000624': 'Moda',
      '200000634': 'Belleza', '200000635': 'Belleza',
      '200000656': 'Juguetes', '200000657': 'Juguetes',
      '200000364': 'Tecnologia', '200000366': 'Tecnologia',
      '200000330': 'Hogar', '200000331': 'Hogar', '200000332': 'Hogar',
      '200000535': 'Deportes', '200000537': 'Deportes',
      '200000585': 'Mascotas', '200000586': 'Mascotas',
      '200000504': 'Bebes',
      '200000677': 'Herramientas',
      '200000409': 'Salud',
      '200000433': 'Alimentos',
      '200000577': 'Automotriz',
    };
    if (firstId && idMap[firstId]) return idMap[firstId];
    const t = (p.title || p.product_title || '').toLowerCase();
    const rules = [
      ['Tecnologia', ['smartwatch', 'phone', 'smartphone', 'charger', 'cable', 'earphone', 'earbud', 'bluetooth', 'speaker', 'tablet', 'laptop', 'keyboard', 'mouse', 'monitor', 'camera', 'drone', 'usb', 'gps', 'celular', 'led']],
      ['Belleza', ['makeup', 'cosmetic', 'lipstick', 'mascara', 'skincare', 'cream', 'serum', 'nail', 'perfume', 'brush', 'eyelash', 'beauty', 'maquillaje']],
      ['Moda', ['cloth', 'dress', 'shirt', 'blouse', 'skirt', 'pant', 'jean', 'jacket', 'coat', 'hoodie', 'sweater', 'cardigan', 't-shirt', 'tee', 'blazer', 'suit', 'underwear', 'sock', 'shoe', 'boot', 'sneaker', 'bag', 'handbag', 'backpack', 'jewelry', 'necklace', 'ring', 'earring', 'scarf', 'hat', 'cap', 'fashion', 'women', 'men', 'ropa', 'vestido', 'blusa', 'camisa', 'pantalon', 'vestir', 'sweatshirt']],
      ['Hogar', ['home', 'kitchen', 'cook', 'pan', 'pot', 'cup', 'mug', 'glass', 'plate', 'bowl', 'storage', 'organizer', 'furniture', 'sofa', 'table', 'chair', 'lamp', 'decor', 'pillow', 'blanket', 'towel', 'curtain', 'hogar']],
      ['Fitness', ['gym', 'fitness', 'yoga', 'dumbbell', 'weight', 'exercise', 'running']],
      ['Deportes', ['ball', 'soccer', 'football', 'basketball', 'tennis', 'cycling', 'outdoor', 'camping', 'fishing', 'sport']],
      ['Mascotas', ['pet', 'dog', 'cat', 'animal', 'leash', 'collar']],
      ['Bebes', ['baby', 'infant', 'diaper', 'stroller', 'bebe']],
      ['Juguetes', ['toy', 'doll', 'lego', 'puzzle', 'kids', 'children', 'game']],
      ['Herramientas', ['tool', 'drill', 'screwdriver', 'wrench', 'hammer', 'diy']],
      ['Salud', ['health', 'medical', 'medicine', 'mask', 'thermometer', 'salud']],
      ['Alimentos', ['snack', 'tea', 'coffee', 'spice', 'food']],
      ['Automotriz', ['car', 'auto', 'vehicle', 'tire', 'motorcycle', 'engine', 'automotriz']],
      ['Oficina', ['office', 'desk', 'notebook', 'pen', 'paper', 'stationery']],
      ['Jardin', ['garden', 'plant', 'seed', 'flower', 'jardin']],
      ['Musica', ['music', 'guitar', 'piano', 'microphone', 'musica']],
      ['Fotografia', ['camera', 'photo', 'lens', 'tripod', 'photograph']],
    ];
    for (const [cat, words] of rules) {
      if (words.some(w => t.includes(w))) return cat;
    }
    return 'Otros';
  }

  mapProduct(p) {
    const shippingDays = p.shipping_days || p.shippingDays || p.shipping?.days || '';
    const stockQty = p.min_order_quantity || p.minOrderQty || 1;
    const price = p.target_sale_price || p.targetSalePrice || p.sale_price || p.salePrice || p.price || '0';
    let rating = parseFloat(p.evaluate_rate || p.evaluateRate || p.average_star || p.averageStar || p.rating);
    if (isNaN(rating)) rating = 0;
    if (rating > 5 && rating <= 100) rating = rating / 20;
    const ordersStr = p.orders || p.total_orders || p.totalOrders || p.total_tranpro || 0;
    const orders = parseInt(String(ordersStr).replace(/[^\d]/g, '')) || 0;
    let url = p.item_url || p.itemUrl || p.product_detail_url || p.url || '';
    if (url && url.startsWith('//')) url = 'https:' + url;
    const image = p.item_main_pic || p.itemMainPic || p.product_main_image_url || p.image || '';
    return {
      id: p.item_id || p.itemId || p.product_id || p.productId || p.id,
      title: p.title || p.product_title || p.productTitle || '',
      price: String(price),
      originalPrice: String(p.target_original_price || p.targetOriginalPrice || p.original_price || p.originalPrice || price),
      image,
      images: p.product_images || p.productImages || (image ? [image] : []),
      rating: rating ? Number(rating.toFixed(1)) : 0,
      orders,
      url,
      shipping: shippingDays ? shippingDays + ' dias' : '15-30 dias',
      shippingDays: shippingDays || '20',
      shippingCost: p.shipping_cost || p.shippingCost || p.shipping?.cost || '',
      storeName: p.store_name || p.storeName || p.shop_name || p.shopName || '',
      category: this._categoryFor(p),
      description: p.title || p.product_title || p.productTitle || '',
      currency: p.target_original_price_currency || p.targetOriginalPriceCurrency || p.sale_price_currency || p.salePriceCurrency || 'USD',
      stockStatus: p.stock_status || p.stockStatus || p.stock || 'in_stock',
      minOrderQty: stockQty,
      handlingTime: p.handling_time || p.handlingTime || '1-3',
      sellerRating: p.store_rating || p.storeRating || p.seller_rating || p.sellerRating || 0,
      sellerOrders: p.store_orders || p.storeOrders || p.seller_orders || p.sellerOrders || 0,
    };
  }
}

module.exports = AliExpressProvider;
