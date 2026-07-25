const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const WA_PHONE = '573011497152';
const API = '';

let remoteProducts = [];
let remoteOrders = [];

function getProducts() { return remoteProducts; }
function getOrders() { return remoteOrders; }

async function loadProducts() {
  try {
    const res = await fetch(API + '/api/products');
    remoteProducts = await res.json();
  } catch { remoteProducts = []; }
}

async function loadOrders() {
  try {
    const res = await fetch(API + '/api/orders');
    remoteOrders = await res.json();
  } catch { remoteOrders = []; }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.remove('show'), 1800);
}

function statusClass(s) {
  if (s === 'Enviado') return 'enviado';
  if (s === 'Procesando') return 'procesando';
  if (s === 'Entregado') return 'entregado';
  return 'procesando';
}

function renderChart() {
  const canvas = document.getElementById('salesChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width - 32;
  canvas.height = 200;

  const orders = getOrders();
  const days = 7;
  const data = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayStr = d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' });
    const dayTotal = orders.filter(o => {
      const oDate = new Date(parseInt(o.id.replace('#DP-', '')) || Date.now());
      return oDate.toDateString() === d.toDateString();
    }).reduce((s, o) => s + Number(o.total), 0);
    data.push({ label: dayStr, value: dayTotal });
  }

  const w = canvas.width, h = canvas.height;
  const pad = { top: 20, bottom: 28, left: 10, right: 10 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const maxVal = Math.max(...data.map(d => d.value), 1);

  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = '#e4e7ef';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    const val = Math.round((maxVal / 4) * (4 - i));
    ctx.fillStyle = '#6f7887'; ctx.font = '10px Inter'; ctx.textAlign = 'right';
    ctx.fillText(money.format(val), pad.left - 4, y + 3);
  }

  const points = data.map((d, i) => ({
    x: pad.left + (chartW / (data.length - 1 || 1)) * i,
    y: pad.top + chartH - (d.value / maxVal) * chartH * 0.9,
    value: d.value,
    label: d.label
  }));

  ctx.beginPath();
  ctx.strokeStyle = '#e84c1d';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  points.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
  ctx.stroke();

  ctx.fillStyle = 'rgba(232,76,29,0.08)';
  ctx.beginPath();
  ctx.moveTo(points[0].x, pad.top + chartH);
  points.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, pad.top + chartH);
  ctx.closePath();
  ctx.fill();

  points.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#e84c1d';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  ctx.fillStyle = '#6f7887';
  ctx.font = '10px Inter';
  ctx.textAlign = 'center';
  data.forEach((d, i) => {
    ctx.fillText(d.label, points[i].x, h - 6);
  });

  if (points.length > 0) {
    const last = points[points.length - 1];
    ctx.fillStyle = '#14161c';
    ctx.font = 'bold 11px Inter';
    ctx.textAlign = 'left';
    ctx.fillText(money.format(last.value), last.x + 8, last.y + 3);
  }
}

function renderTopProducts() {
  const products = getProducts().sort((a, b) => b.sold - a.sold).slice(0, 5);
  const maxSold = products.length ? products[0].sold : 1;
  document.getElementById('topProducts').innerHTML = products.map(p => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <img src="${p.image}" style="width:32px;height:32px;border-radius:6px;object-fit:cover;background:var(--panel-soft)" onerror="this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=64&q=60'">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
        <div style="height:6px;background:var(--panel-soft);border-radius:3px;margin-top:3px;overflow:hidden">
          <div style="height:100%;width:${(p.sold / maxSold) * 100}%;background:linear-gradient(90deg,var(--brand),var(--gold));border-radius:3px;transition:.3s"></div>
        </div>
      </div>
      <span style="font-weight:900;font-size:12px;color:var(--brand)">${p.sold.toLocaleString('es-ES')}</span>
    </div>
  `).join('');
}

function renderDashboard() {
  const products = getProducts();
  const orders = getOrders();
  const revenue = orders.reduce((sum, o) => sum + Number(o.total), 0);
  document.getElementById('statProducts').textContent = products.length;
  document.getElementById('statOrders').textContent = orders.length;
  document.getElementById('statRevenue').textContent = money.format(revenue);
  const customers = new Set(orders.map(o => o.customer));
  document.getElementById('statCustomers').textContent = customers.size;
  document.getElementById('dashboardOrders').innerHTML = orders.slice(0, 5).map(o => `
    <tr>
      <td><strong>${o.id}</strong></td>
      <td>${o.customer}${o.bank ? '<br><span style="font-size:10px;color:var(--muted)">'+o.bank+'</span>' : ''}</td>
      <td>${money.format(o.total)}</td>
      <td><span class="status-badge ${statusClass(o.status)}">${o.status}</span></td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="empty">Sin pedidos aun</td></tr>';
  renderChart();
  renderTopProducts();
}

function renderProducts() {
  const list = getProducts();
  document.getElementById('productsTable').innerHTML = list.map(p => `
    <tr>
      <td>${p.id}</td>
      <td style="display:flex;align-items:center;gap:6px">
        <img src="${p.image}" style="width:28px;height:28px;border-radius:4px;object-fit:cover;background:var(--panel-soft)" onerror="this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=64&q=60'">
        <strong>${p.name}</strong>
      </td>
      <td>${p.category}</td>
      <td>${p.provider ? '<span class="provider-badge">' + p.provider + '</span>' : '-'}</td>
      <td>${money.format(p.price)}</td>
      <td>${p.sold.toLocaleString('es-ES')}</td>
      <td>${p.rating.toFixed(1)}</td>
      <td>
        <button class="btn-icon edit" onclick="editProduct(${p.id})">✏️</button>
        <button class="btn-icon delete" onclick="deleteProduct(${p.id})">🗑️</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="8" class="empty">No hay productos</td></tr>';
}

function renderOrders() {
  const list = getOrders();
  document.getElementById('ordersTable').innerHTML = list.map(o => `
    <tr>
      <td><strong>${o.id}</strong></td>
      <td>${o.customer}${o.bank ? '<br><span style="font-size:10px;color:var(--muted)">'+o.bank+'</span>' : ''}</td>
      <td>${o.product}</td>
      <td>${money.format(o.total)}</td>
      <td>
        <select onchange="updateStatus('${o.id}', this.value)" style="border:1px solid var(--line);border-radius:6px;padding:4px 8px;font-size:12px;font-weight:600">
          <option value="Procesando" ${o.status === 'Procesando' ? 'selected' : ''}>Procesando</option>
          <option value="Enviado" ${o.status === 'Enviado' ? 'selected' : ''}>Enviado</option>
          <option value="Entregado" ${o.status === 'Entregado' ? 'selected' : ''}>Entregado</option>
        </select>
      </td>
      <td>
        <a href="https://wa.me/${WA_PHONE}?text=${encodeURIComponent('Hola! consulta sobre el pedido ' + o.id + ' - ' + o.customer)}" target="_blank" style="color:#25d366;font-weight:900;text-decoration:none;font-size:16px">💬</a>
        <button class="btn-icon delete" onclick="deleteOrder('${o.id}')">🗑️</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty">Sin pedidos</td></tr>';
}

async function deleteProduct(id) {
  if (!confirm('¿Eliminar este producto?')) return;
  await fetch(API + '/api/products/' + id, { method: 'DELETE' });
  await loadProducts();
  renderAll();
  showToast('Producto eliminado');
}

function editProduct(id) {
  const p = getProducts().find(x => x.id === id);
  if (!p) return;
  document.getElementById('editId').value = p.id;
  document.getElementById('editName').value = p.name;
  document.getElementById('editPrice').value = p.price;
  document.getElementById('editOldPrice').value = p.old || '';
  document.getElementById('editCategory').value = p.category;
  document.getElementById('editImage').value = p.image || '';
  document.getElementById('editDescription').value = p.description || '';
  document.getElementById('editProvider').value = p.provider || '';
  document.getElementById('editModal').classList.add('open');
}

function handleFileInput(inputId, previewId, urlInputId) {
  const fileInput = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  const urlInput = document.getElementById(urlInputId);
  if (!fileInput) return;
  fileInput.addEventListener('change', function () {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      const dataUrl = e.target.result;
      urlInput.value = dataUrl;
      preview.style.display = 'block';
      preview.querySelector('img').src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

handleFileInput('newImageFile', 'newImagePreview', 'newImage');
handleFileInput('editImageFile', 'editImagePreview', 'editImage');

document.getElementById('editForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const id = Number(document.getElementById('editId').value);
  const updated = {
    name: document.getElementById('editName').value.trim(),
    price: Number(document.getElementById('editPrice').value),
    old: document.getElementById('editOldPrice').value ? Number(document.getElementById('editOldPrice').value) : Math.round(Number(document.getElementById('editPrice').value) * 1.35),
    category: document.getElementById('editCategory').value,
    provider: document.getElementById('editProvider').value.trim() || '',
    image: document.getElementById('editImage').value.trim() || undefined,
    description: document.getElementById('editDescription').value.trim() || undefined,
  };
  await fetch(API + '/api/products/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updated),
  });
  document.getElementById('editModal').classList.remove('open');
  await loadProducts();
  renderAll();
  showToast('Producto actualizado');
});

document.getElementById('cancelEdit').addEventListener('click', () => {
  document.getElementById('editModal').classList.remove('open');
});

document.getElementById('modalBg').addEventListener('click', () => {
  document.getElementById('editModal').classList.remove('open');
});

async function updateStatus(orderId, newStatus) {
  await fetch(API + '/api/orders/' + encodeURIComponent(orderId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus }),
  });
  await loadOrders();
  renderAll();
  showToast('Estado actualizado');
}

async function deleteOrder(id) {
  if (!confirm('¿Eliminar este pedido?')) return;
  await fetch(API + '/api/orders/' + encodeURIComponent(id), { method: 'DELETE' });
  await loadOrders();
  renderAll();
  showToast('Pedido eliminado');
}

document.getElementById('productForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const name = document.getElementById('newName').value.trim();
  const price = Number(document.getElementById('newPrice').value);
  const oldPrice = document.getElementById('newOldPrice').value ? Number(document.getElementById('newOldPrice').value) : Math.round(price * 1.35);
  const category = document.getElementById('newCategory').value;
  const provider = document.getElementById('newProvider').value.trim() || '';
  const image = document.getElementById('newImage').value.trim() || 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=82';
  const description = document.getElementById('newDescription').value.trim() || 'Producto nuevo.';
  await fetch(API + '/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, price, old: oldPrice, category, provider, image, description, rating: 4.7, sold: 0, tag: 'Nuevo' }),
  });
  this.reset();
  document.getElementById('newImagePreview').style.display = 'none';
  await loadProducts();
  renderAll();
  showToast('Producto creado');
});

document.querySelectorAll('.admin-nav button[data-page]').forEach(btn => {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.admin-nav button[data-page]').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    document.querySelectorAll('.section-page').forEach(s => s.classList.remove('active'));
    document.getElementById('page-' + this.dataset.page).classList.add('active');
    if (this.dataset.page === 'dashboard') renderChart();
  });
});

let flashSale = { enabled: false };

function renderImportCategoryList() {
  const cats = [...new Set(getProducts().map(p => p.category))];
  const defaultCats = ['Tecnologia','Belleza','Hogar','Moda','Fitness','Deportes','Mascotas','Bebes','Juguetes','Herramientas','Salud','Alimentos','Automotriz','Oficina','Jardin','Musica','Fotografia','Otros'];
  const allCats = [...new Set([...cats, ...defaultCats])];
  const dl = document.getElementById('importCatList');
  if (dl) dl.innerHTML = allCats.map(c => `<option value="${c}">`).join('');
}

const platformColors = {
  'Temu': '#fb7701', 'AliExpress': '#e43225', 'Amazon': '#ff9900',
  'Shopee': '#ee4d2d', 'Shein': '#000', 'MercadoLibre': '#ffe600', 'Otro': '#64748b'
};

function detectPlatform(url) {
  if (/temu\.com/i.test(url)) return 'Temu';
  if (/aliexpress/i.test(url)) return 'AliExpress';
  if (/amazon\./i.test(url)) return 'Amazon';
  if (/shopee\./i.test(url)) return 'Shopee';
  if (/shein\.com/i.test(url)) return 'Shein';
  if (/mercadolibre\./i.test(url)) return 'MercadoLibre';
  return 'Otro';
}

function showPlatformBadge(platform) {
  const el = document.getElementById('importPlatformBadge');
  const color = platformColors[platform] || '#64748b';
  el.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:800;color:#fff;background:${color}">${platform}</span>`;
  el.style.display = 'block';
}

document.getElementById('importBtn').addEventListener('click', async function () {
  const url = document.getElementById('importUrl').value.trim();
  if (!url) return;
  const platform = detectPlatform(url);
  showPlatformBadge(platform);
  document.getElementById('importLoading').style.display = 'block';
  document.getElementById('importResult').style.display = 'none';
  this.disabled = true;
  try {
    const res = await fetch(API + '/api/import-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    document.getElementById('importName').value = data.title || '';
    document.getElementById('importImage').value = data.image || '';
    document.getElementById('importDescription').value = data.description || '';
    document.getElementById('importProvider').value = platform;
    document.getElementById('importSourceUrl').value = url;
    if (data.price) {
      const usdPrice = parseFloat(data.price);
      const copPrice = platform === 'Amazon' ? Math.round(usdPrice * 4200) : Math.round(usdPrice * 4200);
      document.getElementById('importPrice').value = copPrice || '';
      document.getElementById('importOldPrice').value = copPrice ? Math.round(copPrice * 1.35) : '';
    }
    if (data.image) {
      const preview = document.getElementById('importPreview');
      preview.style.display = 'block';
      preview.querySelector('img').src = data.image;
    }
    document.getElementById('importResult').style.display = 'block';
  } catch {
    document.getElementById('importResult').style.display = 'block';
  }
  document.getElementById('importLoading').style.display = 'none';
  this.disabled = false;
});

document.getElementById('importImageFile')?.addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    document.getElementById('importImage').value = e.target.result;
    const preview = document.getElementById('importPreview');
    preview.style.display = 'block';
    preview.querySelector('img').src = e.target.result;
  };
  reader.readAsDataURL(file);
});

document.getElementById('importSaveBtn').addEventListener('click', async function () {
  const name = document.getElementById('importName').value.trim();
  const price = Number(document.getElementById('importPrice').value);
  if (!name || !price) return showToast('Nombre y precio son obligatorios');
  const product = {
    name,
    price,
    old: document.getElementById('importOldPrice').value ? Number(document.getElementById('importOldPrice').value) : Math.round(price * 1.35),
    category: document.getElementById('importCategory').value || 'Otros',
    provider: document.getElementById('importProvider').value || '',
    image: document.getElementById('importImage').value.trim() || 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=82',
    description: document.getElementById('importDescription').value.trim() || 'Producto importado.',
    sourceUrl: document.getElementById('importSourceUrl').value.trim() || '',
    rating: 4.7, sold: 0, tag: 'Nuevo',
  };
  await fetch(API + '/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(product),
  });
  await loadProducts();
  renderAll();
  document.getElementById('importResult').style.display = 'none';
  document.getElementById('importPlatformBadge').style.display = 'none';
  document.getElementById('importUrl').value = '';
  showToast('Producto importado exitosamente');
});

document.getElementById('importClearBtn').addEventListener('click', function () {
  document.getElementById('importUrl').value = '';
  document.getElementById('importResult').style.display = 'none';
  document.getElementById('importPlatformBadge').style.display = 'none';
  document.getElementById('importName').value = '';
  document.getElementById('importPrice').value = '';
  document.getElementById('importOldPrice').value = '';
  document.getElementById('importImage').value = '';
  document.getElementById('importDescription').value = '';
  document.getElementById('importCategory').value = '';
  document.getElementById('importProvider').value = '';
  document.getElementById('importSourceUrl').value = '';
});

document.getElementById('importUrl').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('importBtn').click(); }
});

async function loadFlashSale() {
  try {
    const res = await fetch(API + '/api/flashsale');
    flashSale = await res.json();
  } catch { flashSale = { enabled: false }; }
}

function renderFlashSaleForm() {
  document.getElementById('fsEnabled').checked = flashSale.enabled || false;
  document.getElementById('fsTitle').value = flashSale.title || 'Flash Sale';
  document.getElementById('fsSubtitle').value = flashSale.subtitle || 'Ofertas por tiempo limitado';
  if (flashSale.endTime) {
    const d = new Date(flashSale.endTime);
    document.getElementById('fsEndTime').value = d.toISOString().slice(0, 16);
  } else {
    document.getElementById('fsEndTime').value = '';
  }
  document.getElementById('fsCouponEnabled').checked = flashSale.couponEnabled || false;
  document.getElementById('fsCouponCode').value = flashSale.couponCode || 'NEX10';
  document.getElementById('fsCouponDesc').value = flashSale.couponDescription || '10% OFF en tu primer pedido';
}

document.getElementById('flashForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const data = {
    enabled: document.getElementById('fsEnabled').checked,
    title: document.getElementById('fsTitle').value.trim() || 'Flash Sale',
    subtitle: document.getElementById('fsSubtitle').value.trim() || 'Ofertas por tiempo limitado',
    endTime: document.getElementById('fsEndTime').value ? new Date(document.getElementById('fsEndTime').value).toISOString() : '',
    couponEnabled: document.getElementById('fsCouponEnabled').checked,
    couponCode: document.getElementById('fsCouponCode').value.trim() || 'NEX10',
    couponDescription: document.getElementById('fsCouponDesc').value.trim() || '10% OFF en tu primer pedido',
  };
  await fetch(API + '/api/flashsale', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  flashSale = data;
  showToast('Flash Sale actualizado');
});

function renderAll() {
  renderDashboard();
  renderProducts();
  renderOrders();
  renderCategoryLists();
  renderImportCategoryList();
}

function renderCategoryLists() {
  const cats = [...new Set(getProducts().map(p => p.category))];
  const optionsHtml = cats.map(c => `<option value="${c}">`).join('');
  const extraOptions = '<option value="Tecnologia"><option value="Belleza"><option value="Hogar"><option value="Moda"><option value="Fitness"><option value="Deportes"><option value="Mascotas"><option value="Bebes"><option value="Juguetes"><option value="Herramientas"><option value="Salud"><option value="Alimentos"><option value="Automotriz"><option value="Oficina"><option value="Jardin"><option value="Musica"><option value="Fotografia"><option value="Otros">';
  const allOptions = optionsHtml + extraOptions;
  const newDatalist = document.getElementById('newCatList');
  const editDatalist = document.getElementById('editCatList');
  if (newDatalist) newDatalist.innerHTML = allOptions;
  if (editDatalist) editDatalist.innerHTML = allOptions;
}

function connectSSE() {
  const es = new EventSource(API + '/api/sse');
  es.addEventListener('product-added', async () => { await loadProducts(); renderAll(); showToast('Nuevo producto agregado'); });
  es.addEventListener('product-updated', async () => { await loadProducts(); renderAll(); showToast('Producto actualizado'); });
  es.addEventListener('product-deleted', async () => { await loadProducts(); renderAll(); showToast('Producto eliminado'); });
  es.addEventListener('order-added', async () => { await loadOrders(); renderAll(); showToast('Nuevo pedido recibido'); });
  es.addEventListener('order-updated', async () => { await loadOrders(); renderAll(); });
  es.addEventListener('order-deleted', async () => { await loadOrders(); renderAll(); });
  es.addEventListener('flashsale-updated', async (e) => { flashSale = JSON.parse(e.data); renderFlashSaleForm(); });
  es.onerror = () => { setTimeout(connectSSE, 3000); es.close(); };
}

async function init() {
  await Promise.all([loadProducts(), loadOrders(), loadFlashSale()]);
  renderAll();
  renderFlashSaleForm();
  renderImportCategoryList();
  connectSSE();
}

init();
