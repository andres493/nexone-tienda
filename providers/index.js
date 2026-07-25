const AliExpressProvider = require('./aliexpress');
const AmazonProvider = require('./amazon');
const AlibabaProvider = require('./alibaba');

const registry = {
  aliexpress: new AliExpressProvider(),
  amazon: new AmazonProvider(),
  alibaba: new AlibabaProvider(),
};

function getProvider(name) {
  const key = name.toLowerCase().replace(/[\s-]/g, '');
  return registry[key] || null;
}

function getAllProviders() {
  return Object.entries(registry).map(([key, provider]) => ({
    id: key,
    name: provider.name,
    configured: provider.isConfigured,
  }));
}

module.exports = { getProvider, getAllProviders };
