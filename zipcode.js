// 住所から郵便番号を引く。1つに決まらないときは無理に答えず status: 'ambiguous' / 'notfound' を返す。
// Node（Electron版のメインプロセス・テスト）でも画面側（Tauri版）でも使う。データの読み込み方だけが違う。
(function (root) {
const isNode = typeof module !== 'undefined' && module.exports;
const ITAIJI = isNode ? require('./itaiji.js') : root.ITAIJI || new Map();

let DATA = null;
let CITY_INDEX = null; // 正規化した市区町村名 → [{pref, city}]（都道府県が書かれていない住所用）

const KNUM = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function kanjiToNum(s) {
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0, cur = 0;
  for (const ch of s) {
    if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
    else if (ch === '百') { total += (cur || 1) * 100; cur = 0; }
    else if (ch in KNUM) cur = cur * 10 + KNUM[ch];
    else return NaN;
  }
  return total + cur;
}

// 照合用の正規化: 全角半角・異体字・ヶ/が/ケ・ノ/の/之 の揺れ・空白をそろえる
function key(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[\u{E0100}-\u{E01EF}︀-️]/gu, '')
    .replace(/\p{Script=Han}/gu, (c) => ITAIJI.get(c) || c)
    .replace(/[ヶケヵがガ]/g, 'ケ')
    .replace(/[ノの之]/g, 'ノ')
    .replace(/[\s　]/g, '');
}

// data: { 都道府県: { 市区町村: [[町域, 郵便番号], ...] } }
function setData(data) {
  DATA = data;
  CITY_INDEX = new Map();
  for (const [pref, cities] of Object.entries(DATA)) {
    for (const city of Object.keys(cities)) {
      const names = [city];
      const m = city.match(/^.+?郡(.+)$/); // 「西白河郡矢吹町」は「矢吹町」とも書かれる
      if (m) names.push(m[1]);
      for (const nm of names) {
        const k = key(nm);
        if (!CITY_INDEX.has(k)) CITY_INDEX.set(k, []);
        CITY_INDEX.get(k).push({ pref, city });
      }
    }
  }
}

function load() {
  if (DATA) return;
  if (!isNode) throw new Error('郵便番号データが読み込まれていません');
  const fs = require('fs'), path = require('path'), zlib = require('zlib');
  setData(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'zipdata.json.gz'))).toString('utf8')));
}

// 画面側（Tauri版）: 同梱の zipdata.json.gz を取り寄せて展開する
async function loadInBrowser(url = 'zipdata.json.gz') {
  if (DATA) return;
  const res = await fetch(url);
  const text = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
  setData(JSON.parse(text));
}

// かっこ書きの条件（「１〜１９丁目」「その他」など）を読む
function parseCond(town) {
  const m = town.match(/^(.*?)（(.*)）$/);
  const base = m ? m[1] : town;
  const cond = m ? m[2].normalize('NFKC') : '';
  if (!cond) return { base, kind: 'none' };
  // 高層ビルの階（「１階」「地階・階層不明」）
  const fl = cond.match(/^(\d+)階$/);
  if (fl) return { base, kind: 'floor', floor: Number(fl[1]) };
  if (/地階・階層不明/.test(cond)) return { base, kind: 'floor', floorUnknown: true };
  if (/その他|除く|以外/.test(cond)) return { base, kind: 'other' };
  const unit = /丁目/.test(cond) ? 'chome' : /番地|番/.test(cond) ? 'banchi' : null;
  if (!unit) return { base, kind: 'unknown' };
  // 「1〜3丁目、5丁目」のような番号の並びだけを扱う（「4丁目1〜16番」のように細かいものは扱わない）
  const ranges = [];
  for (const part of cond.split(/[、,]/)) {
    const r = part.match(/^(\d+)(?:[〜~～-](\d+))?(丁目|番地|番)?$/);
    if (!r) return { base, kind: 'unknown' };
    ranges.push([Number(r[1]), Number(r[2] || r[1])]);
  }
  return { base, kind: unit, ranges };
}

function lookup(address) {
  load();
  let rest = key(address).replace(/^〒?\d{3}-?\d{4}/, '');
  if (!rest) return { status: 'notfound' };

  // 都道府県
  let prefs = Object.keys(DATA);
  const pm = prefs.find((p) => rest.startsWith(key(p)));
  if (pm) { rest = rest.slice(key(pm).length); prefs = [pm]; }

  // 市区町村（最も長く一致するもの）
  let best = null;
  for (let len = Math.min(rest.length, 12); len >= 2; len--) {
    const hits = (CITY_INDEX.get(rest.slice(0, len)) || []).filter((h) => prefs.includes(h.pref));
    if (hits.length) { best = { len, hits }; break; }
  }
  if (!best) return { status: 'notfound' };
  if (best.hits.length > 1) return { status: 'ambiguous', reason: '同じ名前の市区町村が複数ある' };
  const { pref, city } = best.hits[0];
  rest = rest.slice(best.len).replace(/^(大字|字)/, '');

  const raw = DATA[pref][city];
  const pairs = typeof raw === 'string' ? raw.split('\n').map((l) => l.split('\t')) : raw;
  const rows = pairs.map(([town, zip]) => ({ zip, ...parseCond(town) }));
  const zipOf = (list) => [...new Set(list.map((r) => r.zip))];

  // 町域（最も長く一致するもの）
  let townRows = [];
  let townLen = 0;
  for (const r of rows) {
    if (/以下に掲載がない場合|一円|の次に番地がくる場合/.test(r.base)) continue;
    const k = key(r.base);
    if (k && rest.startsWith(k) && k.length >= townLen) {
      if (k.length > townLen) townRows = [];
      townLen = k.length;
      townRows.push(r);
    }
  }
  if (!townRows.length) {
    // 町域の一覧が無い市町村（「一円」「以下に掲載がない場合」だけ）なら、その番号で決まる
    const named = rows.filter((r) => !/以下に掲載がない場合|一円|の次に番地がくる場合/.test(r.base));
    if (!named.length && zipOf(rows).length === 1) return { status: 'ok', zip: fmt(rows[0].zip), pref, city };
    return { status: 'ambiguous', reason: '町名が見つからない', pref, city };
  }
  const town = townRows[0].base;

  // 高層ビル: 「西新宿新宿野村ビル（１階）」のようにビル・階ごとの番号がある。住所にビル名があればそちらを使う
  const tk = key(town);
  const allBuild = rows.filter((r) => r.kind === 'floor' && key(r.base).startsWith(tk) && key(r.base).length > tk.length);
  const hitBuild = allBuild.filter((r) => rest.includes(key(r.base).slice(tk.length)));
  if (hitBuild.length) {
    const floorM = key(address).match(/(\d+)(?:階|F)(?![a-z])/i);
    if (floorM) {
      const f = hitBuild.filter((r) => r.floor === Number(floorM[1]));
      if (f.length === 1) return { status: 'ok', zip: fmt(f[0].zip), pref, city, town: f[0].base };
    }
    const unknownFloor = hitBuild.filter((r) => r.floorUnknown);
    if (!floorM && unknownFloor.length === 1) return { status: 'ok', zip: fmt(unknownFloor[0].zip), pref, city, town: unknownFloor[0].base };
    if (zipOf(hitBuild).length === 1) return { status: 'ok', zip: fmt(hitBuild[0].zip), pref, city, town: hitBuild[0].base };
    return { status: 'ambiguous', reason: 'ビルの階で番号が分かれている', pref, city, town };
  }

  if (zipOf(townRows).length === 1) return { status: 'ok', zip: fmt(townRows[0].zip), pref, city, town };

  // 丁目・番地で分かれている町域
  const after = rest.slice(townLen);
  const nm = after.match(/^(\d+|[一二三四五六七八九十百〇]+)(?=丁目|-|番|$|[^\d])/);
  const num = nm ? kanjiToNum(nm[1]) : NaN;
  const isChome = /^(\d+|[一二三四五六七八九十百〇]+)丁目/.test(after) || /^\d+-\d/.test(after);
  if (!Number.isNaN(num)) {
    const specific = townRows.filter((r) => (r.kind === 'chome' || r.kind === 'banchi') &&
      (r.kind === 'chome' ? isChome || !townRows.some((x) => x.kind === 'banchi') : !isChome) &&
      r.ranges.some(([a, b]) => num >= a && num <= b));
    if (specific.length && zipOf(specific).length === 1) return { status: 'ok', zip: fmt(specific[0].zip), pref, city, town };
    if (!specific.length && !townRows.some((r) => r.kind === 'unknown')) {
      const other = townRows.filter((r) => r.kind === 'other' || r.kind === 'none');
      if (zipOf(other).length === 1) return { status: 'ok', zip: fmt(other[0].zip), pref, city, town };
    }
  }
  return { status: 'ambiguous', reason: '同じ町名で番号が分かれている', pref, city, town };
}

const fmt = (z) => `${z.slice(0, 3)}-${z.slice(3)}`;

const api = { lookup, key, loadInBrowser, loaded: () => !!DATA };
if (isNode) module.exports = api;
else root.ZipCode = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
