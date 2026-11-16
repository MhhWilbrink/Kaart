/* Business card / badge photo -> text lines, on the phone.
   Steps: find the card in the photo and crop it, turn it the right way up, boost contrast, read the text.
   Needs Tesseract (tesseract.min.js) for reading; QR codes are read separately by the app. */
(function (root) {
  function toCanvas(img, max) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const s = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function gray(ctx, w, h, invert) {
    const d = ctx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) { const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; g[j] = invert ? 255 - v : v; }
    return g;
  }

  // Dark cards with light text (navy, black, purple): the middle of the photo is mostly dark.
  function looksDark(src) {
    const small = toCanvas(src, 200), w = small.width, h = small.height;
    const g = gray(small.getContext('2d'), w, h);
    let n = 0, dark = 0;
    for (let y = Math.round(h * 0.2); y < h * 0.8; y++) for (let x = Math.round(w * 0.2); x < w * 0.8; x++) { n++; if (g[y * w + x] < 100) dark++; }
    return dark / Math.max(1, n) > 0.35;
  }

  function otsu(g) {
    const hist = new Array(256).fill(0); g.forEach(v => hist[v]++);
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, t = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      const wF = g.length - wB; if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; t = i; }
    }
    return t;
  }

  // The card is the largest bright area. Returns a crop box in the coordinates of `src`, or null.
  function findCard(src, invert) {
    const small = toCanvas(src, 360), w = small.width, h = small.height;
    const g = gray(small.getContext('2d'), w, h, invert);
    const t = otsu(g);
    let hit = brightArea(g, w, h, t);
    // light-grey table or wall: the bright area is nearly the whole photo. The card is the brightest part,
    // so split the bright pixels once more.
    if (!hit || hit.area > 0.85 * w * h) {
      const upper = g.filter(v => v > t);
      const hit2 = upper.length ? brightArea(g, w, h, otsu(upper)) : null;
      if (hit2 && hit2.area > 0.12 * w * h) hit = hit2;
    }
    if (!hit || hit.area < 0.12 * w * h || hit.area > 0.97 * w * h) return null;   // no clear card: use the whole photo
    const f = (src.naturalWidth || src.width) / w, pad = 0.012 * Math.max(w, h);
    const x = Math.max(0, hit.x0 - pad), y = Math.max(0, hit.y0 - pad);
    return { x: x * f, y: y * f, w: (Math.min(w, hit.x1 + pad) - x) * f, h: (Math.min(h, hit.y1 + pad) - y) * f };
  }

  // The largest bright area at threshold t, with background edges trimmed off.
  function brightArea(g, w, h, t) {
    const bright = new Uint8Array(w * h); g.forEach((v, i) => bright[i] = v > t ? 1 : 0);
    // close small gaps (text, logos) so the card is one area
    let m = bright;
    for (let k = 0; k < 3; k++) {
      const n = new Uint8Array(w * h);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        n[i] = m[i] || m[i - 1] || m[i + 1] || m[i - w] || m[i + w] ? 1 : 0;
      }
      m = n;
    }
    const seen = new Uint8Array(w * h); let best = null;
    for (let s = 0; s < w * h; s++) {
      if (!m[s] || seen[s]) continue;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0; const stack = [s]; seen[s] = 1;
      while (stack.length) {
        const i = stack.pop(), x = i % w, y = (i / w) | 0; n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        [i - 1, i + 1, i - w, i + w].forEach(j => { if (j >= 0 && j < w * h && m[j] && !seen[j] && Math.abs((j % w) - x) <= 1) { seen[j] = 1; stack.push(j); } });
      }
      if (!best || n > best.n) best = { n, x0, y0, x1, y1 };
    }
    if (!best) return null;
    // trim edges that are mostly background (bright patches of a table or wall can stick to the card)
    const frac = (x0, y0, x1, y1) => { let n = 0, tt = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { tt++; n += bright[y * w + x]; } return n / Math.max(1, tt); };
    for (let k = 0; k < 4; k++) {
      while (best.y1 - best.y0 > 20 && frac(best.x0, best.y0, best.x1, best.y0) < 0.6) best.y0++;
      while (best.y1 - best.y0 > 20 && frac(best.x0, best.y1, best.x1, best.y1) < 0.6) best.y1--;
      while (best.x1 - best.x0 > 20 && frac(best.x0, best.y0, best.x0, best.y1) < 0.6) best.x0++;
      while (best.x1 - best.x0 > 20 && frac(best.x1, best.y0, best.x1, best.y1) < 0.6) best.x1--;
    }
    best.area = (best.x1 - best.x0) * (best.y1 - best.y0);
    return best;
  }

  // Crop, rotate (0/90/180/270) and stretch the contrast, so dim photos become black text on white.
  function prepare(src, box, angle, maxSide, border, invert) {
    border = border == null ? 24 : border;
    const bw = box ? box.w : (src.naturalWidth || src.width), bh = box ? box.h : (src.naturalHeight || src.height);
    const s = Math.min(2, maxSide / Math.max(bw, bh));
    const rot = angle % 180 !== 0;
    const c = document.createElement('canvas');
    c.width = Math.round((rot ? bh : bw) * s) + 2 * border; c.height = Math.round((rot ? bw : bh) * s) + 2 * border;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.translate(c.width / 2, c.height / 2); ctx.rotate(angle * Math.PI / 180);
    ctx.drawImage(src, box ? box.x : 0, box ? box.y : 0, bw, bh, -bw * s / 2, -bh * s / 2, bw * s, bh * s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const im = ctx.getImageData(0, 0, c.width, c.height), d = im.data;
    const g = new Uint8Array(c.width * c.height);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) { const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; g[j] = invert ? 255 - v : v; }
    if (invert) {   // the white border added above must stay white after turning dark into light
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (x < border || y < border || x >= c.width - border || y >= c.height - border) g[y * c.width + x] = 255;
    }
    const hist = new Array(256).fill(0); g.forEach(v => hist[v]++);
    let lo = 0, hi = 255, acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > g.length * 0.01) { lo = i; break; } }
    acc = 0; for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > g.length * 0.15) { hi = i; break; } }   // paper = top 15%
    const span = Math.max(30, hi - lo);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) {
      const v = Math.max(0, Math.min(255, (g[j] - lo) * 255 / span));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    // local threshold (Bradley): uneven light, shadows and grey paper become clean black text on white
    {
      const W = c.width, H = c.height, I = new Float64Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += d[(y * W + x) * 4]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
      const r = Math.max(8, Math.round(Math.max(W, H) / 32)), out = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
        for (let x = 0; x < W; x++) {
          const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
          const n = (x1 - x0 + 1) * (y1 - y0 + 1);
          const sum = I[(y1 + 1) * (W + 1) + x1 + 1] - I[y0 * (W + 1) + x1 + 1] - I[(y1 + 1) * (W + 1) + x0] + I[y0 * (W + 1) + x0];
          out[y * W + x] = d[(y * W + x) * 4] * n < sum * 0.82 ? 0 : 255;
        }
      }
      for (let j = 0; j < W * H; j++) d[j * 4] = d[j * 4 + 1] = d[j * 4 + 2] = out[j];
    }
    // whatever dark is connected to the edge is table or background, not text: paint it white
    const W = c.width, H = c.height, st = [];
    const dark = j => d[j * 4] < 140;
    const push = j => { if (dark(j)) { d[j * 4] = d[j * 4 + 1] = d[j * 4 + 2] = 255; st.push(j); } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (st.length) {
      const j = st.pop(), x = j % W;
      if (x > 0) push(j - 1); if (x < W - 1) push(j + 1); if (j >= W) push(j - W); if (j < W * (H - 1)) push(j + W);
    }
    ctx.putImageData(im, 0, 0);
    return c;
  }

  function rawLines(data, dx, dy) {
    let lines = data.lines;
    if (!lines && data.blocks) lines = data.blocks.flatMap(b => (b.paragraphs || []).flatMap(p => p.lines || []));
    return (lines || []).map(l => ({ text: l.text.replace(/\s+/g, ' ').trim(), conf: l.confidence ?? 0,
      x0: l.bbox.x0 + dx, y0: l.bbox.y0 + dy, x1: l.bbox.x1 + dx, y1: l.bbox.y1 + dy }));
  }
  // emails and web addresses get a lower bar: odd letter mixes (optics11) make the reader less sure, but they matter most
  const goodLine = l => (l.conf >= 60 || (l.conf >= 30 && /[@&]|www|\.(com|net|org|[a-z]{2})\b/i.test(l.text))) && (l.text.match(/[\p{L}\d]/gu) || []).length >= 2 && /[\p{L}\d]{2}/u.test(l.text);

  // Merge readings of the whole card and of its halves: where two lines cover the same spot, keep the surer one.
  function merge(lists) {
    const all = lists.flatMap((l, i) => l.map(x => Object.assign({ pass: i ? 1 : 0 }, x))).filter(goodLine)
      .sort((a, b) => a.pass - b.pass || b.conf - a.conf || b.text.length - a.text.length);
    const kept = [];
    all.forEach(l => {
      const area = (l.x1 - l.x0) * (l.y1 - l.y0);
      const clash = kept.some(k => {
        const ix = Math.max(0, Math.min(k.x1, l.x1) - Math.max(k.x0, l.x0)), iy = Math.max(0, Math.min(k.y1, l.y1) - Math.max(k.y0, l.y0));
        return ix * iy > 0.4 * Math.min(area, (k.x1 - k.x0) * (k.y1 - k.y0));
      });
      if (!clash) kept.push(l);
    });
    return kept.sort((a, b) => (Math.abs(a.y0 - b.y0) < 0.5 * (a.y1 - a.y0) ? a.x0 - b.x0 : a.y0 - b.y0))
      .map(l => ({ text: l.text, h: l.y1 - l.y0, conf: l.conf }));
  }

  // Where the text is (as fractions of the picture), from a first reading; null when it is most of the picture anyway.
  function textRegion(data, cw, ch) {
    if (!data || !cw) return null;
    const ls = rawLines(data, 0, 0).filter(l => l.conf >= 80 && (l.text.match(/[\p{L}\d]/gu) || []).length >= 4);
    if (ls.length < 2) return null;
    let x0 = Math.min(...ls.map(l => l.x0)), y0 = Math.min(...ls.map(l => l.y0)), x1 = Math.max(...ls.map(l => l.x1)), y1 = Math.max(...ls.map(l => l.y1));
    const mx = 0.08 * cw, my = 0.08 * ch;
    x0 = Math.max(0, x0 - mx); y0 = Math.max(0, y0 - my); x1 = Math.min(cw, x1 + mx); y1 = Math.min(ch, y1 + my);
    if ((x1 - x0) * (y1 - y0) > 0.7 * cw * ch) return null;
    return { x: x0 / cw, y: y0 / ch, w: (x1 - x0) / cw, h: (y1 - y0) / ch };
  }

  function crop(c, x, y, w, h) {
    const o = document.createElement('canvas'); o.width = w + 32; o.height = h + 32;
    const ctx = o.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, o.width, o.height);
    ctx.drawImage(c, x, y, w, h, 16, 16, w, h); return o;
  }

  // How "readable" a result is: confident words of 3+ letters, plus emails and phone numbers.
  function score(data) {
    const words = data.words || (data.lines || []).flatMap(l => l.words || []);
    let s = 0;
    words.forEach(wd => { if (wd.confidence > 70 && /[\p{L}]{3,}/u.test(wd.text)) s += wd.text.length; });
    const t = data.text || '';
    if (/@[\w-]+\.\w{2,}/.test(t)) s += 20;
    if (/\+?\d[\d ()-]{7,}\d/.test(t)) s += 10;
    return s;
  }

  // Find the card and the way up, for dark-on-light (normal) or light-on-dark (invert) text.
  async function orient(worker, img, invert, step, noCrop) {
    const box = noCrop || (read.opts && read.opts.nocrop) ? null : findCard(img, invert);
    const w = box ? box.w : (img.naturalWidth || img.width), h = box ? box.h : (img.naturalHeight || img.height);
    // Cards are wider than tall: a tall crop means the photo was taken sideways.
    const angles = h > w * 1.1 ? [90, 270, 0, 180] : [0, 180, 90, 270];
    let best = null;
    for (const a of angles) {
      step('Reading the text…');
      const c = prepare(img, box, a, box ? 1200 : 1000, null, invert);   // whole photos: a smaller first look is much faster
      const { data } = await worker.recognize(c);
      const sc = score(data);
      if (!best || sc > best.score) best = { angle: a, score: sc, box, invert, data, cw: c.width, ch: c.height };
      if (sc > 60) break;                                          // clearly the right way up: skip the other sides
      if (a === angles[1] && best.score > 25) break;               // good enough from the likely two
    }
    return best;
  }

  async function read(worker, img, onStep) {
    const step = onStep || (() => {});
    await worker.setParameters({ tessedit_pageseg_mode: String((read.opts && read.opts.psm) || 11) });   // sparse text: business cards are not paragraphs
    // light text on a dark card: try that first; when the first try reads little, try the other way too
    // Dark cards are hard to cut out of a dark table (glare splits them): read those from the whole photo.
    const darkFirst = looksDark(img);
    let best = await orient(worker, img, darkFirst, step, darkFirst);
    if (best.score <= 60) {
      const other = await orient(worker, img, !darkFirst, step, !darkFirst);
      if (other.score > best.score) best = other;
    }
    // a weak result from the cut-out card: compare with the whole photo
    if (best.box && best.score <= 60) {
      step('Reading the text…');
      const pc = prepare(img, null, best.angle, 1200, null, best.invert);
      const { data } = await worker.recognize(pc);
      const sc = score(data);
      if (sc > best.score) best = Object.assign({}, best, { box: null, score: sc, data, cw: pc.width, ch: pc.height });
    }
    if (read.opts && read.opts.log) read.opts.log.push({ dark: darkFirst, invert: best.invert, crop: !!best.box, score: best.score });
    const box = best.box;
    // read the winner again at full size
    // the reader works best with letters of about 30–50 pixels: very big print (a phone number across the card) is scaled down
    let size = (read.opts && read.opts.size) || 1600;
    const hs = best.data ? rawLines(best.data, 0, 0).filter(l => l.conf >= 70).map(l => l.y1 - l.y0).sort((a, b) => a - b) : [];
    if (hs.length >= 3 && !(read.opts && read.opts.size)) {
      const med = hs[Math.floor(hs.length / 2)] * 1600 / Math.max(best.cw, best.ch);    // at the 1600 size
      if (med > 60) size = Math.max(1000, Math.round(1600 * 45 / med));
    }
    let c = prepare(img, box, best.angle, size, null, best.invert);
    // only the part with text: less table or fabric to wade through, so faster and cleaner
    const reg = textRegion(best.data, best.cw, best.ch);
    if (read.opts && read.opts.log) read.opts.log.push({ reg, size });
    if (reg) c = crop(c, Math.round(reg.x * c.width), Math.round(reg.y * c.height), Math.round(reg.w * c.width), Math.round(reg.h * c.height));
    const { data } = await worker.recognize(c);
    const found = rawLines(data, 0, 0).filter(goodLine);
    // very big digits (a phone number across the card) are misread at full size: read those lines again smaller
    const digits = t => (t.match(/\d/g) || []).length;
    for (const l of found.filter(x => digits(x.text) >= 5 && x.y1 - x.y0 > 60).slice(0, 4)) {
      const h = l.y1 - l.y0, f = 40 / h, pad = Math.round(h * 0.15);
      const x = Math.max(0, l.x0 - pad), y = Math.max(0, l.y0 - pad), w = Math.min(c.width - x, l.x1 - l.x0 + 2 * pad), hh = Math.min(c.height - y, h + 2 * pad);
      const sm = document.createElement('canvas'); sm.width = Math.round(w * f) + 32; sm.height = Math.round(hh * f) + 32;
      const sctx = sm.getContext('2d'); sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, sm.width, sm.height);
      sctx.drawImage(c, x, y, w, hh, 16, 16, Math.round(w * f), Math.round(hh * f));
      await worker.setParameters({ tessedit_pageseg_mode: '7' });
      const res = await worker.recognize(sm);
      const t = (res.data.text || '').replace(/\s+/g, ' ').trim();
      if (t && digits(t) >= digits(l.text) - 1 && digits(t) <= digits(l.text) + 1) l.text = t;
    }
    // small text next to a big logo is often skipped: read the inked areas that nothing was found in
    const extra = [];
    for (const r of uncovered(c, found).slice(0, 6)) {
      step('Reading the text… (details)');
      await worker.setParameters({ tessedit_pageseg_mode: '6' });
      const res = await worker.recognize(crop(c, r.x, r.y, r.w, r.h));
      extra.push(rawLines(res.data, r.x - 16, r.y - 16));
    }
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    return { lines: merge([found].concat(extra)), angle: best.angle, cropped: !!box, inverted: best.invert, canvas: c };
  }

  // Areas with ink (text) that no found line covers. Logos (very tall areas) and specks are ignored.
  function uncovered(c, found) {
    const f = 600 / c.width, w = 600, h = Math.round(c.height * f);
    const sm = document.createElement('canvas'); sm.width = w; sm.height = h;
    sm.getContext('2d').drawImage(c, 0, 0, w, h);
    const g = gray(sm.getContext('2d'), w, h);
    const ink = new Uint8Array(w * h); g.forEach((v, i) => ink[i] = v < 110 ? 1 : 0);
    // blank out what was already read (a few loose characters such as "33" do not count: read that spot again)
    found.filter(l => (l.text.match(/[\p{L}\d]/gu) || []).length >= 4).forEach(l => {
      for (let y = Math.max(0, Math.floor(l.y0 * f) - 2); y < Math.min(h, Math.ceil(l.y1 * f) + 2); y++)
        for (let x = Math.max(0, Math.floor(l.x0 * f) - 2); x < Math.min(w, Math.ceil(l.x1 * f) + 2); x++) ink[y * w + x] = 0;
    });
    // join letters into words and lines: smear sideways
    const r = 12, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) { let last = -1e9; for (let x = 0; x < w; x++) { if (ink[y * w + x]) last = x; if (x - last <= r) m[y * w + x] = 1; } }
    for (let y = 0; y < h; y++) { let last = 1e9; for (let x = w - 1; x >= 0; x--) { if (ink[y * w + x]) last = x; if (last - x > r && m[y * w + x] && !ink[y * w + x]) { let near = false; for (let k = 1; k <= r && x - k >= 0; k++) if (ink[y * w + x - k]) { near = true; break; } if (!near) m[y * w + x] = 0; } } }
    const seen = new Uint8Array(w * h), boxes = [];
    for (let s = 0; s < w * h; s++) {
      if (!m[s] || seen[s]) continue;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0; const st = [s]; seen[s] = 1;
      while (st.length) {
        const i = st.pop(), x = i % w, y = (i / w) | 0; n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const j of [i - 1, i + 1, i - w, i + w]) if (j >= 0 && j < w * h && m[j] && !seen[j] && Math.abs((j % w) - x) <= 1) { seen[j] = 1; st.push(j); }
      }
      const bh = y1 - y0 + 1, bw = x1 - x0 + 1;
      if (bh < 5 || bw < 12 || n < 40) continue;            // specks
      if (bh > h * 0.22) continue;                          // logos and pictures
      if (x0 <= 1 || y0 <= 1 || x1 >= w - 2 || y1 >= h - 2) { if (bw > w * 0.5 || bh > h * 0.5) continue; }   // table edges
      // text is a band of ink, wider than tall and not solid; table fabric and photos are not
      const density = n / (bw * bh);
      if (bw < bh * 1.5 || density > 0.85) continue;
      boxes.push({ x0, y0, x1, y1, n });
    }
    // neighbouring lines become one block
    boxes.sort((a, b) => a.y0 - b.y0);
    const blocks = [];
    boxes.forEach(b => {
      const t = blocks.find(k => b.y0 - k.y1 < 14 && Math.min(k.x1, b.x1) - Math.max(k.x0, b.x0) > -10);
      if (t) { t.x0 = Math.min(t.x0, b.x0); t.y0 = Math.min(t.y0, b.y0); t.x1 = Math.max(t.x1, b.x1); t.y1 = Math.max(t.y1, b.y1); t.n += b.n; }
      else blocks.push(Object.assign({}, b));
    });
    return blocks.sort((a, b) => b.n - a.n).map(b => {
      const pad = 6;
      const x = Math.max(0, (b.x0 - pad) / f), y = Math.max(0, (b.y0 - pad) / f);
      return { x: Math.round(x), y: Math.round(y), w: Math.round(Math.min(c.width, (b.x1 + pad) / f) - x), h: Math.round(Math.min(c.height, (b.y1 + pad) / f) - y) };
    });
  }

  root.CardScan = { read, findCard, prepare, uncovered, crop, rawLines, looksDark };
})(typeof window !== 'undefined' ? window : globalThis);
