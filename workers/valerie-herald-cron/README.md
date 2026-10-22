# Valerie Autonomous Herald Cloudflare Cron Worker

## Overview
Automated edge-native cron worker for **Project Valerie** that periodically harvests real breaking news events, computes cross-source controversy dispersion, and dispatches high-variance story clusters to the `valerie-herald-agent` Edge Function for adversarial de-spinning and publication into `valerie.polls`.

## Ingestion Architecture

```
[ GDELT 2.0 API ] ──┐
                     ├──> [ Clustering & Dispersion Engine ]
[ Multi-Source RSS ] ┘       - Groups articles by keyword similarity
                             - Computes sentiment dispersion (variance >= 0.27)
                             - Extracts geographic scope tier (LOCAL/STATE/NATL)
                                     │
                                     ▼
                     [ valerie-herald-agent (Supabase Edge) ]
                             - Adversarial IRT Decomposition (3 Axes)
                             - Cynic Referee Partisan Audit
                             - SHA-256 Tooltip Cache Warming
                             - Auto-Publishes to valerie.polls
```

## Schedule
Configured in `wrangler.jsonc`:
```
0 */2 * * * (Every 2 hours)
```

## Security & Access Control
- All communication with `valerie-herald-agent` is authenticated via `x-cron-secret` matching `CRON_SECRET` or `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.
- Manual on-demand triggers (`POST /trigger`) are strictly guarded by `TRIGGER_SECRET`.
- Sensitive tokens, API keys, and connection strings are redacted before logging or HTTP responses.

## Deployment
```bash
cd workers/valerie-herald-cron
npx wrangler deploy
```

## Secret Configuration
```bash
npx wrangler secret put CRON_SECRET
npx wrangler secret put TRIGGER_SECRET
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

## Testing
Run unit tests:
```bash
npm run test
```
Or from the root repository:
```bash
npx vitest run test/workers/heraldCron.test.ts
```
