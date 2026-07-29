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
    try {
      const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
      const auth = db.aliexpressAuth;
      if (!auth || !auth.access_token) return null;
      if (auth.expire_time && auth.expire_time < Date.now()) return null;
      return auth.access_token;
    } catch { return null; }
  }

  _sign(params, appSecret) {
    const sorted = Object.keys(params).sort().reduce((a, k) => { a[k] = params[k]; return a; }, {});
    const str = appSecret + Object.keys(sorted).map(k => k + sorted[k]).join('') + appSecret;
    return crypto.createHash('md5').update(str, 'utf8').digest('hex').toUpperCase();
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
        app_key: appKey, method, sign_method: 'md5', timestamp: ts,
        format: 'json', v: '2.0', ...extraParams,
      };
      if (useToken && accessToken) params.access_token = accessToken;
      params.sign = this._sign(params, appSecret);

      const postData = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
      const req = https.request({
        hostname: 'api-sg.aliexpress.com', path: '/sync', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', 'Content-Length': Buffer.byteLength(postData) },
      }, (resp) => {
        let data = '';
        resp.on('data', (c) => { data += c; });
        resp.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON from AliExpress')); }
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  async search({ keywords, category, page = 1, pageSize = 20 }) {
    const query = keywords || category || '';
    const result = await this._request('aliexpress.ds.product.search', {
      keywords: query,
      page: String(page),
      page_size: String(Math.min(pageSize, this.maxPageSize)),
      currency: 'USD',
      language: 'EN',
    });
    const resp = result?.aliexpress_ds_product_search_response;
    if (!resp) return { products: [], total: 0, error: result?.error_response?.msg || 'API Error' };
    const raw = resp?.result?.products || [];
    return {
      products: raw.map(p => this.mapProduct(p)),
      total: resp?.result?.total_count || 0,
      page, pageSize,
    };
  }

  async getDetail(productId) {
    const result = await this._request('aliexpress.ds.product.get', {
      product_id: String(productId),
    });
    const resp = result?.aliexpress_ds_product_get_response;
    const p = resp?.result;
    if (!p) return null;
    return this.mapProduct(p);
  }

  mapProduct(p) {
    const shippingDays = p.shipping_days || p.shipping?.days || '';
    const stockQty = p.min_order_quantity || 1;
    const price = p.sale_price || p.price || p.target_sale_price || '0';
    return {
      id: p.product_id || p.id,
      title: p.product_title || p.title || '',
      price: String(price),
      originalPrice: p.original_price || p.target_original_price || String(price),
      image: p.product_main_image_url || p.image || '',
      images: p.product_images || (p.image ? [p.image] : []),
      rating: p.average_star || p.rating || '4.7',
      orders: p.total_orders || p.total_tranpro || 0,
      url: p.product_detail_url || p.url || '',
      shipping: shippingDays ? shippingDays + ' dias' : '15-30 dias',
      shippingDays: shippingDays || '20',
      shippingCost: p.shipping_cost || p.shipping?.cost || '',
      storeName: p.store_name || p.shop_name || '',
      category: '',
      description: p.product_title || p.title || '',
      currency: 'USD',
      stockStatus: p.stock_status || p.stock || 'in_stock',
      minOrderQty: stockQty,
      handlingTime: p.handling_time || '1-3',
      sellerRating: p.store_rating || p.seller_rating || 0,
      sellerOrders: p.store_orders || p.seller_orders || 0,
    };
  }
}

module.exports = AliExpressProvider;
