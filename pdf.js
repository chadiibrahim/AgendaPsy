'use strict';
/* Minimal offline PDF writer: Helvetica, WinAnsi (Latin-1 + common punctuation), A4, wrapped text and tables. */
const PDFW = (() => {
  // Helvetica advance widths for ASCII 32..126 (per 1000 em)
  const WID = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  const CP = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F };

  function enc(s) {
    let o = '';
    for (const ch of String(s ?? '')) {
      const c = ch.codePointAt(0);
      if (/\s/.test(ch)) { o += ' '; continue; }
      if (c < 32) continue;
      // 128-255 pass through unchanged so that already-encoded text (wrapped lines) is not mangled by a second pass
      if (c <= 126 || (c >= 128 && c <= 255)) o += String.fromCharCode(c);
      else if (CP[ch] !== undefined) o += String.fromCharCode(CP[ch]);
      else o += '?';
    }
    return o;
  }
  function cw(ch) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c <= 126) return WID[c - 32];
    const b = ch.normalize('NFD')[0];
    const bc = b ? b.charCodeAt(0) : 0;
    if (bc >= 32 && bc <= 126) return WID[bc - 32];
    return 556;
  }
  function width(s, size, bold) { let w = 0; for (const ch of s) w += cw(ch); return w * size / 1000 * (bold ? 1.07 : 1); }
  function wrap(text, maxW, size, bold) {
    const out = [];
    String(text ?? '').split(/\r?\n/).forEach(par => {
      par = enc(par);
      if (!par.trim()) { out.push(''); return; }
      let line = '';
      par.split(' ').forEach(word => {
        if (word === '') return;
        const test = line ? line + ' ' + word : word;
        if (width(test, size, bold) <= maxW) { line = test; return; }
        if (line) { out.push(line); line = ''; }
        // very long word: hard break
        let w = word;
        while (width(w, size, bold) > maxW && w.length > 1) {
          let k = w.length - 1;
          while (k > 1 && width(w.slice(0, k), size, bold) > maxW) k--;
          out.push(w.slice(0, k)); w = w.slice(k);
        }
        line = w;
      });
      if (line) out.push(line);
    });
    return out;
  }
  const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  const PW = 595, PH = 842, M = 40;
  const BRAND = '0.18 0.50 0.47', INK = '0.12 0.16 0.18', MUTED = '0.42 0.48 0.50';

  class Doc {
    constructor(title, footerLeft) {
      this.title = title; this.footerLeft = footerLeft || ''; this.pages = []; this.newPage();
    }
    newPage() { this.cur = []; this.pages.push(this.cur); this.y = PH - M; }
    ensure(h) { if (this.y - h < M + 22) { this.newPage(); return true; } return false; }
    raw(op) { this.cur.push(op); }
    text(x, y, s, size = 10, bold = false, color = INK) {
      this.raw(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(enc(s))}) Tj ET`);
    }
    space(n = 6) { this.y -= n; }
    h1(s) { const lines = wrap(s, PW - 2 * M, 18, true); lines.forEach(l => { this.ensure(24); this.y -= 20; this.text(M, this.y, l, 18, true, BRAND); }); this.y -= 4; }
    sub(s) { if (!s) return; this.ensure(14); this.y -= 12; this.text(M, this.y, enc(s), 9.5, false, MUTED); this.y -= 6; }
    h2(s) {
      this.ensure(34); this.y -= 22;
      this.text(M, this.y, s, 12, true, BRAND);
      this.raw(`${BRAND} RG 0.8 w ${M} ${(this.y - 4).toFixed(2)} m ${PW - M} ${(this.y - 4).toFixed(2)} l S`);
      this.y -= 8;
    }
    p(s, { size = 10, bold = false, indent = 0, color = INK, gap = 3 } = {}) {
      const lh = size * 1.32;
      wrap(s, PW - 2 * M - indent, size, bold).forEach(l => { this.ensure(lh); this.y -= lh; if (l) this.text(M + indent, this.y, l, size, bold, color); });
      this.y -= gap;
    }
    kv(label, value) {
      if (value === undefined || value === null || String(value).trim() === '') return;
      const size = 10, lh = 13.2, lx = 118;
      const lines = wrap(value, PW - 2 * M - lx, size, false);
      this.ensure(lh);
      lines.forEach((l, i) => {
        this.ensure(lh); this.y -= lh;
        if (i === 0) this.text(M, this.y, label, 9.5, true, MUTED);
        if (l) this.text(M + lx, this.y, l, size, false, INK);
      });
      this.y -= 2;
    }
    table(cols, rows, { size = 9 } = {}) {
      const total = PW - 2 * M, lh = size * 1.3, padX = 4;
      const xs = []; let acc = M; cols.forEach(c => { xs.push(acc); acc += c.w * total; });
      const header = () => {
        this.ensure(lh + 10); this.y -= lh + 6;
        this.raw(`0.90 0.95 0.94 rg ${M} ${(this.y - 3).toFixed(2)} ${total} ${(lh + 6).toFixed(2)} re f`);
        cols.forEach((c, i) => {
          const cwid = c.w * total;
          const tx = c.align === 'r' ? xs[i] + cwid - padX - width(enc(c.h), size, true) : xs[i] + padX;
          this.text(tx, this.y + 1, c.h, size, true, BRAND);
        });
      };
      header();
      rows.forEach(r => {
        const cells = r.map((v, i) => wrap(v, cols[i].w * total - 2 * padX, size, !!(r.bold)));
        const n = Math.max(1, ...cells.map(c => c.length));
        const h = n * lh + 5;
        if (this.ensure(h + 2)) header();
        this.y -= 3;
        cells.forEach((lines, i) => {
          const cwid = cols[i].w * total;
          lines.forEach((l, k) => {
            if (!l) return;
            const tx = cols[i].align === 'r' ? xs[i] + cwid - padX - width(l, size, false) : xs[i] + padX;
            this.text(tx, this.y - lh * (k + 1) + 3, l, size, !!r.bold, INK);
          });
        });
        this.y -= n * lh + 2;
        this.raw(`0.86 0.89 0.89 RG 0.4 w ${M} ${(this.y).toFixed(2)} m ${PW - M} ${(this.y).toFixed(2)} l S`);
      });
      this.y -= 6;
    }
    finish() {
      const n = this.pages.length;
      const stamp = new Date().toLocaleDateString('fr-FR') + ' ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      this.pages.forEach((ops, i) => {
        const left = enc(this.footerLeft + (this.footerLeft ? '  |  ' : '') + stamp);
        ops.push(`BT /F1 8 Tf ${MUTED} rg ${M} 22 Td (${esc(left)}) Tj ET`);
        const r = `${i + 1} / ${n}`;
        ops.push(`BT /F1 8 Tf ${MUTED} rg ${(PW - M - width(r, 8, false)).toFixed(2)} 22 Td (${esc(r)}) Tj ET`);
      });
      const objs = [];
      objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
      objs[2] = `<< /Type /Pages /Kids [${this.pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ')}] /Count ${n} >>`;
      objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
      objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
      this.pages.forEach((ops, i) => {
        const stream = ops.join('\n');
        objs[5 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`;
        objs[6 + 2 * i] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
      });
      let out = '%PDF-1.4\n%âãÏÓ\n';
      const offs = [];
      for (let i = 1; i < objs.length; i++) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
      const xref = out.length;
      out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
      for (let i = 1; i < objs.length; i++) out += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
      out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
      return bytes;
    }
  }
  return { Doc, enc, wrap, width };
})();
