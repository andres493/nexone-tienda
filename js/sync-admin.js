const SYNC_API = '/api/sync';

let syncPollTimer = null;

function syncShowToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(syncShowToast._t);
  syncShowToast._t = setTimeout(() => t.classList.remove('show'), 1800);
}

async function loadSyncProviders() {
  try {
    const res = await fetch(SYNC_API + '/providers');
    const providers = await res.json();
    const el = document.getElementById('syncProvidersStatus');
    el.innerHTML = providers.map(p => {
      const color = p.configured ? '#d1fae5' : '#fee2e2';
      const textColor = p.configured ? '#065f46' : '#dc2626';
      const icon = p.configured ? '✅' : '❌';
      return `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;background:${color};color:${textColor}">${icon} ${p.name}</span>`;
    }).join('');
    const providerSelect = document.getElementById('syncProvider');
    if (providerSelect) {
      providerSelect.innerHTML = providers.map(p => `<option value="${p.id}" ${!p.configured ? 'disabled' : ''}>${p.name} ${!p.configured ? '(sin configurar)' : ''}</option>`).join('');
    }
  } catch {}
}

async function loadSyncConfig() {
  try {
    const res = await fetch(SYNC_API + '/config');
    const config = await res.json();
    document.getElementById('syncAutoEnabled').checked = config.autoSyncEnabled || false;
    document.getElementById('syncAutoHide').checked = config.autoHideOutOfStock !== false;
    document.getElementById('syncInterval').value = config.autoSyncIntervalMinutes || 60;
    document.getElementById('syncDefaultMargin').value = config.defaultProfitMargin || 35;
    document.getElementById('syncMaxProducts').value = config.maxProductsPerSync || 500;
  } catch {}
}

async function loadSyncJobs() {
  try {
    const res = await fetch(SYNC_API + '/jobs');
    const jobs = await res.json();
    renderSyncJobs(jobs);
    updateSyncStats(jobs);
  } catch {}
}

async function loadSyncStats() {
  try {
    const res = await fetch(SYNC_API + '/stats');
    const stats = await res.json();
    document.getElementById('syncStatTotal').textContent = (stats.synced || 0).toLocaleString('es-ES');
    document.getElementById('syncStatOutOfStock').textContent = (stats.outOfStock || 0).toLocaleString('es-ES');
    if (stats.lastSync) {
      document.getElementById('syncStatLast').textContent = new Date(stats.lastSync).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    }
  } catch {}
}

async function loadSyncLogs() {
  try {
    const res = await fetch(SYNC_API + '/logs?limit=50');
    const logs = await res.json();
    renderSyncLogs(logs);
  } catch {}
}

function updateSyncStats(jobs) {
  const active = jobs.filter(j => j.status === 'running' || j.status === 'queued').length;
  document.getElementById('syncStatActive').textContent = active;
}

function renderSyncJobs(jobs) {
  const tbody = document.getElementById('syncJobsBody');
  if (!jobs.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">Sin trabajos de sincronizacion</td></tr>'; return; }
  tbody.innerHTML = jobs.slice(0, 20).map(j => {
    const progressPct = j.progress?.total ? Math.round((j.progress.current / j.progress.total) * 100) : 0;
    const s = j.stats || {};
    const statsText = `${s.imported || 0}+ ${s.updated || 0}~ ${s.outOfStock || 0} sin stock`;
    const shortId = j.id.length > 18 ? j.id.slice(0, 18) + '...' : j.id;
    const queryShort = (j.searchQuery || '').length > 20 ? j.searchQuery.slice(0, 20) + '...' : (j.searchQuery || '-');
    let actions = '';
    if (j.status === 'running') actions = `<button class="btn-icon edit" onclick="syncPause('${j.id}')" title="Pausar">⏸</button> <button class="btn-icon delete" onclick="syncCancel('${j.id}')" title="Cancelar">⏹</button>`;
    else if (j.status === 'paused') actions = `<button class="btn-icon edit" onclick="syncResume('${j.id}')" title="Reanudar">▶</button> <button class="btn-icon delete" onclick="syncCancel('${j.id}')" title="Cancelar">⏹</button>`;
    else if (j.status === 'error') actions = `<button class="btn-icon edit" onclick="syncResume('${j.id}')" title="Reintentar">🔄</button>`;
    return `<tr>
      <td style="font-size:11px;font-family:monospace">${shortId}</td>
      <td><span class="provider-badge">${j.provider}</span></td>
      <td style="font-size:12px">${queryShort}</td>
      <td><div class="sync-progress"><div class="sync-progress-fill" style="width:${progressPct}%"></div></div><span style="font-size:10px;color:var(--muted)">${progressPct}%</span></td>
      <td style="font-size:11px;white-space:nowrap">${statsText}</td>
      <td><span class="sync-status ${j.status}">${j.status}</span></td>
      <td style="white-space:nowrap">${actions}</td>
    </tr>`;
  }).join('');
}

function renderSyncLogs(logs) {
  const el = document.getElementById('syncLogsList');
  if (!logs.length) { el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted)">Sin logs</div>'; return; }
  el.innerHTML = logs.map(l => {
    const time = new Date(l.timestamp).toLocaleString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `<div class="sync-log-item ${l.level}"><span class="sync-log-time">${time}</span><span class="sync-log-msg">${l.message}</span></div>`;
  }).join('');
}

async function syncPause(jobId) {
  await fetch(SYNC_API + '/pause/' + jobId, { method: 'POST' });
  syncShowToast('Sincronizacion pausada');
  await loadSyncJobs();
}

async function syncResume(jobId) {
  await fetch(SYNC_API + '/resume/' + jobId, { method: 'POST' });
  syncShowToast('Sincronizacion reanudada');
  await loadSyncJobs();
}

async function syncCancel(jobId) {
  if (!confirm('¿Cancelar esta sincronizacion?')) return;
  await fetch(SYNC_API + '/cancel/' + jobId, { method: 'POST' });
  syncShowToast('Sincronizacion cancelada');
  await loadSyncJobs();
}

document.getElementById('syncStartBtn')?.addEventListener('click', async () => {
  const provider = document.getElementById('syncProvider').value;
  const searchType = document.getElementById('syncSearchType').value;
  const searchQuery = document.getElementById('syncSearchQuery').value.trim();
  const profitMargin = Number(document.getElementById('syncProfitMargin').value);
  const maxProducts = Number(document.getElementById('syncMaxProducts').value);
  if (!searchQuery) return syncShowToast('Escribe un termino de busqueda');

  await fetch(SYNC_API + '/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxProductsPerSync: maxProducts }),
  });

  try {
    const res = await fetch(SYNC_API + '/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, searchType, searchQuery, profitMargin }),
    });
    const data = await res.json();
    if (data.error) return syncShowToast('Error: ' + data.error);
    syncShowToast('Sincronizacion dropshipping iniciada');
    await loadSyncJobs();
    startSyncPolling();
  } catch (e) {
    syncShowToast('Error al iniciar: ' + e.message);
  }
});

document.getElementById('syncSaveConfigBtn')?.addEventListener('click', async () => {
  try {
    await fetch(SYNC_API + '/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        autoSyncEnabled: document.getElementById('syncAutoEnabled').checked,
        autoHideOutOfStock: document.getElementById('syncAutoHide').checked,
        autoSyncIntervalMinutes: Number(document.getElementById('syncInterval').value),
        defaultProfitMargin: Number(document.getElementById('syncDefaultMargin').value),
        maxProductsPerSync: Number(document.getElementById('syncMaxProducts').value),
      }),
    });
    syncShowToast('Configuracion dropshipping guardada');
  } catch (e) {
    syncShowToast('Error: ' + e.message);
  }
});

document.getElementById('syncRefreshBtn')?.addEventListener('click', () => { loadSyncJobs(); loadSyncStats(); });
document.getElementById('syncLogsRefreshBtn')?.addEventListener('click', () => loadSyncLogs());

document.getElementById('syncSearchQuery')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('syncStartBtn')?.click();
});

function startSyncPolling() {
  if (syncPollTimer) return;
  syncPollTimer = setInterval(async () => {
    await loadSyncJobs();
    await loadSyncLogs();
    await loadSyncStats();
    const res = await fetch(SYNC_API + '/status');
    const data = await res.json();
    if (data.activeSyncs === 0) {
      clearInterval(syncPollTimer);
      syncPollTimer = null;
    }
  }, 5000);
}

async function checkAliExpressConnection() {
  try {
    const res = await fetch('/api/aliexpress/token-status');
    const data = await res.json();
    const container = document.getElementById('aliexpressConnection');
    const status = document.getElementById('aliexpressConnStatus');
    const connectBtn = document.getElementById('aliexpressConnectBtn');
    const disconnectBtn = document.getElementById('aliexpressDisconnectBtn');
    if (!container) return;
    container.style.display = 'flex';
    if (data.connected && !data.expired) {
      status.textContent = '✅ Conectado';
      status.style.color = '#065f46';
      connectBtn.style.display = 'none';
      disconnectBtn.style.display = '';
    } else {
      status.textContent = data.expired ? '⚠️ Token expirado, reconecta' : '❌ Desconectado';
      status.style.color = data.expired ? '#b45309' : '#dc2626';
      connectBtn.style.display = '';
      disconnectBtn.style.display = 'none';
    }
  } catch {}
}

function renderSyncPage() {
  loadSyncProviders();
  loadSyncConfig();
  loadSyncJobs();
  loadSyncStats();
  loadSyncLogs();
  checkAliExpressConnection();
}

document.querySelectorAll('.admin-nav button[data-page]').forEach(btn => {
  btn.addEventListener('click', function () {
    if (this.dataset.page === 'sync') {
      renderSyncPage();
      fetch(SYNC_API + '/status').then(r => r.json()).then(data => {
        if (data.activeSyncs > 0) startSyncPolling();
      }).catch(() => {});
    }
  });
});

document.getElementById('aliexpressConnectBtn')?.addEventListener('click', () => {
  window.open('/api/aliexpress/auth', '_blank', 'width=600,height=700');
});

window.addEventListener('message', (e) => {
  if (e.data?.type === 'aliexpress-connected') {
    checkAliExpressConnection();
    syncShowToast('AliExpress conectado!');
  }
});

document.getElementById('aliexpressDisconnectBtn')?.addEventListener('click', async () => {
  await fetch('/api/aliexpress/disconnect', { method: 'POST' });
  checkAliExpressConnection();
  syncShowToast('AliExpress desconectado');
});
