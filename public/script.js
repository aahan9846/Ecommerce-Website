// script.js — auth flow, storefront rendering, cart/checkout, and the admin panel.

const el = (id) => document.getElementById(id);

let token = localStorage.getItem('token');
let currentUser = null;
let allProducts = [];
let activeCategory = 'All';
let cart = JSON.parse(localStorage.getItem('cart') || '[]');

// ===================== Boot =====================

(async function init() {
  if (token) {
    const ok = await fetchMe();
    if (ok) {
      showApp();
      await loadProducts();
      updateCartUI();
      return;
    }
  }
  showAuth();
})();

// ===================== API helper =====================

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ===================== Auth =====================

el('auth-toggle').addEventListener('click', () => {
  const showingLogin = !el('login-form').classList.contains('hidden');
  el('login-form').classList.toggle('hidden', showingLogin);
  el('register-form').classList.toggle('hidden', !showingLogin);
  el('auth-title').textContent = showingLogin ? 'Create your account' : 'Welcome back';
  el('auth-toggle').textContent = showingLogin ? 'Already have an account? Log in' : 'Need an account? Sign up';
});

el('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('login-error').textContent = '';
  try {
    const res = await api('/api/auth/login', 'POST', {
      email: el('login-email').value.trim(),
      password: el('login-password').value
    });
    onAuthed(res);
  } catch (err) {
    el('login-error').textContent = err.message;
  }
});

el('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('register-error').textContent = '';
  try {
    const res = await api('/api/auth/register', 'POST', {
      name: el('register-name').value.trim(),
      email: el('register-email').value.trim(),
      password: el('register-password').value
    });
    onAuthed(res);
  } catch (err) {
    el('register-error').textContent = err.message;
  }
});

el('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('token');
  token = null;
  currentUser = null;
  showAuth();
});

async function onAuthed({ token: t, user }) {
  token = t;
  currentUser = user;
  localStorage.setItem('token', t);
  showApp();
  await loadProducts();
  updateCartUI();
}

async function fetchMe() {
  try {
    const res = await api('/api/auth/me');
    currentUser = res.user;
    return true;
  } catch {
    localStorage.removeItem('token');
    token = null;
    return false;
  }
}

function showAuth() {
  el('auth-screen').classList.remove('hidden');
  el('app-screen').classList.add('hidden');
}

function showApp() {
  el('auth-screen').classList.add('hidden');
  el('app-screen').classList.remove('hidden');
  el('user-name').textContent = currentUser ? `${currentUser.name} (${currentUser.role})` : '';
  el('admin-nav-btn').classList.toggle('hidden', currentUser?.role !== 'admin');
}

// ===================== View switching =====================

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchView(view) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  el(`view-${view}`).classList.remove('hidden');
  if (view === 'orders') loadOrders();
  if (view === 'admin') {
    loadAdminProducts();
    loadAdminOrders();
  }
}

document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.admin-tab').forEach((t) => t.classList.add('hidden'));
    el(btn.dataset.tab).classList.remove('hidden');
  });
});

// ===================== Catalog =====================

async function loadProducts() {
  try {
    allProducts = await api('/api/products');
    renderCategoryChips();
    renderProductGrid();
  } catch (err) {
    el('product-grid').innerHTML = '<p class="loading">Couldn\'t load products right now.</p>';
  }
}

function renderCategoryChips() {
  const categories = ['All', ...new Set(allProducts.map((p) => p.category))];
  el('category-chips').innerHTML = categories
    .map((c) => `<button class="chip ${c === activeCategory ? 'active' : ''}" data-cat="${escapeAttr(c)}">${escapeHtml(c)}</button>`)
    .join('');
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      activeCategory = chip.dataset.cat;
      renderCategoryChips();
      renderProductGrid();
    });
  });
}

function renderProductGrid() {
  const list = activeCategory === 'All' ? allProducts : allProducts.filter((p) => p.category === activeCategory);
  if (list.length === 0) {
    el('product-grid').innerHTML = '<p class="loading">No products in this category.</p>';
    return;
  }
  el('product-grid').innerHTML = list.map(renderProductCard).join('');
  document.querySelectorAll('.add-to-cart-btn').forEach((btn) => {
    btn.addEventListener('click', () => addToCart(Number(btn.dataset.id)));
  });
}

function renderProductCard(p) {
  const inCart = cart.find((c) => c.product_id === p.id)?.quantity || 0;
  const available = p.stock - inCart;
  return `
    <div class="product-card">
      <div class="product-swatch" style="background:${p.image_color}">${escapeHtml(p.name[0] || '?')}</div>
      <h3>${escapeHtml(p.name)}</h3>
      <p class="desc">${escapeHtml(p.description)}</p>
      <div class="product-row">
        <span class="price">${formatPrice(p.price)}</span>
        <span class="stock-tag ${p.stock > 0 ? 'in' : 'out'}">${p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'}</span>
      </div>
      <button class="add-to-cart-btn" data-id="${p.id}" ${available <= 0 ? 'disabled' : ''}>
        ${available <= 0 ? 'Unavailable' : 'Add to cart'}
      </button>
    </div>
  `;
}

// ===================== Cart =====================

function addToCart(productId) {
  const product = allProducts.find((p) => p.id === productId);
  if (!product) return;
  const existing = cart.find((c) => c.product_id === productId);
  const currentQty = existing ? existing.quantity : 0;
  if (currentQty >= product.stock) return;

  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ product_id: product.id, name: product.name, price: product.price, image_color: product.image_color, quantity: 1, stock: product.stock });
  }
  saveCart();
  updateCartUI();
  renderProductGrid();
}

function changeQty(productId, delta) {
  const item = cart.find((c) => c.product_id === productId);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) {
    cart = cart.filter((c) => c.product_id !== productId);
  } else if (item.quantity > item.stock) {
    item.quantity = item.stock;
  }
  saveCart();
  updateCartUI();
  renderProductGrid();
}

function removeFromCart(productId) {
  cart = cart.filter((c) => c.product_id !== productId);
  saveCart();
  updateCartUI();
  renderProductGrid();
}

function saveCart() {
  localStorage.setItem('cart', JSON.stringify(cart));
}

function updateCartUI() {
  el('cart-count').textContent = cart.reduce((sum, c) => sum + c.quantity, 0);

  if (cart.length === 0) {
    el('cart-items').innerHTML = '<p class="loading">Your cart is empty.</p>';
  } else {
    el('cart-items').innerHTML = cart
      .map(
        (c) => `
      <div class="cart-item">
        <div class="cart-item-swatch" style="background:${c.image_color}"></div>
        <div class="cart-item-info">
          <h4>${escapeHtml(c.name)}</h4>
          <span class="price">${formatPrice(c.price * c.quantity)}</span>
          <div class="cart-item-controls">
            <button class="qty-btn" data-action="dec" data-id="${c.product_id}">−</button>
            <span>${c.quantity}</span>
            <button class="qty-btn" data-action="inc" data-id="${c.product_id}">+</button>
            <button class="remove-item-btn" data-action="remove" data-id="${c.product_id}">Remove</button>
          </div>
        </div>
      </div>
    `
      )
      .join('');

    el('cart-items').querySelectorAll('[data-action]').forEach((btn) => {
      const id = Number(btn.dataset.id);
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'inc') changeQty(id, 1);
        if (btn.dataset.action === 'dec') changeQty(id, -1);
        if (btn.dataset.action === 'remove') removeFromCart(id);
      });
    });
  }

  const total = cart.reduce((sum, c) => sum + c.price * c.quantity, 0);
  el('cart-total').textContent = formatPrice(total);
}

el('cart-btn').addEventListener('click', () => el('cart-drawer').classList.remove('hidden'));
el('close-cart-btn').addEventListener('click', () => el('cart-drawer').classList.add('hidden'));
el('cart-backdrop').addEventListener('click', () => el('cart-drawer').classList.add('hidden'));

el('checkout-btn').addEventListener('click', async () => {
  const status = el('checkout-status');
  status.textContent = '';
  if (cart.length === 0) {
    status.textContent = 'Your cart is empty.';
    return;
  }
  if (!token) {
    status.textContent = 'Please log in to check out.';
    return;
  }
  try {
    await api('/api/orders', 'POST', { items: cart.map((c) => ({ product_id: c.product_id, quantity: c.quantity })) });
    cart = [];
    saveCart();
    updateCartUI();
    el('cart-drawer').classList.add('hidden');
    await loadProducts(); // refresh stock levels
    switchView('orders');
  } catch (err) {
    status.textContent = err.message;
    await loadProducts(); // in case the error was a stock conflict
  }
});

// ===================== Orders (customer) =====================

async function loadOrders() {
  const list = el('orders-list');
  list.innerHTML = '<p class="loading">Loading orders…</p>';
  try {
    const orders = await api('/api/orders');
    if (orders.length === 0) {
      list.innerHTML = '<p class="loading">No orders yet — anything in your cart is waiting for checkout.</p>';
      return;
    }
    list.innerHTML = orders.map(renderOrderCard).join('');
  } catch (err) {
    list.innerHTML = '<p class="loading">Couldn\'t load orders right now.</p>';
  }
}

function renderOrderCard(o) {
  return `
    <div class="order-card">
      <div class="order-head">
        <h3>Order #${o.id}</h3>
        <span class="status-tag status-${o.status}">${o.status}</span>
      </div>
      <p class="order-meta">${formatDate(o.created_at)} · ${formatPrice(o.total)}</p>
      <ul class="order-items">
        ${o.items.map((i) => `<li><span>${i.quantity} × ${escapeHtml(i.product_name)}</span><span>${formatPrice(i.unit_price * i.quantity)}</span></li>`).join('')}
      </ul>
    </div>
  `;
}

// ===================== Admin: products =====================

async function loadAdminProducts() {
  const tbody = el('admin-product-rows');
  tbody.innerHTML = '<tr><td colspan="5" class="loading">Loading…</td></tr>';
  try {
    const products = await api('/api/products');
    tbody.innerHTML = products
      .map(
        (p) => `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.category)}</td>
        <td>${formatPrice(p.price)}</td>
        <td>${p.stock}</td>
        <td><button class="row-link" data-id="${p.id}">Edit</button></td>
      </tr>
    `
      )
      .join('');
    tbody.querySelectorAll('.row-link').forEach((btn) => {
      btn.addEventListener('click', () => openProductModal(Number(btn.dataset.id)));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading">Couldn't load products.</td></tr>`;
  }
}

el('new-product-btn').addEventListener('click', () => openProductModal(null));
el('cancel-product-btn').addEventListener('click', closeProductModal);

function openProductModal(id) {
  const product = id ? allProducts.find((p) => p.id === id) : null;
  el('product-modal-title').textContent = product ? 'Edit product' : 'New product';
  el('product-id').value = product ? product.id : '';
  el('product-name').value = product ? product.name : '';
  el('product-description').value = product ? product.description : '';
  el('product-price').value = product ? product.price : '';
  el('product-stock').value = product ? product.stock : '';
  el('product-category').value = product ? product.category : '';
  el('delete-product-btn').classList.toggle('hidden', !product);
  el('product-modal').classList.remove('hidden');
  el('product-name').focus();
}

function closeProductModal() {
  el('product-modal').classList.add('hidden');
  el('product-form').reset();
}

el('product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = el('product-id').value;
  const payload = {
    name: el('product-name').value.trim(),
    description: el('product-description').value.trim(),
    price: parseFloat(el('product-price').value),
    stock: parseInt(el('product-stock').value, 10),
    category: el('product-category').value.trim()
  };
  try {
    if (id) {
      await api(`/api/products/${id}`, 'PUT', payload);
    } else {
      await api('/api/products', 'POST', payload);
    }
    closeProductModal();
    await loadProducts();
    await loadAdminProducts();
  } catch (err) {
    alert(err.message);
  }
});

el('delete-product-btn').addEventListener('click', async () => {
  const id = el('product-id').value;
  if (!id || !confirm('Delete this product?')) return;
  try {
    await api(`/api/products/${id}`, 'DELETE');
    closeProductModal();
    await loadProducts();
    await loadAdminProducts();
  } catch (err) {
    alert(err.message);
  }
});

el('product-modal').addEventListener('click', (e) => {
  if (e.target === el('product-modal')) closeProductModal();
});

// ===================== Admin: orders =====================

async function loadAdminOrders() {
  const tbody = el('admin-order-rows');
  tbody.innerHTML = '<tr><td colspan="4" class="loading">Loading…</td></tr>';
  try {
    const orders = await api('/api/admin/orders');
    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="loading">No orders yet.</td></tr>';
      return;
    }
    tbody.innerHTML = orders
      .map(
        (o) => `
      <tr>
        <td>#${o.id}</td>
        <td>${escapeHtml(o.customer_name)}<br><span class="loading">${escapeHtml(o.customer_email)}</span></td>
        <td>${formatPrice(o.total)}</td>
        <td>
          <select class="status-select" data-id="${o.id}">
            ${['pending', 'paid', 'shipped', 'cancelled'].map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </td>
      </tr>
    `
      )
      .join('');
    tbody.querySelectorAll('.status-select').forEach((select) => {
      select.addEventListener('change', async () => {
        try {
          await api(`/api/admin/orders/${select.dataset.id}/status`, 'PATCH', { status: select.value });
        } catch (err) {
          alert(err.message);
          loadAdminOrders();
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="loading">Couldn't load orders.</td></tr>`;
  }
}

// ===================== Helpers =====================

function formatPrice(n) {
  return `$${Number(n).toFixed(2)}`;
}
function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str = '') {
  return escapeHtml(str);
}
