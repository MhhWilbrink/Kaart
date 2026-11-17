/**
 * NFC Business Card — Google Workspace adapter.
 *
 * This file only connects the shared core (Core.gs, generated, don't edit) to
 * Google: the Sheet for contacts, Script Properties for settings, Drive for images.
 * All business logic lives in the core and is identical on every platform.
 *
 * Setup from the template Sheet: in the Sheet choose the menu  NFC card → 1. Install,
 * publish as a web app (NFC card → Help with publishing), then NFC card → 2. Address and setup code.
 * By hand: deploy as web app (Execute as: Me, Who has access: Anyone), then run showSetupCode.
 */

const CODE_VERSION = '2.17.0';       // changes only when this file changes (the admin page compares it)

const SETTINGS = {
  APP_URL: '',                       // optional: your owner app URL, used in email links
  CONTACTS_SHEET: 'Contacts',
  ASSET_FOLDER: 'NFC Card Assets',
  PHOTO_FOLDER: 'NFC Card Contact Photos'    // private: never shared, read only through the app
};

function doGet(e) {
  return output_(core_().handle({ method: 'GET', query: (e && e.parameter) || {} }));
}

function doPost(e) {
  return output_(core_().handle({ method: 'POST', body: e && e.postData ? e.postData.contents : '' }));
}

/** Run once from the editor after deploying: shows the code for creating the admin password. */
function showSetupCode() {
  const code = core_().setupCode();
  Logger.log(code ? 'Your setup code: ' + code + '  — open the admin page and enter it there.' : 'Already set up. Nothing to do.');
}

/* ======================== installing: a menu in the Sheet ======================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('NFC card')
    .addItem('1. Install', 'install')
    .addItem('2. Address and setup code', 'showInstallInfo')
    .addSeparator()
    .addItem('Help with publishing', 'showPublishHelp')
    .addToUi();
}

/** Everything that can be done without the person: contacts tab, Drive folders, morning reminder. */
function install() {
  sheetStore_().all();                 // creates the Contacts tab with its headers
  photoFolder_(); assetFolder_();
  installDailyReminder();
  showPublishHelp('Installed: the Contacts tab, two Drive folders and the morning reminder are ready.');
}

function showPublishHelp(intro) {
  const html = '<div style="font:14px/1.5 Arial,sans-serif">' +
    (typeof intro === 'string' ? '<p><b>' + intro + '</b></p>' : '') +
    '<p>Now publish it as a web app (once, about a minute):</p><ol>' +
    '<li>Menu <b>Extensions → Apps Script</b>.</li>' +
    '<li>Top right: <b>Deploy → New deployment</b>.</li>' +
    '<li>Click the gear next to <i>Select type</i> and choose <b>Web app</b>.</li>' +
    '<li><b>Execute as:</b> Me. <b>Who has access:</b> Anyone.</li>' +
    '<li>Click <b>Deploy</b>, then <b>Authorize access</b> if asked, and <b>Done</b>.</li></ol>' +
    '<p>Then come back here and choose <b>NFC card → 2. Address and setup code</b>.</p>' +
    '<p style="color:#666">“Anyone” is needed so visitors can open the card page without a Google account. ' +
    'Contacts and photos stay in this Sheet and your Drive; only people you invite can read them.</p></div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(460).setHeight(420), 'NFC card: publish');
}

/** The web app address (to send to the card provider) and the one-time setup code for the admin page. */
function showInstallInfo() {
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { /* not published yet */ }
  const code = core_().setupCode();
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = '<div style="font:14px/1.5 Arial,sans-serif">' +
    (url && /\/exec$/.test(url)
      ? '<p><b>Web app address</b> (send this to your NFC card provider):</p><textarea readonly style="width:100%;height:60px" onclick="this.select()">' + esc(url) + '</textarea>'
      : url
        ? '<p><b>Web app address:</b> this shows a test address. Open <b>Deploy → Manage deployments</b> in Apps Script and copy the address that ends with <code>/exec</code>.</p>'
        : '<p><b>Not published yet.</b> Choose <b>NFC card → Help with publishing</b> first.</p>') +
    (code
      ? '<p><b>Setup code</b> (keep it: you need it once, on the admin page, to choose the administrator password):</p><p style="font:20px monospace">' + esc(code) + '</p>'
      : '<p>The administrator password has already been set. Nothing else to do here.</p>') +
    '</div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(460).setHeight(330), 'NFC card: address and setup code');
}

/* ======================== adapter ======================== */

/**
 * Morning reminder of follow-ups that are due. Run installDailyReminder() once from the editor;
 * Google then runs this every day between 8 and 9 (the time zone of this script, see Project Settings).
 */
function dailyFollowUps() {
  const r = core_().daily();
  console.log('Follow-up reminders sent to ' + r.users + ' people (' + r.followUps + ' follow-ups due).');
  return r;
}

function installDailyReminder() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyFollowUps').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyFollowUps').timeBased().everyDays(1).atHour(8).create();
  console.log('Done: follow-up reminders are sent every morning between 8 and 9.');
}

function core_() {
  return Core.createCore({
    store: sheetStore_(),
    kv: {
      get: k => {
        const v = PropertiesService.getScriptProperties().getProperty(k);
        if (v === null || v === '') return null;
        try { return JSON.parse(v); } catch (e) { return v; }   // plain strings from version 1
      },
      set: (k, v) => PropertiesService.getScriptProperties().setProperty(k, typeof v === 'string' ? v : JSON.stringify(v))
    },
    cache: {
      get: k => CacheService.getScriptCache().get(k),
      put: (k, v, s) => CacheService.getScriptCache().put(k, String(v), Math.min(s, 21600)),
      remove: k => CacheService.getScriptCache().remove(k)
    },
    crypto: {
      uuid: () => Utilities.getUuid(),
      sha256Base64: s => Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)),
      sha256Hex: s => Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
        .map(b => ((b & 255) + 256).toString(16).slice(1)).join('')
    },
    http: {
      post: (url, headers, done) => {
        const res = UrlFetchApp.fetch(url, { method: 'post', headers: headers, payload: '', muteHttpExceptions: true });
        done(res.getResponseCode());
      }
    },
    images: {
      save: (kind, bytes, mime) => {
        const blob = Utilities.newBlob(bytes.map(b => (b > 127 ? b - 256 : b)), mime, kind + '-' + Date.now() + '.' + mime.split('/')[1].replace('jpeg', 'jpg'));
        const file = assetFolder_().createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        return file.getId();
      },
      remove: id => DriveApp.getFileById(id).setTrashed(true),
      url: id => 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w1000'
    },
    photos: {
      save: (bytes, mime) => {
        const blob = Utilities.newBlob(bytes.map(b => (b > 127 ? b - 256 : b)), mime, 'contact-' + Date.now() + '.' + mime.split('/')[1].replace('jpeg', 'jpg'));
        return photoFolder_().createFile(blob).getId();          // no sharing: stays private in your Drive
      },
      read: id => {
        const blob = DriveApp.getFileById(id).getBlob();
        return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
      },
      remove: id => DriveApp.getFileById(id).setTrashed(true)
    },
    mail: { send: (to, subject, body) => MailApp.sendEmail(to, subject, body) },
    lock: fn => {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try { return fn(); } finally { lock.releaseLock(); }
    },
    now: () => new Date(),
    log: msg => console.error(msg),
    settings: { appUrl: SETTINGS.APP_URL, codeVersion: CODE_VERSION }
  });
}

/* ---------- contacts in a Google Sheet ---------- */

function sheetStore_() {
  const COLS = Core.CONTACT_COLUMNS;            // [[field, header], …] — new columns only ever at the end
  const idx = {};
  COLS.forEach((c, i) => idx[c[0]] = i);
  const TEXT = ['name', 'email', 'phone', 'company', 'note', 'cardId', 'myNotes'];
  // Prevents formula injection (values starting with = + - @)
  const safe = v => (typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v);

  const sheet = () => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(SETTINGS.CONTACTS_SHEET);
    if (!sh) {
      sh = ss.insertSheet(SETTINGS.CONTACTS_SHEET);
      sh.appendRow(COLS.map(c => c[1]));
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, COLS.length).setFontWeight('bold');
    } else if (sh.getLastColumn() < COLS.length) {
      const from = sh.getLastColumn() + 1;       // older sheet: add the new headers at the end
      sh.getRange(1, from, 1, COLS.length - from + 1).setValues([COLS.slice(from - 1).map(c => c[1])]).setFontWeight('bold');
    }
    return sh;
  };

  const toRow = rec => COLS.map(([k]) => {
    const v = rec[k];
    if (k === 'tags' || k === 'photos') return (v || []).join(', ');
    if ((k === 'time' || k === 'updated') && v) return new Date(v);
    return TEXT.indexOf(k) !== -1 ? safe(v == null ? '' : v) : (v == null ? '' : v);
  });

  const fromRow = r => {
    const rec = {};
    COLS.forEach(([k], i) => {
      const v = r[i];
      if (k === 'tags' || k === 'photos') rec[k] = v ? String(v).split(/\s*,\s*/).filter(String) : [];
      else rec[k] = v instanceof Date ? v.toISOString() : String(v == null ? '' : v);
    });
    if (!rec.source) rec.source = 'card';
    return rec;
  };

  const rowIndex = (sh, id) => {
    const last = sh.getLastRow();
    if (last < 2) return -1;
    const ids = sh.getRange(2, idx.id + 1, last - 1, 1).getValues();
    for (let i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === id) return i + 2;
    return -1;
  };

  return {
    all: () => sheet().getDataRange().getValues().slice(1).filter(r => r[idx.id]).map(fromRow),
    get: id => {
      const sh = sheet();
      const row = rowIndex(sh, id);
      return row < 0 ? null : fromRow(sh.getRange(row, 1, 1, COLS.length).getValues()[0]);
    },
    append: rec => sheet().appendRow(toRow(rec)),
    update: (id, fields) => {
      const sh = sheet();
      const row = rowIndex(sh, id);
      if (row < 0) return;
      const rec = Object.assign(fromRow(sh.getRange(row, 1, 1, COLS.length).getValues()[0]), fields);
      sh.getRange(row, 1, 1, COLS.length).setValues([toRow(rec)]);
    },
    remove: id => {
      const sh = sheet();
      const row = rowIndex(sh, id);
      if (row > 0) sh.deleteRow(row);
    }
  };
}

function photoFolder_() {
  const it = DriveApp.getFoldersByName(SETTINGS.PHOTO_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(SETTINGS.PHOTO_FOLDER);
}

function assetFolder_() {
  const it = DriveApp.getFoldersByName(SETTINGS.ASSET_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(SETTINGS.ASSET_FOLDER);
}

function output_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
