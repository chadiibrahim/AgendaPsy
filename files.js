'use strict';
/* ===================== data helpers ===================== */
const P = id => db.patients.find(p => p.id === id);
const pname = p => p ? (`${p.first || ''} ${p.last || ''}`.trim() || t('Unnamed')) : t('Deleted patient');
const pSortKey = p => normStr(`${p.last || ''} ${p.first || ''}`);
const sortedPatients = (list = db.patients) => [...list].sort((a, b) => pSortKey(a).localeCompare(pSortKey(b)));
const billedOf = pid => round2(db.sessions.filter(s => s.pid === pid).reduce((a, s) => a + num(s.fee), 0));
const paidOf = pid => round2(db.payments.filter(s => s.pid === pid).reduce((a, s) => a + num(s.amount), 0));
const balanceOf = pid => round2(billedOf(pid) - paidOf(pid));
const statusLabel = s => ({ scheduled: t('Scheduled'), done: t('Done'), cancelled: t('Cancelled'), noshow: t('No-show') })[s] || s;
const methodLabel = m => ({ cash: t('Cash'), card: t('Card'), transfer: t('Transfer'), other: t('Other') })[m] || m || '';
const byDateTime = (a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));
const slug = s => normStr(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'file';

/* ===================== saving files ===================== */
let skipLockUntil = 0;
const blobToB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

async function saveFile(name, blob) {
  const C = window.Capacitor;
  try {
    if (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.Filesystem && C.Plugins.Share) {
      skipLockUntil = Date.now() + 120000; // the share sheet puts the app in the background
      const data = await blobToB64(blob);
      const r = await C.Plugins.Filesystem.writeFile({ path: name, data, directory: 'CACHE' });
      await C.Plugins.Share.share({ title: name, url: r.uri, dialogTitle: name });
      return true;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(t('File saved: {0}', name));
    return true;
  } catch (e) {
    if (e && /cancel/i.test(String(e.message || e))) return false;
    toast(t('Could not save the file') + ': ' + (e && e.message || e));
    return false;
  }
}
const pdfBlob = bytes => new Blob([bytes], { type: 'application/pdf' });
const footerLeft = () => db.settings.clinic || t('Agenda Psy');

/* ===================== PDF reports ===================== */
function pdfPatientFile(pid) {
  const p = P(pid); if (!p) return;
  const d = new PDFW.Doc(t('Patient file'), footerLeft());
  d.h1(`${t('Patient file')}: ${pname(p)}`); d.sub(db.settings.clinic);
  d.h2(t('Identity'));
  d.kv(t('Date of birth'), p.dob ? `${fmtDateS(p.dob)} (${ageOf(p.dob)} ${t('years')})` : '');
  d.kv(t('Phone'), p.phone); d.kv(t('Email'), p.email); d.kv(t('Address'), p.address);
  d.kv(t('Emergency contact'), p.emergency); d.kv(t('File opened'), fmtDateS(p.created));
  d.kv(t('Status'), p.status === 'archived' ? t('Archived') : t('Active'));
  if (p.history) { d.h2(t('Medical history')); d.p(p.history); }
  if (p.notes) { d.h2(t('General notes')); d.p(p.notes); }
  const ss = db.sessions.filter(s => s.pid === pid).sort(byDateTime);
  d.h2(`${t('Session notes')} (${ss.length})`);
  if (!ss.length) d.p(t('No sessions recorded.'));
  ss.forEach(s => {
    d.ensure(52);
    d.p(`${fmtDateS(s.date)}${s.time ? ' ' + s.time : ''}${s.topic ? '  -  ' + s.topic : ''}`, { bold: true, gap: 1 });
    if (s.notes) d.p(s.notes, { indent: 8, gap: 1 });
    if (s.plan) d.p(`${t('Plan / tasks')}: ${s.plan}`, { indent: 8, gap: 1 });
    d.space(5);
  });
  d.h2(t('Account'));
  d.kv(t('Billed'), money(billedOf(pid))); d.kv(t('Paid'), money(paidOf(pid))); d.kv(t('Balance'), money(balanceOf(pid)));
  saveFile(`${slug(t('Patient file'))}-${slug(pname(p))}.pdf`, pdfBlob(d.finish()));
}

function pdfStatement(pid) {
  const p = P(pid); if (!p) return;
  const ev = [];
  db.sessions.filter(s => s.pid === pid).forEach(s => ev.push({ date: s.date, k: 0, desc: `${t('Session')}${s.topic ? ' - ' + s.topic : ''}`, ch: num(s.fee), pay: 0 }));
  db.payments.filter(s => s.pid === pid).forEach(s => ev.push({ date: s.date, k: 1, desc: `${t('Payment')}${s.method ? ' (' + methodLabel(s.method) + ')' : ''}`, ch: 0, pay: num(s.amount) }));
  ev.sort((a, b) => a.date.localeCompare(b.date) || a.k - b.k);
  let bal = 0;
  const rows = ev.map(e => { bal = round2(bal + e.ch - e.pay); return [fmtDateS(e.date), e.desc, e.ch ? money(e.ch) : '', e.pay ? money(e.pay) : '', money(bal)]; });
  const tot = ['', t('Balance due'), money(billedOf(pid)), money(paidOf(pid)), money(balanceOf(pid))]; tot.bold = true; rows.push(tot);
  const d = new PDFW.Doc(t('Account statement'), footerLeft());
  d.h1(`${t('Account statement')}: ${pname(p)}`); d.sub(`${db.settings.clinic ? db.settings.clinic + '  |  ' : ''}${t('Date')}: ${fmtDateS(todayStr())}`);
  d.table([{ h: t('Date'), w: .14 }, { h: t('Description'), w: .38 }, { h: t('Charge'), w: .16, align: 'r' }, { h: t('Payment'), w: .16, align: 'r' }, { h: t('Balance'), w: .16, align: 'r' }], rows);
  saveFile(`${slug(t('Account statement'))}-${slug(pname(p))}.pdf`, pdfBlob(d.finish()));
}

function pdfAgenda(ym) {
  const list = db.appointments.filter(a => a.date.startsWith(ym)).sort(byDateTime);
  const d = new PDFW.Doc(t('Appointments'), footerLeft());
  const label = parseYmd(ym + '-01').toLocaleDateString(loc(), { month: 'long', year: 'numeric' });
  d.h1(`${t('Appointments')} - ${label}`); d.sub(db.settings.clinic);
  const rows = list.map(a => [fmtDate(a.date), `${a.time}-${addMin(a.time, a.dur)}`, pname(P(a.pid)), statusLabel(a.status), a.fee ? money(a.fee) : '']);
  if (!rows.length) d.p(t('No appointments.'));
  else d.table([{ h: t('Date'), w: .22 }, { h: t('Time'), w: .15 }, { h: t('Patient'), w: .30 }, { h: t('Status'), w: .16 }, { h: t('Fee'), w: .17, align: 'r' }], rows);
  saveFile(`${slug(t('Appointments'))}-${ym}.pdf`, pdfBlob(d.finish()));
}

function pdfBalances() {
  const d = new PDFW.Doc(t('Balances'), footerLeft());
  d.h1(t('Patient balances')); d.sub(`${db.settings.clinic ? db.settings.clinic + '  |  ' : ''}${fmtDateS(todayStr())}`);
  let tb = 0, tp = 0;
  const rows = sortedPatients().map(p => ({ p, b: billedOf(p.id), pd: paidOf(p.id) })).filter(x => x.b || x.pd).map(x => { tb += x.b; tp += x.pd; return [pname(x.p), x.p.phone || '', money(x.b), money(x.pd), money(round2(x.b - x.pd))]; });
  const tot = [t('Total'), '', money(tb), money(tp), money(round2(tb - tp))]; tot.bold = true; rows.push(tot);
  d.table([{ h: t('Patient'), w: .30 }, { h: t('Phone'), w: .18 }, { h: t('Billed'), w: .17, align: 'r' }, { h: t('Paid'), w: .17, align: 'r' }, { h: t('Balance'), w: .18, align: 'r' }], rows);
  saveFile(`${slug(t('Balances'))}-${todayStr()}.pdf`, pdfBlob(d.finish()));
}

function pdfPatientList() {
  const d = new PDFW.Doc(t('Patients'), footerLeft());
  d.h1(t('Patient list')); d.sub(`${db.settings.clinic ? db.settings.clinic + '  |  ' : ''}${fmtDateS(todayStr())}`);
  const rows = sortedPatients().map(p => [pname(p), p.phone || '', p.dob ? fmtDateS(p.dob) : '', p.status === 'archived' ? t('Archived') : t('Active')]);
  d.table([{ h: t('Name'), w: .38 }, { h: t('Phone'), w: .24 }, { h: t('Date of birth'), w: .20 }, { h: t('Status'), w: .18 }], rows);
  saveFile(`${slug(t('Patients'))}-${todayStr()}.pdf`, pdfBlob(d.finish()));
}

/* ===================== Excel / CSV / JSON export ===================== */
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function patientRows() {
  return sortedPatients().map(p => ({
    [t('First name')]: p.first || '', [t('Last name')]: p.last || '', [t('Phone')]: p.phone || '', [t('Date of birth')]: p.dob || '',
    [t('Email')]: p.email || '', [t('Address')]: p.address || '', [t('Emergency contact')]: p.emergency || '', [t('Patient fee')]: (p.fee !== '' && p.fee != null) ? p.fee : '',
    [t('Medical history')]: p.history || '', [t('General notes')]: p.notes || '', [t('File opened')]: p.created || '',
    [t('Status')]: p.status === 'archived' ? t('Archived') : t('Active'), [t('Balance')]: balanceOf(p.id)
  }));
}
function exportXlsx() {
  if (typeof XLSX === 'undefined') { toast(t('Excel library not loaded')); return; }
  const wb = XLSX.utils.book_new();
  const add = (rows, name, empty) => XLSX.utils.book_append_sheet(wb, rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([empty]), name);
  add(patientRows(), t('Patients'), [t('First name'), t('Last name')]);
  add([...db.appointments].sort(byDateTime).map(a => ({ [t('Date')]: a.date, [t('Time')]: a.time, [t('Patient')]: pname(P(a.pid)), [t('Duration (min)')]: a.dur, [t('Status')]: statusLabel(a.status), [t('Fee')]: num(a.fee), [t('Note')]: a.note || '' })), t('Appointments'), [t('Date')]);
  add([...db.sessions].sort(byDateTime).map(s => ({ [t('Date')]: s.date, [t('Patient')]: pname(P(s.pid)), [t('Topic')]: s.topic || '', [t('Session notes')]: s.notes || '', [t('Plan / tasks')]: s.plan || '', [t('Fee')]: num(s.fee) })), t('Sessions'), [t('Date')]);
  add([...db.payments].sort((a, b) => a.date.localeCompare(b.date)).map(p => ({ [t('Date')]: p.date, [t('Patient')]: pname(P(p.pid)), [t('Amount')]: num(p.amount), [t('Method')]: methodLabel(p.method), [t('Note')]: p.note || '' })), t('Payments'), [t('Date')]);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveFile(`agenda-psy-${todayStr()}.xlsx`, new Blob([out], { type: XLSX_MIME }));
}
function exportPatientsCsv() {
  if (typeof XLSX === 'undefined') { toast(t('Excel library not loaded')); return; }
  const ws = XLSX.utils.json_to_sheet(patientRows());
  const csv = '﻿' + XLSX.utils.sheet_to_csv(ws);
  saveFile(`${slug(t('Patients'))}-${todayStr()}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}
function downloadTemplate() {
  if (typeof XLSX === 'undefined') { toast(t('Excel library not loaded')); return; }
  const head = [t('First name'), t('Last name'), t('Phone'), t('Date of birth'), t('Email'), t('Address'), t('Emergency contact'), t('Medical history'), t('General notes'), t('Patient fee')];
  const ex = ['Marie', 'Khoury', '03 123 456', '1990-04-12', 'marie@example.com', '', '', '', '', ''];
  const ws = XLSX.utils.aoa_to_sheet([head, ex]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, t('Patients'));
  saveFile(`${slug(t('Import template'))}.xlsx`, new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: XLSX_MIME }));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isNative = () => !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pw, salt) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptText(text, pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(pw, salt), new TextEncoder().encode(text)));
  return JSON.stringify({ psyagenda: 'enc1', salt: b64(salt), iv: b64(iv), data: b64(ct) });
}
async function decryptText(env, pw) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, await deriveKey(pw, unb64(env.salt)), unb64(env.data));
  return new TextDecoder().decode(pt);
}
function askPassword(confirmIt) {
  return new Promise(res => {
    const html = `<form id="f" autocomplete="off"><p class="muted">${esc(confirmIt ? t('Without this password the backup cannot be opened. Keep it safe.') : t('Encrypted backup: enter its password'))}</p>
      ${fld(t('Backup password'), inp('pw', '', 'type="password" autocomplete="off" required minlength="6"'))}
      ${confirmIt ? fld(t('Repeat password'), inp('pw2', '', 'type="password" autocomplete="off" required minlength="6"')) : ''}
      <div class="row end"><button type="button" class="btn" data-cancel>${esc(t('Cancel'))}</button><button class="btn primary">${esc(t('Continue'))}</button></div></form>`;
    let settled = false; const done = v => { if (!settled) { settled = true; res(v); } };
    const el = openSheet(confirmIt ? t('Encrypt backup') : t('Encrypted backup'), html, el => {
      const f = $('#f', el);
      $('[data-cancel]', el).onclick = () => closeOverlay(el);
      f.onsubmit = e => {
        e.preventDefault(); const d = formData(f);
        if (d.pw.length < 6) { toast(t('Password (6 characters minimum)')); return; }
        if (confirmIt && d.pw !== d.pw2) { toast(t('Passwords do not match')); return; }
        done(d.pw); closeOverlay(el);
      };
    });
    const o = overlays.find(x => x.el === el); if (o) o.onClose = () => done(null);
  });
}
async function runBackup(mode) {
  const data = JSON.parse(JSON.stringify(db));
  delete data.settings.pinHash; delete data.settings.salt; delete data.settings.pinLen;
  let text = JSON.stringify(data);
  const enc = !!db.settings.backupEnc;
  if (enc) {
    if (!(window.crypto && crypto.subtle)) { toast(t('Encryption is not available here')); return; }
    const pw = await askPassword(true); if (!pw) return;
    text = await encryptText(text, pw);
  }
  const base = `agenda-psy-backup-${todayStr()}${enc ? '-chiffre' : ''}`;
  let done = false;
  if (mode === 'share' && !isNative() && navigator.canShare && navigator.share) {
    // Chrome on Android only shares text-like files, so the backup travels as .txt (it is still the same JSON)
    const f = new File([text], base + '.txt', { type: 'text/plain' });
    if (navigator.canShare({ files: [f] })) {
      try { skipLockUntil = Date.now() + 120000; await navigator.share({ files: [f], title: t('Agenda Psy') }); done = true; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
  }
  if (!done) done = await saveFile(base + '.json', new Blob([text], { type: 'application/json' }));
  if (done) { db.settings.lastBackup = todayStr(); save(); refresh(); if (mode === 'share') toast(t('Backup done')); }
}
const exportBackup = () => runBackup('share');
async function restoreBackup(file) {
  let d;
  try { d = JSON.parse(await file.text()); } catch (e) { toast(t('Invalid backup file')); return; }
  if (d && d.psyagenda === 'enc1') {
    if (!(window.crypto && crypto.subtle)) { toast(t('Encryption is not available here')); return; }
    let plain = null;
    for (let k = 0; k < 3 && plain === null; k++) {
      const pw = await askPassword(false); if (!pw) return;
      try { plain = await decryptText(d, pw); } catch (e) { toast(t('Wrong password or damaged file')); await sleep(900); }
    }
    if (plain === null) return;
    try { d = JSON.parse(plain); } catch (e) { toast(t('Invalid backup file')); return; }
  }
  if (!d || !Array.isArray(d.patients) || !Array.isArray(d.appointments || []) || !Array.isArray(d.sessions || []) || !Array.isArray(d.payments || [])) { toast(t('Invalid backup file')); return; }
  const ok = await confirmBox(t('Replace ALL current data with this backup ({0} patients)?', d.patients.length), { ok: t('Restore'), danger: true });
  if (!ok) return;
  const keep = { pinHash: db.settings.pinHash, salt: db.settings.salt, pinLen: db.settings.pinLen };
  db.patients = d.patients; db.appointments = d.appointments || []; db.sessions = d.sessions || []; db.payments = d.payments || [];
  db.settings = Object.assign(defaults().settings, d.settings || {}, keep);
  LANG = db.settings.lang; save(); closeAllOverlays(); render(); toast(t('Backup restored'));
}

/* ===================== import (CSV / Excel) ===================== */
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const count = c => first.split(c).length - 1;
  const delim = [',', ';', '\t'].map(c => [c, count(c)]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}
function decodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) { return new TextDecoder('windows-1252').decode(buf); }
}
function parseDateAny(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) { if (isNaN(v)) return ''; const d = new Date(v.getTime() + 12 * 3600 * 1000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  if (typeof v === 'number') {
    if (v > 1000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
    return '';
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += y > 30 ? 1900 : 2000; }
  else return '';
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return '';
  return `${y}-${pad(mo)}-${pad(d)}`;
}
const HDR = {
  first: ['firstname', 'first', 'prenom', 'givenname', 'prenoms'],
  last: ['lastname', 'last', 'surname', 'familyname', 'nomdefamille'],
  full: ['name', 'fullname', 'nomcomplet', 'patient', 'patients', 'nom', 'nomprenom', 'prenomnom'],
  phone: ['phone', 'telephone', 'tel', 'mobile', 'gsm', 'cell', 'numero', 'phonenumber', 'telephonemobile', 'portable'],
  dob: ['dob', 'dateofbirth', 'birthdate', 'birthday', 'datedenaissance', 'naissance', 'ddn', 'datenaissance'],
  email: ['email', 'mail', 'courriel', 'emailaddress', 'adresseemail'],
  address: ['address', 'adresse'],
  emergency: ['emergency', 'emergencycontact', 'contactdurgence', 'urgence', 'contacturgence'],
  fee: ['fee', 'patientfee', 'honoraires', 'tarif', 'prix', 'price', 'rate'],
  history: ['history', 'medicalhistory', 'antecedents', 'antecedentsmedicaux', 'atcd'],
  notes: ['notes', 'note', 'remarques', 'remarque', 'commentaires', 'comment', 'generalnotes', 'notesgenerales'],
  created: ['created', 'fileopened', 'dateouverture', 'datecreation', 'firstvisit', 'premierevisite', 'since', 'ouvertureduvdossier']
};
const cellStr = v => (v instanceof Date || v === null || v === undefined) ? '' : String(v).trim();
function rowsToPatients(aoa) {
  if (!aoa.length) return { error: t('The file is empty.') };
  const hdr = aoa[0].map(h => normStr(cellStr(h)).replace(/[^a-z0-9]/g, ''));
  const col = {};
  hdr.forEach((h, i) => { for (const k in HDR) { if (HDR[k].includes(h) && col[k] === undefined) { col[k] = i; break; } } });
  if (col.first !== undefined && col.last === undefined && col.full !== undefined) { col.last = col.full; delete col.full; }
  if (col.first === undefined && col.last === undefined && col.full === undefined) return { error: t('No name column found. Use headers like "First name", "Last name", "Phone".') };
  const get = (r, k) => col[k] === undefined ? '' : r[col[k]];
  const out = []; let blank = 0;
  aoa.slice(1).forEach(r => {
    let first = cellStr(get(r, 'first')), last = cellStr(get(r, 'last'));
    if (!first && !last && col.full !== undefined) {
      const full = cellStr(get(r, 'full')); const i = full.indexOf(' ');
      if (i < 0) first = full; else { first = full.slice(0, i); last = full.slice(i + 1).trim(); }
    }
    if (!first && !last) { if (r.some(c => cellStr(c))) blank++; return; }
    let phone = get(r, 'phone'); phone = typeof phone === 'number' ? String(phone) : cellStr(phone);
    out.push({
      id: uid(), first, last, phone, dob: parseDateAny(get(r, 'dob')), email: cellStr(get(r, 'email')), address: cellStr(get(r, 'address')),
      emergency: cellStr(get(r, 'emergency')), history: cellStr(get(r, 'history')), notes: cellStr(get(r, 'notes')),
      fee: (v => v === '' || v == null || !isFinite(parseFloat(String(v).replace(',', '.'))) ? '' : parseFloat(String(v).replace(',', '.')))(get(r, 'fee')), status: 'active', created: parseDateAny(get(r, 'created')) || todayStr()
    });
  });
  return { patients: out, blank };
}
const dupKey = p => normStr(`${p.first} ${p.last}`).replace(/\s+/g, ' ').trim() + '|' + String(p.phone || '').replace(/\D/g, '');

function pickFile(accept, onFile) {
  skipLockUntil = Date.now() + 120000;
  const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.style.display = 'none';
  i.onchange = () => { const f = i.files && i.files[0]; i.remove(); if (f) onFile(f); };
  document.body.appendChild(i); i.click();
}
function startImport() { pickFile('.csv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel', importPatientsFile); }
async function importPatientsFile(file) {
  try {
    const buf = await file.arrayBuffer();
    let aoa;
    if (/\.(csv|txt)$/i.test(file.name) || (file.type || '').includes('csv')) aoa = parseCSV(decodeText(buf));
    else {
      if (typeof XLSX === 'undefined') { toast(t('Excel library not loaded')); return; }
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
    }
    const r = rowsToPatients(aoa);
    if (r.error) { toast(r.error); return; }
    const seen = new Set(db.patients.map(dupKey)); const fresh = []; let dups = 0;
    r.patients.forEach(p => { const k = dupKey(p); if (seen.has(k)) { dups++; return; } seen.add(k); fresh.push(p); });
    showImportPreview(fresh, dups, r.blank);
  } catch (e) { toast(t('Could not read the file') + ': ' + (e && e.message || e)); }
}
function showImportPreview(list, dups, blank) {
  const rows = list.slice(0, 5).map(p => `<tr><td>${esc(pname(p))}</td><td>${esc(p.phone)}</td><td>${esc(p.dob ? fmtDateS(p.dob) : '')}</td></tr>`).join('');
  const html = `<p><b>${list.length}</b> ${esc(t('patients ready to import'))}${dups ? `<br><span class="muted">${esc(t('Duplicates skipped (same name and phone): {0}', dups))}</span>` : ''}${blank ? `<br><span class="muted">${esc(t('Rows without a name skipped: {0}', blank))}</span>` : ''}</p>
    ${list.length ? `<table class="mini"><thead><tr><th>${esc(t('Name'))}</th><th>${esc(t('Phone'))}</th><th>${esc(t('Date of birth'))}</th></tr></thead><tbody>${rows}</tbody></table>${list.length > 5 ? `<p class="muted">… ${esc(t('and {0} more', list.length - 5))}</p>` : ''}` : ''}
    <div class="row end"><button class="btn" data-close2>${esc(t('Cancel'))}</button><button class="btn primary" id="doImport" ${list.length ? '' : 'disabled'}>${esc(t('Import'))}</button></div>`;
  openSheet(t('Import patients'), html, el => {
    $('[data-close2]', el).onclick = () => closeOverlay(el);
    $('#doImport', el).onclick = () => {
      db.patients.push(...list); save(); closeOverlay(el); refresh(); toast(t('{0} patients imported', list.length));
    };
  });
}
