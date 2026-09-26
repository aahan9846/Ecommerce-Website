// server.js
// Express backend for the store: JWT auth with roles (user/admin), a
// product catalog, checkout that turns a cart into an order, and
// role-gated order management for admins.
//
// Run locally:  npm install && npm run seed && npm start
// Then visit:   http://localhost:3000

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('./db');
const { requireAuth, requireAdmin, JWT_SECRET } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function toProductView(row) {
  return { ...row, price: row.price_cents / 100 };
}

// ===================== Auth =====================
// Public registration always creates a 'user' role account — admin
// accounts are created via the seed script, not through this endpoint,
// so a visitor can't grant themselves admin access.

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const password_hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email.toLowerCase(), password_hash, 'user');

  const user = { id: info.lastInsertRowid, name, email: email.toLowerCase(), role: 'user' };
  res.status(201).json({ token: signToken(user), user });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }

  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  res.json({ token: signToken(user), user });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ===================== Products (catalog) =====================
// Reads are public (it's a storefront); writes require an admin token.

app.get('/api/products', (req, res) => {
  const { category } = req.query;
  const rows = category
    ? db.prepare('SELECT * FROM products WHERE category = ? ORDER BY id DESC').all(category)
    : db.prepare('SELECT * FROM products ORDER BY id DESC').all();
  res.json(rows.map(toProductView));
});

app.get('/api/products/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Product not found.' });
  res.json(toProductView(row));
});

app.post('/api/products', requireAuth, requireAdmin, (req, res) => {
  const { name, description, price, category, stock, image_color } = req.body;
  if (!name || price == null) {
    return res.status(400).json({ error: 'name and price are required.' });
  }
  const info = db
    .prepare(`
      INSERT INTO products (name, description, price_cents, category, stock, image_color)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(name, description || '', Math.round(price * 100), category || 'General', stock || 0, image_color || '#1F3AED');

  const created = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(toProductView(created));
});

app.put('/api/products/:id', requireAuth, requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });

  const body = req.body;
  const merged = {
    id: existing.id,
    name: body.name ?? existing.name,
    description: body.description ?? existing.description,
    price_cents: body.price != null ? Math.round(body.price * 100) : existing.price_cents,
    category: body.category ?? existing.category,
    stock: body.stock ?? existing.stock,
    image_color: body.image_color ?? existing.image_color
  };

  db.prepare(`
    UPDATE products SET name=@name, description=@description, price_cents=@price_cents,
      category=@category, stock=@stock, image_color=@image_color
    WHERE id=@id
  `).run(merged);

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(existing.id);
  res.json(toProductView(updated));
});

app.delete('/api/products/:id', requireAuth, requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Product not found.' });
  res.status(204).end();
});

// ===================== Orders (checkout & tracking) =====================

// Checkout: client sends [{ product_id, quantity }, ...]. Prices and stock
// are re-read from the database server-side — the client never dictates
// the price it pays.
app.post('/api/orders', requireAuth, (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array of { product_id, quantity }.' });
  }

  const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
  const resolved = [];
  for (const item of items) {
    const product = getProduct.get(item.product_id);
    if (!product) return res.status(400).json({ error: `Product ${item.product_id} does not exist.` });
    const quantity = Number(item.quantity) || 0;
    if (quantity <= 0) return res.status(400).json({ error: `Invalid quantity for ${product.name}.` });
    if (product.stock < quantity) {
      return res.status(409).json({ error: `Not enough stock for "${product.name}" (${product.stock} left).` });
    }
    resolved.push({ product, quantity });
  }

  const total_cents = resolved.reduce((sum, r) => sum + r.product.price_cents * r.quantity, 0);

  const createOrder = db.transaction(() => {
    const orderInfo = db
      .prepare('INSERT INTO orders (user_id, status, total_cents) VALUES (?, ?, ?)')
      .run(req.user.id, 'paid', total_cents);

    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity)
      VALUES (?, ?, ?, ?, ?)
    `);
    const decrementStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');

    for (const { product, quantity } of resolved) {
      insertItem.run(orderInfo.lastInsertRowid, product.id, product.name, product.price_cents, quantity);
      decrementStock.run(quantity, product.id);
    }

    return orderInfo.lastInsertRowid;
  });

  const orderId = createOrder();
  res.status(201).json(getOrderWithItems(orderId));
});

function getOrderWithItems(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  return { ...order, total: order.total_cents / 100, items: items.map((i) => ({ ...i, unit_price: i.unit_price_cents / 100 })) };
}

// Current user's own orders.
app.get('/api/orders', requireAuth, (req, res) => {
  const orders = db.prepare('SELECT id FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  res.json(orders.map((o) => getOrderWithItems(o.id)));
});

app.get('/api/orders/:id', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not your order.' });
  }
  res.json(getOrderWithItems(order.id));
});

// --- Admin: view and manage every order ---
app.get('/api/admin/orders', requireAuth, requireAdmin, (req, res) => {
  const orders = db.prepare(`
    SELECT orders.*, users.name AS customer_name, users.email AS customer_email
    FROM orders JOIN users ON users.id = orders.user_id
    ORDER BY orders.id DESC
  `).all();
  res.json(orders.map((o) => ({ ...getOrderWithItems(o.id), customer_name: o.customer_name, customer_email: o.customer_email })));
});

app.patch('/api/admin/orders/:id/status', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.body;
  const valid = ['pending', 'paid', 'shipped', 'cancelled'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` });
  }
  const info = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Order not found.' });
  res.json(getOrderWithItems(req.params.id));
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Store server running at http://localhost:${PORT}`);
});
