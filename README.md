# KitSetups Backend

Market scanning and trade setup engine for cryptocurrencies (Bybit perpetuals).

## Quick Start

### Prerequisites
- Node.js 18+
- Firebase project with service account
- Bybit API access

### Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Firebase service account (base64-encoded)
   ```

3. **Start server**
   ```bash
   npm start
   ```
   Server runs on `http://localhost:8787`

## Architecture

### Trading Engine Pipeline

```
Market Data (Bybit OHLC + Ticker)
  ↓
Context Analysis (timeframe bias)
  ↓
Structure Analysis (swings, breaks, hierarchy)
  ↓
Liquidity Analysis (directional levels)
  ↓
Momentum Analysis (ROC, pressure, expansion)
  ↓
Setup Detection (all conditions met?)
  ↓
Entry Calculation (structural entry zone)
  ↓
Stop Calculation (structural invalidation)
  ↓
Targets Calculation (liquidity-based objectives, min 2R)
  ↓
Quality Scoring (A+/A/B/C grade)
  ↓
Final Setup (READY) or Rejection (WAIT)
```

### Scanner Loop

- Runs every 5 minutes
- Analyzes symbol universe via trading engine
- Publishes READY signals to Firestore `signals/latest`
- Tracks lifecycle state in Firestore `lifecycle/{setupId}`

### API Endpoints

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|----------|
| GET | `/health` | No | Health check |
| GET | `/api/auth/me` | Yes | Authenticated user info |
| GET | `/api/account` | Yes | Account + access state |
| GET | `/api/signals` | Yes | Current signals snapshot |
| GET | `/api/signalHistory` | Yes | Historical signals |
| GET | `/api/analysis?symbol=X` | Yes | Live market analysis |
| POST | `/api/auth/register` | Yes | Create account |
| GET/POST/DELETE | `/api/developer/key` | Yes | Manage API keys |

### Firestore Schema

```
collections:
  signals/
    latest          ← Current published signals
    {setupId}/...   ← Historical signals
  
  users/
    {uid}/          ← User account + plan info
  
  lifecycle/
    {setupId}/      ← Trade state (READY → ENTRY → ACTIVE → TP1/2/3 → CLOSED)
  
  apiKeys/
    {userId}/...    ← Developer API keys
```

## Environment Variables

See `.env.example` for complete reference.

**Required:**
- `FIREBASE_SERVICE_ACCOUNT_BASE64` — Firebase admin credentials (base64)

**Optional:**
- `PORT` — HTTP server port (default: 8787)
- `FRONTEND_URL` — CORS origin (default: *)
- `NODE_ENV` — Environment (development/production)

## Development

### Run in watch mode
```bash
npm run dev
```

### Run tests
```bash
npm test
```

### Run scanner once
```bash
node src/scanner/runner.js
```

## Deployment

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src ./src
EXPOSE 8787
CMD ["npm", "start"]
```

### Environment (Production)
```bash
FIREBASE_SERVICE_ACCOUNT_BASE64=<base64-json>
PORT=8787
FRONTEND_URL=https://kitsetups.xyz
NODE_ENV=production
```

### Firestore Security Rules

See `firestore.rules` for recommended security configuration.

## Trading Logic

### Setup Detection Requirements

A setup is published only when ALL conditions pass:

1. **Directional Bias**: Macro AND primary timeframes agree, OR primary has structural break
2. **Structural Support**: 4H OR 1H structure confirms direction
3. **Execution Confirmation**: 30M structure confirmed OR valid break of structure
4. **Liquidity**: Directional liquidity exists

### Entry Rules

- **LONG**: Price within structural high/low, not extended above
- **SHORT**: Price within structural high/low, not extended below
- Prefers 30M structure; falls back to 1H

### Stop Rules

- **LONG**: Below structural low (protected low) + 0.05% buffer
- **SHORT**: Above structural high (protected high) + 0.05% buffer
- Minimum distance from entry: 0.10%

### Target Rules

- Collected from internal directional liquidity
- First target MUST provide ≥ 2.0R
- Up to 3 targets selected (TP1, TP2, TP3)
- Based on market structure, never invented

## Lifecycle States

```
READY
  ├─→ ENTRY_HIT → ACTIVE → TP1_HIT → TP2_HIT → TP3_HIT → CLOSED (WIN)
  └─→ MISSED (target reached before entry)
       ↓
      STOP_LOSS → CLOSED (LOSS)
```

## Troubleshooting

### "Invalid FIREBASE_SERVICE_ACCOUNT_BASE64"
- Ensure JSON is properly base64-encoded: `cat file.json | base64 -w 0`
- Service account must include: `project_id`, `client_email`, `private_key`

### "Bybit API timeout"
- Check internet connection
- Verify Bybit API status
- Check rate limits (default: 10 requests/sec)

### Signals not publishing
- Check scanner log output
- Verify Firestore permissions
- Ensure symbol universe is populated

## Support

For issues or questions, open an issue on GitHub.
