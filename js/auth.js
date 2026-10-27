/* ============================================================
   DataVault — auth.js
   Sign-in state (Netlify Identity) + the site-wide top menu.

   Pages wait for the session with:   await DVAuthManager.ready();
   Every account can both buy and sell — no roles to pick.
   ============================================================ */

'use strict';

const DVAuthManager = (() => {

  let _user    = null;
  let _profile = null;
  let _resolveReady;
  const _ready = new Promise(r => { _resolveReady = r; });
  let _started = false;

  /* Only same-site paths are allowed as a post-login destination */
  function safeReturnTo(value) {
    if (!value) return null;
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin !== window.location.origin) return null;
      if (url.pathname.endsWith('login.html')) return null;
      return url.pathname + url.search + url.hash;
    } catch {
      return null;
    }
  }

  async function loadProfile() {
    if (!_user) { _profile = null; return null; }
    const { data } = await DVSupabase.profiles.get();
    _profile = data || null;
    return _profile;
  }

  /* Where to go after signing in */
  async function homeFor() {
    let back = safeReturnTo(new URLSearchParams(window.location.search).get('returnTo'));
    try {
      // Set before leaving for Google sign-in
      back = back || safeReturnTo(sessionStorage.getItem('dv_return_to'));
      sessionStorage.removeItem('dv_return_to');
    } catch { /* storage blocked */ }
    if (!_user) _user = window.netlifyIdentity?.currentUser?.() || window.netlifyIdentity?.gotrue?.currentUser?.() || null;
    if (!_profile) await loadProfile().catch(() => null);
    if (!_profile) return 'onboard.html' + (back ? `?returnTo=${encodeURIComponent(back)}` : '');
    return back || 'dashboard.html';
  }

  async function goHome() {
    window.location.href = await homeFor();
  }

  function init() {
    if (_started) return;
    _started = true;
    renderNav();

    if (window.DV_CONFIG?.DEMO_MODE) {
      enableDemoUser();
      _resolveReady();
      return;
    }

    const identity = window.netlifyIdentity;
    if (!identity) {
      console.error('[DVAuth] Netlify Identity widget not loaded.');
      _resolveReady();
      return;
    }

    let initDone = false;
    identity.on('init', async user => {
      _user = user || null;
      await loadProfile().catch(() => null);
      initDone = true;
      renderNav();
      _resolveReady();
    });

    // Fires after Google sign-in, email confirmation, or the Identity popup
    identity.on('login', async user => {
      _user = user;
      identity.close();
      await loadProfile().catch(() => null);
      renderNav();
      if (!window.DV_NO_AUTH_REDIRECT) goHome();
    });

    identity.on('logout', () => {
      _user = null;
      _profile = null;
      renderNav();
    });

    identity.on('error', err => console.error('[DVAuth] Identity error:', err));

    // Safety net if 'init' never fires (widget blocked, offline)
    setTimeout(() => {
      if (!initDone) {
        _user = identity.currentUser?.() || null;
        loadProfile().catch(() => null).finally(() => { renderNav(); _resolveReady(); });
      }
    }, 2500);
  }

  function ready() { return _ready; }

  /* ── Actions ─────────────────────────────────────────── */
  function openLogin()  { window.location.href = 'login.html'; }
  function openSignup() { window.location.href = 'login.html?mode=signup'; }

  function signInWithGoogle() {
    window.location.href = '/.netlify/identity/authorize?provider=google';
  }

  function signOut() {
    window.netlifyIdentity?.logout();
    _user = null;
    _profile = null;
    window.location.href = 'index.html';
  }

  /* Send signed-out visitors to the login page; resolves to true when signed in */
  async function requireAuth() {
    await ready();
    if (_user) return true;
    const here = window.location.pathname.split('/').pop() + window.location.search + window.location.hash;
    window.location.href = `login.html?returnTo=${encodeURIComponent(here)}`;
    return false;
  }

  /* Signed in AND finished the one-page profile */
  async function requireProfile() {
    if (!(await requireAuth())) return false;
    if (_profile) return true;
    const here = window.location.pathname.split('/').pop() + window.location.search + window.location.hash;
    window.location.href = `onboard.html?returnTo=${encodeURIComponent(here)}`;
    return false;
  }

  /* ── Top menu ───────────────────────────────────────── */
  function renderNav() {
    const nav = document.querySelector('nav.nav');
    if (!nav) return;
    const page = window.location.pathname.split('/').pop() || 'index.html';
    const link = (href, label) =>
      `<a href="${href}" class="nav__link${page === href ? ' nav__link--active' : ''}">${label}</a>`;

    const name = (_profile?.business_name || _user?.user_metadata?.full_name || _user?.email || 'My account');
    const shortName = name.length > 18 ? name.slice(0, 16) + '…' : name;

    const actions = _user
      ? `<a href="upload.html" class="btn btn--accent btn--sm nav__cta">Sell data</a>
         <div class="nav__menu">
           <button class="btn btn--outline btn--sm" id="nav-user-btn" aria-haspopup="true" aria-expanded="false">${esc(shortName)} ▾</button>
           <div class="nav__dropdown" id="nav-user-dropdown" hidden>
             <a href="dashboard.html#buying">🛒 Things I'm buying</a>
             <a href="dashboard.html#selling">💰 Things I'm selling</a>
             <a href="dashboard.html#settings">⚙️ My account</a>
             <button type="button" onclick="DVAuthManager.signOut()">Sign out</button>
           </div>
         </div>`
      : `<a href="login.html" class="btn btn--outline btn--sm">Log in</a>
         <a href="login.html?mode=signup" class="btn btn--accent btn--sm nav__cta">Sign up free</a>`;

    nav.innerHTML = `
      <div class="nav__inner">
        <a href="index.html" class="nav__logo"><span class="nav__logo-icon">🔐</span> DataVault</a>
        <div class="nav__links" id="nav-links">
          ${link('marketplace.html', 'Browse data')}
          ${link('upload.html', 'Sell your data')}
          ${link('pricing.html', 'Pricing')}
          ${link('faq.html', 'Help')}
          ${_user ? link('dashboard.html', 'My dashboard') : '<a href="login.html?mode=signup" class="nav__link nav__link--mobile-only">✨ Sign up free</a>'}
        </div>
        <div class="nav__actions">
          ${actions}
          <button class="nav__hamburger" id="nav-hamburger" aria-label="Open menu" aria-expanded="false">☰</button>
        </div>
      </div>`;

    const burger = nav.querySelector('#nav-hamburger');
    const links  = nav.querySelector('#nav-links');
    burger.addEventListener('click', () => {
      const open = links.classList.toggle('nav__links--mobile-open');
      burger.setAttribute('aria-expanded', String(open));
      burger.textContent = open ? '✕' : '☰';
    });

    const btn = nav.querySelector('#nav-user-btn');
    const dd  = nav.querySelector('#nav-user-dropdown');
    if (btn && dd) {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        dd.hidden = !dd.hidden;
        btn.setAttribute('aria-expanded', String(!dd.hidden));
      });
      document.addEventListener('click', () => { dd.hidden = true; btn.setAttribute('aria-expanded', 'false'); });
    }
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── Local-file demo ─────────────────────────────────── */
  function enableDemoUser() {
    _user    = { id: 'demo-user', email: 'demo@example.com' };
    _profile = { ...DVSupabase.DEMO_DATA.profile };
    renderNav();
  }

  function setProfile(p) { _profile = p; renderNav(); }

  return {
    init, ready, openLogin, openSignup, signInWithGoogle, signOut,
    requireAuth, requireProfile, renderNav, updateNavAuth: renderNav,
    enableDemoUser, setProfile, goHome, homeFor, safeReturnTo, loadProfile,
    get user()       { return _user; },
    get profile()    { return _profile; },
    get isLoggedIn() { return !!_user; },
    get isSeller()   { return !!_profile; },
    get isBuyer()    { return !!_profile; },
    get isVerified() { return _profile?.verified === true; },
  };
})();

window.DVAuthManager = DVAuthManager;

// Listen to Identity right away (before the widget fires 'init'),
// then draw the menu once the page exists.
DVAuthManager.init();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => DVAuthManager.renderNav());
}
