# JPano Portfolio — Release 7 Final Touches (2026-10-12)

Source: user-uploaded `7portfolio-updated.zip`. This is a complete updated **source project**, with original `client/`, `server/`, `database/` structure preserved. Added root `compile.bat`, sanitized `.env`, and `.gitignore`. `run.bat` remains unchanged.

## Completed

### Tonex — contextual pricing and actual UI actions
- The previous client and Go backend intercepted every price question and returned the same discovery prompt, even after a detailed feature list. The client now evaluates **recent visitor messages** for a concrete feature list; Go does the equivalent on the authorized AI request history. When enough scope exists, Tonex can discuss an organized scope/worklist and missing assumptions, and the AI can provide a cautiously qualified, nonbinding budget discussion where justified. **Only Admin approves the final commercial quote.** This is not tied to historical project prices or an arbitrary PHP ceiling.
- If an AI provider is offline, the local fallback now offers an actual Markdown worklist table when requested and features were already given; vague inquiries still receive targeted discovery questions rather than invented fixed prices.
- Theme commands now support conversational follow-ups such as "yes, change it to dark" using the preceding theme discussion, and mixed requests such as "change the theme; also tell me ..." preserve the additional question.
- Bot `/theme dark`, `/theme light`, `/theme toggle` commands are explicitly allowlisted and available in `/` suggestions. The hidden `/ai` status command stays hidden. Only the visitor can initiate reversible UI actions; AI-generated arbitrary JavaScript or commands do not run.
- The offline assistant no longer pushes project lists merely because a visitor says "system" or "portfolio". A generic programming-language question now receives general technology guidance rather than automatically selling the developer's skills.

### Composer layout
- Visitor **Tonex Bot** and **Live Chat** composer controls now share a single height and bottom baseline: **48 px desktop**, **44 px mobile**, for `[attach] [message input] [send]`. Multi-line text grows upward and remains scroll-limited by the existing composer sizing code.

### Payment status update latency
- Signed PayMongo `checkout_session.payment.paid` webhooks remain the fastest and authoritative update. Ledger writes are verified against checkout ID, reference, mode, currency, amount and are idempotent.
- The server recovery worker checks pending sessions every **25 seconds** instead of two minutes, with a **65-second throttle per checkout** to avoid repeatedly hammering PayMongo. Only checkout attempts more than 10 seconds old are eligible.
- In the visitor project-payment dialog, offers are refreshed every **6 seconds** while open. A bounded, authenticated recovery check runs about every 18 seconds for up to two minutes after creating/returning to checkout; no manual "Check payment" button was added.
- PayMongo success redirect now returns to `/?checkout_return=1#contact`; the frontend reopens Live Chat and shows a neutral "Waiting for PayMongo confirmation" notification. **Returning from checkout never marks a payment paid.** There is no guaranteed fixed confirmation time. PayMongo may be slow or a backend webhook may be unreachable if Go is local/offline.

### Compile and deploy
- Root `compile.bat` now drives `client/scripts/tools/compile-release.mjs` (requires **Node.js 20+** and **Go 1.25+**). Run:

```bat
compile.bat local
compile.bat production https://api.jpano.dev
```

Use your **actual HTTPS API hostname** in place of `api.jpano.dev` if different. A production build rejects non-HTTPS or localhost backend origins.

The compiled distribution is a **sibling** directory (outside the source checkout), named `jpano-portfolio/`:

```text
jpano-portfolio/
  system/
    windows/jpano-portfolio.exe
    linux/jpano-portfolio
    macos/jpano-portfolio-amd64
    macos/jpano-portfolio-arm64
  env/
    client/.env            (public values only)
    server/.env            (PRIVATE — never host as a static asset)
  client/
    dist/                  (built website for Vercel/static hosting)
    assets/data/public-snapshot.json
  database/schema.sql
  server/                   (runtime log directory placeholder)
  DEPLOYMENT_README.md
```

The whole output folder is **not** for uploading to Vercel. On Vercel, deploy only `client/dist` (or deploy source using the existing `client/htmls/vercel` build settings). The private `env/server/.env` stays on the backend or moves into Render's private environment settings. The optional root `.env` is **not** copied, by design: publishing it to Vercel could expose credentials. `.gitignore` also excludes credentials and build products from new Git tracking; it does not untrack files previously committed.

For production, `compile.bat` sets browser API URLs to the chosen HTTPS origin, and prepares backend origin/CORS for `https://jpano.dev`. The Go config now honors Render-style `PORT` process settings ahead of local `BACKEND_PORT`, so a Render service can bind to its assigned port. Verify it is bound to `0.0.0.0` behind Render, and configure OAuth callbacks, TLS, Supabase access, SMTP and signed PayMongo webhooks on the actual public domain.

## Not changed / remaining before production
- OAuth callback path and authorized redirect URI configuration **were deliberately not changed** in this pass (the user requested handling OAuth next). Google and GitHub Login must be tested against the exact `/auth/...` Go routes; Telegram legacy login needs a valid BotFather HTTPS domain. Do not deploy production-required OAuth flows until the mismatch is resolved.
- The sanitized `.env` has **blank private values**. Fill local credentials yourself and rotate any previously exposed secrets, especially the Telegram token that was pasted in chat. Do **not** send passwords, API keys, access secrets or the private env file to ChatGPT.
- Supabase schema and live audit/payment records were **not modified**. A live deployment still needs database backup, schema alignment review, webhook test, actual PayMongo payment/refund flow review, and an end-to-end manual test of chat/WebSocket reconnects.
- Go cross-compilation requires a real Go **1.25+** toolchain on the user's machine. The analysis environment has Go 1.23.2 and DNS blocks Go toolchain downloads, so the full Go build and integration tests could **not** be independently run here. The script's staging and env split were exercised separately with placeholder executables. **Those placeholder binaries are not shipped in this source ZIP.**
- Network-based screenshot browsing was blocked in this environment. A local Chromium CSS fixture confirmed the composer controls share equal geometry on 1366px and 390px viewports, but the complete deployed browser workflows and live providers must be smoke-tested by the user.

## Tests performed
- **77/77** frontend Node tests passed after this update, including 7 targeted release regression cases.
- All frontend JS files passed parsing, and the static frontend built successfully with a bundled public snapshot fallback when the live API was unavailable.
- Go files modified in this release passed `gofmt` syntax parsing; full Go 1.25 `go test ./...` **not run** in this environment.
- The `compile.bat` staging implementation was simulated for local and production origin modes; correctly produced Windows/Linux/macOS paths, separated private/public env, and emitted a built production API origin. **Simulation was not an actual Go compilation.**

## Suggested production smoke test

1. Copy source ZIP to a folder and configure a **private** `.env` on your Windows machine.
2. Run `cd server && go test ./...` with Go 1.25+ and `cd client/htmls/vercel && npm test && npm run build` with Node 20+.
3. Start locally with `run.bat`. Test `/theme dark`, `/theme light`, natural theme follow-up, project feature list → "how much? give me a table worklist", and mobile chat composer.
4. Confirm your public backend hostname and `compile.bat production https://YOUR-ACTUAL-API-HOST` produces binaries and frontend settings. Never deploy an output flagged `BUILD_INCOMPLETE`.
5. Before turning on real payments, test PayMongo signed webhook delivery to the **public HTTPS** backend, duplicate callback idempotency, updated visitor/Admin balance, and delayed recovery. Localhost is not reachable by external webhooks without a properly configured tunnel.
6. Resolve Google/GitHub/Telegram redirect errors and perform a final browser login + chat + payment test on your actual HTTPS domain before production traffic.
