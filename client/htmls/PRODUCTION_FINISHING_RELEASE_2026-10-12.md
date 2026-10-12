# JPano Portfolio — Production finishing update (12 October 2026)

Base: `6portfolio-updated.zip`. This package is complete source code, not a patch. Root: `client/`, `server/`, `database/`, sanitized `.env`, `run.bat`, `compile.bat`.

## Implemented in this release

1. **Tonex Bot relevance**: project/certificate/career cards require an explicit visitor request rather than incidental wording in a generated reply. Quick-action buttons also require relevant intent. Social-profile answers create valid links from published site information. Bot identifies itself as **Tonex Bot** when asked about its underlying provider/model. Server prompt forbids fabricated actions and unrequested promotion.
2. **Scope-first pricing**: a visitor asking about a price receives discovery questions (who uses it, required features, integrations, platform, timeframe) rather than a made-up quote or the portfolio's historical range. A human Admin must approve the estimate. Public hero says **Based on scope**.
3. **Visitor Bot concurrency**: one in-flight response per browser tab, visible “Tonex is responding…” state, Send disabled until completion. This is not a global user-account-wide mutex between browser tabs/devices.
4. **Hidden `/ai`**: callable in visitor Bot, visitor Live Chat, and Admin Chat, but absent from slash autocomplete/help. Visitors get only generic recent-success/availability info; Admin can test configured provider routes under an authenticated, rate-limited endpoint. No private keys, model identifiers or provider routing are exposed to visitors.
5. **Durable `/getaichat` handoff**: with visitor consent, up to 18 recent Bot entries are sent through an authenticated HTTP chat session and saved to existing seven-day message history, then broadcast to Live Chat and Admin. Admin's `/getaichat` locates a visitor-approved handoff in the selected conversation. If the guest is offline **and Admin isn't online**, the existing guest Live Chat access rule still applies; signed-in visitors can use the offline-Admin path.
6. **Automatic PayMongo updates**: removed manual “Check payment with PayMongo”/routine Admin Verify controls. Signed PayMongo webhooks remain the main verification mechanism; verified payment balances are sent over existing WebSocket events, and the visitor dialog refreshes offer status while open. A bounded backend worker checks older pending PayMongo checkout sessions every two minutes to recover missed events, using only the existing verification/idempotency routine. Webhook delivery is **HTTPS POST**; WebSocket is for the browser notification, not the webhook receiver.
7. **Admin AI management**: provider-specific SVG icons, icon-only Eye/Copy, reset custom select after adding a credential, consistent existing warning/danger theme tokens, and an on-demand **Test connections** action. Encrypted API keys remain private server-side; `.env` remains fallback. Health checks are limited and don't return raw model output or keys.
8. **Transactions**: Active / Archived / All segmented navigation replaces the checkbox; archived financial records remain preserved for audit and do not reduce the verified project balance.
9. **Server hardware and network**: improved Windows CPU model detection; optional Admin-only network check reports external IP, likely ISP/network operator and a bounded download sample. Results depend on available OS/provider metadata, proxies/VPNs, and a working public network. They are **not guaranteed carrier identification or a full network speed test**.
10. **Multilingual greetings**: eight configured language rotations (English, Filipino, Cebuano, Spanish, French, German, Japanese, Korean) with greeting translations and message variants, refreshed every minute. The compiled snapshot has variants; live database-provided information may override the bundled snapshot.

## Run locally

1. Install **Go 1.25+** and Node.js **20+**. Set your real private credentials in the root `.env` (template contains no private secrets).
2. Windows: run `run.bat` from the project root. It keeps both terminals visible.
3. Manual: from `server/`, run `go run .`; from `client/htmls/vercel/`, run `npm install`, `npm run build`, `npx serve dist -l 3000`.
4. Open `http://127.0.0.1:3000` or `/admin`. Backend normally binds `127.0.0.1:48000` locally.

## Production configuration checklist (must be validated in your environment)

- Deploy the static frontend to Vercel; set **PUBLIC_API_BASE_URL** to the real HTTPS backend URL **before the build**, not `127.0.0.1`. Set API/frontend origins, cookies, proxy/trusted origin rules appropriately.
- Configure direct PostgreSQL **DATABASE_URL** and/or the Supabase IPv4 **DATABASE_POOLER_URL** exactly as shown in Supabase's Connect dialog. Backup first and rehearse additive alignment on staging; use `DB_AUTO_MIGRATE=true` only as part of a supervised migration; disable it afterward if desired.
- Configure PayMongo `PAYMONGO_SECRET`, `PAYMONGO_PUBLIC`, and the **webhook signing secret** from the dashboard. Register the stable HTTPS webhook endpoint to the actual Go handler. Use test keys first. Only deliberately set `PAYMONGO_ALLOW_LIVE=true` for live keys and a tested public deployment.
- Configure **AI_KEY_ENCRYPTION_KEY** as stable base64 from 32 random bytes before using Admin-stored keys. Keep the original key backed up or existing saved credentials become unreadable. Provider-specific `.env` keys are optional backups; keep them server-side.
- Configure OAuth redirect URLs, SMTP, TLS, DNS, uptime/alerts, backups, rollback and rate limits before accepting real visitors or payments. Rotate exposed secrets.
- Test a real PayMongo event including signed webhook receipt, duplicate replay, partial/full balance, visitor/WebSocket reconnect, and a missed-webhook recovery window. Do **not** trust checkout redirects to mark payments paid.
- The prior user-supplied “production checklist all checked” is self-reported. We have **not** independently tested this Go backend against production Supabase, PayMongo, SMTP or hosted AI services.

## Verification performed in this working environment

- `npm test`: **70/70 passed**, including seven new regression tests added for this update.
- `npm run build`: **passed** with bundled snapshot fallback (API unreachable here).
- JavaScript syntax checks: passed.
- `gofmt` validation: all Go source files parse/format.
- **Full Go 1.25 compilation/test suite: not run**. The available runtime is Go 1.23.2 and a Go 1.25 toolchain download is blocked. Validate `go test ./...` on your Go 1.25 Windows machine before deployment.
- No live DB migration, webhook delivery, SMTP send, or production-provider health probes were made.

## Known limitations and intentional safeguards

- Admin and Live Chat still depend on the Go server and PostgreSQL; a static frontend doesn't supply those services.
- `/ai` visitor health gives a privacy-preserving recent-success indicator, **not** a live provider-by-provider ping. Admin may run on-demand checks.
- The response lock is per browser tab, not distributed across devices.
- Social links depend on the published content snapshot; if an admin changes links in the DB, publish/refresh the public content path.
- Opt-in ISP discovery can identify a cloud/VPN/tunnel operator instead of the user's actual ISP; do not display as verified.
- The “provider logos” are original provider-distinct vector glyphs, not licensed brand logos.

## Suggested post-launch feature

Build a private client project workspace with agreed scope, milestones, approved changes, delivery files, payments and receipts. Make the project offer the source of truth and preserve an immutable payment audit history. This is not implemented in this release.
