'use strict';
/* ===================== PIN ===================== */
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function hashPin(pin, salt, mode = 'p1') {
  const enc = new TextEncoder();
  if (mode === 'p1') {
    if (!(window.crypto && crypto.subtle)) return '';
    const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
    return 'p1:' + hex(bits);
  }
  let h = 2166136261; const data = enc.encode(salt + ':' + pin);
  for (let k = 0; k < 5000; k++) for (const b of data) { h ^= b; h = Math.imul(h, 16777619) >>> 0; }
  return 'f1:' + h.toString(16);
}
async function setPin(pin) {
  const arr = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(arr) : arr.forEach((_, i) => arr[i] = Math.random() * 256);
  const salt = hex(arr);
  const mode = (window.crypto && crypto.subtle) ? 'p1' : 'f1';
  db.settings.salt = salt; db.settings.pinLen = pin.length; db.settings.pinHash = await hashPin(pin, salt, mode); save();
}
async function verifyPin(pin) {
  const st = db.settings.pinHash; if (!st) return false;
  try { return (await hashPin(pin, db.settings.salt, st.slice(0, 2))) === st; } catch (e) { return false; }
}
const FAILKEY = KEY + '.fail';
const failState = () => { try { return JSON.parse(localStorage.getItem(FAILKEY)) || { n: 0, until: 0 }; } catch (e) { return { n: 0, until: 0 }; } };
const setFail = s => { try { localStorage.setItem(FAILKEY, JSON.stringify(s)); } catch (e) { } };
function bumpFail() {
  const s = failState(); s.n++;
  if (s.n % 5 === 0) s.until = Date.now() + Math.min(900, 30 * Math.pow(2, s.n / 5 - 1)) * 1000;
  setFail(s);
}

/* ===================== lock screen ===================== */
let lockTimer = 0, lockKeyHandler = null;
function lockScreen() {
  closeAllOverlays(); isLocked = true; $('#app').hidden = true;
  const L = $('#lock'); L.hidden = false;
  const setup = !db.settings.pinHash;
  let phase = setup ? 'new' : 'enter', buf = '', first = '', msg = '', busy = false, shake = false;
  const maxLen = () => phase === 'enter' ? db.settings.pinLen : (phase === 'confirm' ? first.length : 6);
  const prompt = () => phase === 'new' ? t('Choose a PIN (4 to 6 digits)') : phase === 'confirm' ? t('Confirm your PIN') : t('Enter your PIN');

  function draw() {
    clearTimeout(lockTimer);
    const fs = failState(), wait = Math.max(0, Math.ceil((fs.until - Date.now()) / 1000)), n = maxLen();
    L.innerHTML = `<div class="lock-in">
      <div class="lock-logo">${icon('lock', 30)}</div><h1>${esc(t('Agenda Psy'))}</h1>
      <p class="lock-msg ${shake ? 'err' : ''}">${esc(wait ? t('Too many attempts. Try again in {0}s', wait) : (msg || prompt()))}</p>
      <div class="dots ${shake ? 'shake' : ''}">${Array.from({ length: n }, (_, i) => `<i class="${i < buf.length ? 'f' : ''}"></i>`).join('')}</div>
      <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => `<button data-k="${d}">${d}</button>`).join('')}
        <button data-k="del" aria-label="${esc(t('Delete'))}">${icon('del', 22)}</button><button data-k="0">0</button>
        <button data-k="ok" class="okk" aria-label="OK" ${phase === 'new' ? '' : 'style="visibility:hidden"'}>${icon('check', 24)}</button></div>
      <div class="lock-foot"><button class="link" data-lang>${LANG === 'fr' ? 'English' : 'Français'}</button>${setup ? '' : `<button class="link" data-forgot>${esc(t('Forgot PIN?'))}</button>`}</div></div>`;
    $$('[data-k]', L).forEach(b => b.onclick = () => key(b.dataset.k));
    $('[data-lang]', L).onclick = () => { LANG = LANG === 'fr' ? 'en' : 'fr'; db.settings.lang = LANG; document.documentElement.lang = LANG; save(); draw(); };
    const fg = $('[data-forgot]', L);
    if (fg) fg.onclick = async () => {
      if (!await confirmBox(t('Without your PIN the only way back in is to erase ALL data on this phone (you can then restore a backup). Erase everything?'), { ok: t('Continue') })) return;
      if (!await confirmBox(t('Last chance: erase everything?'), { ok: t('Erase everything') })) return;
      eraseAll();
    };
    if (wait > 0) lockTimer = setTimeout(draw, 1000);
  }
  async function key(k) {
    if (busy) return;
    if (failState().until > Date.now()) return;
    msg = '';
    if (k === 'del') { buf = buf.slice(0, -1); return draw(); }
    if (k === 'ok') {
      if (phase !== 'new') return;
      if (buf.length < 4) { msg = t('PIN must be 4 to 6 digits'); return draw(); }
      first = buf; buf = ''; phase = 'confirm'; return draw();
    }
    if (buf.length >= maxLen()) return;
    buf += k;
    if (phase === 'new' && buf.length === 6) { first = buf; buf = ''; phase = 'confirm'; return draw(); }
    draw();
    if (phase === 'confirm' && buf.length === first.length) {
      busy = true;
      if (buf === first) { await setPin(buf); busy = false; unlock(); }
      else { msg = t('PINs do not match'); shake = true; buf = ''; first = ''; phase = 'new'; busy = false; draw(); }
    } else if (phase === 'enter' && buf.length === db.settings.pinLen) {
      busy = true; const ok = await verifyPin(buf); busy = false;
      if (ok) { setFail({ n: 0, until: 0 }); unlock(); }
      else { bumpFail(); buf = ''; msg = t('Wrong PIN'); shake = true; draw(); }
    }
  }
  if (lockKeyHandler) document.removeEventListener('keydown', lockKeyHandler);
  lockKeyHandler = e => {
    if (!isLocked) return;
    if (/^\d$/.test(e.key)) key(e.key); else if (e.key === 'Backspace') key('del'); else if (e.key === 'Enter') key('ok');
  };
  document.addEventListener('keydown', lockKeyHandler);
  draw();
}
function unlock() {
  isLocked = false; clearTimeout(lockTimer);
  const L = $('#lock'); L.hidden = true; L.innerHTML = '';
  $('#app').hidden = false;
  document.documentElement.lang = LANG;
  render();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { }
}

/* ===================== auto-lock & back button ===================== */
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (!db.settings.pinHash || isLocked) return;
  if (document.hidden) {
    hiddenAt = Date.now();
    if (Date.now() >= skipLockUntil && db.settings.autoLock === 0) lockScreen();
  } else {
    if (hiddenAt && Date.now() >= skipLockUntil && Date.now() - hiddenAt >= db.settings.autoLock * 1000) lockScreen();
    hiddenAt = 0; skipLockUntil = 0;
  }
});
function setupBack() {
  const C = window.Capacitor;
  if (!(C && C.Plugins && C.Plugins.App)) return;
  C.Plugins.App.addListener('backButton', () => {
    if (isLocked) { C.Plugins.App.exitApp(); return; }
    if (closeTop()) return;
    if (S.tab !== 'today') { setTab('today'); return; }
    C.Plugins.App.exitApp();
  });
}
function registerSW() {
  const C = window.Capacitor;
  const native = C && C.isNativePlatform && C.isNativePlatform();
  if (!native && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => { });
}

/* ===================== boot ===================== */
function boot() {
  LANG = db.settings.lang || 'fr'; document.documentElement.lang = LANG;
  $('#btnVoice').innerHTML = icon('mic', 22); $('#btnVoice').onclick = openVoice; $('#btnLock').innerHTML = icon('lock', 22); $('#btnSettings').innerHTML = icon('sliders', 22); $('#fab').innerHTML = icon('plus', 26);
  $('#btnLock').onclick = () => lockScreen();
  $('#btnSettings').onclick = openSettings;
  lockScreen(); setupBack(); registerSW();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
