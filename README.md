# E-Commerce Web Application

A full-stack storefront: a product catalog with categories, a client-side
cart, server-validated checkout, role-based access (admin vs. regular
user), and an admin panel for managing products and order status.

```
ecommerce-project/
├── public/                 frontend (served as static files)
│   ├── index.html           auth, storefront, cart, orders, admin panel
│   ├── style.css
│   └── script.js
├── middleware/
│   └── auth.js               JWT verification + admin-role guard
├── server.js                 Express app + REST API
├── db.js                     SQLite connection + schema
├── seed.js                   starter products + a default admin account
├── package.json
└── .env.example
```

## 1. Run it locally

Requires Node.js 18+.

```bash
npm install
cp .env.example .env      # then edit JWT_SECRET to your own secret
npm run seed                # loads starter products + a demo admin account
npm start
```

Visit **http://localhost:3000**.

- Sign up for a regular account to shop, add items to the cart, and check out.
- Log in as the seeded admin to manage products and update order status:
  **admin@example.com / admin12345** — change this password (or delete
  and re-seed with your own) before using this anywhere real.

For auto-restart on file changes during development:

```bash
npm run dev
```

## 2. How the pieces fit together

- **Frontend** (`public/`) is plain HTML/CSS/JS — no build step. The cart
  lives in `localStorage` until checkout; everything else is fetched from
  the API. The Admin nav item only appears when the logged-in user's role
  is `admin`.
- **Backend** (`server.js`) is an Express app serving the frontend and a
  JSON REST API under `/api/*`.
- **Auth & roles**: passwords are hashed with `bcryptjs`. Public
  registration always creates a `user`-role account — there's no API path
  for a visitor to grant themselves `admin`, so admin accounts only come
  from the seed script (or by promoting a user directly in the database).
  `requireAuth` verifies the JWT; `requireAdmin` (chained after it) checks
  `role === 'admin'` before allowing product writes or order management.
- **Checkout is server-validated**: the client only sends product IDs and
  quantities. The server re-reads current prices and stock from the
  database and rejects the order if stock is insufficient — the client
  can never dictate what it pays.
- **Database** (`db.js`) is SQLite via `better-sqlite3`: `users`,
  `products`, `orders`, and `order_items` (which snapshots the product
  name and price at time of purchase, so later edits to a product don't
  rewrite order history).

## 3. API reference

| Method | Route                          | Auth        | Description                          |
|--------|---------------------------------|-------------|----------------------------------------|
| POST   | `/api/auth/register`            | —           | Create a `user`-role account           |
| POST   | `/api/auth/login`                | —           | Log in, returns a token                |
| GET    | `/api/auth/me`                   | token       | Get the current user                   |
| GET    | `/api/products`                  | —           | List products (`?category=` to filter) |
| GET    | `/api/products/:id`              | —           | Get one product                        |
| POST   | `/api/products`                  | admin       | Create a product                       |
| PUT    | `/api/products/:id`              | admin       | Update a product                       |
| DELETE | `/api/products/:id`              | admin       | Delete a product                       |
| POST   | `/api/orders`                    | token       | Checkout: `{ items: [{product_id, quantity}] }` |
| GET    | `/api/orders`                    | token       | List the current user's orders         |
| GET    | `/api/orders/:id`                | token       | Get one order (owner or admin)         |
| GET    | `/api/admin/orders`              | admin       | List every order, with customer info   |
| PATCH  | `/api/admin/orders/:id/status`   | admin       | Update status: pending/paid/shipped/cancelled |
| GET    | `/api/health`                    | —           | Health check (used by hosts)           |

Example — check out as a logged-in user:

```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"items":[{"product_id":1,"quantity":2},{"product_id":3,"quantity":1}]}'
```

## 4. Deploying

This app needs a **persistent Node process** (not a static host), because
it runs Express and reads/writes a SQLite file.

### Option A — Render (recommended, simplest)
1. Push this project to a GitHub repo.
2. On [render.com](https://render.com), create a **New Web Service** from
   that repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add an environment variable `JWT_SECRET` with your own secret. Run the
   seed step once via Render's shell (`npm run seed`) or add it to the
   build command.
5. Deploy. Render gives you a live URL.

### Option B — Railway
Same idea: connect the repo, set `JWT_SECRET`, it detects `npm start`
automatically.

### Netlify / Vercel note
These platforms are built for static sites and serverless functions, not
a long-running Express server with a local SQLite file. To deploy there,
you'd deploy `public/` as the static site and rewrite `server.js`'s
routes as serverless functions backed by a hosted database — e.g.
**Neon** or **Supabase** for Postgres, or **MongoDB Atlas** for Mongo —
instead of SQLite.

## 5. Swapping the database

All database access is isolated in `db.js`, and every query in
`server.js` goes through it. To move to PostgreSQL or MySQL:
1. Replace `db.js` with a client for that database (e.g. `pg` or
   `mysql2`), keeping the same four tables (`users`, `products`,
   `orders`, `order_items`).
2. Update the queries in `server.js`'s route handlers to match — route
   paths, request/response shapes, and the frontend don't need to change.
