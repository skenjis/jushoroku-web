// Jushoroku の iPhone 版（Webアプリ）。見るだけ。読み取り・検索・宛名は Mac/Windows 版と同じ core.js を使う。
// データの取り方: Dropbox（読み取り専用で自動）/ ファイルを選ぶ / サンプル。最後に読んだデータは端末に残す。
const { analyze, atena, search, normalize } = window.Core;
const { parse } = window.StoreCore;
const $ = (id) => document.getElementById(id);

// ---------- 端末に残すもの（localStorage）----------
const KEY = { cache: 'jushoroku.cache', cfg: 'jushoroku.config', tok: 'jushoroku.dropbox', pkce: 'jushoroku.pkce' };
const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const save = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let records = [];
const index = new Map();
let view = [];
let current = null;

function setRecords(list) {
  records = list;
  index.clear();
  for (const r of records) index.set(r.id, analyze(r.text));
}

// ---------- 一覧 ----------
const sortKey = (r) => { const a = index.get(r.id); return normalize(a.kana || a.display); };

function renderList() {
  const q = $('q').value;
  view = search(records, index, q).sort((x, y) => sortKey(x).localeCompare(sortKey(y), 'ja'));
  const ul = $('list');
  ul.textContent = '';
  if (!records.length) {
    ul.innerHTML = '<li class="none">データがありません。右上の ⚙︎ から読み込んでください。</li>';
    return;
  }
  if (!view.length) { ul.innerHTML = '<li class="none">見つかりません</li>'; return; }
  const frag = document.createDocumentFragment();
  for (const r of view.slice(0, 400)) {
    const a = index.get(r.id);
    const li = document.createElement('li');
    const top = document.createElement('div');
    const n = document.createElement('span'); n.className = 'n'; n.textContent = a.display;
    const o = document.createElement('span'); o.className = 'o';
    const others = a.names.slice(1).filter((x) => x.kind !== 'ローマ字').map((x) => x.name);
    o.textContent = [others.length ? `（${others.join('・')}）` : '', a.company && a.company !== a.display ? a.company : ''].filter(Boolean).join(' ');
    top.append(n, o);
    const s = document.createElement('div'); s.className = 's';
    const phone = a.phones.find((p) => p.kind !== 'fax');
    s.textContent = [phone && phone.number, a.address].filter(Boolean).join('　');
    li.append(top, s);
    li.onclick = () => openDetail(r.id);
    frag.appendChild(li);
  }
  ul.appendChild(frag);
  if (view.length > 400) { const li = document.createElement('li'); li.className = 'none'; li.textContent = `ほか ${view.length - 400} 件。検索で絞ってください`; ul.appendChild(li); }
}


function renderStatus() {
  const c = load(KEY.cache);
  const from = c ? { dropbox: 'Dropbox', file: 'ファイル', sample: 'サンプル' }[c.from] : '';
  $('status').textContent = c ? `${records.length} 件・${from}・${fmtTime(c.fetchedAt)} に読み込み` : '';
}

// ---------- 詳細 ----------
const PHONE_LABEL = { mobile: '携帯', tel: '電話', fax: 'FAX' };

function openDetail(id) {
  current = id;
  const rec = records.find((r) => r.id === id);
  const a = index.get(id);
  $('dKana').textContent = a.kana;
  $('dName').textContent = a.display;
  const nb = $('dNames'); nb.textContent = '';
  for (const x of a.names.slice(1)) {
    const s = document.createElement('span');
    s.innerHTML = '<span class="k"></span><span></span>';
    s.children[0].textContent = x.kind || '別名';
    s.children[1].textContent = x.name;
    nb.appendChild(s);
  }
  $('dOrg').textContent = [a.company !== a.display && a.company, a.dept].filter(Boolean).join('　');

  // 電話はタップでかける、メールはタップでメールを書く。右のボタンでコピー
  const box = $('dContacts'); box.textContent = '';
  const order = { mobile: 0, tel: 1, fax: 2 };
  for (const p of [...a.phones].sort((x, y) => order[x.kind] - order[y.kind])) {
    box.appendChild(contactRow(PHONE_LABEL[p.kind], p.number, p.kind === 'fax' ? null : 'tel:' + p.number.replace(/[^\d+]/g, ''), 'tel'));
  }
  for (const m of a.emails) box.appendChild(contactRow('メール', m, 'mailto:' + m, 'mail'));

  // 住所ごとに宛名
  const ad = $('dAddresses'); ad.textContent = '';
  a.addresses.forEach((x, i) => { if (x.address) ad.appendChild(addressCard(a, i)); });

  const links = $('dLinks'); links.textContent = '';
  for (const u of a.urls) {
    const l = document.createElement('a');
    l.href = /^https?:/.test(u) ? u : 'https://' + u; l.target = '_blank'; l.rel = 'noopener'; l.textContent = u;
    links.appendChild(l);
  }
  $('dRaw').textContent = rec.text;
  showPage('detailPage');
  window.scrollTo(0, 0);
  if (location.hash !== '#' + id) history.pushState({ id }, '', '#' + id);
}

function contactRow(label, value, href, cls) {
  const row = document.createElement('div');
  row.className = 'contact ' + cls;
  const a = document.createElement(href ? 'a' : 'div');
  if (href) a.href = href; else a.className = 'plain';
  a.innerHTML = '<span class="lbl"></span><span class="num"></span>';
  a.children[0].textContent = label;
  a.children[1].textContent = value;
  const b = document.createElement('button');
  b.textContent = 'コピー';
  b.onclick = () => copy(value);
  row.append(a, b);
  return row;
}

function addressCard(a, i) {
  const ad = a.addresses[i];
  const card = document.createElement('div');
  card.className = 'card';
  const head = document.createElement('div');
  head.className = 'card-head';
  head.textContent = '宛名' + (a.addresses.length > 1 ? `（住所${i + 1}${ad.label ? '・' + ad.label : ''}）` : '');
  const pre = document.createElement('pre');
  pre.className = 'atena';
  const note = document.createElement('div');
  note.className = 'atena-note';
  let zip = '';
  // 名前が複数ある人（ペンネームと本名など）は、宛名に使う名前を選べる
  const persons = a.names.filter((x) => x.kind !== 'ローマ字' && x.name !== a.company);
  let who = persons[0] ? persons[0].name : '';
  const draw = () => { pre.textContent = atena(a, { index: i, zip, name: who }); };
  let chooser = null;
  if (persons.length > 1) {
    chooser = document.createElement('div');
    chooser.className = 'chooser';
    persons.forEach((x, k) => {
      const b = document.createElement('button');
      b.textContent = x.name + (x.kind ? `（${x.kind}）` : '');
      if (!k) b.className = 'on';
      b.onclick = () => { who = x.name; [...chooser.children].forEach((c) => c.classList.toggle('on', c === b)); draw(); };
      chooser.appendChild(b);
    });
  }
  draw();
  if (/^旧/.test(ad.label || '')) { note.className = 'atena-note warn'; note.textContent = `「${ad.label}」です。今の住所か確かめてから使ってください。`; }
  // 郵便番号が無ければ住所から補う（1つに決まらなければ ？？）
  if (!ad.zip && /[一-龥]/.test(ad.address)) {
    note.textContent = '郵便番号を住所から調べています…';
    window.ZipCode.loadInBrowser().then(() => {
      const r = window.ZipCode.lookup(ad.address);
      zip = r.status === 'ok' ? r.zip : '？？？-？？？？';
      draw();
      if (!/^旧/.test(ad.label || '')) {
        note.className = r.status === 'ok' ? 'atena-note' : 'atena-note warn';
        note.textContent = r.status === 'ok' ? '郵便番号は住所から補いました（日本郵便の郵便番号データ）。' : '郵便番号を住所から1つに決められませんでした。';
      }
    }).catch(() => { note.textContent = ''; });
  }
  const btns = document.createElement('div');
  btns.className = 'btns';
  const c1 = document.createElement('button'); c1.textContent = '宛名をコピー'; c1.className = 'primary'; c1.onclick = () => copy(pre.textContent);
  const c2 = document.createElement('button'); c2.textContent = '住所だけコピー';
  c2.onclick = () => copy([(ad.zip || zip) && '〒' + (ad.zip || zip), ad.address].filter(Boolean).join(' '));
  const map = document.createElement('a'); map.textContent = '地図で開く';
  map.href = 'https://maps.apple.com/?q=' + encodeURIComponent(ad.address); map.target = '_blank'; map.rel = 'noopener';
  btns.append(c1, c2, map);
  card.append(head, ...(chooser ? [chooser] : []), pre, note, btns);
  return card;
}

// ---------- 画面の切り替え ----------
function showPage(id) {
  for (const p of ['listPage', 'detailPage', 'settingsPage']) $(p).hidden = p !== id;
}
window.addEventListener('popstate', () => {
  const id = location.hash.slice(1);
  if (id && index.has(id)) openDetail(id);
  else { current = null; showPage('listPage'); }
});
$('backBtn').onclick = () => { if (location.hash) history.back(); else showPage('listPage'); };
$('settingsBtn').onclick = () => { renderSettings(); showPage('settingsPage'); };
$('settingsBackBtn').onclick = () => showPage('listPage');
$('q').addEventListener('input', renderList);

// ---------- データの読み込み ----------
function accept(list, from) {
  setRecords(list);
  save(KEY.cache, { records: list, from, fetchedAt: new Date().toISOString() });
  renderList(); renderStatus();
}

$('filePick').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const j = parse(await f.text());
    accept(j.records, 'file');
    save(KEY.cfg, { ...(load(KEY.cfg) || {}), source: 'file' });
    toast(`${j.records.length} 件を読み込みました`);
    showPage('listPage');
  } catch (err) { toast('このファイルは読み込めません: ' + err.message); }
  e.target.value = '';
});

$('useSample').onclick = async () => {
  const list = await (await fetch('sample.json')).json();
  accept(list.map((text, i) => ({ id: `sample-${i + 1}`, text, created: '', updated: '' })), 'sample');
  save(KEY.cfg, { ...(load(KEY.cfg) || {}), source: 'sample' });
  toast('サンプルを読み込みました');
  showPage('listPage');
};

$('clearAll').onclick = () => {
  if (!confirm('この iPhone に残っている住所録のデータと設定を消しますか？（Dropbox のファイルは消えません）')) return;
  for (const k of Object.values(KEY)) save(k, null);
  setRecords([]); renderList(); renderStatus(); renderSettings();
  toast('消しました');
};

// ---------- Dropbox（読み取り専用。PKCE でログインし、更新用の鍵を端末に残す）----------
// Dropbox に登録したこのアプリのキー（秘密の鍵ではない。戻り先のURLが登録済みのページでしか使えない）
const DEFAULT_APP_KEY = '27me0ylq9o36qak';
const OLD_APP_KEYS = ['whc1nc5rowdngj8']; // 以前のキー。保存されていても今のキーに切り替える
const validKey = (k) => /^[a-z0-9]{10,20}$/i.test(String(k || '').trim());
const appKeyOf = (cfg) => {
  const k = String((cfg && cfg.appKey) || '').trim();
  return validKey(k) && !OLD_APP_KEYS.includes(k) ? k : DEFAULT_APP_KEY;
};
const redirectUri = () => location.origin + location.pathname;

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function dbxConnect() {
  const typed = $('appKey').value.trim();
  if (typed && !validKey(typed)) { toast('アプリキーの形ではありません（URL ではなく、英数字のキーを入れます）'); return; }
  const appKey = typed || DEFAULT_APP_KEY;
  save(KEY.cfg, { ...(load(KEY.cfg) || {}), appKey, path: $('dbxPath').value.trim() || '/addressbook.json', source: 'dropbox' });
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  save(KEY.pkce, { verifier, state });
  const u = new URL('https://www.dropbox.com/oauth2/authorize');
  Object.entries({ client_id: appKey, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256',
    redirect_uri: redirectUri(), token_access_type: 'offline', state }).forEach(([k, v]) => u.searchParams.set(k, v));
  location.href = u.toString();
}

// Dropbox から戻ってきたとき（?code=…）
async function finishLogin() {
  const p = new URLSearchParams(location.search);
  const code = p.get('code');
  if (!code) return;
  history.replaceState(null, '', redirectUri());
  const pk = load(KEY.pkce);
  const cfg = load(KEY.cfg) || {};
  save(KEY.pkce, null);
  if (!pk || p.get('state') !== pk.state) { toast('Dropbox へのログインを確認できませんでした'); return; }
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: appKeyOf(cfg), code_verifier: pk.verifier, redirect_uri: redirectUri() }),
  });
  if (!r.ok) { toast('Dropbox へのログインに失敗しました'); return; }
  const t = await r.json();
  save(KEY.tok, { appKey: appKeyOf(cfg), refresh: t.refresh_token, access: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000 });
  toast('Dropbox につなぎました');
}

async function accessToken() {
  const t = load(KEY.tok);
  const cfg = load(KEY.cfg) || {};
  if (!t) return null;
  if (t.appKey !== appKeyOf(cfg)) { save(KEY.tok, null); return null; } // アプリキーが変わった → つなぎ直し
  if (t.access && Date.now() < t.expires) return t.access;
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: appKeyOf(cfg) }),
  });
  if (!r.ok) throw new Error('Dropbox の鍵の更新に失敗しました（つなぎ直してください）');
  const n = await r.json();
  save(KEY.tok, { ...t, access: n.access_token, expires: Date.now() + (n.expires_in - 60) * 1000 });
  return n.access_token;
}

async function dbxReload(quiet) {
  const cfg = load(KEY.cfg) || {};
  try {
    const tok = await accessToken();
    if (!tok) { if (!quiet) toast('Dropbox につないでいません'); return; }
    const r = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Dropbox-API-Arg': JSON.stringify({ path: cfg.path || '/addressbook.json' }) },
    });
    if (!r.ok) throw new Error(r.status === 409 ? `Dropbox に ${cfg.path} が見つかりません` : `Dropbox から読み込めませんでした（${r.status}）`);
    const j = parse(await r.text());
    accept(j.records, 'dropbox');
    if (!quiet) toast(`${j.records.length} 件を読み込みました`);
  } catch (e) {
    if (!quiet || !records.length) toast(e.message);
  }
}

$('dbxConnect').onclick = dbxConnect;
$('dbxReload').onclick = () => dbxReload(false);
$('dbxDisconnect').onclick = () => { save(KEY.tok, null); renderSettings(); toast('Dropbox を切りました（読み込んだデータは残ります）'); };

function renderSettings() {
  const cfg = load(KEY.cfg) || {};
  const tok = load(KEY.tok);
  $('appKey').value = appKeyOf(cfg);
  $('dbxPath').value = cfg.path || '/addressbook.json';
  const c = load(KEY.cache);
  $('current').textContent = c
    ? `いま: ${records.length} 件（${{ dropbox: 'Dropbox', file: 'ファイル', sample: 'サンプル' }[c.from]}、${fmtTime(c.fetchedAt)} に読み込み）${tok ? '・Dropbox につないでいます' : ''}`
    : `まだ何も読み込んでいません${tok ? '・Dropbox につないでいます' : ''}`;
}

// ---------- 小物 ----------
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('コピーしました'); }
  catch { toast('コピーできませんでした'); }
}
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- 起動 ----------
(async function init() {
  const c = load(KEY.cache);
  if (c && Array.isArray(c.records)) setRecords(c.records);
  renderList(); renderStatus();
  await finishLogin();
  const cfg = load(KEY.cfg) || {};
  if (cfg.source === 'dropbox' && load(KEY.tok)) dbxReload(true);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
// 開き直したとき（ホーム画面から戻ったとき）も Dropbox を読み直す
document.addEventListener('visibilitychange', () => {
  const cfg = load(KEY.cfg) || {};
  if (document.visibilityState === 'visible' && cfg.source === 'dropbox' && load(KEY.tok)) dbxReload(true);
});
