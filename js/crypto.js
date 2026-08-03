/* ============================================================
   DataVault — crypto.js
   Client-side AES-256-GCM encryption using Web Crypto API
   Files are encrypted BEFORE leaving the browser.
   The server never sees plaintext data.
   ============================================================ */

'use strict';

const DVCrypto = (() => {

  /* ----------------------------------------------------------
     CONSTANTS
     ---------------------------------------------------------- */
  const ALGORITHM   = 'AES-GCM';
  const KEY_BITS    = 256;
  const PBKDF2_ITERS = 200_000;
  const SALT_BYTES  = 16;
  const IV_BYTES    = 12;

  /* ----------------------------------------------------------
     KEY DERIVATION
     Derives an AES-256 key from a password + salt using PBKDF2.
     ---------------------------------------------------------- */
  async function deriveKey(password, salt) {
    const enc      = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name:       'PBKDF2',
        salt:       salt,
        iterations: PBKDF2_ITERS,
        hash:       'SHA-256',
      },
      keyMaterial,
      { name: ALGORITHM, length: KEY_BITS },
      true,   // extractable (so we can export for key delivery)
      ['encrypt', 'decrypt']
    );
  }

  /* ----------------------------------------------------------
     GENERATE RANDOM KEY (for one-off file encryption)
     ---------------------------------------------------------- */
  async function generateKey() {
    return crypto.subtle.generateKey(
      { name: ALGORITHM, length: KEY_BITS },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /* ----------------------------------------------------------
     EXPORT KEY → Base64 string (for delivery to winning buyer)
     ---------------------------------------------------------- */
  async function exportKey(key) {
    const raw = await crypto.subtle.exportKey('raw', key);
    return btoa(String.fromCharCode(...new Uint8Array(raw)));
  }

  /* ----------------------------------------------------------
     IMPORT KEY ← Base64 string (buyer receives this)
     ---------------------------------------------------------- */
  async function importKey(b64) {
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return crypto.subtle.importKey(
      'raw', raw,
      { name: ALGORITHM, length: KEY_BITS },
      false,
      ['decrypt']
    );
  }

  /* ----------------------------------------------------------
     ENCRYPT FILE
     Returns: { encryptedBlob, keyB64, ivB64, saltB64 }
     ---------------------------------------------------------- */
  async function encryptFile(file, onProgress) {
    updateLockUI('encrypting');

    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv   = crypto.getRandomValues(new Uint8Array(IV_BYTES));

    // Generate a fresh key for this file
    const key = await generateKey();

    // Read file as ArrayBuffer
    const plaintext = await readFileAsArrayBuffer(file, onProgress);

    // Encrypt
    const ciphertext = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      plaintext
    );

    // Build encrypted blob: [salt(16)][iv(12)][ciphertext]
    const combined = new Uint8Array(SALT_BYTES + IV_BYTES + ciphertext.byteLength);
    combined.set(salt, 0);
    combined.set(iv, SALT_BYTES);
    combined.set(new Uint8Array(ciphertext), SALT_BYTES + IV_BYTES);

    const encryptedBlob = new Blob([combined], { type: 'application/octet-stream' });
    const keyB64  = await exportKey(key);
    const ivB64   = btoa(String.fromCharCode(...iv));
    const saltB64 = btoa(String.fromCharCode(...salt));

    updateLockUI('done');

    return {
      encryptedBlob,
      keyB64,
      ivB64,
      saltB64,
      originalName: file.name,
      originalSize: file.size,
      encryptedSize: combined.byteLength,
    };
  }

  /* ----------------------------------------------------------
     DECRYPT FILE (for winning buyer)
     Accepts: encryptedBlob, keyB64
     Returns: decrypted Blob
     ---------------------------------------------------------- */
  async function decryptFile(encryptedBlob, keyB64, originalMimeType = 'application/octet-stream') {
    updateLockUI('decrypting');

    const key = await importKey(keyB64);
    const data = await encryptedBlob.arrayBuffer();
    const buf  = new Uint8Array(data);

    const salt = buf.slice(0, SALT_BYTES);           // not used in simple mode
    const iv   = buf.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
    const ciphertext = buf.slice(SALT_BYTES + IV_BYTES);

    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv },
        key,
        ciphertext
      );
      updateLockUI('done');
      return new Blob([plaintext], { type: originalMimeType });
    } catch (err) {
      updateLockUI('error');
      throw new Error('Decryption failed. The key may be incorrect or the file was corrupted.');
    }
  }

  /* ----------------------------------------------------------
     ENCRYPT TEXT (for metadata / preview JSON)
     ---------------------------------------------------------- */
  async function encryptText(text, keyB64) {
    const enc  = new TextEncoder();
    const key  = await importKey(keyB64);
    const iv   = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const data = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, enc.encode(text));
    const combined = new Uint8Array(IV_BYTES + data.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(data), IV_BYTES);
    return btoa(String.fromCharCode(...combined));
  }

  /* ----------------------------------------------------------
     DECRYPT TEXT
     ---------------------------------------------------------- */
  async function decryptText(b64encrypted, keyB64) {
    const dec  = new TextDecoder();
    const key  = await importKey(keyB64);
    const buf  = Uint8Array.from(atob(b64encrypted), c => c.charCodeAt(0));
    const iv   = buf.slice(0, IV_BYTES);
    const data = buf.slice(IV_BYTES);
    const plain = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, data);
    return dec.decode(plain);
  }

  /* ----------------------------------------------------------
     HASH FILE (SHA-256 fingerprint for integrity verification)
     ---------------------------------------------------------- */
  async function hashFile(file) {
    const buf  = await file.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /* ----------------------------------------------------------
     READ FILE as ArrayBuffer (with progress)
     ---------------------------------------------------------- */
  function readFileAsArrayBuffer(file, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      if (onProgress) {
        reader.onprogress = e => {
          if (e.lengthComputable) onProgress(e.loaded / e.total);
        };
      }
      reader.readAsArrayBuffer(file);
    });
  }

  /* ----------------------------------------------------------
     UI: LOCK ANIMATION
     ---------------------------------------------------------- */
  function updateLockUI(state) {
    const indicators = document.querySelectorAll('.encrypt-indicator');
    indicators.forEach(el => {
      const lockEl = el.querySelector('.encrypt-indicator__lock');
      const textEl = el.querySelector('.encrypt-indicator__text');

      switch (state) {
        case 'encrypting':
          if (lockEl) lockEl.textContent = '🔓';
          if (textEl) textEl.textContent = 'Encrypting your file…';
          el.style.borderColor = '#FDE68A';
          el.style.background  = '#FFFBEB';
          el.style.color       = '#D97706';
          break;
        case 'decrypting':
          if (lockEl) lockEl.textContent = '🔓';
          if (textEl) textEl.textContent = 'Decrypting…';
          break;
        case 'done':
          if (lockEl) lockEl.textContent = '🔒';
          if (textEl) textEl.textContent = 'End-to-End Encrypted — AES-256';
          el.style.borderColor = '#A7F3D0';
          el.style.background  = '#ECFDF5';
          el.style.color       = '#059669';
          break;
        case 'error':
          if (lockEl) lockEl.textContent = '🔓';
          if (textEl) textEl.textContent = 'Encryption error. Please try again.';
          el.style.borderColor = '#FCA5A5';
          el.style.background  = '#FEF2F2';
          el.style.color       = '#DC2626';
          break;
      }
    });
  }

  /* ----------------------------------------------------------
     DOWNLOAD DECRYPTED FILE (trigger browser download)
     ---------------------------------------------------------- */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ----------------------------------------------------------
     GENERATE KEY RECEIPT (for record keeping)
     ---------------------------------------------------------- */
  function generateKeyReceipt(datasetTitle, winnerEmail, keyB64) {
    return {
      dataset:   datasetTitle,
      recipient: winnerEmail,
      key:       keyB64,
      algorithm: 'AES-256-GCM',
      issuedAt:  new Date().toISOString(),
      note:      'Store this key securely. It cannot be regenerated.',
    };
  }

  /* ----------------------------------------------------------
     PUBLIC API
     ---------------------------------------------------------- */
  return {
    encryptFile,
    decryptFile,
    encryptText,
    decryptText,
    hashFile,
    exportKey,
    importKey,
    generateKey,
    downloadBlob,
    generateKeyReceipt,
    updateLockUI,
  };

})();

window.DVCrypto = DVCrypto;
