# JPano Portfolio — Chat, payments, Admin operations fixes (2026-10-12)

## Scope and delivery

This update is based on the user-supplied `5-portfolio-updated.zip`. Existing source and database content are preserved. Root contains `client/`, `server/`, `database/`, `.env` and the explicitly requested `run.bat`. The distributed `.env` is a **safe template**: private values are blank. Copy your private values into your extracted, local `.env`; do not publish them.

### Changes

- Visitor website loads the shared `operations.css` required by `/projects`, `/createproject`, `/help`, and payment/project dialogs. Chat slash picker uses full-width, responsive two-column entries; Help uses a scrollable, keyboard-accessible modal with USE buttons.
- Admin sidebar reordered as requested. Archive/Clear confirmations use native `<dialog>.showModal()` to avoid stacking underneath other dialogs. `/clear` hides the current Admin conversation's previously displayed messages locally while preserving database messages and transaction audit history.
- Bottom-right toast placement is unified and a CSS progress strip shrinks over its dismissal duration; reduced-motion setting is respected.
- Inline `<img src="https://…">` and trailing `/img https://…` are Admin-only. Long base64 image data is uploaded privately via multipart to the current conversation and represented by a short `/api/chat/images/ci_…` reference. PNG/JPEG/GIF/WebP under 4MB only; restricted to Admin and that chat's visitor, expires after seven days. Database schema adds the `portfolio.chat_images` table; apply migration only after a backup. Prefer attaching an image file or pasting a `data:image/…;base64,…` string into the Admin composer; do not send megabytes of raw base64 as chat text.
- Database inspector allows Admin to inspect actual rows, 20 at a time, without executing custom SQL. Passwords, tokens, ciphertext, hashes, binary fields and related sensitive columns are redacted. Intended for trusted Admin sessions only.
- Server screen reports process, host CPU/Memory where supported, operating system, CPU model, disk, uptime and a read-only rolling 50-line application log. It is **not** a remotely executable terminal. Windows/Linux host utilization is sampled; GPU or network bandwidth may show unavailable rather than an invented reading.
- Go's SQL `rows.Err()` check added in AI gateway; CSS standard `line-clamp` property added; obsolete `newKaaBAGClient` removed.
- AI-key setup now distinguishes missing, invalid and valid 32-byte base64 encryption keys. Private keys remain encrypted; a server restart is required after modifying `.env`.
- The Go PayMongo checkout logic now gives clearer failure messages. **Live payments remain explicitly disabled in the distributed `.env`** (`PAYMONGO_ALLOW_LIVE=false`). This protects against inadvertently charging real cards/wallets. Use test API keys for staging, or intentionally enable live mode yourself after confirming real webhooks and reconciliation. Never credit payments from redirects or browser-provided status.

### Local startup (Windows)

1. Install Go 1.25+ and Node.js 20+.
2. Extract the ZIP, back up your PostgreSQL database, populate the private `.env` values, and verify `DATABASE_URL` or `DATABASE_POOLER_URL`.
3. Keep `PUBLIC_SNAPSHOT_URL` blank for local builds to use the configured API origin (or static fallback when it is offline). Set `DB_AUTO_MIGRATE=true` *only after backup* if you want the additive schema alignment (including `chat_images`) to run at startup.
4. Double-click root `run.bat`, or run it in `cmd.exe`. It opens two retained terminals: backend (`cd server && go run .`) and frontend (`npm install` if needed, `npm run build`, `npx serve dist -l 3000`).
5. Open `http://127.0.0.1:3000` (portfolio) or `/admin` (management). If the page looks stale, hard refresh to load updated CSS.

### Setup / failure explanations

- **PayMongo:** A live `sk_live_…` key together with `PAYMONGO_ALLOW_LIVE=false` intentionally refuses checkout. Do not change that safeguard until live mode is approved and the PayMongo webhook or secure PayMongo reconciliation is verified. The `PAYMONGO_WEBHOOK_SECRET` must come from the matching registered webhook; it is not an arbitrary seed.
- **AI encryption:** Generate a fresh server-only base64 key encoding exactly 32 random bytes: `powershell -NoProfile -Command "[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))"`. Set `AI_KEY_ENCRYPTION_KEY=` in the project root `.env`, restart Go and use Admin > Artificial Intelligence. **If earlier keys were encrypted under a different value, retain that value or re-enter your provider credentials after rotation.** Changing the master key alone does not automatically re-encrypt stored credentials.
- **Chat images:** The private attachment endpoint requires the Go server, Admin login and migrated PostgreSQL. Embedded third-party images are limited to HTTPS and may fail due to a remote site's policies. Image links expire along with chat content after seven days.
- **Row inspector:** Read-only and paginated, but non-secret columns may include personal data: do not share screenshots publicly.
- **Secrets:** The user's screenshots and prior source contained sensitive configuration. Rotate exposed live PayMongo, PostgreSQL and AI encryption secrets before production, handling encrypted keys as noted above.

### Verification / limitations

- Automated frontend tests: **63 passed** after these changes.
- JavaScript syntax analysis and static frontend build passed; desktop and mobile dialog/suggestion visual fixture checks passed.
- Go source formatting/syntax checked, and platform telemetry helpers compiled independently. **Full Go 1.25 compilation and backend integration tests were not run here** because this environment has Go 1.23 and cannot download 1.25 through its restricted DNS connection.
- No live Supabase migration, real PayMongo payment, production webhook, AI provider connection or SMTP mail was executed. **Staging verification is mandatory before production rollout.**
