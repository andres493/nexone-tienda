class ProviderAdapter {
  get name() { throw new Error('Provider must implement name getter'); }
  get isConfigured() { throw new Error('Provider must implement isConfigured getter'); }
  get type() { return 'dropshipping'; }
  get searchDelayMs() { return 1000; }
  get maxPageSize() { return 50; }

  async search({ keywords, category, page = 1, pageSize = 20 }) {
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

  normalize(mapped, profitMargin) {
    const priceUsd = parseFloat(mapped.price) || 0;
    const priceCop = this.applyProfit(priceUsd, profitMargin);
    const shippingDays = parseInt(mapped.shippingDays) || 0;
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
        shippingDays: shippingDays,
        shippingCost: mapped.shippingCost || '',
        storeName: mapped.storeName || '',
        originalPriceUsd: priceUsd,
        originalCurrency: mapped.currency || 'USD',
        stockStatus: mapped.stockStatus || 'in_stock',
        minOrderQty: mapped.minOrderQty || 1,
        handlingTime: mapped.handlingTime || '',
        sellerRating: mapped.sellerRating || 0,
        sellerOrders: mapped.sellerOrders || 0,
      },
      rating: parseFloat(mapped.rating) || 4.7,
      sold: 0,
      tag: 'Nuevo',
      syncStatus: 'synced',
      lastSyncAt: new Date().toISOString(),
      priceHistory: [{ date: new Date().toISOString(), priceUsd, priceCop, margin: profitMargin }],
    };
  }
}

module.exports = ProviderAdapter;
