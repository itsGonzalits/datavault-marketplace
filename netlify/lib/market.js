/* ============================================================
   Marketplace rules shared by every function:
   pricing, what the public may see, and closing an auction.

   Money flow
   1. A bid places a HOLD on the buyer's card (Stripe manual capture).
   2. When someone outbids them, their hold is released right away.
   3. When the auction closes, the top hold is captured (charged),
      a transaction is recorded and both sides get an email.
   4. The buyer downloads the decrypted file from their dashboard.
   ============================================================ */

const { getStore, getJSON, setJSON } = require('./blobs');
const { sendEmail, escapeHtml, money, siteUrl } = require('./email');

const PLATFORM_FEE_PCT  = 0.05;
const MIN_INCREMENT     = 10;
// Card holds expire after 7 days, so an auction must finish well inside that.
const MAX_AUCTION_DAYS  = 6;
const MIN_AUCTION_DAYS  = 1;

let _stripe = null;
function stripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw Object.assign(new Error('Payments are not configured yet.'), { status: 503 });
    _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

const round2 = n => Math.round(Number(n) * 100) / 100;

/* Lowest bid the next buyer may place */
function minNextBid(ds) {
  const top = Number(ds.current_top_bid) || 0;
  if (!top) return round2(Number(ds.starting_bid) || MIN_INCREMENT);
  return round2(top + Math.max(MIN_INCREMENT, Math.ceil(top * 0.05)));
}

function isOpenForBids(ds) {
  return ds.status === 'active' && new Date(ds.auction_end).getTime() > Date.now();
}

/* Dataset as anyone may see it — never the key, the file, or the secret minimum */
function publicDataset(ds, viewerId) {
  const isOwner = !!viewerId && ds.seller_id === viewerId;
  const out = {
    id:               ds.id,
    title:            ds.title,
    description:      ds.description,
    category:         ds.category,
    location:         ds.location,
    country:          ds.country,
    row_count:        ds.row_count,
    date_range_start: ds.date_range_start,
    date_range_end:   ds.date_range_end,
    file_type:        ds.file_type || null,
    starting_bid:     ds.starting_bid,
    current_top_bid:  ds.current_top_bid || 0,
    bid_count:        ds.bid_count || 0,
    min_next_bid:     minNextBid(ds),
    reserve_met:      (ds.current_top_bid || 0) >= (ds.reserve_price || 0) && (ds.current_top_bid || 0) > 0,
    auction_end:      ds.auction_end,
    status:           ds.status === 'active' && !isOpenForBids(ds) ? 'closing' : ds.status,
    end_reason:       ds.end_reason || null,
    sold_price:       ds.status === 'sold' ? ds.sold_price : undefined,
    ai_analysis:      ds.ai_analysis || null,
    seller:           ds.seller || null,
    seller_id:        ds.seller_id,
    created_at:       ds.created_at,
    is_owner:         isOwner,
  };
  if (isOwner) out.reserve_price = ds.reserve_price;
  return out;
}

/* Bid list as anyone may see it — bidders get stable anonymous labels */
function publicBids(bids, viewerId) {
  const labels = new Map();
  [...bids].sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach(b => {
    if (!labels.has(b.buyer_id)) labels.set(b.buyer_id, `Bidder ${labels.size + 1}`);
  });
  return [...bids]
    .filter(b => b.status !== 'replaced')
    .sort((a, b) => b.amount - a.amount)
    .map(b => ({
      id:           b.id,
      amount:       b.amount,
      status:       b.status,
      created_at:   b.created_at,
      bidder_label: viewerId && b.buyer_id === viewerId ? 'You' : labels.get(b.buyer_id),
      is_mine:      !!viewerId && b.buyer_id === viewerId,
    }));
}

/* Release a card hold; never throws */
async function releaseHold(paymentIntentId) {
  if (!paymentIntentId) return;
  try {
    await stripe().paymentIntents.cancel(paymentIntentId);
  } catch (err) {
    console.warn('[market] could not release hold', paymentIntentId, err.message);
  }
}

/* ----------------------------------------------------------
   CLOSE AUCTION
   Idempotent: safe to call from the seller button, the schedule
   and the Stripe webhook at the same time.
   opts.acceptBelowMinimum — seller chose to sell under reserve.
   ---------------------------------------------------------- */
async function closeAuction(datasetId, opts = {}) {
  const datasets = getStore('datasets');
  const bidsStore = getStore('bids');

  const ds = await getJSON(datasets, datasetId);
  if (!ds) throw Object.assign(new Error('Listing not found'), { status: 404 });
  if (ds.status !== 'active') return { dataset: ds, outcome: ds.status };

  // Claim the auction so a second caller backs off
  ds.status = 'closing';
  ds.closing_started_at = new Date().toISOString();
  await setJSON(datasets, datasetId, ds);

  const bids   = (await getJSON(bidsStore, datasetId)) || [];
  const active = bids.filter(b => b.status === 'active').sort((a, b) => b.amount - a.amount);
  const top    = active[0];
  const now    = new Date().toISOString();

  const finishWithoutSale = async (reason) => {
    for (const b of active) {
      await releaseHold(b.payment_intent_id);
      b.status = 'released';
    }
    await setJSON(bidsStore, datasetId, bids);
    ds.status = 'ended';
    ds.end_reason = reason;
    ds.ended_at = now;
    await setJSON(datasets, datasetId, ds);
    await notifyNoSale(ds, reason, active);
    return { dataset: ds, outcome: 'ended', reason };
  };

  if (!top) return finishWithoutSale('no_bids');
  if (top.amount < (ds.reserve_price || 0) && !opts.acceptBelowMinimum) return finishWithoutSale('reserve_not_met');

  // Charge the winner
  let pi;
  try {
    pi = await stripe().paymentIntents.capture(top.payment_intent_id);
  } catch (err) {
    // Already captured by an earlier attempt? Then carry on.
    pi = await stripe().paymentIntents.retrieve(top.payment_intent_id).catch(() => null);
    if (!pi || pi.status !== 'succeeded') {
      console.error('[market] capture failed for', datasetId, err.message);
      top.status = 'payment_failed';
      return finishWithoutSale('payment_failed');
    }
  }

  top.status = 'won';
  for (const b of active.slice(1)) {
    await releaseHold(b.payment_intent_id);
    b.status = 'outbid';
  }
  await setJSON(bidsStore, datasetId, bids);

  const amount = round2(top.amount);
  const tx = {
    id:                `tx_${datasetId}`,
    dataset_id:        datasetId,
    dataset_title:     ds.title,
    bid_id:            top.id,
    buyer_id:          top.buyer_id,
    buyer_email:       top.buyer_email,
    seller_id:         ds.seller_id,
    seller_email:      ds.seller_email,
    amount,
    platform_fee:      round2(amount * PLATFORM_FEE_PCT),
    seller_payout:     round2(amount * (1 - PLATFORM_FEE_PCT)),
    payout_status:     'pending',
    payment_intent_id: pi.id,
    stripe_charge_id:  pi.latest_charge || null,
    status:            'completed',
    created_at:        now,
  };
  const txStore = getStore('transactions');
  if (!(await getJSON(txStore, tx.id))) await setJSON(txStore, tx.id, tx);

  ds.status     = 'sold';
  ds.winner_id  = top.buyer_id;
  ds.sold_price = amount;
  ds.sold_at    = now;
  await setJSON(datasets, datasetId, ds);

  await notifySale(ds, tx);
  return { dataset: ds, outcome: 'sold', transaction: tx };
}

/* ── Emails ─────────────────────────────────────────────── */
async function notifySale(ds, tx) {
  const title = escapeHtml(ds.title);
  await sendEmail({
    to: tx.buyer_email,
    subject: `You won: ${ds.title}`,
    heading: 'Congratulations — you won! 🎉',
    paragraphs: [
      `Your winning bid of <strong>${money(tx.amount)}</strong> for <strong>${title}</strong> has been charged to your card.`,
      'Your file is ready. Sign in and click <strong>Download</strong> next to it on your dashboard — it opens like any normal file, no extra steps.',
    ],
    button: { label: 'Download my data', url: `${siteUrl()}/dashboard.html#buying` },
  });
  await sendEmail({
    to: ds.seller_email,
    subject: `Sold! ${ds.title} for ${money(tx.amount)}`,
    heading: 'Your data sold! 💰',
    paragraphs: [
      `<strong>${title}</strong> sold for <strong>${money(tx.amount)}</strong>.`,
      `After the 5% DataVault fee you'll receive <strong>${money(tx.seller_payout)}</strong>, paid to the payout details in your account within 5 business days.`,
    ],
    button: { label: 'View my dashboard', url: `${siteUrl()}/dashboard.html#selling` },
  });
  if (process.env.ADMIN_EMAIL) {
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `[DataVault] Payout due: ${money(tx.seller_payout)} to ${ds.seller_email}`,
      heading: 'New sale — seller payout due',
      paragraphs: [
        `Listing: ${title} (${escapeHtml(ds.id)})`,
        `Sale ${money(tx.amount)} · Fee ${money(tx.platform_fee)} · <strong>Pay seller ${money(tx.seller_payout)}</strong>`,
        `Seller: ${escapeHtml(ds.seller_email)} · Stripe payment: ${escapeHtml(tx.payment_intent_id)}`,
      ],
    });
  }
}

async function notifyNoSale(ds, reason, activeBids) {
  const title = escapeHtml(ds.title);
  const top = activeBids[0];
  const why = {
    no_bids:         'it didn\'t receive any bids this time.',
    reserve_not_met: `the highest bid (${money(top?.amount)}) was below your secret minimum price.`,
    payment_failed:  'the winning bidder\'s card could not be charged.',
  }[reason] || 'it closed without a sale.';
  await sendEmail({
    to: ds.seller_email,
    subject: `Your auction ended: ${ds.title}`,
    heading: 'Your auction has ended',
    paragraphs: [
      `<strong>${title}</strong> ended without a sale because ${why}`,
      'No fee is charged. You can list it again any time — a lower starting price or minimum usually brings more bids.',
    ],
    button: { label: 'Go to my dashboard', url: `${siteUrl()}/dashboard.html#selling` },
  });
  for (const b of activeBids) {
    await sendEmail({
      to: b.buyer_email,
      subject: `Auction ended: ${ds.title}`,
      heading: 'This auction ended without a sale',
      paragraphs: [`The auction for <strong>${title}</strong> closed without a sale. The hold on your card has been released — you were not charged.`],
      button: { label: 'Browse other data', url: `${siteUrl()}/marketplace.html` },
    });
  }
}

async function notifyOutbid(ds, bid) {
  await sendEmail({
    to: bid.buyer_email,
    subject: `You've been outbid: ${ds.title}`,
    heading: 'Someone outbid you',
    paragraphs: [
      `Another buyer bid more than your ${money(bid.amount)} on <strong>${escapeHtml(ds.title)}</strong>.`,
      'The hold on your card has been released, so you won\'t be charged. Want it? Place a new bid before the auction ends.',
    ],
    button: { label: 'Bid again', url: `${siteUrl()}/dataset.html?id=${encodeURIComponent(ds.id)}` },
  });
}

module.exports = {
  PLATFORM_FEE_PCT, MIN_INCREMENT, MAX_AUCTION_DAYS, MIN_AUCTION_DAYS,
  stripe, round2, minNextBid, isOpenForBids, publicDataset, publicBids,
  releaseHold, closeAuction, notifyOutbid,
};
