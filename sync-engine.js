const fs = require('fs');
const path = require('path');
const { getProvider } = require('./providers');

const DB_FILE = path.join(__dirname, 'data', 'db.json');
const USD_TO_COP = 4200;

let activeJobs = new Map();

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return { products: [], orders: [], flashSale: { enabled: false }, syncJobs: [], syncLogs: [], syncConfig: defaultConfig() }; }
}
function writeDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

function defaultConfig() {
  return {
    defaultProfitMargin: 35,
    autoSyncEnabled: false,
    autoSyncIntervalMinutes: 60,
    maxProductsPerSync: 500,
    autoHideOutOfStock: true,
    providers: {
      aliexpress: { enabled: false, profitMargin: 35 },
      amazon: { enabled: false, profitMargin: 35 },
      alibaba: { enabled: false, profitMargin: 35 },
    },
  };
}

function ensureConfig(db) {
  if (!db.syncConfig) db.syncConfig = defaultConfig();
  if (!db.syncJobs) db.syncJobs = [];
  if (!db.syncLogs) db.syncLogs = [];
  if (!db.syncConfig.providers) db.syncConfig.providers = defaultConfig().providers;
  return db;
}

function addLog(db, jobId, level, message) {
  const log = { id: Date.now() + Math.random(), jobId, level, message, timestamp: new Date().toISOString() };
  db.syncLogs.unshift(log);
  if (db.syncLogs.length > 2000) db.syncLogs.length = 2000;
  return log;
}

function updateJob(db, jobId, updates) {
  const idx = db.syncJobs.findIndex(j => j.id === jobId);
  if (idx !== -1) db.syncJobs[idx] = { ...db.syncJobs[idx], ...updates };
}

function generateJobId() {
  return 'sync_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function findDuplicate(products, supplierId, provider) {
  if (!supplierId || !provider) return null;
  return products.find(p => p.supplierId === supplierId && p.provider === provider);
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runSyncJob(jobId, broadcast) {
  const db = ensureConfig(readDB());
  const job = db.syncJobs.find(j => j.id === jobId);
  if (!job) return;

  const provider = getProvider(job.provider);
  if (!provider) {
    updateJob(db, jobId, { status: 'error', errorLog: ['Provider not found: ' + job.provider] });
    addLog(db, jobId, 'error', 'Proveedor no encontrado: ' + job.provider);
    writeDB(db);
    if (broadcast) broadcast('sync-job-updated', job);
    return;
  }

  if (!provider.isConfigured) {
    updateJob(db, jobId, { status: 'error', errorLog: ['Provider not configured'] });
    addLog(db, jobId, 'error', provider.name + ' API no configurada. Configura las credenciales en .env');
    writeDB(db);
    if (broadcast) broadcast('sync-job-updated', job);
    return;
  }

  const config = db.syncConfig;
  const providerConfig = config.providers[job.provider] || { profitMargin: 35 };
  const profitMargin = providerConfig.profitMargin || config.defaultProfitMargin || 35;
  const maxProducts = config.maxProductsPerSync || 500;
  const autoHide = config.autoHideOutOfStock !== false;

  updateJob(db, jobId, { status: 'running', startedAt: new Date().toISOString() });
  addLog(db, jobId, 'info', `Iniciando sync dropshipping: ${job.provider} | ${job.searchType}: "${job.searchQuery}" | Margen: ${profitMargin}%`);
  writeDB(db);
  if (broadcast) broadcast('sync-job-updated', db.syncJobs.find(j => j.id === jobId));

  let page = 1;
  let totalImported = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalOutOfStock = 0;
  let hasMore = true;

  try {
    while (hasMore && totalImported + totalUpdated + totalSkipped < maxProducts) {
      const activeJob = activeJobs.get(jobId);
      if (!activeJob || activeJob.cancelled) {
        const dbCancelled = ensureConfig(readDB());
        updateJob(dbCancelled, jobId, { status: 'cancelled' });
        addLog(dbCancelled, jobId, 'warn', 'Sincronizacion cancelada por el usuario');
        writeDB(dbCancelled);
        if (broadcast) broadcast('sync-job-updated', dbCancelled.syncJobs.find(j => j.id === jobId));
        return;
      }
      if (activeJob && activeJob.paused) {
        const dbPaused = ensureConfig(readDB());
        updateJob(dbPaused, jobId, { status: 'paused' });
        writeDB(dbPaused);
        if (broadcast) broadcast('sync-job-updated', dbPaused.syncJobs.find(j => j.id === jobId));
        while (activeJob && activeJob.paused && !activeJob.cancelled) { await delay(1000); }
        if (activeJob && activeJob.cancelled) {
          const dbCancelled2 = ensureConfig(readDB());
          updateJob(dbCancelled2, jobId, { status: 'cancelled' });
          writeDB(dbCancelled2);
          if (broadcast) broadcast('sync-job-updated', dbCancelled2.syncJobs.find(j => j.id === jobId));
          return;
        }
        const dbResumed = ensureConfig(readDB());
        updateJob(dbResumed, jobId, { status: 'running' });
        writeDB(dbResumed);
        if (broadcast) broadcast('sync-job-updated', dbResumed.syncJobs.find(j => j.id === jobId));
      }

      let result;
      try {
        const searchParams = { page, pageSize: Math.min(provider.maxPageSize, 50) };
        if (job.searchType === 'keywords') searchParams.keywords = job.searchQuery;
        else if (job.searchType === 'category') searchParams.category = job.searchQuery;
        else if (job.searchType === 'brand') searchParams.keywords = job.searchQuery;
        else searchParams.keywords = job.searchQuery;
        result = await provider.search(searchParams);
      } catch (e) {
        totalErrors++;
        addLog(db, jobId, 'error', `Pagina ${page} - Error API: ${e.message}`);
        writeDB(db);
        hasMore = false;
        break;
      }

      if (result.error) {
        totalErrors++;
        addLog(db, jobId, 'error', `Pagina ${page}: ${result.error}`);
        hasMore = false;
        break;
      }

      const products = result.products || [];
      if (products.length === 0) { hasMore = false; break; }

      const dbFresh = ensureConfig(readDB());
      const allProducts = dbFresh.products;

      for (const raw of products) {
        if (totalImported + totalUpdated + totalSkipped >= maxProducts) break;
        try {
          const normalized = provider.normalize(raw, profitMargin);

          if (normalized.supplierMeta.stockStatus === 'out_of_stock') {
            totalOutOfStock++;
            if (autoHide) {
              const existing = findDuplicate(allProducts, normalized.supplierId, normalized.provider);
              if (existing) {
                const idx = allProducts.findIndex(p => p.id === existing.id);
                if (idx !== -1) allProducts[idx].syncStatus = 'out_of_stock';
              }
            }
            totalSkipped++;
            continue;
          }

          const existing = findDuplicate(allProducts, normalized.supplierId, normalized.provider);
          if (existing) {
            const idx = allProducts.findIndex(p => p.id === existing.id);
            if (idx !== -1) {
              const priceChanged = existing.price !== normalized.price;
              const imageChanged = existing.image !== normalized.image;
              allProducts[idx] = {
                ...allProducts[idx],
                name: normalized.name,
                category: normalized.category,
                price: normalized.price,
                old: normalized.old,
                image: normalized.image,
                description: normalized.description,
                sourceUrl: normalized.sourceUrl,
                lastSyncAt: new Date().toISOString(),
                syncStatus: 'synced',
                supplierMeta: { ...allProducts[idx].supplierMeta, ...normalized.supplierMeta },
                priceHistory: [
                  ...(allProducts[idx].priceHistory || []).slice(-29),
                  { date: new Date().toISOString(), priceUsd: normalized.supplierMeta.originalPriceUsd, priceCop: normalized.price, margin: profitMargin },
                ],
              };
              if (priceChanged) addLog(db, jobId, 'info', `Precio actualizado: ${normalized.name} -> ${normalized.price}`);
            }
            totalUpdated++;
          } else {
            allProducts.unshift({ id: Date.now() + Math.random(), ...normalized });
            totalImported++;
          }
        } catch (e) {
          totalErrors++;
          addLog(db, jobId, 'warn', `Producto omitido: ${e.message}`);
        }
      }

      writeDB({ ...dbFresh, products: allProducts });
      updateJob(db, jobId, {
        progress: { current: page, total: Math.ceil((result.total || 0) / 50) },
        stats: { imported: totalImported, updated: totalUpdated, skipped: totalSkipped, errors: totalErrors, outOfStock: totalOutOfStock },
      });
      if (broadcast) broadcast('sync-job-progress', {
        jobId,
        progress: { current: page, total: Math.ceil((result.total || 0) / 50) },
        stats: { imported: totalImported, updated: totalUpdated, skipped: totalSkipped, errors: totalErrors, outOfStock: totalOutOfStock },
      });

      hasMore = products.length >= 50;
      page++;
      if (hasMore) await delay(provider.searchDelayMs);
    }

    const dbDone = ensureConfig(readDB());
    updateJob(dbDone, jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      stats: { imported: totalImported, updated: totalUpdated, skipped: totalSkipped, errors: totalErrors, outOfStock: totalOutOfStock },
    });
    addLog(dbDone, jobId, 'info', `Sync completado: ${totalImported} nuevos, ${totalUpdated} actualizados, ${totalSkipped} omitidos, ${totalOutOfStock} sin stock, ${totalErrors} errores`);
    writeDB(dbDone);
    if (broadcast) broadcast('sync-job-updated', dbDone.syncJobs.find(j => j.id === jobId));
    if (broadcast) broadcast('product-added', {});

  } catch (e) {
    const dbErr = ensureConfig(readDB());
    updateJob(dbErr, jobId, { status: 'error', errorLog: [e.message] });
    addLog(dbErr, jobId, 'error', `Sync fallido: ${e.message}`);
    writeDB(dbErr);
    if (broadcast) broadcast('sync-job-updated', dbErr.syncJobs.find(j => j.id === jobId));
  } finally {
    activeJobs.delete(jobId);
  }
}

function createJob(params, broadcast) {
  const db = ensureConfig(readDB());
  const job = {
    id: generateJobId(),
    provider: params.provider,
    type: params.type || 'bulk',
    searchType: params.searchType || 'keywords',
    searchQuery: params.searchQuery || '',
    status: 'queued',
    progress: { current: 0, total: 0 },
    stats: { imported: 0, updated: 0, skipped: 0, errors: 0, outOfStock: 0 },
    startedAt: null,
    completedAt: null,
    errorLog: [],
  };
  db.syncJobs.unshift(job);
  addLog(db, job.id, 'info', `Job creado: ${job.provider} | ${job.searchType}: "${job.searchQuery}"`);
  writeDB(db);
  activeJobs.set(job.id, { paused: false, cancelled: false });
  runSyncJob(job.id, broadcast).catch((e) => {
    const db2 = ensureConfig(readDB());
    updateJob(db2, job.id, { status: 'error', errorLog: [e.message] });
    addLog(db2, job.id, 'error', 'Sync error: ' + e.message);
    writeDB(db2);
    if (broadcast) broadcast('sync-job-updated', db2.syncJobs.find(j => j.id === job.id));
  });
  return job;
}

function recoverStaleJobs(broadcast) {
  const db = ensureConfig(readDB());
  let recovered = 0;
  for (const job of db.syncJobs) {
    if ((job.status === 'queued' || job.status === 'running') && !activeJobs.has(job.id)) {
      activeJobs.set(job.id, { paused: false, cancelled: false });
      runSyncJob(job.id, broadcast).catch((e) => {
        const db2 = ensureConfig(readDB());
        updateJob(db2, job.id, { status: 'error', errorLog: [e.message] });
        addLog(db2, job.id, 'error', 'Sync error: ' + e.message);
        writeDB(db2);
        if (broadcast) broadcast('sync-job-updated', db2.syncJobs.find(j => j.id === job.id));
      });
      recovered++;
    }
  }
  if (recovered > 0) {
    addLog(db, null, 'info', `Recuperados ${recovered} jobs pendientes tras reinicio`);
    writeDB(db);
  }
  return recovered;
}

function pauseJob(jobId) {
  const active = activeJobs.get(jobId);
  if (active) active.paused = true;
  const db = ensureConfig(readDB());
  updateJob(db, jobId, { status: 'paused' });
  addLog(db, jobId, 'info', 'Sincronizacion pausada');
  writeDB(db);
  return db.syncJobs.find(j => j.id === jobId);
}

function resumeJob(jobId, broadcast) {
  const active = activeJobs.get(jobId);
  if (active) {
    active.paused = false;
    const db = ensureConfig(readDB());
    updateJob(db, jobId, { status: 'running' });
    addLog(db, jobId, 'info', 'Sincronizacion reanudada');
    writeDB(db);
    return db.syncJobs.find(j => j.id === jobId);
  }
  const db = ensureConfig(readDB());
  const job = db.syncJobs.find(j => j.id === jobId);
  if (job && (job.status === 'paused' || job.status === 'error')) {
    activeJobs.set(jobId, { paused: false, cancelled: false });
    runSyncJob(jobId, broadcast);
    return job;
  }
  return job;
}

function cancelJob(jobId) {
  const active = activeJobs.get(jobId);
  if (active) { active.cancelled = true; active.paused = false; }
  const db = ensureConfig(readDB());
  updateJob(db, jobId, { status: 'cancelled' });
  addLog(db, jobId, 'info', 'Sincronizacion cancelada');
  writeDB(db);
  return db.syncJobs.find(j => j.id === jobId);
}

function getConfig() { return ensureConfig(readDB()).syncConfig; }

function updateConfig(updates, broadcast) {
  const db = ensureConfig(readDB());
  db.syncConfig = { ...db.syncConfig, ...updates };
  if (updates.providers) db.syncConfig.providers = { ...db.syncConfig.providers, ...updates.providers };
  writeDB(db);
  if (broadcast) broadcast('sync-config-updated', db.syncConfig);
  return db.syncConfig;
}

function getJobs() { return ensureConfig(readDB()).syncJobs; }

function getJob(jobId) { return ensureConfig(readDB()).syncJobs.find(j => j.id === jobId); }

function getLogs(jobId, limit = 100) {
  const logs = ensureConfig(readDB()).syncLogs;
  if (jobId) return logs.filter(l => l.jobId === jobId).slice(0, limit);
  return logs.slice(0, limit);
}

function getActiveSyncCount() {
  let count = 0;
  for (const [, v] of activeJobs) { if (!v.paused && !v.cancelled) count++; }
  return count;
}

module.exports = {
  createJob, pauseJob, resumeJob, cancelJob,
  getConfig, updateConfig, getJobs, getJob, getLogs,
  getActiveSyncCount, ensureConfig, recoverStaleJobs,
};
