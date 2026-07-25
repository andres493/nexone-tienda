const express = require('express');
const { getAllProviders, getProvider } = require('./providers');
const syncEngine = require('./sync-engine');

const router = express.Router();

router.get('/providers', (req, res) => {
  res.json(getAllProviders());
});

router.get('/config', (req, res) => {
  res.json(syncEngine.getConfig());
});

router.put('/config', (req, res) => {
  const config = syncEngine.updateConfig(req.body, req.app.locals.broadcast);
  res.json(config);
});

router.post('/start', (req, res) => {
  const { provider, searchType, searchQuery, profitMargin } = req.body;
  if (!provider || !searchQuery) return res.status(400).json({ error: 'Proveedor y termino de busqueda son requeridos' });
  const activeCount = syncEngine.getActiveSyncCount();
  if (activeCount >= 3) return res.status(429).json({ error: 'Maximo 3 sincronizaciones simultaneas. Espera a que terminen las actuales.' });

  if (profitMargin !== undefined) {
    syncEngine.updateConfig({ providers: { [provider]: { profitMargin } } }, req.app.locals.broadcast);
  }

  const job = syncEngine.createJob({ provider, searchType: searchType || 'keywords', searchQuery, type: 'bulk' }, req.app.locals.broadcast);
  res.json(job);
});

router.post('/pause/:jobId', (req, res) => {
  const job = syncEngine.pauseJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job no encontrado' });
  res.json(job);
});

router.post('/resume/:jobId', (req, res) => {
  const job = syncEngine.resumeJob(req.params.jobId, req.app.locals.broadcast);
  if (!job) return res.status(404).json({ error: 'Job no encontrado' });
  res.json(job);
});

router.post('/cancel/:jobId', (req, res) => {
  const job = syncEngine.cancelJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job no encontrado' });
  res.json(job);
});

router.get('/jobs', (req, res) => {
  res.json(syncEngine.getJobs());
});

router.get('/jobs/:jobId', (req, res) => {
  const job = syncEngine.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job no encontrado' });
  res.json(job);
});

router.get('/logs', (req, res) => {
  res.json(syncEngine.getLogs(req.query.jobId, Number(req.query.limit) || 100));
});

router.get('/status', (req, res) => {
  res.json({
    activeSyncs: syncEngine.getActiveSyncCount(),
    maxConcurrent: 3,
    config: syncEngine.getConfig(),
  });
});

router.post('/reorder/:productId', async (req, res) => {
  const db = syncEngine.ensureConfig(require('fs').readFileSync(require('path').join(__dirname, 'data', 'db.json'), 'utf8') ? JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'data', 'db.json'), 'utf8')) : { products: [] });
  const product = db.products.find(p => p.id === Number(req.params.productId));
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  const supplierUrl = product.sourceUrl || '';
  const supplierName = product.provider || '';
  const supplierId = product.supplierId || '';
  res.json({
    product: { id: product.id, name: product.name, price: product.price, provider: product.provider },
    reorderUrl: supplierUrl,
    supplierName,
    supplierId,
    message: supplierUrl ? `Abrir ${supplierName} para reordenar` : 'URL del proveedor no disponible',
  });
});

router.get('/stats', (req, res) => {
  const db = syncEngine.ensureConfig(require('fs').readFileSync(require('path').join(__dirname, 'data', 'db.json'), 'utf8') ? JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'data', 'db.json'), 'utf8')) : { products: [] });
  const products = db.products || [];
  const synced = products.filter(p => p.syncStatus === 'synced').length;
  const outOfStock = products.filter(p => p.syncStatus === 'out_of_stock').length;
  const withSupplier = products.filter(p => p.supplierId).length;
  const providers = {};
  products.forEach(p => {
    if (p.provider) providers[p.provider] = (providers[p.provider] || 0) + 1;
  });
  res.json({
    totalProducts: products.length,
    synced,
    outOfStock,
    withSupplierId: withSupplier,
    byProvider: providers,
    lastSync: products.reduce((latest, p) => {
      if (p.lastSyncAt && (!latest || p.lastSyncAt > latest)) return p.lastSyncAt;
      return latest;
    }, null),
  });
});

module.exports = router;
