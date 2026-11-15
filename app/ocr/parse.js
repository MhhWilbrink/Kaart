/* Turns the text on a business card or badge into contact fields.
   Runs on the phone; nothing is sent anywhere. Heuristics, so the user always checks the result.
   Input: lines [{ text, h }] (h = letter height in pixels, from the text reader) and/or a QR code payload. */
(function (root) {
  const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const URLRX = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|nl|de|be|fr|uk|no|dk|se|fi|pl|it|es|eu|org|net|io|gov|mil|int|co|ca|au|us)(?:\/[^\s]*)?)/i;
  const PHONE = /(\+|00)?[\d][\d ()./-]{6,}\d/;
  const LEGAL = /\b(b\.?v\.?|n\.?v\.?|ltd\.?|limited|gmbh|ag|inc\.?|llc|plc|s\.?a\.?|s\.?r\.?l\.?|a\/s|as|ab|oy|sp\.? ?z\.? ?o\.? ?o\.?|corp\.?|company|group|holding|systems|technologies|technology|defence|defense|navy|naval|marine|maritime|ministry|agency|university|institute|foundation|kongsberg|thales|saab|damen)\b/i;
  const TITLE = /\b(manager|director|engineer|officer|commander|captain|lieutenant|admiral|colonel|major|head|lead|leader|chief|ceo|cto|cfo|coo|vp|vice|president|founder|owner|partner|consultant|advisor|adviser|specialist|analyst|architect|developer|scientist|researcher|surveyor|hydrographer|sales|business|account|project|program|programme|product|marketing|procurement|buyer|technician|operator|coordinator|assistant|secretary|attach[eé]|professor|dr\.?|sr\.?|senior|junior|principal)\b/i;
  const SKIP = /^(tel|phone|mobile|mob|m|t|f|fax|e|email|e-mail|mail|w|web|www|address|adres)[.:]?\s*/i;
  const LABELS = /^(name|naam|company|bedrijf|organi[sz]ation|title|functie)\s*[:]\s*/i;

  const tidy = s => String(s || '').replace(/[|_~•·]+/g, ' ').replace(/\s+/g, ' ').trim();
  const letters = s => (s.match(/\p{L}/gu) || []).length;

  function phoneFrom(s) {
    const m = s.replace(/[oO](?=\d)/g, '0').match(PHONE);
    if (!m) return '';
    const p = m[0].replace(/[^\d+()\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    return p.replace(/\D/g, '').length >= 8 ? p : '';
  }

  function looksLikeName(s) {
    if (!s || /\d|@|www|http/i.test(s) || LEGAL.test(s) || TITLE.test(s)) return false;
    const words = s.split(' ').filter(Boolean);
    if (words.length < 2 || words.length > 5) return false;
    // "Anna de Boer", "Jürgen Müller", "VAN DER BERG, Piet": mostly capitalised words, small particles allowed
    const caps = words.filter(w => /^\p{Lu}/u.test(w)).length;
    const particles = words.filter(w => /^(van|von|de|der|den|du|da|di|la|le|ten|ter|op|het|'t|y|bin|al)$/i.test(w)).length;
    return caps + particles === words.length && caps >= 2 && letters(s) >= 4;
  }

  function fromVcard(txt) {
    const get = k => { const m = new RegExp('^' + k + '(?:;[^:]*)?:(.*)$', 'im').exec(txt); return m ? m[1].trim() : ''; };
    let name = get('FN');
    if (!name) { const n = get('N').split(';'); name = [n[1], n[0]].filter(Boolean).join(' '); }
    return { name, company: get('ORG').split(';')[0], title: get('TITLE'), email: get('EMAIL'), phone: get('TEL'), website: get('URL') };
  }
  function fromMecard(txt) {
    const get = k => { const m = new RegExp('(?:^|;)' + k + ':([^;]*)', 'i').exec(txt.replace(/^MECARD:/i, '')); return m ? m[1].trim() : ''; };
    const n = get('N').split(',');
    return { name: n.length > 1 ? (n[1] + ' ' + n[0]).trim() : n[0], company: get('ORG'), title: '', email: get('EMAIL'), phone: get('TEL'), website: get('URL') };
  }

  function parse(input) {
    const out = { name: '', company: '', title: '', email: '', phone: '', website: '', source: '' };
    const qr = input.qr || '';
    if (/BEGIN:VCARD/i.test(qr)) Object.assign(out, fromVcard(qr), { source: 'qr' });
    else if (/^MECARD:/i.test(qr)) Object.assign(out, fromMecard(qr), { source: 'qr' });
    if (out.source === 'qr' && out.name) return out;

    const lines = (input.lines || []).map(l => ({ text: tidy(l.text), h: l.h || 0 })).filter(l => l.text && letters(l.text) + (l.text.match(/\d/g) || []).length >= 2);
    const used = new Set();
    const all = lines.map(l => l.text).join('\n');

    const em = all.match(EMAIL);
    if (em) out.email = em[0].replace(/[.,;]+$/, '').toLowerCase();
    lines.forEach((l, i) => {
      const t = l.text.replace(SKIP, '');
      if (EMAIL.test(l.text)) used.add(i);
      if (!out.phone && !EMAIL.test(l.text) && /(\+|00|tel|phone|mob|^t\b|^m\b|\d{3})/i.test(l.text)) {
        const p = phoneFrom(t);
        if (p && (p.replace(/\D/g, '').length / t.replace(/\s/g, '').length) > 0.5) { out.phone = p; used.add(i); }
      }
      if (!out.website && !EMAIL.test(l.text)) {
        const w = l.text.match(URLRX);
        if (w && /www\.|https?:|\//i.test(w[0]) || (w && l.text.trim().length === w[0].length)) { out.website = w[0]; used.add(i); }
      }
    });

    // labelled lines ("Name: …") on some badges
    lines.forEach((l, i) => {
      const m = l.text.match(LABELS);
      if (!m) return;
      const v = l.text.slice(m[0].length);
      const k = m[1].toLowerCase();
      if (/name|naam/.test(k) && !out.name) out.name = v;
      else if (/company|bedrijf|organi/.test(k) && !out.company) out.company = v;
      else if (/title|functie/.test(k) && !out.title) out.title = v;
      used.add(i);
    });

    const free = lines.map((l, i) => Object.assign({ i }, l)).filter(l => !used.has(l.i));
    if (!out.name) {
      // the biggest text that looks like a name; on badges the name is printed largest
      const cands = free.filter(l => looksLikeName(l.text)).sort((x, y) => y.h - x.h || x.i - y.i);
      if (cands.length) { out.name = cands[0].text; used.add(cands[0].i); }
    }
    if (!out.title) {
      const t = free.find(l => !used.has(l.i) && TITLE.test(l.text) && !/\d|@/.test(l.text) && l.text.length <= 70);
      if (t) { out.title = t.text; used.add(t.i); }
    }
    if (!out.company) {
      const c = free.find(l => !used.has(l.i) && LEGAL.test(l.text) && !/@|www/i.test(l.text) && l.text.length <= 60);
      if (c) { out.company = c.text; used.add(c.i); }
    }
    if (!out.company) {
      // fall back to the email domain: anna@kongsberg.com -> Kongsberg
      const dom = (out.email.split('@')[1] || '').split('.');
      const free2 = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|proton|protonmail|gmx|ziggo|kpnmail|planet|home|xs4all)$/i;
      if (dom.length > 1 && !free2.test(dom[0])) {
        const word = dom[dom.length - 2] === 'co' || dom[dom.length - 2] === 'com' ? dom[dom.length - 3] : dom[dom.length - 2];
        const hit = free.find(l => !used.has(l.i) && word && l.text.toLowerCase().replace(/[^a-z0-9]/g, '').includes(word.replace(/[^a-z0-9]/g, '')));
        out.company = hit ? hit.text : (word || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }
    }
    if (!out.company && out.name) {
      // badges: the company is usually the next biggest text that is not the event or the visitor type
      const BADGE = /^(visitor|exhibitor|speaker|delegate|press|media|staff|crew|organi[sz]er|vip|guest|attendee|contractor|bezoeker|standhouder)$/i;
      const c = free.filter(l => !used.has(l.i) && !/\d|@|www/i.test(l.text) && !BADGE.test(l.text) && letters(l.text) >= 3 && l.text.length <= 60)
        .sort((x, y) => y.h - x.h || x.i - y.i)[0];
      if (c) { out.company = c.text; used.add(c.i); }
    }
    out.source = out.source || 'text';
    return out;
  }

  root.CardParse = { parse, looksLikeName };
  if (typeof module !== 'undefined') module.exports = root.CardParse;
})(typeof window !== 'undefined' ? window : globalThis);
