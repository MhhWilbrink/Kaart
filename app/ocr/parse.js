/* Turns the text on a business card or badge into contact fields.
   Runs on the phone; nothing is sent anywhere. Heuristics, so the user always checks the result.
   Input: lines [{ text, h }] (h = letter height in pixels, from the text reader) and/or a QR code payload. */
(function (root) {
  const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const URLRX = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|nl|de|be|fr|uk|no|dk|se|fi|pl|it|es|eu|org|net|io|gov|mil|int|co|ca|au|us|hr|at|ch|pt|gr|ee|lv|lt|ro|bg|si|sk|cz|hu|tr|is)(?:\/[^\s]*)?)/i;
  const PHONE = /(\+|00)?[\d][\d ()./-]{6,}\d/;
  // legal forms: the line is almost certainly the company name
  const LEGAL = /\b(b\.?v\.?|n\.?v\.?|ltd\.?|limited|gmbh|ag|inc\.?|llc|plc|s\.?a\.?s?|s\.?r\.?l\.?|s\.?p\.?a\.?|a\/s|asa|as|ab|oy|oyj|sp\.? ?z\.? ?o\.? ?o\.?|d\.?o\.?o\.?|corp\.?|kg|se)\b\.?/i;
  // organisations without a legal form (defence, government, research); stronger words first
  const ORG = [
    /\b(navy|naval|marine|mornarica|marina|marynarka|sjøforsvaret|marinen|kriegsmarine|coast ?guard|kustwacht|obalna straža|army|air force|luchtmacht|landmacht|krijgsmacht|bundeswehr|armed forces|forsvaret)\b/i,
    /\b(command|commando|kommando|zapovjedni\S*|headquarters|nato|ncia|nspa|occar|dmo)\b/i,
    /\b(ministry|ministarstvo|ministerie|ministerium|minist[eè]re|ministerstwo|departement|department|agency|agentschap|bundesamt|directorate|university|universiteit|universität|institute|instituut|institut|tno|fraunhofer|foundation|republi\S*|snage|forces)\b/i,
    /\b(group|groep|gruppe|holding|systems|technologies|technology|solutions|engineering|industries|defen[cs]e|robotics|maritime|shipyard|werft)\b/i
  ];
  const GENERIC = /^(group|groep|gruppe|holding|company|ltd|gmbh|inc|systems|solutions|international)$/i;
  const TITLE = /\b(manager|director|directeur|directrice|direktor|engineer|ingenieur|ingénieur|officer|commander|captain|lieutenant|admiral|colonel|major|head|hoofd|leiter|leiterin|lead|leader|chief|ceo|cto|cfo|coo|cco|cio|cso|cmo|vp|vice|president|founder|owner|partner|consultant|advisor|adviser|adviseur|specialist|analyst|architect|developer|scientist|researcher|surveyor|hydrographer|sales|business development|account|project|program|programme|product|marketing|procurement|buyer|inkoper|technician|operator|coordinator|co[öo]rdinator|assistant|secretary|attach[eé]|professor|senior|junior|principal|voditelj|načelnik|nacelnik|zapovjednik|savjetnik|referent|responsable|chef|kierownik|dyrektor|sjef|rådgiver|leder|teamleider|afdelingshoofd|beleidsmedewerker|medewerker)\b/i;
  // ranks and honorifics in front of a name (moved to the job title)
  const RANK = /^(brigadir|kontraadmiral|viceadmiral|admiral|kapetan bojnog broda|kapetan fregate|kapetan korvete|kapetan|pukovnik|bojnik|satnik|poru[čc]nik|commodore|rear admiral|vice admiral|captain|capt\.?|commander|cdr\.?|lcdr\.?|lt\.? ?cdr\.?|lieutenant commander|lieutenant|lt\.?|colonel|col\.?|lt\.? ?col\.?|major|maj\.?|brigadier|general|gen\.?|kapitein ter zee|kapitein-luitenant ter zee|kltz|ktz|ltz\d?|kolonel|majoor|kapitein|fregattenkapit[äa]n|korvettenkapit[äa]n|kapit[äa]n zur see|kapit[äa]nleutnant|oberst|oberstleutnant|capitaine de (?:vaisseau|fr[ée]gate|corvette)|capitaine|kommand[øo]r(?:kaptein)?|orlogskaptein|kaptein|komandor(?: porucznik)?|kmdr\.?|dr\.?|drs\.?|ir\.?|ing\.?|prof\.?|mr\.?|mrs\.?|ms\.?|dipl\.?-ing\.?)\s+/i;
  const SKIP = /^(tel|phone|telefon|telefoon|mobile|mobiel|mobil|mob|gsm|cell|m|t|f|fax|e|email|e-mail|mail|w|web|www|address|adres)[.:]*\s*/i;
  const LABELS = /^(name|naam|company|bedrijf|organi[sz]ation|title|functie)\s*[:]\s*/i;
  const PARTICLE = /^(van|von|de|der|den|du|da|di|la|le|ten|ter|op|het|'t|y|bin|al|zu|del|dos|das)$/i;
  const MOBILE = /^(\+31\s?\(?0?\)?\s?6|06|\+44\s?\(?0?\)?\s?7|\+49\s?\(?0?\)?\s?1[5-7]|\+385\s?\(?0?\)?\s?9|\+33\s?\(?0?\)?\s?[67]|\+47\s?[49])/;

  const tidy = s => String(s || '').replace(/[|_~•·]+/g, ' ').replace(/\s+/g, ' ').trim();
  const letters = s => (s.match(/\p{L}/gu) || []).length;
  const orgLevel = s => { const i = ORG.findIndex(rx => rx.test(s)); return i < 0 ? 99 : i; };

  // "ROBERTO KRAMARIC" -> "Roberto Kramaric", "Raphaël BOURDON" -> "Raphaël Bourdon", particles stay small
  function nameCase(s) {
    return s.split(' ').map((w, i) => {
      if (i > 0 && PARTICLE.test(w)) return w.toLowerCase();
      if (w.length > 1 && w === w.toUpperCase() && /\p{L}{2}/u.test(w)) return w.split('-').map(p => p.charAt(0) + p.slice(1).toLowerCase()).join('-');
      return w;
    }).join(' ');
  }

  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  const plain = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // the reader mixes up 1, l, i, I, t and j; compare words with those made equal
  const loose = s => plain(s).replace(/[1li|!tj]/g, 'l').replace(/[0o]/g, 'o');

  function splitRank(s) {
    const m = s.match(RANK);
    return m ? { rank: m[0].trim(), rest: s.slice(m[0].length).trim() } : { rank: '', rest: s };
  }

  function phoneFrom(s) {
    const m = s.replace(/[oO](?=\d)/g, '0').match(PHONE);
    if (!m) return '';
    const p = m[0].replace(/[^\d+()\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    return p.replace(/\D/g, '').length >= 8 ? p : '';
  }

  function looksLikeName(s) {
    if (!s || /\d|@|www|http|[|/\\]/i.test(s) || LEGAL.test(s) || TITLE.test(s) || orgLevel(s) < 99) return false;
    const words = s.split(' ').filter(Boolean);
    if (words.length < 2 || words.length > 5) return false;
    if (words.some(w => w.length === 1 && !/^\p{Lu}\.?$/u.test(w))) return false;
    const caps = words.filter(w => /^\p{Lu}/u.test(w)).length;
    const particles = words.filter(w => PARTICLE.test(w)).length;
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

    // a QR code with a web address tells us the exact domain (optics11.com, not opticsil.com)
    let qrHost = '';
    const qm = /^https?:\/\/(?:www\.)?([^/\s?#]+)/i.exec(qr);
    if (qm) qrHost = qm[1].toLowerCase();
    const lines = (input.lines || []).map(l => ({ text: tidy(l.text).replace(/([\w.-])\s?[&®]\s?([\w-]+\.[\w.-]+)/, '$1@$2'), h: l.h || 0 }))
      .filter(l => l.text && letters(l.text) + (l.text.match(/\d/g) || []).length >= 2);
    const used = new Set();
    const all = lines.map(l => l.text).join('\n');

    const em = all.match(EMAIL);
    if (em) out.email = em[0].replace(/[.,;]+$/, '').toLowerCase();

    // phone numbers: mobile first, then landline; never fax
    const phones = [];
    lines.forEach((l, i) => {
      if (EMAIL.test(l.text)) { used.add(i); return; }
      if (/^\s*(fax|f)\b[.:]*/i.test(l.text)) { if (phoneFrom(l.text)) used.add(i); return; }
      const t = l.text.replace(SKIP, '');
      const p = phoneFrom(t);
      if (p && (p.replace(/\D/g, '').length / Math.max(1, t.replace(/\s/g, '').length)) > 0.5) {
        phones.push({ p, mobile: /^\s*(mob|mobile|mobiel|mobil|gsm|cell|m)\b/i.test(l.text) || MOBILE.test(p) });
        used.add(i);
      }
    });
    if (phones.length) out.phone = (phones.find(x => x.mobile) || phones[0]).p;

    lines.forEach((l, i) => {
      if (out.website || EMAIL.test(l.text)) return;
      const w = l.text.match(URLRX);
      if (w && (/www\.|https?:|\//i.test(w[0]) || l.text.trim().length <= w[0].length + 2)) { out.website = w[0]; used.add(i); }
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

    const free = () => lines.map((l, i) => Object.assign({ i }, l)).filter(l => !used.has(l.i));
    let rank = '', nameIdx = -1;
    if (!out.name) {
      // the biggest text that looks like a name (after taking off a rank such as "brigadir" or "Cdr")
      const cands = free().map(l => Object.assign(l, splitRank(l.text))).filter(l => looksLikeName(l.rest))
        .sort((x, y) => y.h - x.h || (y.rank ? 1 : 0) - (x.rank ? 1 : 0) || x.i - y.i);
      if (cands.length) { out.name = nameCase(cands[0].rest); rank = cands[0].rank; nameIdx = cands[0].i; used.add(nameIdx); }
    } else out.name = nameCase(out.name);

    if (!out.title) {
      const t = free().find(l => TITLE.test(l.text) && !/\d|@/.test(l.text) && l.text.length <= 80 && orgLevel(l.text) > 1);
      if (t) { out.title = t.text; used.add(t.i); }
      else if (nameIdx >= 0) {
        // no known job word: the line right under the name usually is the job title
        const next = lines[nameIdx + 1];
        if (next && !used.has(nameIdx + 1) && next.text !== next.text.toUpperCase() && !/\d|@|www/i.test(next.text) && !LEGAL.test(next.text) && orgLevel(next.text) > 2 && letters(next.text) >= 3 && next.text.length <= 80) {
          out.title = next.text; used.add(nameIdx + 1);
        }
      }
    }
    if (rank) out.title = [rank.charAt(0).toUpperCase() + rank.slice(1), out.title].filter(Boolean).join(', ');

    repair(out, qrHost);
    if (!out.company) {
      const ok = l => letters(l.text) >= 3 && !/@|www|http/i.test(l.text) && l.text.length <= 70 && !GENERIC.test(l.text.trim());
      const legal = free().find(l => ok(l) && LEGAL.test(l.text));
      const org = free().filter(l => ok(l) && orgLevel(l.text) < ORG.length).sort((x, y) => orgLevel(x.text) - orgLevel(y.text) || x.i - y.i)[0];
      const c = legal || org;
      if (c) { out.company = c.text; used.add(c.i); }
    }
    const domainWord = () => {
      const host = out.email.split('@')[1] || out.website.replace(/^(https?:\/\/)?(www\.)?/i, '').split('/')[0] || '';
      const dom = host.split('.');
      if (dom.length < 2 || /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|proton|protonmail|gmx|ziggo|kpnmail|planet|home|xs4all|web|t-online|orange|free|wanadoo|libero)$/i.test(dom[0])) return '';
      return dom[dom.length - 2] === 'co' || dom[dom.length - 2] === 'com' ? dom[dom.length - 3] : dom[dom.length - 2];
    };
    if (!out.company) {
      const word = domainWord();
      if (word) {
        const key = word.replace(/[^a-z0-9]/gi, '').toLowerCase();
        const hit = free().find(l => l.text.toLowerCase().replace(/[^a-z0-9]/g, '').includes(key) && !GENERIC.test(l.text));
        out.company = hit ? hit.text : (word.length <= 5 ? word.toUpperCase() : word.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
        if (hit) used.add(hit.i);
      }
    }
    if (!out.company && out.name) {
      // badges: the company is usually the next biggest text that is not the event or the visitor type
      const BADGE = /^(visitor|exhibitor|speaker|delegate|press|media|staff|crew|organi[sz]er|vip|guest|attendee|contractor|bezoeker|standhouder)$/i;
      const c = free().filter(l => !/\d|@|www/i.test(l.text) && !BADGE.test(l.text) && !GENERIC.test(l.text) && letters(l.text) >= 3 && l.text.length <= 60)
        .sort((x, y) => y.h - x.h || x.i - y.i)[0];
      if (c) { out.company = c.text; used.add(c.i); }
    }
    out.source = out.source || 'text';
    return out;
  }

  // Fix typical misreads in email and web address using what else is on the card.
  function repair(out, qrHost) {
    const site = out.website.replace(/^(https?:\/\/)?(www\.)?/i, '').split('/')[0].toLowerCase();
    let [local, host] = out.email ? out.email.split('@') : ['', ''];
    // 1. the domain: trust the QR code, then the website, when they are nearly the same
    const trusted = qrHost || '';
    const fixHost = h => (trusted && h && h !== trusted && (loose(h) === loose(trusted) || lev(h, trusted) <= 2) ? trusted : h);
    host = fixHost(host);
    let site2 = fixHost(site);
    if (host && site2 && host !== site2 && loose(host) === loose(site2)) {
      // email and website disagree only in look-alike letters: prefer the one with digits where the other has i/l
      const pick = /\d/.test(host) ? host : site2;
      host = pick; site2 = pick;
    }
    if (site2 && site2 !== site) out.website = out.website.replace(site, site2);
    if (!out.website && qrHost && !/\.vcf$/i.test(qrHost)) out.website = qrHost;
    // 2. the part before @: firstname.lastname, so compare with the name on the card
    if (local && out.name) {
      const words = plain(out.name).split(/\s+/).filter(w => w.length > 1);
      local = local.split(/([._-])/).map(part => {
        if (/^[._-]$/.test(part)) return part;
        const w = words.find(x => x !== part && x.length >= 4 && Math.abs(x.length - part.length) <= 1 && x[0] === part[0] && x.slice(-1) === part.slice(-1) && (loose(x) === loose(part) || lev(x, part) === 1));
        return w || part;
      }).join('');
    }
    if (out.email) out.email = local + '@' + host;
  }

  root.CardParse = { parse, looksLikeName, nameCase };
})(typeof window !== 'undefined' ? window : globalThis);
