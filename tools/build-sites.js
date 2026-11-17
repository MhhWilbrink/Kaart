// Builds the published website from customers.json: one folder per customer, each with the shared pages
// (site/) and its own config.json, plus the server files for that customer's administrator (downloads/).
// Runs on GitHub after every change (see .github/workflows/publish.yml); locally: node tools/build-sites.js
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');

const OUT = '_site';
const RESERVED = new Set(['app', 'admin', 'downloads', 'site', 'google', 'tools', 'assets']);
const fail = msg => { console.error('customers.json: ' + msg); process.exit(1); };

let list;
try { list = JSON.parse(fs.readFileSync('customers.json', 'utf8')).customers; } catch (e) { fail('not valid JSON (' + e.message + ')'); }
if (!Array.isArray(list) || !list.length) fail('"customers" must be a list with at least one customer');

// shared pages and server files of a version: the current ones, or those of a release tag (v2.17.0)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sites-'));
// versions.json lists each release and its commit, so no git tags are needed
const RELEASES = fs.existsSync('versions.json') ? JSON.parse(fs.readFileSync('versions.json', 'utf8')) : {};
function source(version) {
  if (!version || version === 'latest') return { site: 'site', google: 'google' };
  if (!/^v\d+\.\d+\.\d+$/.test(version)) fail('version "' + version + '" must be "latest" or like "v2.17.0"');
  const ref = RELEASES[version] || version;
  if (!/^[0-9a-f]{7,40}$|^v\d+\.\d+\.\d+$/.test(ref)) fail('versions.json: bad commit for ' + version);
  const dir = path.join(tmp, version);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
    try { cp.execSync('git archive ' + ref + ' site google | tar -x -C ' + JSON.stringify(dir), { stdio: 'pipe' }); }
    catch (e) { fail('version ' + version + ' is unknown (not in versions.json)'); }
  }
  return { site: path.join(dir, 'site'), google: path.join(dir, 'google') };
}

function downloads(googleDir, dst) {
  const core = fs.readFileSync(path.join(googleDir, 'Core.gs'), 'utf8'), code = fs.readFileSync(path.join(googleDir, 'Code.gs'), 'utf8');
  const coreV = (/version (\d+\.\d+\.\d+)/.exec(core) || [])[1] || '', codeV = (/CODE_VERSION = '([\d.]+)'/.exec(code) || [])[1] || '';
  const d = path.join(dst, 'downloads');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'Core.txt'), core);
  fs.writeFileSync(path.join(d, 'Code.txt'), code);
  if (fs.existsSync(path.join(googleDir, 'appsscript.json'))) fs.copyFileSync(path.join(googleDir, 'appsscript.json'), path.join(d, 'appsscript.json'));
  fs.writeFileSync(path.join(d, 'version.json'), JSON.stringify({ core: coreV, code: codeV }));
  return coreV;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
const seen = new Set();
// the main address first, so a customer folder is never overwritten by it
list.slice().sort((a, b) => (a.folder ? 1 : 0) - (b.folder ? 1 : 0)).forEach(c => {
  const folder = String(c.folder == null ? '' : c.folder);
  if (folder && (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(folder) || RESERVED.has(folder))) fail('folder "' + folder + '" is not allowed (a-z, 0-9 and -, 2–40 characters, not app/admin/downloads)');
  if (seen.has(folder)) fail('folder "' + folder + '" is used twice');
  seen.add(folder);
  if (!/^https:\/\/[^\s"]+$/.test(String(c.endpoint || ''))) fail('customer "' + (c.name || folder) + '": endpoint must be an https address');
  const src = source(c.version);
  const dst = path.join(OUT, folder);
  fs.cpSync(src.site, dst, { recursive: true });
  fs.writeFileSync(path.join(dst, 'config.json'), JSON.stringify({ endpoint: c.endpoint, defaultCardId: c.defaultCardId || 'card-001' }, null, 2));
  const v = downloads(src.google, dst);
  console.log('  /' + folder.padEnd(24) + (c.version || 'latest').padEnd(10) + ' server ' + v + '  ' + (c.name || ''));
});
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log('Built ' + list.length + ' installation(s) in ' + OUT + '/');
