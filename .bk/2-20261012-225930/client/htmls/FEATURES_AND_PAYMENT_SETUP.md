# JPano Portfolio — chat, markup and project checkout

**Source roots:** `client/`, `server/`, `database/`, `.env` only. No React, batch launchers, or generated `dist` are included in the source release.

## Implemented in this update

- A larger chat panel on desktop and a full-viewport chat panel on mobile (including mobile safe-area insets), with padded, centered controls.
- Readable Markdown headings, nested bullet/numbered/task lists, blockquotes, links, tables, images, footnotes, formatted inline text and code blocks. Raw HTML remains literal text; unsafe URI schemes never become clickable links.
- `html`, `markup`, `frontend`, `client`, `page`, or `webpage` fenced source shows a **Preview** control. A full HTML page with inline `<style>` and `<script>` is rendered **only on click** inside an iframe with `sandbox="allow-scripts"` (no `allow-same-origin`) and a restrictive CSP prohibiting network requests, forms, external assets, and embedding. This is a development preview, not an unrestricted website hosting feature.
- Text-only attachment button accepts TXT/MD/HTML/CSS/JS/TS/JSON/CSV/XML/YAML/LOG and DOCX files (1 MB limit). DOCX paragraphs are decoded **in the visitor's browser**, then inserted into the text composer for review, truncated at the chat message limit of **12,000 characters**. On older, unmigrated PostgreSQL databases, the legacy constraint still allows only 2,000 characters: install the reviewed additive schema on staging first. No binary is sent, uploaded, or stored.
- Viewport-clamped tooltip portal, including the backend status indicator. Admin status differentiates Go reachability from database readiness.
- Admin chat `/acceptproject` offers with title, description, price (PHP), minimum downpayment (1–100%). Visitor gets a typed proposal card and can choose an amount from required downpayment to the outstanding balance. This is a proposal, **not a signed services contract**.
- PayMongo **hosted QR Ph checkout**. The project's in-modal QR opens the PayMongo hosted checkout URL on another device; the actual QR Ph payment instruction is produced by PayMongo **inside that checkout page**. Payments can be marked **Payment approved** (deposit threshold reached) or **Fully paid** only after a correctly signed and matching PayMongo webhook. The interface never accepts self-reported payment approval.

## Known limitations

- A full end-to-end checkout and webhook flow must be tested with a PayMongo **test-mode account**. The code has never charged a real payment here.
- Admin offer creation, live project offers and payment confirmation require the Go server **and the new database tables**. General public portfolio browsing still supports its existing static snapshot and optional public Supabase RPC when Go is down.
- Browser-side DOCX decoding needs `DecompressionStream('deflate-raw')`. Some older browsers may require a `.txt` or `.md` export. PDF attachment parsing is not supported.
- LaTeX math, Mermaid rendered diagrams, arbitrary CSS/HTML embedded directly into an ordinary Markdown message, and some advanced CommonMark/GFM extensions are intentionally **not executable**. Code previews are explicitly opt-in.
- KaaBAG chat-completion requests retain the conservative 1,800-character per-prompt limit. Larger messages still render and can be sent through Live Chat, but the Bot uses published-content fallback rather than sending oversized requests to the AI gateway.
- The sandbox is isolated but is not a substitute for a dedicated browser security audit against adversarial HTML/CSS/JS payloads before public launch.
- Since only a client snapshot was available for these checks, end-to-end tests with your production OAuth, Supabase RLS, WebSockets, and actual Go toolchain are still required.

## Safe first-time installation

1. **Back up** the existing repository and private root `.env` before extracting the ZIP. The ZIP includes a sanitized `.env` with private keys blank; merge its new PayMongo entries into your working `.env` instead of replacing real secrets.
2. Build from a fresh extraction:
   ```powershell
   cd client/htmls/vercel
   npm run check
   npm test
   npm run build
   npx serve dist -l 3000
   ```
3. Use Go **1.25 or newer** (as specified in `server/go.mod`):
   ```powershell
   cd server
   go test ./...
   go vet ./...
   go run .
   ```
4. Check `GET /api/health` at your configured Go origin. `online=true` means Go is reachable; `ready=true` and `database=true` mean PostgreSQL is ready. A green Go status is not proof of DB readiness.
5. Back up your current Supabase database and first test against a **staging Supabase project**. Review `database/schema.sql`. Set `DB_AUTO_MIGRATE=true` **temporarily** to apply the new additive tables when Go starts, then set it back to `false`. Nothing in this ZIP runs migrations automatically without explicit opt-in.
6. In the `.env` server configuration add:
   ```dotenv
   PAYMONGO_SECRET=sk_test_YOUR_TEST_SECRET_KEY
   PAYMONGO_PUBLIC=pk_test_YOUR_TEST_PUBLIC_KEY
   PAYMONGO_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET
   PAYMONGO_ALLOW_LIVE=false
   DB_AUTO_MIGRATE=false
   ```
   `PAYMONGO_PUBLIC` is reserved for an optional future native QR Ph payment-method flow; the current **hosted checkout** needs the secret key in Go. Do not include either secret key or webhook secret in Vercel public variables or client JavaScript.
7. In the **PayMongo test dashboard**, register an HTTPS webhook at `https://YOUR-GO-API-ORIGIN/api/paymongo/webhook`, subscribing to `checkout_session.payment.paid`. Put the **webhook signing secret** into `PAYMONGO_WEBHOOK_SECRET`. The endpoint is intentionally independent of browser CSRF headers and authenticates raw provider payloads by HMAC SHA-256, with amount, session, reference and currency matching.
8. In Admin Chats, open a visitor conversation, type `/acceptproject` in the reply box and submit. Send a proposal with a 30% deposit. In the same visitor browser session, open the Project card, create the PayMongo test checkout, and complete a **test payment**. Confirm the webhook updates the project status. Test duplicate webhooks, invalid signatures, missing setup, invalid amounts, old/expired sessions and partial vs full amounts before live launch.
9. Do **not** use `sk_live_` until you have validated your test mode workflow and explicitly set `PAYMONGO_ALLOW_LIVE=true`. Live charge permissions, fee rules, taxes, receipts, refund policy and contract terms need separate review.

## Frontend Markdown tests

These cases should be sent first in Live Chat and inspected in Admin Chats:

````markdown
> **Readable blockquote** with a [safe URL](https://jpano.dev).
>
> - First
>   - Nested child

- [x] Completed
- [ ] In progress

```markup
<!doctype html><html><head><style>body{background:#f1f8f4;font-family:sans-serif}</style></head><body><h1>Preview</h1><button id="run">Try JS</button><script>document.getElementById('run').onclick=()=>{document.body.style.background='#d5f4e3'}</script></body></html>
```

| Column 1 | Column 2 |
|---|---|
| One | **Two** |
````

**Expected:** nested layout and blockquote readable in both light/dark themes; source shows `Preview` rather than executing automatically; separate preview can run inline JS in a sandbox; no CSS or script leaks into the portfolio page.

## Suggested follow-on features

1. **Client project room**: shared scope, milestones, files, messaging and audit trail, separate from expiring live chat.
2. **Milestone billing + payment ledger**: itemized scope, balance, invoice/receipt links, downloadable payment history and webhook reconciliation; add webhook handling for refunds/disputes before offering refunds within the site.
3. **Agreement workflow**: terms, milestones, refund/cancellation policy, both parties' acceptance and signed timestamps before accepting payment.
4. **AI source citations and privacy**: each AI answer links to the exact published portfolio record used; visitor controls for chat history and explicit share-to-Admin consent.
5. **Design QA**: keyboard/focus trapping, reduced-motion mode, WCAG color contrast, mobile viewport rotation, screen-reader labeling and responsive screenshots.
6. **Admin observability**: per-provider uptime, database status, PayMongo webhook attempts and failures, queue backlog, last public snapshot freshness, and alerting.

## Technical/source references

PayMongo documentation: https://docs.paymongo.com/docs/payment-channels-hosted-checkout-quick-start , https://docs.paymongo.com/docs/developer-tools-webhook-setup-management .
