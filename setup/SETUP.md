# DataVault — Go-Live Checklist

Everything runs on **Netlify** (site, sign-in, storage, functions) and **Stripe** (payments).
There is no separate database to set up.

## How money and data move

1. **Seller uploads** a file. CSV/text files have personal columns (names, emails, phones,
   addresses…) blanked out, then the file is encrypted in the browser and stored in Netlify Blobs.
   The key is stored server-side and is never sent to browsers.
2. **Buyer bids.** Stripe places a temporary *hold* (manual capture) on their card for the bid.
   When someone outbids them, their hold is released immediately and they get an email.
3. **Auction closes** — automatically when the timer ends (`close-expired-auctions` runs every
   15 minutes), or early when the seller clicks **Sell now**.
   - Top bid ≥ secret minimum → the hold is captured (charged), buyer + seller are emailed,
     and you (ADMIN_EMAIL) get a "payout due" email.
   - Otherwise every hold is released and nobody pays.
4. **Buyer downloads** the original file from *My dashboard → Buying*. The server decrypts it
   only for the winner.
5. **You pay the seller** 95% of the sale (PayPal/bank, from their account details) within
   5 business days. Stripe keeps the full charge in your Stripe balance until then.

> Card holds expire after 7 days, so auctions are capped at 6 days.

## 1. Netlify
1. Connect this repo to a Netlify site (build settings come from `netlify.toml`).
2. **Identity:** Site configuration → Identity → Enable. Under Registration choose *Open*.
   Optionally add Google under *External providers*.
3. **Forms:** the Contact page uses Netlify Forms. Under Forms, click **Enable form detection** and redeploy; then under Forms → Notifications, add your email so
   customer messages reach you.
4. **Blobs** and **Scheduled Functions** need no setup.

## 2. Stripe
1. Get your keys at https://dashboard.stripe.com/apikeys.
2. Put the **publishable** key in `js/config.js` (`STRIPE_PUBLISHABLE_KEY`). It is currently a
   `pk_test_…` key — **switch it to your `pk_live_…` key to take real money.**
3. Webhook (optional but recommended): Developers → Webhooks → Add endpoint
   `https://YOUR_SITE/.netlify/functions/stripe-webhook`, event `payment_intent.canceled`.
4. For Apple Pay, register your domain under Settings → Payment methods → Apple Pay.

## 3. Email (Resend)
1. Sign up at https://resend.com, verify your sending domain, create an API key.

## 4. Environment variables (Netlify → Site configuration → Environment variables)
| Name | Required | What it is |
|---|---|---|
| `STRIPE_SECRET_KEY` | yes | `sk_live_…` (or `sk_test_…` while testing) |
| `STRIPE_WEBHOOK_SECRET` | if using the webhook | `whsec_…` |
| `RESEND_API_KEY` | yes, for emails | Resend key |
| `RESEND_FROM` | yes, for emails | e.g. `DataVault <hello@yourdomain.com>` on your verified domain |
| `ADMIN_EMAIL` | recommended | Gets payout-due and document-review emails |
| `GEMINI_API_KEY` | optional | Better titles/descriptions, photo reading, automatic document checks. Without it, documents are reviewed by you manually. |

## 5. Test before launch (Stripe test mode)
- [ ] Sign up with email → confirm email → fill in the one-page profile.
- [ ] Sell your data: upload `templates/sales_data_template.csv`, publish.
- [ ] In another browser, sign up as a buyer and bid with card `4242 4242 4242 4242`.
- [ ] Bid again from a third account; check the first buyer's hold is released (Stripe → Payments shows it *Canceled*).
- [ ] As the seller, click **Sell now** on the dashboard → buyer is charged, both get emails.
- [ ] As the winner, Dashboard → Buying → **Download file** opens the CSV.
- [ ] Send a message on the Contact page and check it arrives.

## Paying sellers / reviewing documents
- Sales: you receive an email per sale with the seller's email and amount. Mark payouts in your
  own records (the dashboard shows "Payout on the way").
- Verification documents that weren't auto-approved are stored in the `verification-docs`
  blob store; you get an email for each one.
