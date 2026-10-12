# JPano Portfolio — SMTP delivery and email templates (2026-10-12)

## What changed in this source release

- Automatic enquiry/feedback replies now instruct KaaBAG to write **body text only**. The backend removes stray AI closing signatures and replaces them with a fixed, owner-controlled signature. Existing unsent drafts are also cleaned at send time.
- Payment acknowledgements are **not drafted by AI**. They use the verified project's stored payment status, total received and project price. A partial payment is not misrepresented as a full payment or individual installment.
- Messages have a branded HTML presentation **and** a plain-text MIME alternative, with properly encoded UTF-8, quoted-printable transfer encoding, RFC-compliant headers, and consistent `From`/SMTP envelope identity.
- `.env` supports optional `EMAIL_SIGNATURE_NAME=Jhon Anthony Pano`; if omitted, the backend uses that same default.
- Payment confirmation emails remain triggered only by server-verified payment flow; these changes do not touch the checkout, webhook, or API routing code.
- `compile.bat` is unchanged. Two older JavaScript regression tests now allow a configured private developer `.env`; they still enforce browser-secret isolation during the actual release build.

## Why `550 5.7.30` occurs

Google rejected the message because its **DKIM authentication did not pass**. This is a post-send delivery failure; an email in Gmail's Sent folder, or successful submission to `smtp.gmail.com`, does not guarantee arrival at the recipient.

Your uploaded configuration uses an `@gmail.com` address for `SMTP_EMAIL` and `smtp.gmail.com` for delivery. You do **not** control DNS for `gmail.com`, so do not try to add `google._domainkey` to `jpano.dev` expecting it to authenticate mail whose `From:` is `...@gmail.com`.

### Personal Gmail (`SMTP_EMAIL=...@gmail.com`)

1. Verify `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, and `SMTP_EMAIL` is the exact Gmail account authorized for the SMTP app password. Keep `From:` using the authenticated account; the application already does so. Regenerate the app password after any exposure of credentials.
2. From the Gmail **web app**, send a new test message to a *different* mailbox. If that arrives, open it in the recipient's Gmail, choose **More (three dots) → Show original**, and check the `Authentication-Results` entries for `spf=pass`, `dkim=pass`, and preferably `dmarc=pass`.
3. Send an application-generated email to the same different mailbox and compare its **Show original** headers. If Gmail web mail authenticates but app-generated mail is rejected, check that production really uses Gmail SMTP, no alternate relay modifies the message, and that authenticated `SMTP_EMAIL` matches the `From:` address. The backend does not DKIM-sign; Gmail must sign outgoing mail.
4. If both mail paths produce a DKIM failure, this is an account/provider authentication issue. Google support is the correct next diagnostic; changing HTML or adding `jpano.dev` records cannot resolve `gmail.com` signing.
5. Look at the **Mail Delivery Subsystem** bounce for actual rejection details. The server marks emails as sent after SMTP DATA acceptance; it cannot infer whether the recipient's system subsequently bounced the mail without a separate bounce-event integration.

### Custom domain (e.g., `hello@jpano.dev`, using Google Workspace)

Only follow this if you actually have **Google Workspace email service and a mailbox on that domain**, not merely a domain/web hosting or a free personal Gmail account:

1. Go to **Google Admin console → Apps → Google Workspace → Gmail → Authenticate email**. Generate a **2048-bit DKIM key** (when supported).
2. Add the *exact* generated TXT record to your domain's DNS host (e.g., Cloudflare). The selector may be `google._domainkey`, but use what Google actually gives you.
3. After DNS propagates, click **Start authentication** in the Google Admin console. Authenticate messages with Gmail's **Show original** and check `dkim=pass` with `header.d=jpano.dev`.
4. Configure SPF for the actual sender(s), and a DMARC TXT record, following your provider's directions. Do **not** replace an existing SPF record blindly; a domain should only have one combined SPF record.
5. Change `SMTP_EMAIL` to the authorized custom-domain sender only after the email provider and that account are ready. Keep its envelope/from identity aligned.

If you use a transactional email provider instead of Google Workspace, follow that provider's SPF/DKIM/DMARC setup; the Google Admin DKIM link will not apply.

Google references:
- DKIM setup: https://support.google.com/a/answer/174124
- Gmail sender guidelines: https://support.google.com/mail/answer/81126
- SMTP error 550 5.7.30: https://support.google.com/mail/answer/3726730

## Safe deployment

This shared source ZIP ships with a sanitized `.env` (private keys, DB passwords and API secrets have been blanked) because the uploaded source contained populated credentials. **Keep your actual working `.env` private**, rotate exposed credentials, and transfer newly rotated values to your own local/server configuration before deploying. Never place server `.env` values inside `client/dist/` or commit them to Git.

To apply only the email changes without touching your `.env`, copy these files from the accompanying email-only patch ZIP into `server/`:

- `email.go`
- `email_content.go` (new)
- `email_test.go` (new tests)
- `ai_replies.go`
- `transactions.go`

Also replace `client/scripts/tests/operations-followup.test.mjs` and `client/scripts/tests/payment-ai-chat.test.mjs` to keep the full regression suite compatible with private local `.env` values.

Then build with your usual `compile.bat`. No separate audit command is needed. The full server module requires **Go 1.25+** and your project dependencies. The environment used to prepare this fix could execute focused Go SMTP/template tests but could not fetch the 1.25 toolchain to run the full server module.
