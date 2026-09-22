# WABAC (WhatsApp Business & AI Commerce) Backend

High-performance, multi-tenant conversational commerce backend powering WhatsApp-first merchant storefronts, automated AI sales agents, real-time catalog & inventory management, automated Paystack payment reconciliation, and platform revenue administration.

---

## 🌟 Architecture & Phases

The system is built in 8 modular phases following domain-driven design, multi-tenant isolation, and resilient architectural standards:

### Phase 1: Base Architecture & Infrastructure
- **Core Server**: Node.js & Express cleanly separated in `server.js` (no root `index.js`).
- **Configuration**: Modularized CORS (`config/corsOptions.js`, `config/allowedOrigins.js`), database connections (`config/db.js`), and environment defaults (`config/config.js`).
- **Middleware**: Centralized Winston logger with morgan integration (`middleware/requestLogger.js`), centralized error handler (`middleware/errorHandler.js`), and 404 router.
- **Validation**: Reusable payload validation schemas and utilities (`utils/validators.js`, `utils/jwt.js`).

### Phase 2: Seller Authentication & Multi-Tenant Business Profiles
- **Authentication**: JWT token generation (`/api/auth/register`, `/api/auth/login`, `/api/auth/me`).
- **Multi-Tenant Protection**: RBAC and tenant authorization guards (`middleware/authMiddleware.js`).
- **Business Profile**: Store profile, WhatsApp connection state, currency, and delivery policies (`/api/business`, `/api/sellers/:id`).

### Phase 3: Product Catalog & Variant Inventory Management
- **Catalog Model**: Products with dynamic variants (size, color), SKU tracking, discount percentages, and Cloudinary media upload hooks (`/api/products`).
- **Isolation**: Automatic seller scoping preventing cross-tenant access, modification, or deletions.
- **Search & Filter**: Keyword search, category filtering, in-stock queries, and public catalog endpoints.

### Phase 4: Order Lifecycle, Stock Deductions & Idempotency
- **Order Processing**: Atomically validates stock, calculates delivery fees, captures unit prices, reserves inventory, and records orders (`/api/orders`).
- **Idempotency**: Header-driven deduplication (`X-Idempotency-Key`) preventing double-charges and double-stock reservation.
- **Customer CRM**: Automatic customer record updates and aggregate lifetime order metrics (`/api/customers`).

### Phase 5: WhatsApp Cloud API Integration & Webhook Auto-Responder
- **Meta Verification**: Hub challenge verification handshake (`GET /api/whatsapp/webhook`).
- **Event Handling**: Inbound message receiver (`POST /api/whatsapp/incoming` & `POST /api/whatsapp/webhook`).
- **Conversational Memory**: Customer message transcripts, conversation threading, and outbound message dispatch (`/api/whatsapp/messages`, `/api/whatsapp/send`).

### Phase 6: AI Conversational Sales Agent (OpenAI & Function Tools)
- **Zero-Hallucination Tools**:
  - `searchProducts`: Natural language query matching against seller's live catalog.
  - `getProduct`: Detailed variant and price lookup.
  - `checkStock`: Authoritative stock availability check.
  - `getBusinessInformation`: Operating hours, delivery areas, fees, and contact info.
  - `calculateOrderTotal`: Authoritative calculation of items, discounts, and delivery fees.
  - `createOrder`: Safe order creation with customer details and line items.
  - `getOrder`: Real-time order status tracking.
  - `createPayment`: Paystack link generation for confirmed orders.
- **Orchestration**: `services/ai/aiService.js` with iterative tool execution loop and deterministic fallback agent when API keys are absent.
- **AI Chat Endpoint**: `POST /api/ai/chat`.

### Phase 7: Paystack Payments & Automated Reconciliation
- **Payment Initialization**: Initializes transactions with dynamic revenue splitting (Platform Commission + Paystack Fee + Seller Payout) (`POST /api/payments/initialize`).
- **Verification & Reconciler**: Verifies references and automatically marks orders as `Paid`, triggering seller notification (`POST /api/payments/verify/:reference`).
- **Webhook Handshake**: Cryptographic HMAC-SHA512 signature verification for automated webhook callbacks (`POST /api/payments/webhook`).

### Phase 8: Platform Revenue Tracking & Admin Dashboard
- **Platform Analytics**: Global KPIs covering Total Sellers, Active Sellers, Platform Revenue, Total Orders, and Gross Merchandise Value (`GET /api/admin/stats`).
- **Seller Management**: Listing, auditing, and toggling seller suspension (`GET /api/admin/sellers`, `PATCH /api/admin/sellers/:id/status`).
- **Revenue Ledger**: Detailed commission breakdown and transaction history (`GET /api/admin/revenue`).
- **Dynamic Fee Configuration**: Configurable platform percentage and fixed cut engine (`GET /api/admin/fee`, `PATCH /api/admin/fee`).

---

## 🛠️ API Routes Overview

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/health` / `/api/health` | Service health status | Public |
| `POST` | `/api/auth/register` | Register new seller account | Public |
| `POST` | `/api/auth/login` | Authenticate seller or admin | Public |
| `GET` | `/api/auth/me` | Fetch authenticated seller profile | Bearer Token |
| `GET` | `/api/business` | Get seller's business configuration | Bearer Token |
| `PATCH` | `/api/business` | Update business settings & policies | Bearer Token |
| `GET` | `/api/sellers/:id` | Public storefront profile | Public |
| `GET` | `/api/products` | Search/list seller products (or public) | Optional / Bearer |
| `POST` | `/api/products` | Create product with variants | Bearer Token |
| `PATCH` | `/api/products/:id` | Update product details | Bearer Token |
| `DELETE`| `/api/products/:id` | Remove product from catalog | Bearer Token |
| `POST` | `/api/orders` | Create customer order (idempotent) | Bearer Token |
| `GET` | `/api/orders` | List seller orders | Bearer Token |
| `PATCH` | `/api/orders/:id/status`| Update order status | Bearer Token |
| `GET` | `/api/customers` | Seller customer list & metrics | Bearer Token |
| `GET` | `/api/whatsapp/webhook` | Meta verification handshake | Public |
| `POST` | `/api/whatsapp/webhook` | Meta inbound webhook events | Public |
| `POST` | `/api/whatsapp/incoming`| Process inbound WhatsApp message | Public / Webhook |
| `POST` | `/api/whatsapp/send` | Dispatch outbound WhatsApp message | Bearer Token |
| `GET` | `/api/whatsapp/conversations`| Get conversation threads | Bearer Token |
| `GET` | `/api/whatsapp/messages`| Get customer message transcript | Bearer Token |
| `POST` | `/api/ai/chat` | AI Conversational Sales Agent chat | Bearer Token |
| `POST` | `/api/payments/initialize` | Initialize Paystack payment | Bearer Token |
| `POST` | `/api/payments/verify/:reference` | Verify payment & reconcile order | Bearer Token |
| `POST` | `/api/payments/webhook` | Paystack automated webhook | Signature Verified |
| `GET` | `/api/admin/stats` | Platform performance KPIs | Admin Only |
| `GET` | `/api/admin/sellers` | Manage platform sellers | Admin Only |
| `PATCH` | `/api/admin/sellers/:id/status`| Suspend or activate seller | Admin Only |
| `GET` | `/api/admin/revenue` | Platform revenue & commission ledger| Admin Only |
| `GET` | `/api/admin/fee` | Get platform fee configuration | Admin Only |
| `PATCH` | `/api/admin/fee` | Update platform commission rate | Admin Only |

---

## 🧪 Testing

The repository contains end-to-end automated integration tests for all 8 phases.

Run the complete test suite:
```bash
npm test
```

Run individual phases:
```bash
node tests/phase1.test.js
node tests/phase2.test.js
node tests/phase3.test.js
node tests/phase4.test.js
node tests/phase5.test.js
node tests/phase6.test.js
node tests/phase7.test.js
node tests/phase8.test.js
```

---

## 🚀 Environment Variables

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Key environment configurations:
- `PORT`: Server port (default: `5000`)
- `NODE_ENV`: `development` or `production`
- `JWT_SECRET`: Secret key for JWT auth tokens
- `MONGODB_URI`: MongoDB connection URI (optional; automated in-memory store active when offline)
- `OPENAI_API_KEY`: OpenAI API key for conversational agent
- `PAYSTACK_SECRET_KEY`: Paystack secret key for checkout & webhook verification
- `WHATSAPP_VERIFY_TOKEN`: WhatsApp webhook verification token
- `WHATSAPP_TOKEN`: WhatsApp Cloud API Bearer access token
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`: Cloud media uploads
