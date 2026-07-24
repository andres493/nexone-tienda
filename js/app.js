const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const WA_PHONE = '573011497152';
const WA_BASE = 'https://wa.me/' + WA_PHONE + '?text=';
const API = '';

let allProducts = [];
let flashSale = { enabled: false };

async function loadProducts() {
  try {
    const res = await fetch(API + '/api/products');
    allProducts = await res.json();
  } catch { allProducts = []; }
  renderProducts();
  renderDeals();
  renderFilters();
  renderCategories();
}

async function loadFlashSale() {
  try {
    const res = await fetch(API + '/api/flashsale');
    flashSale = await res.json();
  } catch { flashSale = { enabled: false }; }
  renderFlashBanner();
  renderCouponBar();
}

function getProducts() { return allProducts; }

let activeCategory = 'Todos';

function waUrl(product) {
  return WA_BASE + encodeURIComponent('Hola! Me interesa el producto *' + product.name + '* por ' + money.format(product.price) + '. Quiero hacer el pedido. Gracias.');
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

const catIcons = {
  'Tecnologia': '🖥️', 'Belleza': '💄', 'Hogar': '🏠', 'Moda': '👗', 'Fitness': '💪',
  'Deportes': '⚽', 'Mascotas': '🐾', 'Bebes': '👶', 'Juguetes': '🎮', 'Herramientas': '🔧',
  'Salud': '💊', 'Alimentos': '🍕', 'Automotriz': '🚗', 'Oficina': '💼', 'Jardin': '🌿',
  'Música': '🎵', 'Fotografia': '📷', 'Otros': '📦'
};
function getCatIcon(cat) { return catIcons[cat] || '📦'; }

function renderCategories() {
  const cats = [...new Set(getProducts().map(p => p.category))];
  document.getElementById('catList').innerHTML =
    `<button class="cat-item ${activeCategory === 'Todos' ? 'active' : ''}" data-cat="Todos"><span class="cat-icon">🛍️</span>Todos</button>` +
    cats.map(cat =>
      `<button class="cat-item ${cat === activeCategory ? 'active' : ''}" data-cat="${cat}"><span class="cat-icon">${getCatIcon(cat)}</span>${cat}</button>`
    ).join('');
}

function renderFilters() {
  const cats = [...new Set(getProducts().map(p => p.category))];
  document.getElementById('filters').innerHTML =
    `<button class="chip ${activeCategory === 'Todos' ? 'active' : ''}" data-category="Todos">Todos</button>` +
    cats.map(cat =>
      `<button class="chip ${cat === activeCategory ? 'active' : ''}" data-category="${cat}">${cat}</button>`
    ).join('');
}

function filteredProducts() {
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const sort = document.getElementById('sortSelect').value;
  let list = getProducts().filter(p =>
    (activeCategory === 'Todos' || p.category === activeCategory) &&
    (p.name.toLowerCase().includes(query) || (p.description || '').toLowerCase().includes(query))
  );
  if (sort === 'priceAsc') list.sort((a, b) => a.price - b.price);
  if (sort === 'priceDesc') list.sort((a, b) => b.price - a.price);
  if (sort === 'rating') list.sort((a, b) => b.rating - a.rating);
  return list;
}

function starsHtml(rating) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  let s = '';
  for (let i = 0; i < full; i++) s += '★';
  if (half) s += '½';
  s += '☆'.repeat(5 - full - (half ? 1 : 0));
  return s;
}

function renderProducts() {
  renderFilters();
  const list = filteredProducts();
  document.getElementById('resultsText').textContent = `${list.length} producto${list.length !== 1 ? 's' : ''}`;
  const grid = document.getElementById('productGrid');
  if (!list.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><h3>No hay productos aun</h3><p>Pronto agregaremos nuevos productos a la tienda.</p></div>';
    return;
  }
  grid.innerHTML = list.map(p => {
    const disc = p.old ? Math.round((1 - p.price / p.old) * 100) : 0;
    return `
      <div class="product-card">
        <div class="product-media">
          <img src="${p.image}" alt="${p.name}" loading="lazy">
          ${disc > 0 ? `<span class="prod-badge disc">-${disc}%</span>` : ''}
        </div>
        <div class="prod-body">
          <h3>${p.name}</h3>
          <div class="prod-rating"><span class="stars">${starsHtml(p.rating)}</span> ${p.rating.toFixed(1)} <span style="color:var(--muted)">| ${p.sold.toLocaleString('es-ES')} vend.</span></div>
          <div class="prod-price">${money.format(p.price)}${p.old ? `<span class="old">${money.format(p.old)}</span>` : ''}</div>
          <a href="${waUrl(p)}" target="_blank" class="prod-add">💬 Comprar por WhatsApp</a>
        </div>
      </div>`;
  }).join('');
}

function renderDeals() {
  const top = getProducts().sort((a, b) => b.sold - a.sold).slice(0, 4);
  const section = document.getElementById('featuredDeals');
  if (!top.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  document.getElementById('dealGrid').innerHTML = top.map(p => {
    const disc = p.old ? Math.round((1 - p.price / p.old) * 100) : 0;
    return `
      <div class="deal-card">
        <div class="deal-img">
          <img src="${p.image}" alt="${p.name}" loading="lazy">
          ${disc > 0 ? `<span class="deal-badge disc">-${disc}%</span>` : `<span class="deal-badge hot">Top</span>`}
        </div>
        <div class="deal-body">
          <h3>${p.name}</h3>
          <div class="rating-row"><span class="stars">${starsHtml(p.rating)}</span> ${p.rating.toFixed(1)}</div>
          <div class="price-row">
            <span class="current-price">${money.format(p.price)}</span>
            ${p.old ? `<span class="old-price">${money.format(p.old)}</span>` : ''}
            <span class="sold-count">${p.sold.toLocaleString('es-ES')} vend.</span>
          </div>
          <a href="${waUrl(p)}" target="_blank" class="deal-add">💬 Comprar</a>
        </div>
      </div>`;
  }).join('');
}

function renderFlashBanner() {
  const el = document.getElementById('flashBanner');
  if (!flashSale.enabled || !flashSale.endTime) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.querySelector('.flash-left h2').textContent = '🔥 ' + (flashSale.title || 'Flash Sale');
  el.querySelector('.flash-sub').textContent = flashSale.subtitle || 'Ofertas por tiempo limitado';
}

function renderCouponBar() {
  const el = document.getElementById('couponBar');
  if (!flashSale.couponEnabled) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.querySelector('.coupon-code').textContent = flashSale.couponCode || 'NEX10';
  el.querySelector('p').textContent = flashSale.couponDescription || '10% OFF en tu primer pedido';
}

function updateTimer() {
  const endTime = flashSale.endTime ? new Date(flashSale.endTime).getTime() : 0;
  const diff = Math.max(0, endTime - Date.now());
  if (flashSale.enabled && diff > 0) {
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    document.getElementById('flashHours').textContent = String(h).padStart(2, '0');
    document.getElementById('flashMins').textContent = String(m).padStart(2, '0');
    document.getElementById('flashSecs').textContent = String(s).padStart(2, '0');
  } else {
    document.getElementById('flashHours').textContent = '00';
    document.getElementById('flashMins').textContent = '00';
    document.getElementById('flashSecs').textContent = '00';
  }
  requestAnimationFrame(updateTimer);
}

function connectSSE() {
  const es = new EventSource(API + '/api/sse');
  es.addEventListener('product-added', async () => { await loadProducts(); showToast('Nuevo producto disponible'); });
  es.addEventListener('product-updated', async () => { await loadProducts(); });
  es.addEventListener('product-deleted', async () => { await loadProducts(); });
  es.addEventListener('flashsale-updated', async (e) => { flashSale = JSON.parse(e.data); renderFlashBanner(); renderCouponBar(); });
  es.onerror = () => { setTimeout(connectSSE, 3000); es.close(); };
}

document.addEventListener('click', event => {
  const filter = event.target.closest('[data-category]');
  if (filter) {
    activeCategory = filter.dataset.category;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    filter.classList.add('active');
    renderProducts();
  }
  const catItem = event.target.closest('[data-cat]');
  if (catItem) {
    activeCategory = catItem.dataset.cat;
    document.querySelectorAll('.cat-item').forEach(c => c.classList.remove('active'));
    catItem.classList.add('active');
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    document.querySelector(`.chip[data-category="${activeCategory}"]`)?.classList.add('active');
    renderProducts();
    document.getElementById('productsTop').scrollIntoView({ block: 'start' });
  }
  const scrollBtn = event.target.closest('[data-scroll-products]');
  if (scrollBtn) {
    event.preventDefault();
    document.getElementById('productsTop').scrollIntoView({ block: 'start' });
  }
  const copyBtn = event.target.closest('.copy-btn');
  if (copyBtn) {
    const code = document.querySelector('.coupon-code').textContent;
    navigator.clipboard.writeText(code).then(() => showToast('Cupon copiado: ' + code));
  }
});

document.getElementById('searchInput').addEventListener('input', renderProducts);
document.getElementById('sortSelect').addEventListener('change', renderProducts);
document.getElementById('whatsappFloat').href = WA_BASE + encodeURIComponent('Hola! Quiero informacion sobre productos');

loadProducts();
loadFlashSale();
connectSSE();
updateTimer();
