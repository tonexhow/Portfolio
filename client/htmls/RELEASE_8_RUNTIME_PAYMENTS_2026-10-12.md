# JPano Portfolio Release 8 — Runtime API and Webhook-First Payments

**Based on:** Release 7 source. No database schema changes, no new third-party SDK.

## Changes

- The public frontend backend URL is **runtime-configurable**. Vercel serves `/config.js` through `/api/runtime-config` (a Node.js serverless function) using `PUBLIC_API_BASE_URL` from its deployment environment. The browser receives only a public HTTPS origin and optionally a publishable Supabase URL/key. Responses have `Cache-Control: no-store`.
- The static frontend still has a replaceable `config.js` for `run.bat`/other plain static servers. Run `node client/scripts/tools/update-runtime-config.mjs <dist-directory> <env-file>` to write that public config after editing `.env`, without rebuilding the frontend.
- `compile.bat production [https://api.jpano.dev]` cross-builds Windows/Linux/macOS executables and packages a Vercel-ready `client/dist/` with `api/runtime-config.js`, `vercel.json` and **no stale build-time `config.js`**. The argument is optional; set `PUBLIC_API_BASE_URL` and `API_ORIGIN` after hosting is ready.
- PayMongo payment approvals still require a verified signed webhook or trusted authenticated gateway reconciliation. The Go ledger remains idempotent and unchanged.
- Once a payment is committed, the Go backend broadcasts `project_offer` via authenticated WebSocket to its visitor thread and Admin. The payment modal and Admin Transactions update from that event.
- Removed the visitor's repeated six-second payment-modal polling and repeated six-second gateway verification loop. There is **one delayed 45-second browser-side recovery check**, only while an unpaid proposal modal remains open. The Go background worker separately checks missed webhooks with throttling.
- Added server-side WebSocket Ping every 30 seconds to keep payment notifications flowing through idle chats. Existing cookie-scoped visitor threads continue receiving **read-only payment updates when Admin goes offline**, without allowing new guest messages. Reconnect and tab visibility still refresh saved records once.
- Fixed duplicate `getChatStatus` call in the payment modal.

## Local

From the source directory on Windows:

```
run.bat
```

Frontend: `http://127.0.0.1:3000` (API default `http://127.0.0.1:48000`). Editing `.env` while running the already-built frontend requires only refreshing its **public** config file, not recompiling:

```
node client/scripts/tools/update-runtime-config.mjs
```

Then refresh the page. Restart Go when changing the backend's private settings.

## Production Vercel + Render

1. Recommended permanent backend hostname: `https://api.jpano.dev`, via DNS/custom domain pointing to Render or your server. A stable hostname avoids OAuth/cookie/CORS updates when changing hosting providers.
2. `compile.bat production` (or `compile.bat production https://api.jpano.dev` if the hostname is already ready) on Windows with **Go 1.25+ and Node 20+**.
3. Deploy **only `jpano-portfolio/client/dist/`** to Vercel as the project root, using Framework Preset **Other** and no frontend build step (the files are already built). This folder includes its own `vercel.json`, `package.json`, and serverless function under `api/`. Alternatively deploy from the `client/htmls/vercel/` source project root; its build also removes the static config on Vercel.
4. In Vercel Project Settings → Environment Variables set `PUBLIC_API_BASE_URL=https://api.jpano.dev`, plus optional `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (never secrets). Vercel uses deployment-scoped environment variables: after changing one, apply it to a new/current deployment as instructed by Vercel. **No frontend compilation is needed.**
5. In Render/Go server environment set `API_ORIGIN=https://api.jpano.dev`, `FRONTEND_ORIGIN=https://jpano.dev`, `CORS_ALLOWED_ORIGINS=https://jpano.dev`, `BACKEND_BIND=0.0.0.0`, and your private database/payment/SMTP/OAuth settings. Restart Go after changing server environment variables.
6. Test `https://jpano.dev/config.js`. It must return JavaScript with a new `apiBaseURL` after an environment change; response headers must have `no-store`. It must **not** include private settings.
7. Test `https://api.jpano.dev/api/health` and your `wss://api.jpano.dev/api/public/chat/ws` after creating an authorized live chat session. Configure PayMongo's actual signed webhook callback URL in its dashboard; localhost cannot receive external webhooks.

**Important distinction:** A static website cannot read a server `.env` file at browser request time. Vercel's serverless runtime config solves this by reading a hosting environment variable. Changing only Render's `.env` does **not** change the frontend's backend URL; change the public Vercel environment as well (or keep the permanent `api.jpano.dev` DNS name and update its target instead). Host configuration changes can require deployment activation, but never rebuilding source bundles.

## Payment integration verification

- Verify webhook signatures and live/test mode before changing ledger state; HTTPS required.
- On PayMongo confirmation, project funds update in Go DB once, then the live visitor card and Admin view change via WebSocket without a manual Verify click or polling interval.
- If WebSocket disconnects, reconnect restores state through `getChatOffers`; if the webhook is delayed/missed, the single 45-second check and the Go recovery worker independently reconcile against PayMongo's API. They never trust the return redirect.
- If payment is slow, inspect webhook delivery attempts, HTTPS reachability, application logs and the pending attempt; do not guess or credit it manually.
- Retain `PAYMONGO_ALLOW_LIVE=false` until live webhook/callback monitoring and reconciliation have been verified with a real test payment. Never distribute live keys in ZIP files.

## Test status

- Source tests: **83/83 pass**. JavaScript parsing and static build pass.
- Vercel-mode build verified to omit stale `config.js`; runtime handler tested against changing environment values. Simulated packaging checked both `compile.bat production` with and without a specified backend URL, including separation of client/server `.env` files.
- **Not independently tested:** Actual Go 1.25 compilation, real Vercel serverless routing, production WebSocket network behavior, live PayMongo webhook delivery or payments. The available environment has Go 1.23 only and cannot download Go 1.25; simulated executable files are NOT included in this source release.
