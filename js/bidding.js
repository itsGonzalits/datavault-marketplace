/* ============================================================
   DataVault — bidding.js
   Auction engine: open English auction with reserve price
   Min increment: max($10, 5% of current price)
   ============================================================ */

'use strict';

const DVBidding = (() => {

  const PLATFORM_FEE_PCT = 0.05;  // 5%
  const MIN_INCREMENT_FLAT = 10;  // $10 minimum increment

  /* ----------------------------------------------------------
     AUCTION OBJECT
     ---------------------------------------------------------- */
  function createAuction(config) {
    return {
      id:           config.id || 'auction_' + Date.now(),
      datasetId:    config.datasetId,
      title:        config.title,
      startPrice:   parseFloat(config.startPrice) || 0,
      reservePrice: parseFloat(config.reservePrice) || 0, // PRIVATE - never sent to UI
      currentBid:   parseFloat(config.startPrice) || 0,
      topBidder:    null,
      bids:         [],
      endsAt:       config.endsAt || (Date.now() + 7 * 86400 * 1000),
      status:       'active', // active | closed | sold | reserve_not_met
      createdAt:    Date.now(),
      vendorId:     config.vendorId,
    };
  }

  /* ----------------------------------------------------------
     MINIMUM NEXT BID
     ---------------------------------------------------------- */
  function minNextBid(currentBid) {
    const pctIncrement = currentBid * 0.05;
    return currentBid + Math.max(MIN_INCREMENT_FLAT, Math.ceil(pctIncrement));
  }

  /* ----------------------------------------------------------
     VALIDATE BID
     Returns { valid: bool, error: string|null }
     ---------------------------------------------------------- */
  function validateBid(auction, amount) {
    amount = parseFloat(amount);

    if (isNaN(amount) || amount <= 0) {
      return { valid: false, error: 'Please enter a valid bid amount.' };
    }

    if (auction.status !== 'active') {
      return { valid: false, error: 'This auction is no longer accepting bids.' };
    }

    if (Date.now() > auction.endsAt) {
      return { valid: false, error: 'This auction has ended.' };
    }

    const minBid = minNextBid(auction.currentBid);
    if (amount < minBid) {
      return {
        valid: false,
        error: `Your bid must be at least $${minBid.toFixed(2)} (current: $${auction.currentBid.toFixed(2)} + min increment).`
      };
    }

    return { valid: true, error: null };
  }

  /* ----------------------------------------------------------
     PLACE BID
     ---------------------------------------------------------- */
  function placeBid(auction, amount, buyer) {
    const validation = validateBid(auction, amount);
    if (!validation.valid) throw new Error(validation.error);

    amount = parseFloat(amount);
    const previousTopBidder = auction.topBidder;

    const bid = {
      id:        'bid_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
      auctionId: auction.id,
      buyerId:   buyer?.id || 'anon',
      buyerLabel: buyer?.label || 'Buyer #' + Math.floor(1000 + Math.random() * 9000),
      amount,
      timestamp: Date.now(),
    };

    auction.bids.push(bid);
    auction.currentBid = amount;
    auction.topBidder  = bid;

    // Dispatch events for UI reactivity
    dispatchAuctionEvent('bid:placed', { auction, bid, previousTopBidder });

    if (previousTopBidder && previousTopBidder.buyerId !== buyer?.id) {
      dispatchAuctionEvent('bid:outbid', {
        auction,
        outbidBuyer: previousTopBidder,
        newBid: bid,
      });
    }

    return bid;
  }

  /* ----------------------------------------------------------
     CLOSE AUCTION (called when timer expires)
     ---------------------------------------------------------- */
  function closeAuction(auction) {
    if (auction.status !== 'active') return auction;

    const reserveMet = auction.currentBid >= auction.reservePrice;

    if (!auction.bids.length || !reserveMet) {
      auction.status = 'reserve_not_met';
      dispatchAuctionEvent('auction:closed_no_sale', { auction });
    } else {
      auction.status = 'sold';
      auction.winner = auction.topBidder;
      auction.finalPrice = auction.currentBid;
      auction.vendorPayout = auction.finalPrice * (1 - PLATFORM_FEE_PCT);
      auction.platformFee  = auction.finalPrice * PLATFORM_FEE_PCT;
      dispatchAuctionEvent('auction:sold', { auction });
    }

    return auction;
  }

  /* ----------------------------------------------------------
     RESERVE STATUS (safe for public display — no price revealed)
     ---------------------------------------------------------- */
  function getReserveStatus(auction) {
    if (auction.currentBid >= auction.reservePrice) {
      return { met: true, label: 'Reserve Met ✓', badgeClass: 'badge--success' };
    }
    return { met: false, label: 'Reserve Not Yet Met', badgeClass: 'badge--warning' };
  }

  /* ----------------------------------------------------------
     PAYOUT SUMMARY (for vendor)
     ---------------------------------------------------------- */
  function getPayoutSummary(finalPrice) {
    const fee    = finalPrice * PLATFORM_FEE_PCT;
    const payout = finalPrice - fee;
    return {
      salePrice:   finalPrice,
      platformFee: fee,
      vendorPayout: payout,
      feePercent:  PLATFORM_FEE_PCT * 100,
    };
  }

  /* ----------------------------------------------------------
     BID HISTORY RENDERER
     ---------------------------------------------------------- */
  function renderBidHistory(container, bids) {
    if (!container) return;
    if (!bids || !bids.length) {
      container.innerHTML = '<p class="text-secondary text-sm">No bids yet. Be the first!</p>';
      return;
    }

    const sorted = [...bids].sort((a, b) => b.timestamp - a.timestamp);

    container.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Bidder</th>
              <th>Amount</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map((bid, i) => `
              <tr>
                <td>
                  ${bid.buyerLabel}
                  ${i === 0 ? '<span class="badge badge--accent" style="margin-left:8px">Top Bid 🏆</span>' : ''}
                </td>
                <td style="font-weight:700;color:var(--c-accent)">$${bid.amount.toFixed(2)}</td>
                <td class="text-secondary text-sm">${timeAgo(bid.timestamp)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /* ----------------------------------------------------------
     BID INPUT UI HELPER
     Wires up a bid input to show live min-bid guidance
     ---------------------------------------------------------- */
  function wireBidInput(inputEl, auction, submitBtnEl) {
    if (!inputEl || !auction) return;

    const updateMinLabel = () => {
      const minBid = minNextBid(auction.currentBid);
      inputEl.placeholder = `Min $${minBid.toFixed(2)}`;
      inputEl.min = minBid;
      if (submitBtnEl) submitBtnEl.disabled = false;
    };

    updateMinLabel();

    inputEl.addEventListener('input', () => {
      const val = parseFloat(inputEl.value);
      const minBid = minNextBid(auction.currentBid);
      const valid  = !isNaN(val) && val >= minBid;

      inputEl.classList.toggle('input--error', !valid && inputEl.value !== '');
      if (submitBtnEl) submitBtnEl.disabled = !valid;

      // Show inline fee breakdown
      const feeEl = document.getElementById('bid-fee-breakdown');
      if (feeEl && valid) {
        const summary = getPayoutSummary(val);
        feeEl.textContent = `Platform fee (5%): $${summary.platformFee.toFixed(2)} — Vendor receives: $${summary.vendorPayout.toFixed(2)}`;
        feeEl.classList.remove('hidden');
      } else if (feeEl) {
        feeEl.classList.add('hidden');
      }
    });
  }

  /* ----------------------------------------------------------
     SAMPLE AUCTION DATA (for demo/dev)
     ---------------------------------------------------------- */
  const SAMPLE_AUCTIONS = [
    {
      id: 'ds_001',
      title: 'Q3 2024 Retail Sales Data',
      startPrice: 200,
      reservePrice: 500,
      currentBid: 680,
      endsAt: Date.now() + 3.6 * 86400 * 1000,
      status: 'active',
      bids: [
        { buyerLabel: 'Buyer #4821', amount: 200, timestamp: Date.now() - 6*3600000 },
        { buyerLabel: 'Buyer #7132', amount: 280, timestamp: Date.now() - 5*3600000 },
        { buyerLabel: 'Buyer #4821', amount: 350, timestamp: Date.now() - 4*3600000 },
        { buyerLabel: 'Buyer #9054', amount: 420, timestamp: Date.now() - 3*3600000 },
        { buyerLabel: 'Buyer #7132', amount: 500, timestamp: Date.now() - 2*3600000 },
        { buyerLabel: 'Buyer #3317', amount: 580, timestamp: Date.now() - 1*3600000 },
        { buyerLabel: 'Buyer #9054', amount: 640, timestamp: Date.now() - 0.5*3600000 },
        { buyerLabel: 'Buyer #7132', amount: 680, timestamp: Date.now() - 900000 },
      ],
      vendorId: 'v_001',
    },
  ];

  /* ----------------------------------------------------------
     HELPERS
     ---------------------------------------------------------- */
  function dispatchAuctionEvent(type, detail) {
    window.dispatchEvent(new CustomEvent('datavault:' + type, { detail }));
  }

  function timeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);
    if (days  > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (mins  > 0) return `${mins}m ago`;
    return 'Just now';
  }

  /* ----------------------------------------------------------
     PUBLIC API
     ---------------------------------------------------------- */
  return {
    createAuction,
    placeBid,
    validateBid,
    closeAuction,
    minNextBid,
    getReserveStatus,
    getPayoutSummary,
    renderBidHistory,
    wireBidInput,
    SAMPLE_AUCTIONS,
    PLATFORM_FEE_PCT,
  };

})();

window.DVBidding = DVBidding;
