# JPano Portfolio — Project chat, transactions and AI configuration

Update: 2026-10-12 · Source archive: `client/`, `server/`, `database/`, `.env`.

## What was added

**Public Live Chat / project cards**
- Payment cards show verified received amount, agreed project total, remaining balance, payment progress, and `Awaiting downpayment` / `Partially paid` / `Fully paid`.
- The same project card and status are visible in the authenticated Admin conversation.
- A signed PayMongo `checkout_session.payment.paid` event updates the PostgreSQL records; the server broadcasts updated offers to Admin and visitor Live Chat. Refreshing conversation/offers also reloads the authoritative status.
- Checkout collects **optional** email and phone. If the current visitor has a verified OAuth email, the checkout form suggests it. Neither field is publicly exposed in the project card.
- Admin → **Transactions** lists checkout attempts, project titles, owners, recorded customer contacts, amounts and paid/pending status. Financial history is private to Admin.

**Chat commands / images / attachments**
- Typing `/` shows available commands; use arrows and Enter/Tab to choose; Escape closes. Visitor and Admin commands differ.
- Admin commands: `/acceptproject`, `/img HTTPS_URL`, `/offers`, `/transactions`, `/help`, `/clear`, `/status`. Existing creation flow remains protected behind Admin authentication.
- Visitor commands: `/payments`, `/getaichat`, `/projects`, `/skills`, `/contact`, `/help`, `/clear`.
- **Only messages actually sent by Admin** can render an image with `/img https://example.com/image.jpg` or `<img https://example.com/image.jpg>`. Visitors' matching text cannot become embedded images. The URL must be publicly reachable HTTPS, cannot point at local/private names or numeric hosts, and is never fetched server-side. Facebook profile URLs usually refer to web pages, not direct image assets, and may not preview.
- Drag a `.txt`, `.md`, `.csv`, `.html`, `.css`, `.js`, `.ts`, `.json`, `.xml`, `.yaml`, `.yml`, `.log`, or `.docx` file onto the chat composer, or use Attach. **File text is extracted in the browser and inserted into the draft; binary documents are not uploaded or stored.** Review the excerpt before sending; long files are truncated to the chat message limit. Files are limited to 4 MB and DOCX inflation to 3 MB.

**AI gateway / Admin settings**
- Admin → **Artificial Intelligence** stores multiple saved credentials for KaaBAG, Gemini, Groq, Cloudflare Workers AI, Mistral, Cohere and OpenRouter; entries support priority, model, enabled/disabled status, updates and permanent deletion.
- Admin-managed keys are encrypted at rest with AES-256-GCM, and plaintext is **never** returned to the browser. A masked suffix is displayed for recognition. An independently generated private `AI_KEY_ENCRYPTION_KEY` is required for persistence. Changing or losing this encryption key makes saved provider keys inaccessible; back it up securely.
- **Routing order:** enabled Admin-managed keys (lowest priority number first) → server `.env` backup keys (comma separated per provider) → published portfolio's built-in local response. Providers in cooldown are skipped. The public assistant status counts AI as online only after a verified successful provider response; static/local replies are labelled offline.
- Cloudflare Workers AI additionally requires `CLOUDFLARE_ACCOUNT_ID`; each provider may require a supported model in its corresponding `*_MODEL` environment setting or Admin settings.
- When `AI_AUTODRAFT_ENABLED=true` and a configured provider responds, a submitted feedback/contact message may produce a private reply draft. Open Admin → AI, review/edit, then press **Send reviewed email**. This is intentionally **not auto-sent**; an Admin must check external-model output before SMTP delivery. The outgoing HTML includes an explicit AI-assistance note.
- When PayMongo **verifies** that a project reached its downpayment threshold or became fully paid, the backend can send a one-time payment acknowledgement **if a contact email and SMTP are configured**. AI may draft its text; a factual template is used if AI is offline. If AI actually helped, the email discloses AI assistance. No return URL, client command or AI message can directly update payment records.

## Configure private `.env`

Copy your real values into your local private `.env`; they are intentionally **blank** in the shareable ZIP.

```dotenv
# PostgreSQL: direct IPv6 and optional IPv4 Session Pooler
DATABASE_URL=
DATABASE_POOLER_URL=
DB_AUTO_SETUP=false
DB_AUTO_MIGRATE=true

# Needed to store Admin-added credentials; generate ONCE and back up securely
AI_KEY_ENCRYPTION_KEY=
AI_AUTODRAFT_ENABLED=false
KAABAG_API_BASE_URL=https://kaabag.bcc-edu.ph
KAABAG_API_KEY=
KAABAG_MODEL=
GEMINI_API_KEYS=
GROQ_API_KEYS=
CLOUDFLARE_WORKERS_API_KEYS=
CLOUDFLARE_ACCOUNT_ID=
MISTRAL_API_KEYS=
COHERE_API_KEYS=
OPENROUTER_API_KEYS=

# Checkout + verified payment updates
PAYMONGO_SECRET=
PAYMONGO_PUBLIC=
PAYMONGO_WEBHOOK_SECRET=
PAYMONGO_ALLOW_LIVE=false

# SMTP must work for reviewed AI drafts and project acknowledgements
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_EMAIL=
SMTP_PASSWORD=
```

PowerShell one-time encryption-key generator (do not put this key in the browser):

```powershell
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

After generation, save the result as `AI_KEY_ENCRYPTION_KEY` only on the backend. You may add as many Admin keys as needed **without editing `.env`**, but the encryption master key and server-level fallback keys still belong in the backend environment. Do not include any `sb_secret_`, `sk_live_`, database password or encryption key in deployed static frontend content.

Set `AI_AUTODRAFT_ENABLED=true` only after you've decided how you will inform visitors that feedback/contact messages may be processed by third-party AI providers. Verify the existing form notices, data-protection practices and SMTP sender identity.

## Safe setup and smoke-test order

1. Back up live PostgreSQL, test `database/schema.sql` against a **staging** database, then restart Go with `DB_AUTO_MIGRATE=true`. Schema alignment adds tables/columns; it does **not** seed or delete published portfolio records. Restore `DB_AUTO_MIGRATE=false` if you prefer manual migrations after rollout.
2. Ensure Go is built with **Go 1.25 or newer compatible with the project**. Run `cd server; go test ./...; go run .` on your machine with real dependencies available.
3. Frontend: `cd client/htmls/vercel; npm install; npm run build; npx serve dist -l 3000`. Use the deployed Vercel app for testing HTTPS/OAuth/CORS.
4. Sign in as Admin, open Transactions and Artificial Intelligence. Generate the encryption key first, save **one test provider** and confirm it returns a masked suffix; rotate it and disable it; verify the `.env` fallback still works.
5. Start a Live Chat as a visitor, have Admin create a proposed project with a downpayment percentage, and verify the same offer in both clients.
6. Run PayMongo in **Test Mode** and deliver a **signed real test event** to `/api/paymongo/webhook` over public HTTPS. A successful checkout redirect **is not** payment proof. Verify partial payment updates both cards and the transaction list, then pay the remaining balance to verify Fully Paid. Retry the same webhook; totals must not double-count.
7. Verify optional payer email/phone, OAuth email prefill, AI reply drafts, Admin review, SMTP sender, payment acknowledgement (one-time), invalid `/img` URL rejection and local document extraction.
8. Repeat after restarting Go and refreshing the browser. Check database roles, private API keys, allowed CORS origin, TLS, and PayMongo test/live separation before production traffic.

## Important current limitations

- Admin and Live Chat **still depend on the Go API and PostgreSQL**; they are not independently migrated to Supabase Auth/Realtime. Public published-page fallback remains available when Go is offline.
- Payments only show as verified after signed server-side confirmation. Without a configured, publicly reachable webhook, checkout can work while the project remains Pending.
- Pending checkout sessions remain exclusive per project until resolved by the existing integration; abandoned or expired attempts may require Admin support. A complete PayMongo reconciliation/expiry workflow is a separate enhancement.
- External AI credentials/provider models and SMTP/PayMongo were **not tested live in the handoff environment**; configure and test each integration on staging.
- Manual email draft review is a deliberate safeguard. SMTP delivery is confirmed only to the provider relay; actual inbox delivery is not guaranteed.
- Rich Admin images reference external URLs; image host availability, authorization and hotlinking rules determine whether a thumbnail loads.
