const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    const init = { products: [], orders: [], flashSale: { enabled: false, title: 'Flash Sale', subtitle: 'Ofertas por tiempo limitado', endTime: '', couponEnabled: false, couponCode: 'NEX10', couponDescription: '10% OFF en tu primer pedido' } };
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
    return init;
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const sseClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(msg);
  }
}

app.get('/api/sse', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  sseClients.add(res);
  const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15000);
  req.on('close', () => { sseClients.delete(res); clearInterval(keepalive); });
});

app.get('/api/products', (req, res) => {
  const db = readDB();
  res.json(db.products);
});

app.post('/api/products', (req, res) => {
  const db = readDB();
  const product = { id: Date.now(), ...req.body, sold: req.body.sold ?? 0, rating: req.body.rating ?? 4.7 };
  db.products.unshift(product);
  writeDB(db);
  broadcast('product-added', product);
  res.json(product);
});

app.put('/api/products/:id', (req, res) => {
  const db = readDB();
  const id = Number(req.params.id);
  const idx = db.products.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.products[idx] = { ...db.products[idx], ...req.body };
  writeDB(db);
  broadcast('product-updated', db.products[idx]);
  res.json(db.products[idx]);
});

app.delete('/api/products/:id', (req, res) => {
  const db = readDB();
  const id = Number(req.params.id);
  db.products = db.products.filter(p => p.id !== id);
  writeDB(db);
  broadcast('product-deleted', { id });
  res.json({ ok: true });
});

app.get('/api/orders', (req, res) => {
  const db = readDB();
  res.json(db.orders);
});

app.post('/api/orders', (req, res) => {
  const db = readDB();
  const order = { id: '#DP-' + Date.now(), status: 'Procesando', ...req.body };
  db.orders.unshift(order);
  writeDB(db);
  broadcast('order-added', order);
  res.json(order);
});

app.put('/api/orders/:id', (req, res) => {
  const db = readDB();
  const id = req.params.id;
  const idx = db.orders.findIndex(o => o.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.orders[idx] = { ...db.orders[idx], ...req.body };
  writeDB(db);
  broadcast('order-updated', db.orders[idx]);
  res.json(db.orders[idx]);
});

app.delete('/api/orders/:id', (req, res) => {
  const db = readDB();
  db.orders = db.orders.filter(o => o.id !== req.params.id);
  writeDB(db);
  broadcast('order-deleted', { id: req.params.id });
  res.json({ ok: true });
});

app.get('/api/flashsale', (req, res) => {
  const db = readDB();
  res.json(db.flashSale || { enabled: false });
});

app.put('/api/flashsale', (req, res) => {
  const db = readDB();
  db.flashSale = { ...db.flashSale, ...req.body };
  writeDB(db);
  broadcast('flashsale-updated', db.flashSale);
  res.json(db.flashSale);
});

app.listen(PORT, () => {
  console.log(`NEXONE server running at http://localhost:${PORT}`);
});
