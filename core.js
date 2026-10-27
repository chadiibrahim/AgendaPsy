'use strict';
/* ===================== utils ===================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const parseYmd = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const addMin = (hhmm, n) => { const [h, m] = String(hhmm || '00:00').split(':').map(Number); const t0 = (h * 60 + m + (+n || 0)) % 1440; return `${pad(Math.floor(t0 / 60))}:${pad(t0 % 60)}`; };
const toMin = hhmm => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + m; };
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/* ===================== i18n ===================== */
// English strings are the keys; FR holds French translations (see i18n-fr.js)
let LANG = 'fr';
const t = (s, ...a) => { let r = (LANG === 'fr' && typeof FR !== 'undefined' && FR[s]) || s; a.forEach((v, i) => { r = r.split('{' + i + '}').join(v); }); return r; };
const loc = () => (LANG === 'fr' ? 'fr-FR' : 'en-GB');

/* ===================== storage ===================== */
const KEY = 'psyagenda.v1';
function defaults() {
  return {
    v: 1,
    settings: { lang: 'fr', currency: 'USD', fee: 60, dur: 50, cc: '961', clinic: '', autoLock: 30, pinHash: '', salt: '', pinLen: 4, lastBackup: '', backupDays: 30, backupEnc: false },
    patients: [], appointments: [], sessions: [], payments: []
  };
}
function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
  if (raw) {
    try {
      const d = JSON.parse(raw);
      const base = defaults();
      const out = Object.assign(base, d, { settings: Object.assign(base.settings, d.settings || {}) });
      ['patients', 'appointments', 'sessions', 'payments'].forEach(k => { if (!Array.isArray(out[k])) out[k] = []; });
      return out;
    } catch (e) {
      // keep the unreadable data instead of overwriting it
      try { localStorage.setItem(KEY + '.corrupt.' + Date.now(), raw); } catch (_) { }
    }
  }
  return defaults();
}
let db = load();
/* a 'done' appointment always has a session carrying its fee, so it is billed */
function ensureSession(a) {
  if (a.status !== 'done' || db.sessions.some(s => s.aid === a.id)) return false;
  db.sessions.push({ id: uid(), pid: a.pid, date: a.date, time: a.time || '', aid: a.id, topic: '', notes: '', plan: '', fee: num(a.fee) });
  return true;
}
(function () { if (db.settings.doneSync) return; let ch = false; db.appointments.forEach(a => { if (ensureSession(a)) ch = true; }); db.settings.doneSync = true; try { save(); } catch (e) { } })();
let saveFailed = false;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); saveFailed = false; return true; }
  catch (e) { saveFailed = true; toast(t('Could not save: storage is full or blocked')); return false; }
}

/* ===================== formatting ===================== */
function money(n) {
  const c = db.settings.currency;
  const v = round2(n);
  const dec = c === 'LBP' ? 0 : 2;
  const s = Math.abs(v).toLocaleString(loc(), { minimumFractionDigits: (c === 'LBP' || v % 1 === 0) ? 0 : 2, maximumFractionDigits: dec });
  const sym = c === 'USD' ? '$' : c === 'EUR' ? '€' : c === 'LBP' ? 'LBP' : c;
  return (v < 0 ? '-' : '') + s + ' ' + sym;
}
const fmtDate = s => s ? parseYmd(s).toLocaleDateString(loc(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtDateS = s => s ? parseYmd(s).toLocaleDateString(loc(), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const fmtDayLong = s => parseYmd(s).toLocaleDateString(loc(), { weekday: 'long', day: 'numeric', month: 'long' });
function ageOf(dob) {
  if (!dob) return '';
  const b = parseYmd(dob), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a >= 0 && a < 130 ? a : '';
}
const normStr = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function telHref(p) { return 'tel:' + String(p || '').replace(/[^\d+]/g, ''); }
function waHref(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = (db.settings.cc || '961') + d.slice(1);
  else if (d.length <= 8) d = (db.settings.cc || '961') + d;
  return 'https://wa.me/' + d;
}
function smsHref(p) { return 'sms:' + String(p || '').replace(/[^\d+]/g, ''); }

/* ===================== icons ===================== */
const ICONS = {
  today: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  money: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  back: '<polyline points="15 18 9 12 15 6"/>',
  next: '<polyline points="9 18 15 12 9 6"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  mail: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  del: '<path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>'
};
const icon = (n, s = 22) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

/* ===================== toast / overlays ===================== */
let toastTimer = 0;
function toast(msg) {
  const el = $('#toast'); if (!el) return;
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

const overlays = [];
let isLocked = true;
function addOverlay(el, onClose, render) {
  // while the app is locked, only dialogs flagged data-ok (the "forgot PIN" confirmations) may appear
  if (isLocked && !el.dataset.ok) return;
  overlays.push({ el, onClose, render }); $('#layer').appendChild(el);
}
function closeOverlay(el) {
  const i = overlays.findIndex(o => o.el === el); if (i < 0) return;
  while (overlays.length > i) { const o = overlays.pop(); o.el.remove(); if (o.onClose) o.onClose(); }
}
function closeTop() { if (!overlays.length) return false; closeOverlay(overlays[overlays.length - 1].el); return true; }
function closeAllOverlays() { while (overlays.length) { const o = overlays.pop(); o.el.remove(); } }

function openSheet(title, html, mount) {
  const el = document.createElement('div'); el.className = 'sheetwrap';
  el.innerHTML = `<div class="backdrop"></div><div class="sheet" role="dialog" aria-label="${esc(title)}"><div class="sheet-h"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="${esc(t('Close'))}">${icon('x')}</button></div><div class="sheet-b">${html}</div></div>`;
  addOverlay(el);
  $('.backdrop', el).onclick = () => closeOverlay(el);
  $('[data-close]', el).onclick = () => closeOverlay(el);
  if (mount) mount(el);
  return el;
}
function openPage(renderFn) {
  const el = document.createElement('div'); el.className = 'page';
  const render = () => { const st = el.scrollTop; renderFn(el); el.scrollTop = st; };
  addOverlay(el, null, render);
  renderFn(el);
  return el;
}
function refreshPages() { [...overlays].forEach(o => { if (o.render) o.render(); }); }

function confirmBox(msg, { ok = t('Delete'), danger = true } = {}) {
  return new Promise(res => {
    const el = document.createElement('div'); el.className = 'sheetwrap center'; el.dataset.ok = '1';
    el.innerHTML = `<div class="backdrop"></div><div class="dialog" role="alertdialog"><p>${esc(msg)}</p><div class="row end"><button type="button" class="btn" data-n>${esc(t('Cancel'))}</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-y>${esc(ok)}</button></div></div>`;
    addOverlay(el, () => res(false));
    const done = v => { res(v); closeOverlay(el); };
    $('.backdrop', el).onclick = () => done(false);
    $('[data-n]', el).onclick = () => done(false);
    $('[data-y]', el).onclick = () => done(true);
  });
}

/* ===================== form helpers ===================== */
const fld = (label, inner, cls = '') => `<label class="fld ${cls}"><span>${esc(label)}</span>${inner}</label>`;
const inp = (name, val = '', attrs = '') => `<input name="${name}" value="${esc(val)}" ${attrs}>`;
const txa = (name, val = '', rows = 3, attrs = '') => `<textarea name="${name}" rows="${rows}" ${attrs}>${esc(val)}</textarea>`;
const sel = (name, opts, val, attrs = '') => `<select name="${name}" ${attrs}>${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(val) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const formData = form => Object.fromEntries(new FormData(form));
