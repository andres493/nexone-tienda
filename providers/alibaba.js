const https = require('https');
const http = require('http');
const ProviderAdapter = require('./base');

class AlibabaProvider extends ProviderAdapter {
  get name() { return 'Alibaba'; }
  get isConfigured() {
    return !!(process.env.ALIEXPRESS_APP_KEY && process.env.ALIEXPRESS_APP_SECRET);
  }
  get searchDelayMs() { return 1500; }
  get maxPageSize() { return 20; }

  _fetchPage(url) {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
        timeout: 15000,
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return this._fetchPage(res.headers.location).then(resolve).catch(reject);
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
  }

  async search({ keywords, category, page = 1, pageSize = 20 }) {
    if (!this.isConfigured) return { products: [], total: 0, error: 'Alibaba uses same API keys as AliExpress. Configure AliExpress credentials first.' };
    try {
      const query = encodeURIComponent(keywords || category || '');
      const url = `https://www.alibaba.com/trade/search?SearchText=${query}&page=${page}`;
      const html = await this._fetchPage(url);
      const products = [];
      const regex = /data-content="([^"]+)"[^>]*>.*?"title":\s*"([^"]+)".*?"image":\s*\{[^}]*"src":\s*"([^"]+)"/gs;
      let match;
      while ((match = regex.exec(html)) !== null && products.length < pageSize) {
        products.push(this.mapProduct({ id: match[1], title: match[2], image: match[3], price: '0' }));
      }
      if (products.length === 0) {
        const imgRegex = /class="[^"]*image[^"]*"[^>]*><img[^>]*src="([^"]+)"[^>]*alt="([^"]+)"/gi;
        while ((match = imgRegex.exec(html)) !== null && products.length < pageSize) {
          products.push(this.mapProduct({ id: String(Date.now() + products.length), image: match[1], title: match[2], price: '0' }));
        }
      }
      return { products, total: products.length, page };
    } catch (e) {
      return { products: [], total: 0, error: 'Alibaba scraping failed: ' + e.message };
    }
  }

  async getDetail(productId) {
    return null;
  }

  mapProduct(p) {
    return {
      id: p.id || '',
      title: p.title || '',
      price: p.price || '0',
      originalPrice: p.originalPrice || p.price || '0',
      image: p.image || '',
      images: [],
      rating: p.rating || '4.5',
      orders: p.orders || 0,
      url: p.url || '',
      shipping: '',
      storeName: 'Alibaba',
      category: '',
      description: p.title || '',
    };
  }
}

module.exports = AlibabaProvider;
