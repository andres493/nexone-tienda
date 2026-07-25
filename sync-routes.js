const express = require('express');
const { getAllProviders } = require('./providers');
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
  const { provider, searchType, searchQuery } = req.body;
  if (!provider || !searchQuery) return res.status(400).json({ error: 'provider and searchQuery required' });
  const activeCount = syncEngine.getActiveSyncCount();
  if (activeCount >= 3) return res.status(429).json({ error: 'Max 3 concurrent syncs. Wait for current jobs to finish.' });
  const job = syncEngine.createJob({ provider, searchType: searchType || 'keywords', searchQuery, type: 'bulk' }, req.app.locals.broadcast);
  res.json(job);
});

router.post('/pause/:jobId', (req, res) => {
  const job = syncEngine.pauseJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.post('/resume/:jobId', (req, res) => {
  const job = syncEngine.resumeJob(req.params.jobId, req.app.locals.broadcast);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.post('/cancel/:jobId', (req, res) => {
  const job = syncEngine.cancelJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.get('/jobs', (req, res) => {
  res.json(syncEngine.getJobs());
});

router.get('/jobs/:jobId', (req, res) => {
  const job = syncEngine.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
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

module.exports = router;
