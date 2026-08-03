/* ============================================================
   DataVault — auth.js (Netlify Identity version)
   Auth state management using Netlify Identity (gotrue-js).

   Loads the Netlify Identity widget, which:
   - Handles email/password signup + login
   - Sends magic links automatically
   - Supports Google, GitHub OAuth (enabled in Netlify UI)
   - Manages JWT tokens for API auth

   No Supabase needed. Zero external account setup required.
   ============================================================ */

'use strict';

const DVAuthManager = (() => {

  let _user    = null;
  let _profile = null;
  let _ready   = false;
  let _listeners = [];

  /* ----------------------------------------------------------
     INIT — call on every page load.
     Netlify Identity auto-restores session from localStorage.
     ---------------------------------------------------------- */
  async function init() {
    const identity = window.netlifyIdentity;
    if (!identity) {
      console.error('[DVAuth] Netlify Identity widget not loaded.');
      // Fallback: demo mode
      if (window.DV_CONFIG?.DEMO_MODE) enableDemoUser('seller');
      return;
    }

    // When Identity is ready it fires this event
    identity.on('init', async user => {
      _user  = user;
      _ready = true;
      if (user) {
        await loadProfile(user.id);
      }
      updateNavAuth();
    });

    identity.on('login', async user => {
      _user = user;
      await loadProfile(user.id);
      updateNavAuth();
      _notifyListeners('SIGNED_IN', user);

      // Handle redirect after login
      const params   = new URLSearchParams(window.location.search);
      const returnTo = params.get('returnTo');
      if (returnTo) {
        window.location.href = decodeURIComponent(returnTo);
        return;
      }

      // Default redirect based on role
      if (_profile?.role === 'seller') {
        window.location.href = 'dashboard.html';
      } else if (_profile?.role === 'buyer') {
        window.location.href = 'buyer-dashboard.html';
      } else {
        window.location.href = 'onboard.html';
      }
    });

    identity.on('logout', () => {
      _user    = null;
      _profile = null;
      updateNavAuth();
      _notifyListeners('SIGNED_OUT', null);
    });

    identity.on('error', err => {
      console.error('[DVAuth] Identity error:', err);
    });

    // If user is already logged in from localStorage
    _user = identity.currentUser();
    if (_user) {
      await loadProfile(_user.id);
      updateNavAuth();
    }
  }

  /* ----------------------------------------------------------
     LOAD PROFILE from /profile function
     ---------------------------------------------------------- */
  async function loadProfile(userId) {
    try {
      const { data } = await DVSupabase.profiles.get(userId);
      _profile = data;
    } catch (err) {
      console.warn('[DVAuth] Could not load profile:', err.message);
      _profile = null;
    }
    return _profile;
  }

  /* ----------------------------------------------------------
     AUTH ACTIONS
     ---------------------------------------------------------- */
  function openLogin()  {
    const identity = window.netlifyIdentity;
    if (!identity) { window.location.href = 'login.html'; return; }
    identity.open('login');
  }

  function openSignup() {
    const identity = window.netlifyIdentity;
    if (!identity) { window.location.href = 'onboard.html'; return; }
    identity.open('signup');
  }

  async function signOut() {
    window.netlifyIdentity?.logout();
    _user    = null;
    _profile = null;
    window.location.href = 'index.html';
  }

  /* ----------------------------------------------------------
     ROUTE GUARDS
     ---------------------------------------------------------- */
  async function requireAuth() {
    if (!isLoggedIn()) {
      const returnTo = encodeURIComponent(window.location.href);
      window.location.href = `login.html?returnTo=${returnTo}`;
      return false;
    }
    return true;
  }

  async function requireSeller() {
    const ok = await requireAuth();
    if (!ok) return false;
    if (!isSeller()) {
      window.location.href = 'onboard.html';
      return false;
    }
    return true;
  }

  /* ----------------------------------------------------------
     GETTERS
     ---------------------------------------------------------- */
  function getUser()     { return _user; }
  function getProfile()  { return _profile; }
  function isLoggedIn()  { return !!_user; }
  function isSeller()    { return _profile?.role === 'seller' || _profile?.role === 'both'; }
  function isBuyer()     { return _profile?.role === 'buyer'  || _profile?.role === 'both'; }
  function isVerified()  { return _profile?.verified === true; }

  /* ----------------------------------------------------------
     UPDATE NAV based on auth state
     ---------------------------------------------------------- */
  function updateNavAuth() {
    const actionsEl = document.querySelector('.nav__actions');
    if (!actionsEl) return;

    if (isLoggedIn()) {
      const dashboardUrl = isSeller() ? 'dashboard.html' : 'buyer-dashboard.html';
      const displayName  = _profile?.business_name || _user?.user_metadata?.full_name || _user?.email || 'Account';
      const name         = displayName.length > 20 ? displayName.slice(0, 18) + '…' : displayName;

      actionsEl.innerHTML = `
        <a href="marketplace.html" class="btn btn--outline btn--sm">Browse Data</a>
        <div style="position:relative">
          <button class="btn btn--accent btn--sm" id="nav-user-btn" aria-expanded="false">
            ${name} ▾
          </button>
          <div id="nav-user-dropdown" style="display:none;position:absolute;right:0;top:calc(100% + 8px);background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--r-lg);box-shadow:var(--sh-lg);min-width:180px;z-index:200;overflow:hidden;">
            <a href="${dashboardUrl}" style="display:block;padding:12px 16px;color:var(--c-text);text-decoration:none;font-weight:600;border-bottom:1px solid var(--c-border);">📊 My Dashboard</a>
            ${isSeller() ? `<a href="upload.html" style="display:block;padding:12px 16px;color:var(--c-text);text-decoration:none;">📤 Upload Dataset</a>` : ''}
            <a href="${dashboardUrl}#settings" style="display:block;padding:12px 16px;color:var(--c-text);text-decoration:none;">⚙️ Settings</a>
            <button onclick="DVAuthManager.signOut()" style="display:block;width:100%;padding:12px 16px;text-align:left;background:none;border:none;border-top:1px solid var(--c-border);color:var(--c-error);font-weight:600;cursor:pointer;font-family:var(--font);font-size:var(--fs-sm);">← Sign Out</button>
          </div>
        </div>
      `;

      const btn = document.getElementById('nav-user-btn');
      const dropdown = document.getElementById('nav-user-dropdown');
      if (btn && dropdown) {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const open = dropdown.style.display !== 'none';
          dropdown.style.display = open ? 'none' : 'block';
          btn.setAttribute('aria-expanded', String(!open));
        });
        document.addEventListener('click', () => {
          dropdown.style.display = 'none';
        }, { once: false });
      }
    } else {
      actionsEl.innerHTML = `
        <a href="marketplace.html" class="btn btn--outline btn--sm">Browse Data</a>
        <button class="btn btn--outline btn--sm" onclick="DVAuthManager.openLogin()">Log In</button>
        <button class="btn btn--accent btn--sm" onclick="DVAuthManager.openSignup()">Start Selling</button>
      `;
    }
  }

  /* ----------------------------------------------------------
     DEMO MODE
     ---------------------------------------------------------- */
  function enableDemoUser(role = 'seller') {
    _user    = { id: 'demo-user', email: 'demo@example.com' };
    _profile = { ...DVSupabase.DEMO_DATA.profile, role };
    updateNavAuth();
  }

  /* ----------------------------------------------------------
     LISTENERS
     ---------------------------------------------------------- */
  function onChange(callback) {
    _listeners.push(callback);
    return () => { _listeners = _listeners.filter(l => l !== callback); };
  }

  function _notifyListeners(event, session) {
    _listeners.forEach(fn => fn(event, session));
  }

  /* ----------------------------------------------------------
     PUBLIC API
     ---------------------------------------------------------- */
  return {
    init,
    openLogin,
    openSignup,
    signOut,
    requireAuth,
    requireSeller,
    updateNavAuth,
    onChange,
    enableDemoUser,
    get user()       { return getUser(); },
    get profile()    { return getProfile(); },
    get isLoggedIn() { return isLoggedIn(); },
    get isSeller()   { return isSeller(); },
    get isBuyer()    { return isBuyer(); },
    get isVerified() { return isVerified(); },
  };

})();

window.DVAuthManager = DVAuthManager;

/* ----------------------------------------------------------
   AUTO-INIT on DOMContentLoaded
   ---------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => DVAuthManager.init());
