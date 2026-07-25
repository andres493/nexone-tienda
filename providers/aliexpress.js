const crypto = require('crypto');
const https = require('https');
const ProviderAdapter = require('./base');

class AliExpressProvider extends ProviderAdapter {
  get name() { return 'AliExpress'; }
  get isConfigured() {
    return !!(process.env.ALIEXPRESS_APP_KEY && process.env.ALIEXPRESS_APP_SECRET);
  }
  get searchDelayMs() { return 500; }
  get maxPageSize() { return 50; }

  _sign(params, appSecret) {
    const sorted = Object.keys(params).sort().reduce((a, k) => { a[k] = params[k]; return a; }, {});
    const str = appSecret + Object.keys(sorted).map(k => k + sorted[k]).join('') + appSecret;
    return crypto.createHash('md5').update(str, 'utf8').digest('hex').toUpperCase();
  }

  _request(method, extraParams) {
    return new Promise((resolve, reject) => {
      const appKey = process.env.ALIEXPRESS_APP_KEY;
      const appSecret = process.env.ALIEXPRESS_APP_SECRET;
      const trackingId = process.env.ALIEXPRESS_TRACKING_ID || '';
      if (!appKey || !appSecret) return reject(new Error('AliExpress API not configured'));

      const now = new Date();
      const ts = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + ' ' +
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0');

      const params = {
        app_key: appKey, method, sign_method: 'md5', timestamp,
        format: 'json', v: '2.0', ...extraParams,
      };
      if (trackingId) params.tracking_id = trackingId;
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
    const result = await this._request('aliexpress.affiliate.product.query', {
      keywords: query,
      page_no: String(page),
      page_size: String(Math.min(pageSize, this.maxPageSize)),
      target_currency: 'USD',
      target_language: 'EN',
      ship_to_country: 'US',
      sort: 'LAST_VOLUME_DESC',
    });
    const resp = result?.aliexpress_affiliate_product_query_response;
    if (resp?.resp_code !== 200) return { products: [], total: 0, error: resp?.resp_msg || 'API Error' };
    const raw = resp?.result?.products?.product || [];
    return {
      products: raw.map(p => this.mapProduct(p)),
      total: resp?.result?.total_record_count || 0,
      page, pageSize,
    };
  }

  async getDetail(productId) {
    const result = await this._request('aliexpress.affiliate.productdetail.get', {
      product_ids: productId,
      target_currency: 'USD',
      target_language: 'EN',
      fields: 'product_main_image_url,product_title,sale_price,target_original_price,average_star,total_tranpro,product_detail_url,product_images',
    });
    const resp = result?.aliexpress_affiliate_productdetail_get_response;
    const p = resp?.result?.products?.[0];
    if (!p) return null;
    return this.mapProduct(p);
  }

  mapProduct(p) {
    return {
      id: p.product_id,
      title: p.product_title || '',
      price: p.sale_price || p.target_sale_price || '0',
      originalPrice: p.target_original_price || p.original_price || '0',
      image: p.product_main_image_url || '',
      images: p.product_images || [],
      rating: p.average_star || '4.7',
      orders: p.total_tranpro || 0,
      url: p.product_detail_url || '',
      shipping: p.shipping?.days ? p.shipping.days + ' dias' : '',
      storeName: p.store_name || '',
      category: '',
      description: p.product_title || '',
    };
  }
}

module.exports = AliExpressProvider;
