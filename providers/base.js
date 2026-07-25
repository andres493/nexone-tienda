class ProviderAdapter {
  get name() { throw new Error('Provider must implement name getter'); }
  get isConfigured() { throw new Error('Provider must implement isConfigured getter'); }
  get searchDelayMs() { return 1000; }
  get maxPageSize() { return 50; }

  async search({ keywords, page = 1, pageSize = 20 }) {
    throw new Error('Provider must implement search()');
  }

  async getDetail(productId) {
    throw new Error('Provider must implement getDetail()');
  }

  mapProduct(raw) {
    throw new Error('Provider must implement mapProduct()');
  }

  applyProfit(priceUsd, marginPercent) {
    const cop = Math.round(priceUsd * 4200);
    return Math.round(cop * (1 + marginPercent / 100));
  }

  normalize(raw, profitMargin) {
    const mapped = this.mapProduct(raw);
    const priceUsd = parseFloat(mapped.price) || 0;
    const priceCop = this.applyProfit(priceUsd, profitMargin);
    return {
      name: mapped.title || 'Producto sin nombre',
      price: priceCop,
      old: Math.round(priceCop * 1.35),
      category: mapped.category || 'Otros',
      provider: this.name,
      image: mapped.image || '',
      images: mapped.images || [],
      description: mapped.description || mapped.title || '',
      sourceUrl: mapped.url || '',
      supplierId: mapped.id ? String(mapped.id) : '',
      supplierMeta: {
        rating: mapped.rating || 0,
        orders: mapped.orders || 0,
        shipping: mapped.shipping || '',
        storeName: mapped.storeName || '',
        originalPriceUsd: priceUsd,
      },
      rating: parseFloat(mapped.rating) || 4.7,
      sold: 0,
      tag: 'Nuevo',
      syncStatus: 'synced',
      lastSyncAt: new Date().toISOString(),
    };
  }
}

module.exports = ProviderAdapter;
