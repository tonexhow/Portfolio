# JPano Portfolio — compile, OAuth, and API wiring audit (12 October 2026)

This release corrects a faulty build assertion: the previous security test insisted that `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`, and `TELEGRAM_BOT_TOKEN` were *empty in your source `.env`*. That is not compatible with normal local development. Keeping private keys on the Go server is correct; publishing them in browser files is not. The new gate scans the generated browser build for configured server credentials and blocks release if it detects a leak. Dedicated tests cover a populated private `.env`, safe public output, and a deliberately leaking fixture.

## How to build (Windows PowerShell)

Run commands inside the unzipped source folder, using current, **rotated** credentials in a private `.env`:

```powershell
node .\client\scripts\tools\audit-config.mjs
.\compile.bat local
```

For a production build using the currently selected permanent API hostname:

```powershell
.\compile.bat production https://backend.jpano.dev
```

Requires Go **1.25+** and Node **20+**. The distribution is created next to your source folder, in `jpano-portfolio`, with `client/dist`, compiled Go binaries under `system/`, schema, and separately scoped `env/client/.env` and `env/server/.env`. Deploy **only `client/dist`** to Vercel. Do not publish the release `env/server/.env` or include it in Git.

You can check expected public callbacks before hosting:

```powershell
node .\client\scripts\tools\audit-config.mjs https://backend.jpano.dev
```

The above preview does **not** change Go environment variables or provider settings.

## OAuth: where the redirect_uri actually comes from

The Go backend uses `API_ORIGIN` (not `FRONTEND_ORIGIN`) to build the OAuth callback URI. All provider start requests and their token exchanges use the corresponding callback.

| Provider | Register this URI in the provider console when API_ORIGIN=https://backend.jpano.dev |
|---|---|
| Google Web application | `https://backend.jpano.dev/auth/feedback/google/callback` |
| GitHub OAuth App | `https://backend.jpano.dev/auth/feedback/github/callback` |
| Facebook Login (if enabled) | `https://backend.jpano.dev/auth/feedback/facebook/callback` |

Google contact-form identity uses the same Google feedback callback. The frontend begins sign-in at the **backend** (`/auth/feedback/{provider}/start`), so don't register a frontend `/api/auth/callback` or a `jpano.dev` frontend callback.

For local development when the backend runs at `127.0.0.1:48000`, the Google callback is `http://127.0.0.1:48000/auth/feedback/google/callback` and GitHub is `http://127.0.0.1:48000/auth/feedback/github/callback`. Keep local and production registrations separate if your provider restricts how many callbacks an application supports.

**Google Cloud**: APIs & Services → Google Auth Platform → Clients → select the OAuth client of type **Web application** → **Authorized redirect URIs** → enter the exact matching callback. Ensure the ID/secret in the running Go backend are for that same client. If using an app in Testing, the Google account might need to be a test user; that is a separate issue from `redirect_uri_mismatch`.

**GitHub**: Settings → Developer settings → OAuth Apps → select your app → enter the backend URI as an Authorization callback URL. Restrict callbacks to exact URLs rather than enabling wildcard matching unless there is a specific justified need.

For production align:

```dotenv
API_ORIGIN=https://backend.jpano.dev
PUBLIC_API_BASE_URL=https://backend.jpano.dev
PUBLIC_SNAPSHOT_URL=https://backend.jpano.dev/api/public/snapshot
FRONTEND_ORIGIN=https://jpano.dev
CORS_ALLOWED_ORIGINS=https://jpano.dev
BACKEND_BIND=0.0.0.0
COOKIE_SAME_SITE=lax
```

Configure private OAuth credentials **only on the Go backend**. Configure `PUBLIC_API_BASE_URL` in Vercel's environment too; the `/config.js` serverless response reads it at request time. Restart Go after server-side env changes. Applying Vercel env changes may require a deployment refresh, but **not** a JS source rebuild. If you change the backend host later, you must also update the provider callback registrations (a stable API subdomain helps avoid this).

A Google/GitHub redirect mismatch cannot be fixed solely by changing application code if the provider-console callback registration still differs.

## Route wiring audit

- 111 declared Go HTTP routes discovered in `server/main.go`, including Google and GitHub feedback start/callback, contact Google start, public chatbot sessions, visitor/Admin WebSockets, project checkout and verification, PayMongo webhook, admin CRUD, and management OTP/SSE.
- 80 static/template `request()` calls in `client/scripts/core/api_manager.js` checked for matching Go route patterns. New `endpoint-contract.test.mjs` also checks critical OAuth, chat, WebSocket, payment, contact, and access routes.
- Existing JavaScript/HTML reference validation and import resolution are retained.
- These are static/contract tests. They cannot prove that your *deployed* Supabase connection, Cloudflare/Render tunnel, OAuth dashboard, SMTP, or PayMongo webhook deliveries currently work.

## PayMongo readiness

The browser uses an authenticated WebSocket for confirmed payment notifications. Payment records still change only when the backend confirms the payment through a signed PayMongo webhook or its authenticated reconciliation routine. A delayed browser recovery check and the backend worker remain as fallbacks.

Your earlier compile log showed `PAYMONGO_WEBHOOK_SECRET` blank, with a live API secret and `PAYMONGO_ALLOW_LIVE=false`. Under those settings **live webhook handling is unavailable**. Before enabling real payments, configure a valid PayMongo signing secret associated with the webhook pointing to `https://backend.jpano.dev/api/paymongo/webhook`, validate test-mode processing and gateway delivery, and *only then* intentionally enable live mode. Never guess a signing secret, trust the browser's return URL as proof of payment, or test live transactions before deployment checks pass.

## Credential safety and verification limits

The earlier pasted PowerShell log contained potentially sensitive values: PostgreSQL connection passwords, Supabase secret key, SMTP app password, OAuth client secrets, Telegram bot token, access/encryption secrets, and PayMongo live secret. Rotate/revoke them from their respective providers. The source ZIP distributed with this audit uses **blank placeholders** for private fields and does not include those logged values. Do not use the old credentials again.

Static builds and JS tests were run here. **Go binary compilation could not be completed in the audit environment**, which contains Go 1.23.2 and has no toolchain download access. Run the final `compile.bat` on Windows with Go 1.25+ (the script builds for Windows/Linux/macOS). No claim is made that external OAuth or payments were verified live.
