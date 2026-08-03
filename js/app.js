/* ============================================================
   DataVault — app.js
   Core application: routing, state, auth helpers, shared UI
   ============================================================ */

'use strict';

/* ============================================================
   STATE
   ============================================================ */
const State = {
  user: null,
  role: null, // 'vendor' | 'buyer' | null
  datasets: [],
  bids: [],

  load() {
    try {
      this.user     = JSON.parse(localStorage.getItem('dv_user') || 'null');
      this.role     = localStorage.getItem('dv_role') || null;
      this.datasets = JSON.parse(localStorage.getItem('dv_datasets') || '[]');
      this.bids     = JSON.parse(localStorage.getItem('dv_bids') || '[]');
    } catch { /* ignore parse errors */ }
  },

  save() {
    localStorage.setItem('dv_user',     JSON.stringify(this.user));
    localStorage.setItem('dv_role',     this.role || '');
    localStorage.setItem('dv_datasets', JSON.stringify(this.datasets));
    localStorage.setItem('dv_bids',     JSON.stringify(this.bids));
  },

  login(user, role) {
    this.user = user;
    this.role = role;
    this.save();
  },

  logout() {
    this.user = null;
    this.role = null;
    localStorage.removeItem('dv_user');
    localStorage.removeItem('dv_role');
  },

  addDataset(ds) {
    ds.id = 'ds_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    ds.createdAt = Date.now();
    ds.bids = [];
    ds.status = 'active';
    this.datasets.push(ds);
    this.save();
    return ds;
  },

  placeBid(datasetId, amount, buyerInfo) {
    const bid = {
      id: 'bid_' + Date.now(),
      datasetId,
      amount,
      buyerId: buyerInfo?.id || 'anon',
      buyerLabel: 'Buyer #' + Math.floor(1000 + Math.random() * 9000),
      timestamp: Date.now(),
    };
    this.bids.push(bid);

    const ds = this.datasets.find(d => d.id === datasetId);
    if (ds) {
      ds.bids.push(bid);
      ds.topBid = Math.max(...ds.bids.map(b => b.amount));
    }
    this.save();
    return bid;
  },
};

/* ============================================================
   TOAST NOTIFICATIONS
   ============================================================ */
const Toast = {
  container: null,

  init() {
    if (document.getElementById('toast-container')) {
      this.container = document.getElementById('toast-container');
      return;
    }
    this.container = document.createElement('div');
    this.container.id = 'toast-container';
    this.container.className = 'toast-container';
    document.body.appendChild(this.container);
  },

  show(message, type = 'default', duration = 4000) {
    if (!this.container) this.init();
    const icons = { success: '✅', error: '❌', warning: '⚠️', default: '💬' };
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `<span>${icons[type] || icons.default}</span><span>${message}</span>`;
    this.container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(110%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 350);
    }, duration);
  },

  success(msg) { this.show(msg, 'success'); },
  error(msg)   { this.show(msg, 'error');   },
  warning(msg) { this.show(msg, 'warning'); },
};

/* ============================================================
   MODAL HELPERS
   ============================================================ */
const Modal = {
  open(overlayId) {
    const el = document.getElementById(overlayId);
    if (el) {
      el.classList.add('modal-overlay--open');
      document.body.style.overflow = 'hidden';
    }
  },
  close(overlayId) {
    const el = document.getElementById(overlayId);
    if (el) {
      el.classList.remove('modal-overlay--open');
      document.body.style.overflow = '';
    }
  },
  closeAll() {
    document.querySelectorAll('.modal-overlay').forEach(el => {
      el.classList.remove('modal-overlay--open');
    });
    document.body.style.overflow = '';
  },
};

/* ============================================================
   ACCORDION
   ============================================================ */
function initAccordions() {
  document.querySelectorAll('.accordion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.accordion-item');
      const isOpen = item.classList.contains('accordion-item--open');

      // Close all
      document.querySelectorAll('.accordion-item').forEach(i =>
        i.classList.remove('accordion-item--open')
      );

      // Toggle current
      if (!isOpen) item.classList.add('accordion-item--open');
    });
  });
}

/* ============================================================
   SIDEBAR NAVIGATION (dashboard pages)
   ============================================================ */
function initSidebarNav() {
  const links = document.querySelectorAll('.sidebar__nav-link[data-section]');
  if (!links.length) return;

  links.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const target = link.dataset.section;

      // Update active link
      links.forEach(l => l.classList.remove('sidebar__nav-link--active'));
      link.classList.add('sidebar__nav-link--active');

      // Show target section, hide others
      document.querySelectorAll('.dashboard-section').forEach(sec => {
        sec.classList.toggle('hidden', sec.id !== target);
      });
    });
  });
}

/* ============================================================
   COUNTDOWN TIMERS
   ============================================================ */
function initCountdowns() {
  document.querySelectorAll('[data-countdown]').forEach(el => {
    const end = parseInt(el.dataset.countdown, 10);
    if (isNaN(end)) return;

    const tick = () => {
      const now  = Date.now();
      const diff = Math.max(0, end - now);
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);

      const dEl = el.querySelector('[data-days]');
      const hEl = el.querySelector('[data-hours]');
      const mEl = el.querySelector('[data-minutes]');
      const sEl = el.querySelector('[data-seconds]');

      if (dEl) dEl.textContent = String(d).padStart(2, '0');
      if (hEl) hEl.textContent = String(h).padStart(2, '0');
      if (mEl) mEl.textContent = String(m).padStart(2, '0');
      if (sEl) sEl.textContent = String(s).padStart(2, '0');

      if (diff > 0) setTimeout(tick, 1000);
      else {
        el.innerHTML = '<span style="color:var(--c-error);font-weight:700">Auction Ended</span>';
      }
    };
    tick();
  });
}

/* ============================================================
   SCROLL ANIMATIONS (IntersectionObserver)
   ============================================================ */
function initScrollAnimations() {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.animate-on-scroll').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(24px)';
    el.style.transition = 'opacity 0.55s ease, transform 0.55s ease';
    obs.observe(el);
  });
}

/* ============================================================
   MOBILE NAV TOGGLE
   ============================================================ */
function initMobileNav() {
  const hamburger = document.querySelector('.nav__hamburger');
  const links     = document.querySelector('.nav__links');
  if (!hamburger || !links) return;

  hamburger.addEventListener('click', () => {
    const open = links.classList.toggle('nav__links--mobile-open');
    hamburger.textContent = open ? '✕' : '☰';
  });

  // Close when link clicked
  links.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      links.classList.remove('nav__links--mobile-open');
      hamburger.textContent = '☰';
    });
  });
}

/* ============================================================
   TABS (FAQ page categories)
   ============================================================ */
function initTabs() {
  document.querySelectorAll('[data-tab-group]').forEach(group => {
    const groupName = group.dataset.tabGroup;
    const tabs = group.querySelectorAll('[data-tab]');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('chip--selected'));
        tab.classList.add('chip--selected');
        const target = tab.dataset.tab;
        document.querySelectorAll(`[data-tab-content="${groupName}"]`).forEach(section => {
          section.classList.toggle('hidden', section.dataset.tabTarget !== target && target !== 'all');
        });
      });
    });
  });
}

/* ============================================================
   FORM VALIDATION
   ============================================================ */
const Validate = {
  required(input) {
    const val = input.value.trim();
    if (!val) {
      this.error(input, 'This field is required.');
      return false;
    }
    this.clear(input);
    return true;
  },

  email(input) {
    const val = input.value.trim();
    if (!val) { this.error(input, 'Email is required.'); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      this.error(input, 'Please enter a valid email address.');
      return false;
    }
    this.clear(input);
    return true;
  },

  min(input, minimum) {
    const val = parseFloat(input.value);
    if (isNaN(val) || val < minimum) {
      this.error(input, `Must be at least $${minimum}.`);
      return false;
    }
    this.clear(input);
    return true;
  },

  error(input, msg) {
    input.classList.add('input--error');
    input.classList.add('animate-shake');
    setTimeout(() => input.classList.remove('animate-shake'), 500);

    let errEl = input.parentElement.querySelector('.form-error');
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.className = 'form-error';
      input.parentElement.appendChild(errEl);
    }
    errEl.textContent = '⚠ ' + msg;
  },

  clear(input) {
    input.classList.remove('input--error');
    const errEl = input.parentElement.querySelector('.form-error');
    if (errEl) errEl.remove();
  },

  clearAll(form) {
    form.querySelectorAll('.input--error').forEach(i => i.classList.remove('input--error'));
    form.querySelectorAll('.form-error').forEach(e => e.remove());
  },
};

/* ============================================================
   CHIP MULTI-SELECT
   ============================================================ */
function initChipSelects() {
  document.querySelectorAll('.chip[data-selectable]').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('chip--selected');
    });
  });
}

/* ============================================================
   TOGGLE SWITCHES
   ============================================================ */
function initToggles() {
  document.querySelectorAll('.toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('toggle--on');
      const input = toggle.querySelector('input[type="checkbox"]');
      if (input) input.checked = toggle.classList.contains('toggle--on');
    });
  });
}

/* ============================================================
   PRICE INPUT FORMATTING
   ============================================================ */
function initPriceInputs() {
  document.querySelectorAll('input[data-price]').forEach(input => {
    input.addEventListener('blur', () => {
      const val = parseFloat(input.value);
      if (!isNaN(val)) input.value = val.toFixed(2);
    });
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^0-9.]/g, '');
    });
  });
}

/* ============================================================
   PROGRESS STEPS (Wizard)
   ============================================================ */
const Wizard = {
  currentStep: 1,
  totalSteps: 4,

  init(total = 4) {
    this.totalSteps  = total;
    this.currentStep = 1;
    this.render();
  },

  goTo(step) {
    this.currentStep = step;
    this.render();

    // Show/hide step panels
    document.querySelectorAll('[data-step]').forEach(panel => {
      panel.classList.toggle('hidden', parseInt(panel.dataset.step, 10) !== step);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  next() {
    if (this.currentStep < this.totalSteps) this.goTo(this.currentStep + 1);
  },

  render() {
    document.querySelectorAll('.step').forEach((stepEl, i) => {
      const n = i + 1;
      stepEl.classList.toggle('step--active', n === this.currentStep);
      stepEl.classList.toggle('step--done',   n < this.currentStep);
    });
  },
};

/* ============================================================
   NAV AUTH STATE — delegates to DVAuthManager (auth.js)
   The real implementation lives in DVAuthManager.updateNavAuth().
   This stub exists only for backward compat with old call sites.
   ============================================================ */
function updateNavAuth() {
  if (window.DVAuthManager?.updateNavAuth) {
    window.DVAuthManager.updateNavAuth();
  }
}

/* ============================================================
   CONFETTI ANIMATION
   ============================================================ */
function launchConfetti(container) {
  if (!container) return;
  const colors = ['#0D9488','#F97316','#059669','#D97706','#0EA5E9','#8B5CF6'];
  for (let i = 0; i < 60; i++) {
    const dot = document.createElement('div');
    const size = 6 + Math.random() * 8;
    dot.style.cssText = `
      position:absolute;width:${size}px;height:${size}px;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
      left:${Math.random() * 100}%;
      bottom:0;
      animation: confetti ${0.8 + Math.random() * 1.2}s ease forwards;
      animation-delay:${Math.random() * 0.5}s;
    `;
    container.appendChild(dot);
    setTimeout(() => dot.remove(), 2500);
  }
}

/* ============================================================
   ANIMATED COUNTER
   ============================================================ */
function animateCounter(el, from, to, duration = 1500, prefix = '', suffix = '') {
  const start = performance.now();
  const step = (now) => {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = Math.floor(from + (to - from) * eased);
    el.textContent = prefix + current.toLocaleString() + suffix;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  State.load();
  Toast.init();
  initAccordions();
  initSidebarNav();
  initCountdowns();
  initScrollAnimations();
  initMobileNav();
  initTabs();
  initChipSelects();
  initToggles();
  initPriceInputs();
  updateNavAuth();

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) Modal.closeAll();
    });
  });

  // Mobile nav styles (injected)
  const style = document.createElement('style');
  style.textContent = `
    @media (max-width: 768px) {
      .nav__links--mobile-open {
        display: flex !important;
        flex-direction: column;
        position: absolute;
        top: var(--nav-h);
        left: 0; right: 0;
        background: var(--c-surface);
        padding: var(--sp-4) var(--sp-6);
        border-bottom: 1px solid var(--c-border);
        box-shadow: var(--sh-lg);
        gap: var(--sp-2);
        z-index: 99;
      }
    }
  `;
  document.head.appendChild(style);
});

// Expose globally
window.DV = { State, Toast, Modal, Validate, Wizard, launchConfetti, animateCounter };
