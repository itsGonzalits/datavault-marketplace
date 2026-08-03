# DataVault Setup Guide

This guide will walk you through setting up the complete backend infrastructure for DataVault.

## 1. Create Supabase Project
1. Go to [Supabase](https://supabase.com/) and sign in.
2. Click **New Project** and select your organization.
3. Enter project details (Name, strong Database Password, Region).
4. Wait a few minutes for the database to provision.

## 2. Run Database Schema
1. In the Supabase dashboard, go to the **SQL Editor** (left sidebar).
2. Click **New Query**.
3. Copy the contents of `schema.sql` and paste it into the editor.
4. Click **Run**. This will create all tables, indexes, policies, and triggers.

## 3. Enable Google OAuth
1. Go to **Authentication > Providers** in the Supabase dashboard.
2. Enable **Google**.
3. You will need to obtain a Client ID and Client Secret from the [Google Cloud Console](https://console.cloud.google.com/):
   - Create a new project.
   - Set up the OAuth consent screen.
   - Create OAuth 2.0 Client IDs (Web application).
   - Add your Supabase project URL + `/auth/v1/callback` as an Authorized redirect URI.
4. Enter the Client ID and Secret in Supabase and click **Save**.

## 4. Create Storage Buckets
1. Go to **Storage** in the Supabase dashboard.
2. Click **New Bucket**.
3. Name it `datasets`. Make sure **Public bucket** is **OFF**.
   - Under Configuration, you can restrict uploads to a 100MB limit.
4. Create another bucket named `verification-docs`. Make sure **Public bucket** is **OFF**.

## 5. Set up Stripe
1. Create a [Stripe Account](https://stripe.com/).
2. Go to **Developers > API keys**.
3. Note your **Publishable key** and **Secret key**.

## 6. Create Stripe Webhook
1. In Stripe, go to **Developers > Webhooks**.
2. Click **Add endpoint**.
3. Set the Endpoint URL to: `https://YOUR_SITE.netlify.app/.netlify/functions/stripe-webhook`
4. Select events to listen to:
   - `payment_intent.succeeded`
   - `payment_intent.canceled`
5. Click **Add endpoint**.
6. Reveal your **Signing secret** (Webhook Secret). Save this for Netlify.

## 7. Get Resend API Key
1. Sign up for [Resend](https://resend.com/).
2. Add and verify your sending domain.
3. Go to **API Keys** and generate a new key. Save it.

## 8. Update Client Configuration
1. In your project code, open `js/config.js` (create it if missing).
2. Add your public keys:
```javascript
window.CONFIG = {
  SUPABASE_URL: 'your_supabase_project_url',
  SUPABASE_ANON_KEY: 'your_supabase_anon_key',
  STRIPE_PUBLISHABLE_KEY: 'your_stripe_publishable_key'
};
```

## 9. Deploy to Netlify
1. Connect your Git repository to Netlify, or use the Netlify CLI: `netlify deploy --prod`
2. Ensure the base directory is correct and functions are mapped to `netlify/functions` (handled by `netlify.toml`).

## 10. Set Netlify Environment Variables
1. Go to your site settings in Netlify: **Site configuration > Environment variables**.
2. Add the following keys:
   - `STRIPE_SECRET_KEY`: Your Stripe secret key
   - `STRIPE_WEBHOOK_SECRET`: Your Stripe webhook signing secret
   - `SUPABASE_URL`: Your Supabase Project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase Service Role key (found in Supabase API settings)
   - `RESEND_API_KEY`: Your Resend API key

## 11. Testing Checklist
- [ ] Sign up as a new user (check if `profiles` record is auto-created).
- [ ] Create a dataset listing.
- [ ] Place a bid (check if Stripe PaymentIntent is created).
- [ ] Win an auction (trigger `capture-payment` and verify payment is captured in Stripe).
- [ ] Check if the Resend email with the download link and key was received.
- [ ] Verify the Stripe Webhook correctly updates the transaction status to 'completed'.
