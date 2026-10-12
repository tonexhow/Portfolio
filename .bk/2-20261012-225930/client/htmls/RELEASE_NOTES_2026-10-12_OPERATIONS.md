# JPano Portfolio — Operations, Payments & Chat Update
Date: 2026-10-12
Source: 4-portfolio-updated.zip. Four root items: client/, server/, database/, .env.

## Delivered in this update

### Admin and interface
- Management sidebar scrolls independently with a fixed bottom action area (desktop/mobile).
- AI page: full-width provider cards, local pagination (6 entries/page), optional provider labels, masked encrypted keys with explicit Admin-only View/Copy confirmation. Removed the environment backup status display; actual server fallback remains.
- AI drafts placed below providers; local pagination and automatically pruned **sent** draft history after 15 days.
- Transactions: progress, owner/contact, project description/details, PayMongo verification on pending attempts, archive single entries or all paid entries. Archive only changes Admin visibility: verified money and ledger are preserved.
- New Admin Database page: private, **read-only** schema/table metadata, estimated rows and storage. No SQL editor.
- New Admin Server page: private, read-only uptime/hosting/CPU/RAM/host storage (when available)/GPU availability/network status and sanitized last 50 app log lines. No shell execution or remote control.

### Live chat and project management
- `/` opens fixed-width, role-scoped command suggestions with keyboard navigation.
- `/help` opens a modal including each command's example and an interactive USE button.
- `/clear` clears the current local view (Bot: clears locally saved history after confirmation; Live/Admin: clears only displayed messages, never financial records).
- Visitor `/createproject`: persistent inquiry with title, description and suggested budget, reviewable by Admin.
- Visitor `/projects`: review own inquiries and agreed project cards; withdraw pending inquiry. Admin `/projects`: list, count and archive offers; `/acceptproject`: review outstanding inquiries; `/createproject`: create a new offer with adjustable price, percentage and optional note.
- Only server-authenticated Admin messages can render inline `<img src="https://...">` as a small image or mixed text followed by `/img https://...` as a bottom image. Scripts and untrusted visitor/bot HTML are not executed. Some webpages (such as Facebook profile pages) are not direct image URLs and will only show a fallback link.
- Archiving a project notifies both ends over chat sockets to remove its card. Original payment attempts are never deleted.

### Payment verification
- Existing signature-checked `checkout_session.payment.paid` webhook remains the normal payment authority.
- Pending checkouts can also be checked through a **server-to-server PayMongo query** from the transaction row or Visitor project's “Check payment with PayMongo” button. Matching requires stored session ID, reference, paid payment ID, currency PHP, exact amount, and live/test mode.
- Changes to project received balance are atomic, idempotent and tied to verified payment evidence. Checkout redirects and UI actions alone never mark paid.
- After a confirmed downpayment, a project acknowledgement email can be sent when valid recipient and SMTP exist; AI wording is optional and labeled when AI-assisted.

### Email automation
- AI replies to feedback/contact can be automatically composed when AI provider and SMTP are available, and optionally sent automatically with a footer disclosing AI authorship. Configure BOTH `AI_AUTODRAFT_ENABLED=true` and `AI_AUTOSEND_ENABLED=true` to enable. Both are **false by default** in the shared template to prevent accidental outbound messages.
- Sent AI email records are automatically pruned after 15 days. Unsent drafts are retained for manual review and may still need administrator attention.

## Setup: before first run

1. Extract, preserving exactly `client/`, `server/`, `database/`, `.env`.
2. **Restore your private `.env` locally** (sanitized ZIP contains no private credentials). Rotate any secrets previously shared in a chat or repository.
3. For saved AI API credentials, configure `AI_KEY_ENCRYPTION_KEY` as 32 cryptographically random bytes encoded as Base64. Windows PowerShell: `[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`. Keep this key available securely: losing it means existing encrypted provider credentials cannot be recovered. Never put this in client code.
4. Back up the production Supabase PostgreSQL database. On a **staging clone first**, review `database/schema.sql`; use `DB_AUTO_MIGRATE=true` for the additive schema alignment. New table: `portfolio.project_inquiries`; new offer/payment archive and Admin note fields. No sample data is seeded. After migration, consider disabling automatic migrations for production rollouts.
5. Go requires Go **1.25**. Start Go from `server/` with `go run .`. Frontend: `cd client/htmls/vercel`, `npm run build`, `npx serve dist -l 3000`. The frontend can show bundled published content when Go is offline, but Admin/Live Chat still need Go plus PostgreSQL.
6. Set PayMongo **test mode** API keys and registered webhook signing secret for `POST /api/paymongo/webhook`. Use a publicly reachable HTTPS URL, subscribe to `checkout_session.payment.paid` and verify events against the PayMongo dashboard. `PAYMONGO_ALLOW_LIVE=false` by default; deliberately enable only after complete staging tests.
7. Verify SMTP in staging before enabling AI email auto-send. Check spam behavior, opt-out policy and rate limits. Human review remains a safer default for public feedback.

## Staging acceptance checks

- Log in and verify each Admin page, sidebar scroll/footer position at desktop and mobile widths, provider pagination/hidden key/reveal/copy, transactions and table/server pages.
- Open a visitor Live Chat, `/help`, `/createproject`, then in Admin `/acceptproject`; update the quote/note; see the new visitor card and `/projects` counts.
- Try `/img` after text and `<img src="https://images.example.com/sample.png">` from Admin; verify visitor messages cannot create images. Validate invalid/local/image-less URLs show as text or fallback links.
- Create PayMongo *test* checkout; process GCash or available test channel; send verified signed webhook; verify amounts, duplicate deliveries, out-of-order events and Admin `Verify with PayMongo` action. Confirm **no credit** for a failed or unverified checkout.
- Verify payment receipt and AI-assisted contact email on a test mailbox. Do not enable live auto-send until confirmed.
- Check database migrations preserve existing project cards, archived transactions and AI settings. Restore from backups in staging at least once.
- Reopen the same Live Chat session across a reload: offers and inquiries should remain; after Admin archives an offer, verify it disappears from both sides without deleting ledger records.

## Tests and explicit limitations
- Frontend Node test suite: 57 tests passed at time of release.
- JavaScript syntax checks and fresh static build pass offline with bundled snapshot fallback.
- Go source files parsed with the local Go parser (40 files). **Not compiled or integration-tested** with Go 1.25 because this environment has Go 1.23 and cannot download Go 1.25 over DNS.
- Live Supabase, PayMongo, SMTP, provider inference, browser/OAuth authentication and end-to-end GCash testing **not performed** in this environment.
- Local AI provider pagination works within the returned 150 configs and 75 drafts; true server-side cursor pagination is a future improvement if records exceed those limits.
- CPU/GPU/network metrics are portable to the extent supported; a missing GPU or outbound bandwidth figure is explicitly reported as unavailable, never fabricated. Host disk capacity is available on Linux/Windows/macOS where OS APIs allow it.
- Server page is *not* a remote shell. Its console is a read-only, bounded application log.
- Financial “Delete” and “Clear paid” archive records from the default Admin view only; never delete or reverse payments.
- Admin and Live Chat still depend on Go/PostgreSQL. No Supabase Auth/RLS or Realtime replacement is part of this update.
