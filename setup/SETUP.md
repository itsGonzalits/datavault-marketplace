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

## 3. Enable Google OAuth in Netlify Identity
1. In your Netlify dashboard, go to your site: **datavault-marketplace**.
2. Navigate to **Site configuration > Identity > External providers**.
3. Click **Add provider** and select **Google**.
4. You have two options:
   - **Default Netlify credentials**: Zero setup, works instantly for testing and prototyping.
   - **Custom Google Cloud credentials**: For production branding ("Continue to DataVault"):
     - Go to [Google Cloud Console > Credentials](https://console.cloud.google.com/apis/credentials).
     - Configure the OAuth Consent Screen (App name: DataVault, user support email, etc.).
     - Create an **OAuth client ID** of type **Web application**.
     - Add Authorized redirect URI: `https://datavaultmarket.com/.netlify/identity/callback` (and `https://datavault-marketplace.netlify.app/.netlify/identity/callback`).
     - Copy your **Client ID** and **Client Secret** into Netlify's Google provider settings and click **Save**.

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
