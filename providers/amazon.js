const ProviderAdapter = require('./base');

class AmazonProvider extends ProviderAdapter {
  get name() { return 'Amazon'; }
  get isConfigured() {
    return !!(process.env.AMAZON_CREDENTIAL_ID && process.env.AMAZON_CREDENTIAL_SECRET);
  }
  get searchDelayMs() { return 2000; }
  get maxPageSize() { return 10; }

  async search({ keywords, category, page = 1, pageSize = 10 }) {
    if (!this.isConfigured) return { products: [], total: 0, error: 'Amazon API not configured. Register at affiliate-program.amazon.com' };
    const amazonPaapi = require('amazon-paapi');
    const commonParameters = {
      AccessKey: process.env.AMAZON_CREDENTIAL_ID,
      SecretKey: process.env.AMAZON_CREDENTIAL_SECRET,
      PartnerTag: process.env.AMAZON_PARTNER_TAG,
      Marketplace: 'www.amazon.com',
      PartnerType: 'Associates',
    };
    const requestParameters = {
      Keywords: keywords || category || '',
      SearchIndex: 'All',
      ItemCount: Math.min(pageSize, this.maxPageSize),
      Resources: ['Images.Primary.Medium', 'ItemInfo.Title', 'Offers.Listings.Price', 'CustomerReviews.Count', 'CustomerReviews.StarRating'],
    };
    const data = await amazonPaapi.SearchItems(commonParameters, requestParameters);
    const items = data?.SearchResult?.Items || [];
    return {
      products: items.map(item => this.mapProduct(item)),
      total: items.length,
      page,
    };
  }

  async getDetail(asin) {
    if (!this.isConfigured) return null;
    const amazonPaapi = require('amazon-paapi');
    const commonParameters = {
      AccessKey: process.env.AMAZON_CREDENTIAL_ID,
      SecretKey: process.env.AMAZON_CREDENTIAL_SECRET,
      PartnerTag: process.env.AMAZON_PARTNER_TAG,
      Marketplace: 'www.amazon.com',
      PartnerType: 'Associates',
    };
    const data = await amazonPaapi.GetItems(commonParameters, {
      ItemIds: [asin],
      Resources: ['Images.Primary.Large', 'ItemInfo.Title', 'ItemInfo.Features', 'Offers.Listings.Price', 'CustomerReviews.Count', 'CustomerReviews.StarRating'],
    });
    const item = data?.ItemsResult?.Items?.[0];
    if (!item) return null;
    return this.mapProduct(item);
  }

  mapProduct(item) {
    return {
      id: item.ASIN || '',
      title: item.ItemInfo?.Title?.DisplayValue || '',
      price: item.Offers?.Listings?.[0]?.Price?.Amount || 0,
      originalPrice: item.Offers?.Listings?.[0]?.Price?.Amount || 0,
      image: item.Images?.Primary?.Medium?.URL || item.Images?.Primary?.Large?.URL || '',
      images: [],
      rating: item.CustomerReviews?.StarRating?.Value || 0,
      orders: item.CustomerReviews?.TotalReviews || 0,
      url: item.DetailPageURL || '',
      shipping: '',
      storeName: 'Amazon',
      category: '',
      description: (item.ItemInfo?.Features?.DisplayValues || []).join('. ') || item.ItemInfo?.Title?.DisplayValue || '',
    };
  }
}

module.exports = AmazonProvider;
