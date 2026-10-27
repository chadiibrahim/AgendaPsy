'use strict';
/* ===================== app state & shell ===================== */
const S = { tab: 'today', calMonth: todayStr().slice(0, 7), calDay: todayStr(), pq: '', pf: 'active' };
const TABS = () => [['today', 'today', t('Today')], ['calendar', 'calendar', t('Calendar')], ['patients', 'users', t('Patients')], ['billing', 'money', t('Billing')], ['stats', 'chart', t('Stats')]];

function renderTabs() {
  $('#tabs').innerHTML = TABS().map(([k, ic, label]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-tab="${k}" aria-label="${esc(label)}">${icon(ic, 22)}<span>${esc(label)}</span></button>`).join('');
  $$('#tabs [data-tab]').forEach(b => b.onclick = () => setTab(b.dataset.tab));
}
function setTab(tab) { S.tab = tab; $('#view').scrollTop = 0; render(); }
function render() {
  const v = $('#view');
  renderTabs();
  $('#title').textContent = ({ today: t('Today'), calendar: t('Calendar'), patients: t('Patients'), billing: t('Billing'), stats: t('Statistics') })[S.tab];
  $('#btnLock').setAttribute('aria-label', t('Lock')); $('#btnSettings').setAttribute('aria-label', t('Settings'));
  const fab = $('#fab');
  fab.hidden = S.tab === 'stats';
  fab.setAttribute('aria-label', t('Add'));
  fab.onclick = () => ({
    today: () => apptForm({ date: todayStr() }), calendar: () => apptForm({ date: S.calDay }),
    patients: () => patientForm(), billing: () => paymentForm()
  })[S.tab]();
  ({ today: viewToday, calendar: viewCalendar, patients: viewPatients, billing: viewBilling, stats: viewStats })[S.tab](v);
}
function refresh() { const v = $('#view'); const st = v.scrollTop; render(); v.scrollTop = st; refreshPages(); }

const statusBadge = s => `<span class="badge b-${s}">${esc(statusLabel(s))}</span>`;
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);

function apptCard(a, showDate) {
  const p = P(a.pid);
  return `<button class="card item st-${a.status}" data-appt="${a.id}">
    <div class="time"><b>${esc(a.time)}</b><small>${esc(addMin(a.time, a.dur))}</small></div>
    <div class="grow"><div class="nm">${esc(pname(p))}</div><div class="sub">${showDate ? esc(fmtDate(a.date)) + ' · ' : ''}${statusBadge(a.status)}${a.note ? ' · ' + esc(a.note.slice(0, 40)) : ''}</div></div>
    <div class="amt">${a.fee ? esc(money(a.fee)) : ''}</div></button>`;
}
const wireAppts = r => $$('[data-appt]', r).forEach(b => b.onclick = () => openAppt(b.dataset.appt));

/* ===================== TODAY ===================== */
function viewToday(v) {
  const td = todayStr(), tm = addDays(td, 1);
  const todays = db.appointments.filter(a => a.date === td).sort(byDateTime);
  const live = todays.filter(a => a.status !== 'cancelled');
  const expected = live.reduce((s, a) => s + num(a.fee), 0);
  const review = db.appointments.filter(a => a.date < td && a.status === 'scheduled').sort(byDateTime).reverse().slice(0, 20);
  const tomorrow = db.appointments.filter(a => a.date === tm && a.status !== 'cancelled').sort(byDateTime);
  const lb = db.settings.lastBackup;
  const firstDate = db.patients.map(p => p.created || td).sort()[0];
  const bd = num(db.settings.backupDays);
  const needBackup = bd > 0 && db.patients.length > 0 && (lb ? daysBetween(lb, td) >= bd : daysBetween(firstDate, td) >= Math.min(7, bd));
  v.innerHTML = `
    <div class="hello"><h2>${esc(fmtDayLong(td))}</h2>
      <div class="chips"><span class="chip">${live.length} ${esc(live.length === 1 ? t('appointment') : t('appointments'))}</span>${expected ? `<span class="chip">${esc(money(expected))}</span>` : ''}</div></div>
    ${needBackup ? `<button class="banner" id="bk">${esc(t('No recent backup. Tap to back up your data.'))}</button>` : ''}
    ${review.length ? `<section><h3>${esc(t('To review'))}</h3><p class="hint">${esc(t('Past appointments still marked as scheduled.'))}</p>${review.map(a => apptCard(a, true)).join('')}</section>` : ''}
    <section><h3>${esc(t('Today'))}</h3>${todays.length ? todays.map(a => apptCard(a)).join('') : `<div class="empty">${esc(t('No appointments today.'))}</div>`}</section>
    ${tomorrow.length ? `<section><h3>${esc(t('Tomorrow'))}</h3>${tomorrow.map(a => apptCard(a)).join('')}</section>` : ''}
    ${!db.patients.length ? `<div class="empty big">${esc(t('Welcome. Start by adding your first patient in the Patients tab, or import a list from Excel/CSV in Settings.'))}</div>` : ''}`;
  wireAppts(v);
  const bk = $('#bk', v); if (bk) bk.onclick = exportBackup;
}

/* ===================== CALENDAR ===================== */
function shiftMonth(n) {
  const [y, m] = S.calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  S.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  S.calDay = S.calMonth === todayStr().slice(0, 7) ? todayStr() : S.calMonth + '-01';
  render();
}
function viewCalendar(v) {
  const [y, m] = S.calMonth.split('-').map(Number);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7, dim = new Date(y, m, 0).getDate();
  const cnt = {};
  db.appointments.forEach(a => { if (a.date.startsWith(S.calMonth) && a.status !== 'cancelled') cnt[a.date] = (cnt[a.date] || 0) + 1; });
  const td = todayStr();
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="cell empty"></span>';
  for (let d = 1; d <= dim; d++) {
    const ds = `${S.calMonth}-${pad(d)}`;
    cells += `<button class="cell ${ds === td ? 'today' : ''} ${ds === S.calDay ? 'sel' : ''}" data-d="${ds}"><span>${d}</span>${cnt[ds] ? `<i>${cnt[ds]}</i>` : ''}</button>`;
  }
  const wd = LANG === 'fr' ? ['L', 'M', 'M', 'J', 'V', 'S', 'D'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const label = new Date(y, m - 1, 1).toLocaleDateString(loc(), { month: 'long', year: 'numeric' });
  const dayList = db.appointments.filter(a => a.date === S.calDay).sort(byDateTime);
  v.innerHTML = `
    <div class="monthbar"><button class="icon-btn" id="pm" aria-label="${esc(t('Previous month'))}">${icon('back')}</button><h2>${esc(label)}</h2><button class="icon-btn" id="nm" aria-label="${esc(t('Next month'))}">${icon('next')}</button></div>
    <div class="row"><button class="btn sm" id="gt">${esc(t('Today'))}</button><button class="btn sm" id="mpdf">${icon('file', 16)} PDF</button></div>
    <div class="cal"><div class="wd">${wd.map(x => `<b>${x}</b>`).join('')}</div><div class="grid7">${cells}</div></div>
    <section><h3>${esc(fmtDayLong(S.calDay))}</h3>${dayList.length ? dayList.map(a => apptCard(a)).join('') : `<div class="empty">${esc(t('No appointments.'))}</div>`}</section>`;
  $('#pm', v).onclick = () => shiftMonth(-1); $('#nm', v).onclick = () => shiftMonth(1);
  $('#gt', v).onclick = () => { S.calMonth = todayStr().slice(0, 7); S.calDay = todayStr(); render(); };
  $('#mpdf', v).onclick = () => pdfAgenda(S.calMonth);
  $$('[data-d]', v).forEach(b => b.onclick = () => { S.calDay = b.dataset.d; render(); });
  wireAppts(v);
}

/* ===================== PATIENTS ===================== */
function viewPatients(v) {
  v.innerHTML = `<div class="searchbar">${icon('search', 18)}<input id="q" type="search" placeholder="${esc(t('Search name, phone, notes…'))}" value="${esc(S.pq)}" autocomplete="off"></div>
    <div class="chips filt">${[['active', t('Active')], ['archived', t('Archived')], ['owing', t('Owing')], ['all', t('All')]].map(([k, l]) => `<button class="chip ${S.pf === k ? 'on' : ''}" data-f="${k}">${esc(l)}</button>`).join('')}</div>
    <div id="plist"></div>`;
  const draw = () => {
    const td = todayStr(), q = normStr(S.pq).trim(), qd = q.replace(/\D/g, '');
    let list = db.patients.filter(p => S.pf === 'all' || (S.pf === 'archived' ? p.status === 'archived' : p.status !== 'archived'));
    if (S.pf === 'owing') list = db.patients.filter(p => balanceOf(p.id) > 0.005);
    if (q) list = list.filter(p => {
      const hay = normStr([p.first, p.last, p.email, p.address, p.history, p.notes].join(' '));
      if (hay.includes(q)) return true;
      if (qd.length >= 3 && String(p.phone || '').replace(/\D/g, '').includes(qd)) return true;
      return db.sessions.some(s => s.pid === p.id && normStr(`${s.topic} ${s.notes} ${s.plan}`).includes(q));
    });
    list = sortedPatients(list);
    const next = {}; db.appointments.forEach(a => { if (a.status === 'scheduled' && a.date >= td && (!next[a.pid] || a.date < next[a.pid])) next[a.pid] = a.date; });
    $('#plist', v).innerHTML = list.length ? `<p class="hint">${list.length} ${esc(list.length === 1 ? t('patient') : t('patients'))}</p>` + list.map(p => {
      const b = balanceOf(p.id);
      return `<button class="card item" data-p="${p.id}"><div class="avatar">${esc((p.first || p.last || '?')[0].toUpperCase())}</div><div class="grow"><div class="nm">${esc(pname(p))}</div><div class="sub">${esc(p.phone || '')}${next[p.id] ? (p.phone ? ' · ' : '') + esc(t('Next:')) + ' ' + esc(fmtDateS(next[p.id])) : ''}</div></div>${b > 0.005 ? `<div class="amt owe">${esc(money(b))}</div>` : ''}</button>`;
    }).join('') : `<div class="empty">${esc(db.patients.length ? t('No patient matches.') : t('No patients yet. Tap + to add one.'))}</div>`;
    $$('[data-p]', v).forEach(b => b.onclick = () => patientPage(b.dataset.p));
  };
  $('#q', v).oninput = e => { S.pq = e.target.value; draw(); };
  $$('[data-f]', v).forEach(b => b.onclick = () => { S.pf = b.dataset.f; render(); });
  draw();
}

function patientPage(pid) {
  openPage(el => {
    const p = P(pid); if (!p) { closeOverlay(el); return; }
    const td = todayStr();
    const ss = db.sessions.filter(s => s.pid === pid).sort(byDateTime).reverse();
    const upcoming = db.appointments.filter(a => a.pid === pid && a.date >= td && a.status === 'scheduled').sort(byDateTime);
    const pays = db.payments.filter(x => x.pid === pid).sort((a, b) => b.date.localeCompare(a.date));
    const bal = balanceOf(pid);
    const kv = (l, val) => val ? `<div class="kv"><span>${esc(l)}</span><div>${esc(val)}</div></div>` : '';
    el.innerHTML = `
      <div class="pagebar"><button class="icon-btn" data-back aria-label="${esc(t('Back'))}">${icon('back')}</button><h2>${esc(pname(p))}</h2><button class="icon-btn" data-edit aria-label="${esc(t('Edit'))}">${icon('edit')}</button></div>
      <div class="pagebody">
        <div class="card pad">
          <div class="muted">${p.dob ? esc(fmtDateS(p.dob)) + (ageOf(p.dob) !== '' ? ' · ' + ageOf(p.dob) + ' ' + esc(t('years')) : '') : ''}${p.status === 'archived' ? ` <span class="badge b-cancelled">${esc(t('Archived'))}</span>` : ''}</div>
          ${p.phone ? `<div class="contact"><a class="btn" href="${esc(telHref(p.phone))}">${icon('phone', 18)} ${esc(p.phone)}</a><a class="btn" href="${esc(waHref(p.phone))}" target="_blank" rel="noopener">${icon('msg', 18)} WhatsApp</a><a class="btn" href="${esc(smsHref(p.phone))}">SMS</a></div>` : ''}
          ${p.email ? `<div class="kv"><span>${esc(t('Email'))}</span><div><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></div></div>` : ''}
          ${kv(t('Address'), p.address)}${kv(t('Emergency contact'), p.emergency)}${kv(t('Medical history'), p.history)}${kv(t('General notes'), p.notes)}
        </div>
        <div class="card pad"><div class="tiles"><div><small>${esc(t('Billed'))}</small><b>${esc(money(billedOf(pid)))}</b></div><div><small>${esc(t('Paid'))}</small><b>${esc(money(paidOf(pid)))}</b></div><div><small>${esc(t('Balance'))}</small><b class="${bal > 0.005 ? 'owe' : bal < -0.005 ? 'ok' : ''}">${esc(money(bal))}</b></div></div>
          <div class="row"><button class="btn primary" data-pay>${icon('plus', 18)} ${esc(t('Payment'))}</button><button class="btn" data-stm>${icon('file', 18)} ${esc(t('Statement PDF'))}</button></div></div>
        <div class="grid2"><button class="btn primary" data-newses>${icon('plus', 18)} ${esc(t('Session note'))}</button><button class="btn" data-newappt>${icon('plus', 18)} ${esc(t('Appointment'))}</button></div>
        ${upcoming.length ? `<h3>${esc(t('Upcoming'))}</h3>${upcoming.map(a => apptCard(a, true)).join('')}` : ''}
        <h3>${esc(t('Session notes'))} (${ss.length})</h3>
        ${ss.length ? ss.map(s => `<button class="card item" data-ses="${s.id}"><div class="grow"><div class="nm">${esc(fmtDate(s.date))}${s.topic ? ' · ' + esc(s.topic) : ''}</div><div class="sub clamp">${esc(s.notes || s.plan || '')}</div></div><div class="amt">${s.fee ? esc(money(s.fee)) : ''}</div></button>`).join('') : `<div class="empty">${esc(t('No sessions recorded.'))}</div>`}
        <h3>${esc(t('Payments'))} (${pays.length})</h3>
        ${pays.length ? pays.map(x => `<button class="card item" data-pay-id="${x.id}"><div class="grow"><div class="nm">${esc(fmtDate(x.date))}</div><div class="sub">${esc(methodLabel(x.method))}${x.note ? ' · ' + esc(x.note) : ''}</div></div><div class="amt ok">${esc(money(num(x.amount)))}</div></button>`).join('') : `<div class="empty">${esc(t('No payments yet.'))}</div>`}
        <div class="grid2" style="margin-top:14px"><button class="btn" data-pdf>${icon('file', 18)} ${esc(t('Patient file PDF'))}</button><button class="btn" data-arch>${esc(p.status === 'archived' ? t('Unarchive') : t('Archive'))}</button></div>
        <button class="btn danger wide" data-del>${esc(t('Delete patient'))}</button>
      </div>`;
    $('[data-back]', el).onclick = () => closeOverlay(el);
    $('[data-edit]', el).onclick = () => patientForm(pid);
    $('[data-pay]', el).onclick = () => paymentForm({ pid });
    $('[data-stm]', el).onclick = () => pdfStatement(pid);
    $('[data-newses]', el).onclick = () => sessionForm({ pid });
    $('[data-newappt]', el).onclick = () => apptForm({ pid });
    $('[data-pdf]', el).onclick = () => pdfPatientFile(pid);
    $('[data-arch]', el).onclick = () => { p.status = p.status === 'archived' ? 'active' : 'archived'; save(); refresh(); };
    $('[data-del]', el).onclick = async () => {
      if (!await confirmBox(t('Delete {0} and ALL their appointments, session notes and payments? This cannot be undone.', pname(p)))) return;
      db.patients = db.patients.filter(x => x.id !== pid);
      db.appointments = db.appointments.filter(x => x.pid !== pid); db.sessions = db.sessions.filter(x => x.pid !== pid); db.payments = db.payments.filter(x => x.pid !== pid);
      save(); closeOverlay(el); refresh(); toast(t('Deleted'));
    };
    $$('[data-ses]', el).forEach(b => b.onclick = () => sessionForm({ id: b.dataset.ses }));
    $$('[data-pay-id]', el).forEach(b => b.onclick = () => paymentForm({ id: b.dataset['payId'] }));
    wireAppts(el);
  });
}

/* ===================== BILLING ===================== */
function viewBilling(v) {
  const ym = todayStr().slice(0, 7);
  const recv = round2(db.payments.filter(x => x.date.startsWith(ym)).reduce((s, x) => s + num(x.amount), 0));
  const billed = round2(db.sessions.filter(x => x.date.startsWith(ym)).reduce((s, x) => s + num(x.fee), 0));
  const rows = db.patients.map(p => ({ p, b: balanceOf(p.id) })).filter(x => Math.abs(x.b) >= 0.005).sort((a, b) => b.b - a.b);
  const owed = round2(rows.filter(x => x.b > 0).reduce((s, x) => s + x.b, 0));
  const pays = [...db.payments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
  v.innerHTML = `
    <div class="tiles card pad"><div><small>${esc(t('Owed to you'))}</small><b class="${owed > 0 ? 'owe' : ''}">${esc(money(owed))}</b></div><div><small>${esc(t('Received this month'))}</small><b>${esc(money(recv))}</b></div><div><small>${esc(t('Billed this month'))}</small><b>${esc(money(billed))}</b></div></div>
    <div class="row"><button class="btn sm" id="bpdf">${icon('file', 16)} ${esc(t('Balances PDF'))}</button></div>
    <section><h3>${esc(t('Balances'))}</h3>${rows.length ? rows.map(x => `<button class="card item" data-p="${x.p.id}"><div class="grow"><div class="nm">${esc(pname(x.p))}</div><div class="sub">${esc(t('Billed'))} ${esc(money(billedOf(x.p.id)))} · ${esc(t('Paid'))} ${esc(money(paidOf(x.p.id)))}</div></div><div class="amt ${x.b > 0 ? 'owe' : 'ok'}">${esc(money(x.b))}</div></button>`).join('') : `<div class="empty">${esc(t('All accounts are settled.'))}</div>`}</section>
    <section><h3>${esc(t('Recent payments'))}</h3>${pays.length ? pays.map(x => `<button class="card item" data-pay-id="${x.id}"><div class="grow"><div class="nm">${esc(pname(P(x.pid)))}</div><div class="sub">${esc(fmtDate(x.date))} · ${esc(methodLabel(x.method))}</div></div><div class="amt ok">${esc(money(num(x.amount)))}</div></button>`).join('') : `<div class="empty">${esc(t('No payments yet.'))}</div>`}</section>`;
  $('#bpdf', v).onclick = pdfBalances;
  $$('[data-p]', v).forEach(b => b.onclick = () => patientPage(b.dataset.p));
  $$('[data-pay-id]', v).forEach(b => b.onclick = () => paymentForm({ id: b.dataset['payId'] }));
}

/* ===================== STATS ===================== */
function lastMonths(n) {
  const out = [], now = new Date();
  for (let i = n - 1; i >= 0; i--) { const x = new Date(now.getFullYear(), now.getMonth() - i, 1); out.push(`${x.getFullYear()}-${pad(x.getMonth() + 1)}`); }
  return out;
}
const compact = v => v >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(Math.round(v * 10) / 10);
function barChart(labels, vals, label) {
  const W = 340, H = 160, padB = 22, padT = 18, n = vals.length, max = Math.max(...vals, 1), bw = W / n;
  let g = '';
  vals.forEach((v, i) => {
    const h = (H - padB - padT) * (v / max), x = i * bw + bw * 0.16, w = bw * 0.68, y = H - padB - h;
    g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h, v > 0 ? 1.5 : 0).toFixed(1)}" rx="2" class="bar"/>`;
    if (v > 0) g += `<text x="${(x + w / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" class="bv">${compact(v)}</text>`;
    g += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle" class="bl">${esc(labels[i])}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(label)}"><line x1="0" y1="${H - padB}" x2="${W}" y2="${H - padB}" class="axis"/>${g}</svg>`;
}
function viewStats(v) {
  const months = lastMonths(12), ym = todayStr().slice(0, 7), td = todayStr();
  const labels = months.map(k => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(loc(), { month: 'short' }).replace('.', '').slice(0, 4); });
  const by = (arr, key, val) => months.map(k => round2(arr.filter(x => String(x[key] || '').startsWith(k)).reduce((s, x) => s + (val ? num(x[val]) : 1), 0)));
  const newP = by(db.patients, 'created'), sess = by(db.sessions, 'date'), rev = by(db.payments, 'date', 'amount');
  const active = db.patients.filter(p => p.status !== 'archived').length;
  const owed = round2(db.patients.reduce((s, p) => s + Math.max(0, balanceOf(p.id)), 0));
  const since = addDays(td, -90);
  const recent = db.appointments.filter(a => a.date >= since && a.date <= td);
  const ns = recent.filter(a => a.status === 'noshow').length, dn = recent.filter(a => a.status === 'done').length;
  const rate = ns + dn ? Math.round(100 * ns / (ns + dn)) : 0;
  const cur = months.length - 1;
  v.innerHTML = `
    <div class="tiles4">
      <div class="card pad"><small>${esc(t('Active patients'))}</small><b>${active}</b></div>
      <div class="card pad"><small>${esc(t('Sessions this month'))}</small><b>${sess[cur]}</b></div>
      <div class="card pad"><small>${esc(t('Received this month'))}</small><b>${esc(money(rev[cur]))}</b></div>
      <div class="card pad"><small>${esc(t('Owed to you'))}</small><b class="${owed > 0 ? 'owe' : ''}">${esc(money(owed))}</b></div>
      <div class="card pad"><small>${esc(t('No-show rate (90 days)'))}</small><b>${rate}%</b></div>
      <div class="card pad"><small>${esc(t('Sessions (12 months)'))}</small><b>${sess.reduce((a, b) => a + b, 0)}</b></div>
    </div>
    <section class="card pad"><h3>${esc(t('New patients per month'))}</h3>${barChart(labels, newP, t('New patients per month'))}</section>
    <section class="card pad"><h3>${esc(t('Sessions per month'))}</h3>${barChart(labels, sess, t('Sessions per month'))}</section>
    <section class="card pad"><h3>${esc(t('Revenue received per month'))} (${esc(db.settings.currency)})</h3>${barChart(labels, rev, t('Revenue received per month'))}</section>
    <p class="hint">${esc(t('Revenue = payments received. New patients = by file opening date.'))}</p>`;
}

/* ===================== APPOINTMENT ===================== */
function openAppt(id) {
  const a = db.appointments.find(x => x.id === id); if (!a) return;
  const p = P(a.pid), ses = db.sessions.find(s => s.aid === a.id);
  const html = `
    <div class="apptdetail"><button class="link" data-pat>${esc(pname(p))}</button>
      <div>${esc(fmtDate(a.date))} · ${esc(a.time)}–${esc(addMin(a.time, a.dur))}</div>
      <div>${statusBadge(a.status)}${a.fee ? ' · ' + esc(money(a.fee)) : ''}</div>${a.note ? `<p class="note">${esc(a.note)}</p>` : ''}</div>
    <div class="grid2">
      ${a.status === 'done' && ses ? `<button class="btn primary" data-ses>${esc(t('Open session note'))}</button>` : `<button class="btn primary" data-done>${icon('check', 18)} ${esc(a.status === 'done' ? t('Add session note') : t('Done + session note'))}</button>`}
      ${a.status !== 'noshow' ? `<button class="btn" data-st="noshow">${esc(t('No-show'))}</button>` : ''}
      ${a.status !== 'cancelled' ? `<button class="btn" data-st="cancelled">${esc(t('Cancel appointment'))}</button>` : ''}
      ${a.status !== 'scheduled' ? `<button class="btn" data-st="scheduled">${esc(t('Set as scheduled'))}</button>` : ''}
      <button class="btn" data-edit>${icon('edit', 18)} ${esc(t('Edit / reschedule'))}</button>
      ${p && p.phone ? `<a class="btn" href="${esc(telHref(p.phone))}">${icon('phone', 18)} ${esc(t('Call'))}</a><a class="btn" href="${esc(waHref(p.phone))}" target="_blank" rel="noopener">${icon('msg', 18)} WhatsApp</a>` : ''}
    </div>
    <button class="btn danger wide" data-del>${esc(t('Delete'))}</button>`;
  openSheet(t('Appointment'), html, el => {
    const pat = $('[data-pat]', el); if (p) pat.onclick = () => patientPage(p.id);
    const done = $('[data-done]', el); if (done) done.onclick = () => { closeOverlay(el); sessionForm({ pid: a.pid, aid: a.id, date: a.date, time: a.time, fee: a.fee }); };
    const so = $('[data-ses]', el); if (so) so.onclick = () => { closeOverlay(el); sessionForm({ id: ses.id }); };
    $$('[data-st]', el).forEach(b => b.onclick = () => { a.status = b.dataset.st; save(); closeOverlay(el); refresh(); });
    $('[data-edit]', el).onclick = () => { closeOverlay(el); apptForm({ id: a.id }); };
    $('[data-del]', el).onclick = async () => { if (!await confirmBox(t('Delete this appointment?'))) return; db.appointments = db.appointments.filter(x => x.id !== a.id); db.sessions.forEach(s => { if (s.aid === a.id) s.aid = ''; }); save(); closeOverlay(el); refresh(); };
  });
}
const lastFeeOf = pid => { const s = db.sessions.filter(x => x.pid === pid).sort(byDateTime).pop(); return s ? num(s.fee) : num(db.settings.fee); };
function patientOptions(selectedId) {
  const pats = sortedPatients(db.patients.filter(p => p.status !== 'archived' || p.id === selectedId));
  return [['', t('Choose…')], ...pats.map(p => [p.id, pname(p)])];
}

/* type part of a name to filter the patient list (all words must match) */
function patientSearchHtml() { return `<label class="fld"><span>${esc(t('Search patient'))}</span><input type="search" data-psearch placeholder="${esc(t('Type part of the name…'))}" autocomplete="off" autocapitalize="off" enterkeyhint="search"></label>`; }
function wirePatientSearch(f, el) {
  const s = f.pid, input = $('[data-psearch]', el); if (!s || !input) return;
  const all = [...s.options].map(o => [o.value, o.textContent]);
  input.oninput = () => {
    const words = normStr(input.value.trim()).split(/\s+/).filter(Boolean), cur = s.value;
    const m = words.length ? all.filter(([v, l]) => v && words.every(w => normStr(l).includes(w))) : all.filter(x => x[0]);
    const opts = !words.length ? all : m.length === 1 ? m : [['', m.length ? t('Choose…') : t('No match')], ...m];
    s.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    const want = words.length && m.length === 1 ? m[0][0] : (opts.some(x => x[0] === cur) ? cur : '');
    s.value = want;
    if (want !== cur) s.dispatchEvent(new Event('change'));
  };
}

function apptForm(o = {}) {
  const a = o.id ? db.appointments.find(x => x.id === o.id) : null;
  if (!a && !db.patients.length) { toast(t('Add a patient first')); return; }
  const v = a || { pid: o.pid || '', date: o.date || todayStr(), time: o.time || '10:00', dur: db.settings.dur, fee: o.pid ? lastFeeOf(o.pid) : num(db.settings.fee), status: 'scheduled', note: '' };
  const html = `<form id="f" autocomplete="off">
    ${patientSearchHtml()}${fld(t('Patient'), sel('pid', patientOptions(v.pid), v.pid, 'required'))}
    <div class="grid2">${fld(t('Date'), inp('date', v.date, 'type="date" required'))}${fld(t('Time'), inp('time', v.time, 'type="time" required'))}</div>
    <div class="grid2">${fld(t('Duration (min)'), inp('dur', v.dur, 'type="number" min="5" step="5" inputmode="numeric"'))}${fld(t('Fee'), inp('fee', v.fee, 'type="number" min="0" step="any" inputmode="decimal"'))}</div>
    ${a ? fld(t('Status'), sel('status', ['scheduled', 'done', 'cancelled', 'noshow'].map(s => [s, statusLabel(s)]), v.status)) : ''}
    ${fld(t('Note'), txa('note', v.note, 2))}
    ${a ? '' : fld(t('Repeat weekly for N more weeks'), inp('rep', 0, 'type="number" min="0" max="52" inputmode="numeric"'))}
    <div class="row end"><button type="button" class="btn" data-cancel>${esc(t('Cancel'))}</button><button class="btn primary">${esc(t('Save'))}</button></div></form>`;
  openSheet(a ? t('Edit appointment') : t('New appointment'), html, el => {
    const f = $('#f', el);
    $('[data-cancel]', el).onclick = () => closeOverlay(el);
    wirePatientSearch(f, el);
    if (!a) f.pid.onchange = () => { if (f.pid.value) f.fee.value = lastFeeOf(f.pid.value); };
    f.onsubmit = e => {
      e.preventDefault();
      const d = formData(f);
      if (!d.pid) { toast(t('Choose a patient')); return; }
      const rec = { pid: d.pid, date: d.date, time: d.time, dur: parseInt(d.dur) || db.settings.dur, fee: num(d.fee), note: (d.note || '').trim(), status: d.status || 'scheduled' };
      const clash = db.appointments.find(x => (!a || x.id !== a.id) && x.date === rec.date && x.status !== 'cancelled' && toMin(x.time) < toMin(rec.time) + rec.dur && toMin(rec.time) < toMin(x.time) + x.dur);
      const go = () => {
        if (a) { Object.assign(a, rec); ensureSession(a); }
        else { const n = Math.min(52, parseInt(d.rep) || 0); for (let i = 0; i <= n; i++) { const na = { id: uid(), ...rec, date: addDays(rec.date, 7 * i) }; db.appointments.push(na); ensureSession(na); } }
        save(); closeOverlay(el); S.calDay = rec.date; S.calMonth = rec.date.slice(0, 7); refresh(); toast(t('Saved'));
      };
      if (clash && rec.status !== 'cancelled') confirmBox(t('This overlaps with {0} at {1}. Save anyway?', pname(P(clash.pid)), clash.time), { ok: t('Save anyway'), danger: false }).then(ok => ok && go());
      else go();
    };
  });
}

/* ===================== PATIENT FORM ===================== */
function patientForm(id) {
  const p = id ? P(id) : null;
  const v = p || { first: '', last: '', phone: '', dob: '', email: '', address: '', emergency: '', history: '', notes: '', status: 'active', created: todayStr() };
  const html = `<form id="f" autocomplete="off">
    <div class="grid2">${fld(t('First name'), inp('first', v.first, 'autocapitalize="words"'))}${fld(t('Last name'), inp('last', v.last, 'autocapitalize="words"'))}</div>
    <div class="grid2">${fld(t('Phone'), inp('phone', v.phone, 'type="tel" inputmode="tel"'))}${fld(t('Date of birth'), inp('dob', v.dob, 'type="date"'))}</div>
    ${fld(t('Email'), inp('email', v.email, 'type="email" inputmode="email"'))}
    ${fld(t('Address'), inp('address', v.address))}
    ${fld(t('Emergency contact'), inp('emergency', v.emergency))}
    ${fld(t('Medical history'), txa('history', v.history, 4))}
    ${fld(t('General notes'), txa('notes', v.notes, 4))}
    <div class="grid2">${fld(t('File opened'), inp('created', v.created, 'type="date"'))}${p ? fld(t('Status'), sel('status', [['active', t('Active')], ['archived', t('Archived')]], v.status)) : ''}</div>
    <div class="row end"><button type="button" class="btn" data-cancel>${esc(t('Cancel'))}</button><button class="btn primary">${esc(t('Save'))}</button></div></form>`;
  openSheet(p ? t('Edit patient') : t('New patient'), html, el => {
    const f = $('#f', el);
    $('[data-cancel]', el).onclick = () => closeOverlay(el);
    f.onsubmit = e => {
      e.preventDefault();
      const d = formData(f);
      ['first', 'last', 'phone', 'email', 'address', 'emergency'].forEach(k => d[k] = (d[k] || '').trim());
      if (!d.first && !d.last) { toast(t('Enter a name')); return; }
      const rec = { first: d.first, last: d.last, phone: d.phone, dob: d.dob || '', email: d.email, address: d.address, emergency: d.emergency, history: (d.history || '').trim(), notes: (d.notes || '').trim(), created: d.created || todayStr(), status: d.status || (p ? p.status : 'active') };
      if (p) { Object.assign(p, rec); save(); closeOverlay(el); refresh(); toast(t('Saved')); }
      else { const np = { id: uid(), ...rec }; db.patients.push(np); save(); closeOverlay(el); refresh(); patientPage(np.id); }
    };
  });
}

/* ===================== SESSION NOTE FORM ===================== */
function sessionForm(o = {}) {
  const s = o.id ? db.sessions.find(x => x.id === o.id) : null;
  if (!s && !db.patients.length) { toast(t('Add a patient first')); return; }
  const v = s || { pid: o.pid || '', aid: o.aid || '', date: o.date || todayStr(), time: o.time || '', topic: '', notes: '', plan: '', fee: o.fee !== undefined ? o.fee : (o.pid ? lastFeeOf(o.pid) : num(db.settings.fee)) };
  const html = `<form id="f" autocomplete="off">
    ${patientSearchHtml()}${fld(t('Patient'), sel('pid', patientOptions(v.pid), v.pid, 'required'))}
    <div id="hint"></div>
    <div class="grid2">${fld(t('Date'), inp('date', v.date, 'type="date" required'))}${fld(t('Fee'), inp('fee', v.fee, 'type="number" min="0" step="any" inputmode="decimal"'))}</div>
    ${fld(t('Topic'), inp('topic', v.topic))}
    ${fld(t('Session notes'), txa('notes', v.notes, 9))}
    ${fld(t('Plan / tasks'), txa('plan', v.plan, 3))}
    <div class="row end">${s ? `<button type="button" class="btn danger" data-del>${esc(t('Delete'))}</button>` : ''}<button type="button" class="btn" data-cancel>${esc(t('Cancel'))}</button><button class="btn primary">${esc(t('Save'))}</button></div></form>`;
  openSheet(s ? t('Edit session note') : t('New session note'), html, el => {
    const f = $('#f', el);
    const hint = () => {
      const prev = db.sessions.filter(x => x.pid === f.pid.value && (!s || x.id !== s.id) && x.plan).sort(byDateTime).pop();
      $('#hint', el).innerHTML = prev ? `<div class="hintbox"><b>${esc(t('Last plan / tasks'))}</b> (${esc(fmtDateS(prev.date))})<br>${esc(prev.plan)}</div>` : '';
    };
    hint();
    wirePatientSearch(f, el);
    f.pid.onchange = () => { hint(); if (!s && f.pid.value) f.fee.value = lastFeeOf(f.pid.value); };
    $('[data-cancel]', el).onclick = () => closeOverlay(el);
    const del = $('[data-del]', el);
    if (del) del.onclick = async () => { if (!await confirmBox(t('Delete this session note?'))) return; db.sessions = db.sessions.filter(x => x.id !== s.id); save(); closeOverlay(el); refresh(); };
    f.onsubmit = e => {
      e.preventDefault();
      const d = formData(f);
      if (!d.pid) { toast(t('Choose a patient')); return; }
      const rec = { pid: d.pid, date: d.date, time: v.time || '', aid: v.aid || '', topic: (d.topic || '').trim(), notes: (d.notes || '').trim(), plan: (d.plan || '').trim(), fee: num(d.fee) };
      if (s) Object.assign(s, rec); else db.sessions.push({ id: uid(), ...rec });
      if (rec.aid) { const ap = db.appointments.find(x => x.id === rec.aid); if (ap && ap.status !== 'done') ap.status = 'done'; }
      save(); closeOverlay(el); refresh(); toast(t('Saved'));
    };
  });
}

/* ===================== PAYMENT FORM ===================== */
function paymentForm(o = {}) {
  const x = o.id ? db.payments.find(p => p.id === o.id) : null;
  if (!x && !db.patients.length) { toast(t('Add a patient first')); return; }
  const pid0 = x ? x.pid : (o.pid || '');
  const v = x || { pid: pid0, date: todayStr(), amount: pid0 && balanceOf(pid0) > 0 ? balanceOf(pid0) : '', method: 'cash', note: '' };
  const html = `<form id="f" autocomplete="off">
    ${patientSearchHtml()}${fld(t('Patient'), sel('pid', patientOptions(v.pid), v.pid, 'required'))}
    <div class="grid2">${fld(t('Date'), inp('date', v.date, 'type="date" required'))}${fld(t('Amount'), inp('amount', v.amount, 'type="number" step="any" inputmode="decimal" required'))}</div>
    ${fld(t('Method'), sel('method', ['cash', 'card', 'transfer', 'other'].map(m => [m, methodLabel(m)]), v.method))}
    ${fld(t('Note'), inp('note', v.note))}
    <div class="row end">${x ? `<button type="button" class="btn danger" data-del>${esc(t('Delete'))}</button>` : ''}<button type="button" class="btn" data-cancel>${esc(t('Cancel'))}</button><button class="btn primary">${esc(t('Save'))}</button></div></form>`;
  openSheet(x ? t('Edit payment') : t('New payment'), html, el => {
    const f = $('#f', el);
    wirePatientSearch(f, el);
    if (!x) f.pid.onchange = () => { const b = f.pid.value ? balanceOf(f.pid.value) : 0; f.amount.value = b > 0 ? b : ''; };
    $('[data-cancel]', el).onclick = () => closeOverlay(el);
    const del = $('[data-del]', el);
    if (del) del.onclick = async () => { if (!await confirmBox(t('Delete this payment?'))) return; db.payments = db.payments.filter(p => p.id !== x.id); save(); closeOverlay(el); refresh(); };
    f.onsubmit = e => {
      e.preventDefault();
      const d = formData(f);
      if (!d.pid) { toast(t('Choose a patient')); return; }
      const amt = num(d.amount); if (!amt) { toast(t('Enter an amount')); return; }
      const rec = { pid: d.pid, date: d.date, amount: amt, method: d.method, note: (d.note || '').trim() };
      if (x) Object.assign(x, rec); else db.payments.push({ id: uid(), ...rec });
      save(); closeOverlay(el); refresh(); toast(t('Saved'));
    };
  });
}

/* ===================== SETTINGS ===================== */
function openSettings() {
  openPage(el => {
    const s = db.settings;
    const lb = s.lastBackup ? fmtDateS(s.lastBackup) : t('never');
    el.innerHTML = `
      <div class="pagebar"><button class="icon-btn" data-back aria-label="${esc(t('Back'))}">${icon('back')}</button><h2>${esc(t('Settings'))}</h2><span style="width:44px"></span></div>
      <div class="pagebody">
        <section class="card pad"><h3>${esc(t('General'))}</h3>
          ${fld(t('Language'), sel('lang', [['fr', 'Français'], ['en', 'English']], s.lang))}
          ${fld(t('Practice / therapist name (on PDFs)'), inp('clinic', s.clinic))}
          <div class="grid2">${fld(t('Currency'), sel('currency', [['USD', 'USD ($)'], ['EUR', 'EUR (€)'], ['LBP', 'LBP']], s.currency))}${fld(t('Default fee'), inp('fee', s.fee, 'type="number" min="0" step="any" inputmode="decimal"'))}</div>
          <div class="grid2">${fld(t('Default duration (min)'), inp('dur', s.dur, 'type="number" min="5" step="5" inputmode="numeric"'))}${fld(t('Country code (WhatsApp)'), inp('cc', s.cc, 'inputmode="numeric"'))}</div>
        </section>
        <section class="card pad"><h3>${esc(t('Security'))}</h3>
          ${fld(t('Auto-lock'), sel('autoLock', [[0, t('Immediately')], [30, t('After 30 seconds')], [120, t('After 2 minutes')], [300, t('After 5 minutes')]], s.autoLock))}
          <div class="grid2"><button class="btn" data-pin>${esc(t('Change PIN'))}</button><button class="btn" data-lock>${icon('lock', 18)} ${esc(t('Lock now'))}</button></div>
        </section>
        <section class="card pad"><h3>${esc(t('Backup'))}</h3>
          <p class="muted">${esc(t('Your data lives only on this phone. Back it up regularly and keep the file somewhere safe: it is not encrypted.'))}<br>${esc(t('Last backup:'))} <b>${esc(lb)}</b></p>
          ${fld(t('Backup reminder'), sel('backupDays', [[0, t('Never')], [7, t('Every week')], [14, t('Every 2 weeks')], [30, t('Every month')]], s.backupDays))}
          ${fld(t('Encrypt backups with a password'), sel('backupEnc', [['0', t('No')], ['1', t('Yes')]], s.backupEnc ? '1' : '0'))}
          <div class="stack"><button class="btn primary" data-bk>${esc(t('Back up & share'))}</button><button class="btn" data-bks>${esc(t('Save to phone'))}</button><button class="btn" data-rs>${esc(t('Restore backup'))}</button></div>
          <p class="muted small">${esc(t('"Back up & share" opens the share sheet (WhatsApp, Drive, e-mail...).'))}</p>
        </section>
        <section class="card pad"><h3>${esc(t('Import / Export'))}</h3>
          <div class="stack"><button class="btn" data-imp>${esc(t('Import patients (Excel / CSV)'))}</button><button class="btn" data-tpl>${esc(t('Download import template'))}</button>
          <button class="btn" data-xl>${esc(t('Export everything (Excel)'))}</button><button class="btn" data-csv>${esc(t('Export patients (CSV)'))}</button><button class="btn" data-plpdf>${esc(t('Patient list (PDF)'))}</button></div>
        </section>
        <section class="card pad"><h3>${esc(t('Danger zone'))}</h3><button class="btn danger wide" data-erase>${esc(t('Erase all data'))}</button></section>
        <p class="muted small">Agenda Psy v1.0</p>
      </div>`;
    $('[data-back]', el).onclick = () => closeOverlay(el);
    $$('select[name],input[name]', el).forEach(i => i.onchange = () => {
      const k = i.name;
      if (k === 'lang') { s.lang = i.value; LANG = i.value; save(); closeAllOverlays(); render(); openSettings(); return; }
      if (k === 'backupEnc') s[k] = i.value === '1'; else if (['fee', 'dur', 'autoLock', 'backupDays'].includes(k)) s[k] = num(i.value); else s[k] = i.value.trim();
      if (k === 'dur' && !s.dur) s.dur = 50;
      save(); if (k === 'currency') refresh();
    });
    $('[data-pin]', el).onclick = changePinSheet;
    $('[data-lock]', el).onclick = () => lockScreen();
    $('[data-bk]', el).onclick = () => runBackup('share');
    $('[data-bks]', el).onclick = () => runBackup('save');
    $('[data-rs]', el).onclick = () => pickFile('.json,.txt,application/json,text/plain', restoreBackup);
    $('[data-imp]', el).onclick = startImport;
    $('[data-tpl]', el).onclick = downloadTemplate;
    $('[data-xl]', el).onclick = exportXlsx;
    $('[data-csv]', el).onclick = exportPatientsCsv;
    $('[data-plpdf]', el).onclick = pdfPatientList;
    $('[data-erase]', el).onclick = async () => {
      if (!await confirmBox(t('Erase ALL patients, appointments, notes and payments from this phone?'), { ok: t('Continue') })) return;
      if (!await confirmBox(t('Last chance: this cannot be undone. Erase everything?'), { ok: t('Erase everything') })) return;
      eraseAll();
    };
  });
}
function eraseAll() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '.fail'); } catch (e) { }
  db = defaults(); LANG = db.settings.lang; closeAllOverlays(); lockScreen();
}
function changePinSheet() {
  const html = `<form id="f" autocomplete="off">
    ${fld(t('Current PIN'), inp('cur', '', 'type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" required'))}
    ${fld(t('New PIN (4 to 6 digits)'), inp('n1', '', 'type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="6" required'))}
    ${fld(t('Repeat new PIN'), inp('n2', '', 'type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="6" required'))}
    <div class="row end"><button type="button" class="btn" data-cancel>${esc(t('Cancel'))}</button><button class="btn primary">${esc(t('Save'))}</button></div></form>`;
  openSheet(t('Change PIN'), html, el => {
    const f = $('#f', el);
    $('[data-cancel]', el).onclick = () => closeOverlay(el);
    f.onsubmit = async e => {
      e.preventDefault();
      const d = formData(f);
      if (!await verifyPin(d.cur)) { toast(t('Wrong PIN')); return; }
      if (!/^\d{4,6}$/.test(d.n1)) { toast(t('PIN must be 4 to 6 digits')); return; }
      if (d.n1 !== d.n2) { toast(t('PINs do not match')); return; }
      await setPin(d.n1); closeOverlay(el); toast(t('PIN changed'));
    };
  });
}
