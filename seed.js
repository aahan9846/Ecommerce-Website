// seed.js
// Populates starter products and a default admin account so the store
// isn't empty on first run. Run with: npm run seed

const bcrypt = require('bcryptjs');
const db = require('./db');

const productCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;

if (productCount === 0) {
  const insert = db.prepare(`
    INSERT INTO products (name, description, price_cents, category, stock, image_color)
    VALUES (@name, @description, @price_cents, @category, @stock, @image_color)
  `);

  const products = [
    { name: 'Field Notebook', description: 'Dot-grid pages, stitched binding, fits a back pocket.', price_cents: 1200, category: 'Stationery', stock: 40, image_color: '#1F3AED' },
    { name: 'Ceramic Pour-Over Set', description: 'Hand-glazed dripper and mug, holds heat well.', price_cents: 3400, category: 'Kitchen', stock: 15, image_color: '#0FA968' },
    { name: 'Canvas Tote', description: 'Heavyweight cotton canvas, reinforced straps.', price_cents: 1800, category: 'Bags', stock: 60, image_color: '#D64545' },
    { name: 'Desk Lamp — Brass', description: 'Adjustable arm, warm 2700K bulb included.', price_cents: 5600, category: 'Home', stock: 8, image_color: '#B4872A' },
    { name: 'Wool Beanie', description: 'Merino wool, one size, six colorways.', price_cents: 2200, category: 'Apparel', stock: 25, image_color: '#8A3B54' },
    { name: 'Enamel Mug', description: 'Camp-style enamel mug, 12oz.', price_cents: 900, category: 'Kitchen', stock: 0, image_color: '#0FA968' }
  ];

  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });
  insertMany(products);
  console.log(`Seeded ${products.length} products.`);
}

const adminEmail = 'admin@example.com';
const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);

if (!existingAdmin) {
  const password_hash = bcrypt.hashSync('admin12345', 10);
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
    'Store Admin',
    adminEmail,
    password_hash,
    'admin'
  );
  console.log(`Seeded admin account — email: ${adminEmail}  password: admin12345`);
  console.log('Change this password after your first login.');
}

console.log('Seed complete.');
