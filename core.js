// 住所録の中核: 自由形式テキストの解析（索引づけ）・検索・宛名・一括取り込みの分割・CSV。
// 1件 = 貼り付けたテキストそのもの。名前や電話などはテキストから毎回読み取る。
(function (root) {
  // 異体字 → 代表字（src/itaiji.js、tools/build-itaiji.js で生成）。斎藤・齋藤・斉藤、高橋・髙橋 などを同じとみなす
  const ITAIJI = typeof module !== 'undefined' && module.exports ? require('./itaiji.js') : root.ITAIJI || new Map();
  const PREFS = '北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県';
  const PREF_RE = new RegExp(PREFS);
  const CITY_RE = /[一-龥ヶ]{1,6}[市区郡](?=\S*?(\d|丁目|番地))/;
  const EN_ADDR_RE = /\b(tokyo|osaka|kyoto|yokohama|nagoya|sapporo|fukuoka|kobe|sendai|hiroshima|japan|[a-z]+-(ku|shi|ken|cho|machi|gun)|prefecture)\b/i;
  const BUILDING_RE = /(ビル|マンション|ハイツ|コーポ|アパート|レジデンス|タワー|ハウス|荘|号室|\d+F$|\d+階|棟|号館|プラザ|ヒルズ|コート|パレス|メゾン|ガーデン|テラス)/;
  const HYPHEN = '\\-‐‑‒–—―−ー';

  const LABELS = {
    name: ['氏名', '名前', 'お名前', 'name', '担当', '担当者'],
    altname: ['本名', '旧姓', 'ペンネーム', '筆名', '通称', '旧名', '芸名', '雅号', 'ニックネーム', '別名'],
    kana: ['ふりがな', 'フリガナ', 'よみ', 'よみがな', '読み', 'かな', 'カナ'],
    company: ['会社', '会社名', '勤務先', '所属', '社名', 'company', 'organization'],
    dept: ['部署', '役職', '肩書', '部署名', 'title'],
    address: ['住所', '所在地', 'address', 'addr', '自宅住所', '勤務地'],
    zip: ['郵便番号', '〒'],
    tel: ['tel', '電話', '電話番号', 'phone', '自宅', '代表', '直通'],
    mobile: ['携帯', '携帯電話', 'mobile', 'cell', 'スマホ'],
    fax: ['fax', 'ファックス', 'ファクス'],
    email: ['e-mail', 'email', 'mail', 'メール', 'メールアドレス'],
    url: ['url', 'web', 'hp', 'ホームページ', 'website'],
    memo: ['メモ', '備考', 'note', 'memo'],
    birthday: ['誕生日', '生年月日'],
    tags: ['タグ', 'tag', 'tags'],
  };
  const LABEL_OF = {};
  for (const [k, ws] of Object.entries(LABELS)) for (const w of ws) LABEL_OF[w.toLowerCase()] = k;
  const LABEL_ALT = Object.values(LABELS).flat().sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[-]/g, '\\-')).join('|');
  const LABEL_RE = new RegExp(`^(${LABEL_ALT})\\s*[:：]\\s*(.*)$`, 'i');
  // 値の前に置かれた見出し語（コロンなし）を除く
  const LABEL_WORDS_RE = /(^|[\s/|,、・])(tel|fax|phone|mobile|cell|e-?mail|mail|url|web|直通|代表|電話番号|電話|携帯電話|携帯|自宅|メールアドレス|メール|ファックス|〒)\s*[.:：]?(?=[\s/|,、・]|$)/gi;

  const CORP_PRE_RE = /^(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|社会福祉法人|医療法人(社団|財団)?|学校法人|宗教法人|独立行政法人|国立大学法人|NPO法人|特定非営利活動法人|\((株|有|合|社|財)\))/;
  const CORP_SUF_RE = /\S(株式会社|有限会社|合同会社|\((株|有)\)|大学|大学院|病院|医院|クリニック|歯科|診療所|事務所|研究所|役所|役場|銀行|信用金庫|信金|協会|組合|学園|学校|高校|高等学校|中学校|小学校|幼稚園|保育園|保育所|商店|商会|工業|工務店|製作所|新聞社|出版|出版社|書店|ホテル|旅館|財団|基金|省|庁|整骨院|接骨院|鍼灸院|整体院|動物病院|不動産|美容室|美容院|理容室|薬局|商店街|サロン|教室|塾|スクール|ジム|クラブ|食堂|酒店|書房|堂|社|コミュニケーションズ|プロダクション|プランニング|エージェンシー|カンパニー|コーポレーション|ホールディングス|ファーム|軒|亭|庵)$/;
  const CORP_EN_RE = /(\binc\.?|\bco\.,?\s*ltd\.?|\bltd\.?|\bllc\b|\bcorp(oration)?\.?|\bk\.k\.|\bgmbh\b|\bplc\b|\bcompany\b)$/i;
  // 部署（〜部・〜課など）と肩書（〜記者・〜部長など。前に修飾語が付いてもよい）
  const DEPT_RE = /^(\S{2,}(部|課|室|局|本部|事業部|統括部|支店|支社|営業所|センター|グループ|チーム|係|科|研究室)|\S*(部長|課長|係長|主任|主査|代表|取締役|社長|会長|専務|常務|執行役員|理事|理事長|所長|院長|店長|室長|局長|本部長|マネージャー|ディレクター|プロデューサー|エンジニア|デザイナー|編集長|編集者|記者|ライター|リーダー|教授|講師|弁護士|税理士|医師|研究員|顧問|秘書|アナリスト|コンサルタント|ジャーナリスト|カメラマン|フォトグラファー|翻訳者|作家|研究者)|manager|director|engineer|designer|ceo|cto|coo|cfo|president|editor|writer|reporter|sales|marketing|head)$/i;
  const ORG_UNIT_RE = /^\S{2,}(部|課|室|局|本部|事業部|統括部|支店|支社|営業所|センター|グループ|チーム|係|科|研究室)$/;
  const SURNAME_BU = /^(長谷部|日下部|曽我部|長曽我部|物部|雀部)$/;
  const KANA_ONLY = /^[ぁ-んァ-ヶー\s]+$/;

  // 全角半角・大文字小文字・カタカナひらがな・空白やハイフン・漢字の異体字の違いを吸収する（検索用）
  function normalize(s) {
    return String(s ?? '')
      .normalize('NFKC')
      .replace(/[\u{E0100}-\u{E01EF}\uFE00-\uFE0F]/gu, '')
      .replace(/\p{Script=Han}/gu, (c) => ITAIJI.get(c) || c)
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/[\s\-‐‑‒–—―−()（）・.,、。]/g, '');
  }
  const digits = (s) => String(s).replace(/\D/g, '');

  function isCompany(w) {
    return CORP_PRE_RE.test(w) || CORP_SUF_RE.test(w) || /\S(co\.,?\s*ltd\.?|inc\.|corp\.)$/i.test(w);
  }
  function isDept(w) {
    return DEPT_RE.test(w) && !SURNAME_BU.test(w);
  }
  function nameLike(t) {
    return t.length <= 30 && !/\d/.test(t) && !/[。！？!?@]/.test(t)
      && !/(の(?=\p{Script=Han})|休|予約|曜|診療|営業|仲間|同期|友達|知人|紹介|について|こちら|場合|より|お知らせ|移転|開催|募集|詳細|案内|ください|予定|[【】「」『』☆★※\[\]:〜~])/u.test(t)
      && !/(お世話|よろしく|ありがと|です|ます|でした|ください|下さい|いたします|致します)/.test(t)
      && !/^(re|fw|fwd|件名|subject|from|to|cc|date|sent)\b/i.test(t);
  }
  // かっこ書きや見出しの「旧姓 飯島智子」「本名：土本一枝」から種類と名前を取り出す
  const ALT_KIND_RE = /^(旧姓|本名|ペンネーム|筆名|通称|旧名|芸名|雅号|ニックネーム|別名)\s*[:：]?\s*(.+)$/;

  // 先頭から名前らしい部分だけを取り出す（「佐藤花子 大学の同期」→「佐藤花子」、「山田 太郎」→そのまま）
  function leadingName(t) {
    const w = t.split(' ');
    let cand;
    if (w.length === 1) cand = t;
    else if (/^[A-Za-z][A-Za-z.'-]*$/.test(w[0])) {
      const n = [];
      for (const x of w) { if (/^[A-Z][A-Za-z.'-]*$/.test(x) && n.length < 3) n.push(x); else break; }
      cand = n.length ? n.join(' ') : t;
    } else {
      const short = (x) => /^[一-龥々ヶぁ-んァ-ヶー○〇◯]{1,4}$/.test(x);
      if (/^[一-龥々ヶ]{4,}$/.test(w[0]) || (/^[一-龥々ヶ]{3}$/.test(w[0]) && !short(w[1]))) cand = w[0];
      else if (short(w[0]) && short(w[1])) cand = w[0] + ' ' + w[1];
      else cand = w[0];
    }
    return nameLike(cand) ? cand : '';
  }

  // 人名らしさを厳しめに判定する（区切りと警告に使う）。「山田 太郎」「佐藤花子」「Taro Yamada」など
  function isPersonName(t) {
    t = String(t).trim();
    // 「大谷さん」「菊池様」のように敬称が付いていれば、2文字の名字だけでも名前
    const hon = t.match(/^([\p{Script=Han}々ヶ]{1,4})\s*(さん|様|さま|氏|先生)$/u);
    if (hon && !isCompany(hon[1]) && !/(駐車|駅|受付|窓口|担当|会社|事務)/.test(hon[1]) && !/^(奥|ご?主人|旦那|夫|妻|母|父|娘|息子|お?子|奥方)$/.test(hon[1])) return true;
    t = t.replace(/\s*(様|さま|殿|さん)$/, '');
    if (/^[A-Z][A-Za-z'-]+( [A-Z][A-Za-z'-]+){1,2}$/.test(t)) return !/\b(Japan|Tokyo|Indonesia|France|Paris|Street|Floor|Building|Department|Tower|Films?|Studios?|Design|Office|Works|Production|Website|Official|Company|Group|Lab|Shop|Cafe|Salon)\b/i.test(t);
    const m = t.match(/^([\p{Script=Han}々ヶ○〇◯]{1,4})\s?([\p{Script=Han}々ヶぁ-んァ-ヶー○〇◯]{1,5})$/u);
    if (!m || t.replace(/\s/g, '').length < 3) return false;
    if (/(ファーム|デザイン|スタジオ|プロセス|オフィス|ショップ|サロン|ハウス|ラボ|カフェ|スタッフ|センター)$/.test(t) || /(線|駅)$/.test(t)) return false;
    if (/^[はがをにのへとでもや]/.test(m[2]) || /[はがをにでとへも]$/.test(t) || /^(あり|なし|する|した|して|します|ない|済み?)$/.test(m[2]) || isCompany(t) || isDept(t)) return false;
    if (/(駐車|駐輪|駅|徒歩|受付|営業|定休|休診|予約|連絡|自宅|勤務|住所|電話|携帯|会社|事務|最寄|担当)/.test(t)) return false;
    return nameLike(t);
  }

  function pushUniq(arr, v, key = (x) => x) {
    if (v && !arr.some((x) => key(x) === key(v))) arr.push(v);
  }

  function extractPhones(l, r, forced) {
    // 区切りはハイフン類・空白・点・中黒・文字化けの「?」（「090 -3082」のような組み合わせも）
    const S = `[\\s${HYPHEN}.・?]{0,3}`;
    const re = new RegExp(
      `\\+\\d{1,3}${S}(?:\\(0?\\d{0,3}\\)${S})?\\d{1,4}(?:${S}\\d{2,4}){1,4}` +
      `|(?<!〒\\s*)(?<![\\d+])(?<!\\d[${HYPHEN}])\\(?0\\d{1,4}\\)?${S}\\(?\\d{1,4}\\)?${S}\\d{3,4}(?!\\d)`, 'g');
    let out = '', last = 0, m;
    while ((m = re.exec(l))) {
      const num = m[0].trim();
      const n = digits(num).length;
      const intl = num.startsWith('+');
      if (intl ? n < 8 || n > 15 : n < 10 || n > 11) continue;
      const pre = l.slice(last, m.index);
      // 直前の見出し語 → 行頭の見出し → 番号の形 の順で種類を決める
      let kind = null;
      if (/(fax|ファックス|ファクス)/i.test(pre)) kind = 'fax';
      else if (/(携帯|mobile|cell|スマホ|\bm\b|\bmob)/i.test(pre)) kind = 'mobile';
      else if (/(tel|電話|phone|代表|直通|自宅|\bt\b)/i.test(pre)) kind = 'tel';
      else if (['tel', 'mobile', 'fax'].includes(forced)) kind = forced;
      else kind = /^(\+81[\s-]?[789]0|0[789]0)/.test(num) ? 'mobile' : 'tel';
      const clean = num.replace(new RegExp(`[\\s${HYPHEN}().・?]+`, 'g'), '-').replace(/^-|-$/g, '').replace(/^\+(\d+)-0-/, (m0, cc) => (/\(0\)/.test(num) ? `+${cc}-` : m0));
      pushUniq(r.phones, { kind, number: clean }, (p) => digits(p.number));
      out += pre + ' ';
      last = m.index + m[0].length;
    }
    return out + l.slice(last);
  }

  // 住所の開始位置から、番地と建物名までを住所として切り出す
  function takeAddress(l, start) {
    const tokens = l.slice(start).replace(/\s*\u241F\s*/g, ' ').trim().split(' ');
    let addr = tokens.shift();
    while (tokens.length) {
      const t = tokens[0];
      if (!/\d/.test(addr) || BUILDING_RE.test(t) || /^\d+[-\dF階号室]*$/.test(t) || /[^\d\s-]\d{2,4}(号室?)?$/.test(t) ||
        /^[A-Za-z0-9.&'#-]+$/.test(t) || /^[ァ-ヶー・]+[\dA-Za-z]*$/.test(t) || /^#?\d+$/.test(t)) addr += ' ' + tokens.shift();
      else break;
    }
    return { addr, rest: (l.slice(0, start) + ' ' + tokens.join(' ')).trim() };
  }

  // 振込口座の欄の始まり。ここから区切り（空行・罫線）までは名前・電話として読まず、メモにする
  const BANK_RE = /(銀行|信用金庫|信金|ゆうちょ|口座|振込|振り込み|預金)/;
  // 宛先の指定（「斎藤方 八木麻里宛」「菅間百合子 様 気付」）
  const CARE_OF_RE = /(宛|気付|c\/o|様方)\s*$|^\S+方[\s\u241F]/i;

  // 五十音の見出し（【あ】【や】など）。区切りとして扱い、中身には含めない
  const KANA_HEAD_RE = /^\s*[【\[（(〔<＜]\s*[ぁ-んァ-ヶ]\s*[】\]）)〕>＞]\s*$/;
  // 住所の種類の見出し（（自宅）【旧住所】など）。次の住所に付ける
  const ADDR_LABEL_RE = /^\s*[【\[（(〔<＜]\s*((?:旧|新|現)?(?:自宅|住所|事務所|会社|勤務先|実家|本社|支社|オフィス|アトリエ|別宅|仕事場|店舗)(?:住所)?)\s*[】\]）)〕>＞]\s*$/;

  // 「○○ ○○」のような伏せ字は文字として扱い、それ以外の記号だけの行を飾りとみなす
  const isDecoration = (l) => /^[^\p{L}\p{N}]+$/u.test(l) && !/^[○〇◯\s\u241F]+$/.test(l);
  const CLOSING_RE = /^((best|kind|warm|warmest)\s+)?(regards|wishes)\b|^(best|cheers|sincerely|thanks|thank you|respectfully|yours( truly| sincerely)?)\b[,.!]?\s*$/i;

  // 罫線や空行で区切ったまとまりのうち、電話・メール・〒が多いもの（署名本体）を先に読み、
  // 近いまとまりから順に読む。署名の上下のお知らせを名前と取り違えないため
  function orderLines(text) {
    const lines = String(text || '').split(/\r?\n/);
    const blocks = [[]];
    for (const l of lines) {
      const t = l.normalize('NFKC').trim();
      if (!t || isDecoration(t)) { if (blocks[blocks.length - 1].length) blocks.push([]); continue; }
      // 「----お知らせ----」のような罫線に挟まれた見出しは、それだけで1つのまとまりにする
      if (/^[-—–―=_~*━─]{3,}.*[-—–―=_~*━─]{3,}$/.test(t)) {
        if (blocks[blocks.length - 1].length) blocks.push([]);
        blocks[blocks.length - 1].push(l);
        blocks.push([]);
        continue;
      }
      blocks[blocks.length - 1].push(l);
    }
    if (blocks[blocks.length - 1].length === 0) blocks.pop();
    if (blocks.length <= 1) return lines;
    const score = (b) => b.reduce((n, l) => {
      const t = l.normalize('NFKC');
      return n + (/@/.test(t) ? 2 : 0) + (/(?<!\d)0\d{1,4}[-(]\d/.test(t) || /\+\d{1,3}[\s-]\d/.test(t) ? 2 : 0) + (/〒/.test(t) ? 2 : 0)
        + (/^(tel|fax|mail|e-mail|携帯|電話)/i.test(t.trim()) ? 1 : 0) + (CORP_PRE_RE.test(t.trim()) || /(株式会社|co\.,? ?ltd|inc\.)/i.test(t) ? 1 : 0);
    }, 0);
    let best = 0;
    blocks.forEach((b, i) => { if (score(b) > score(blocks[best])) best = i; });
    const order = blocks.map((_, i) => i).sort((a, b) => Math.abs(a - best) - Math.abs(b - best) || a - b);
    return order.flatMap((i) => [...blocks[i], '']);
  }

  function analyze(text) {
    const r = { name: '', alias: '', alts: [], kana: '', company: '', dept: '', zip: '', address: '', phones: [], emails: [], urls: [], tags: [], birthday: '', notes: [], warnings: [] };
    // 住所は複数持てる（事務所と自宅など）。新しい〒や都道府県が出てきたら次の住所
    const addrs = [];
    const curA = () => addrs[addrs.length - 1];
    let pendingLabel = '';
    const newAddr = (o) => { if (pendingLabel) { o.label = pendingLabel; pendingLabel = ''; } addrs.push(o); };
    let lastAddr = false;
    let addrNow = false;
    const setZip = (z) => {
      const c = curA();
      if (c && c.zip === z) return;
      if (c && !c.zip && (!c.address || lastAddr || addrNow) && !pendingLabel) c.zip = z;
      else newAddr({ zip: z, address: '' });
    };
    const setAddress = (text) => {
      const c = curA();
      if (c && !c.address && !pendingLabel) c.address = text; else newAddr({ zip: '', address: text });
    };
    const curAddr = () => (curA() ? curA().address : '');
    // 別名（ペンネーム・本名・旧姓など）。出てきた時点のメール数・住所数を覚えておき、
    // その後にメールや住所が重なって出てくるなら「2人分が混ざっている可能性」とする
    r.addAlt = (name, kind = '別名', watch = true) => {
      name = String(name).replace(/\s*(様|さま|殿|さん)$/, '').trim();
      if (!name || r.alts.some((x) => normalize(x.name) === normalize(name))) return;
      r.alts.push({ name, kind, at: watch ? { emails: r.emails.length, addrs: addrs.filter((x) => x.address).length } : null });
    };
    let firstLine = '';

    let inBank = false;
    for (const rawLine of orderLines(text)) {
      if (KANA_HEAD_RE.test(rawLine)) { lastAddr = false; continue; }
      // 振込口座の欄
      const rt = rawLine.normalize('NFKC').trim();
      if (!rt || isDecoration(rt)) inBank = false;
      else if (inBank || (BANK_RE.test(rt) && !/@/.test(rt))) { inBank = true; r.notes.push(rt); lastAddr = false; continue; }
      const al = rawLine.match(ADDR_LABEL_RE);
      if (al) { pendingLabel = al[1]; lastAddr = false; continue; }
      let l = rawLine.replace(/〠/g, '〒').replace(/[\s\u3000]+$/, '').replace(/^[\s\u3000]+/, '').replace(/[\t\u3000]|\s{2,}/g, ' \u241F ').normalize('NFKC').replace(/ {2,}/g, ' ').trim();
      // 文字も数字もない行（罫線・飾り）と、英文の結びの言葉は飛ばす
      if (!l || isDecoration(l) || CLOSING_RE.test(l)) { lastAddr = false; continue; }
      l = l.replace(/[\u2500-\u257F]+/g, ' ').replace(/[-—–―=_~*>＞<＜]{3,}/g, ' ').trim();
      l = l.replace(/^[^\p{L}\p{N}#〒+(○〇◯]+/u, '');
      if (!firstLine) firstLine = l;

      // #タグ
      l = l.replace(/(^|\s)#([^\s#\d,][^\s#,]*)/g, (_, s, t) => { pushUniq(r.tags, t); return s; }).trim();
      if (!l) continue;

      // 誕生日（見出しの後にコロンがない書き方も拾う）
      l = l.replace(/(誕生日|生年月日|birthday)\s*[:：]?\s*(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}[-/月]\d{1,2}日?)/i, (_, _k, d) => { if (!r.birthday) r.birthday = d; return ' '; }).trim();
      if (!l || l === '\u241F') continue;

      // 「見出し: 値」形式
      let forced = null;
      const lm = l.match(LABEL_RE);
      if (lm) {
        forced = LABEL_OF[lm[1].toLowerCase()];
        l = lm[2].replace(/\s*\u241F\s*/g, ' ').trim();
        if (!l) continue;
        const simple = { name: 'name', kana: 'kana', company: 'company', dept: 'dept', birthday: 'birthday' }[forced];
        if (simple) {
          if (forced === 'company' && /\(([^)]+)\)$/.test(l) && !CORP_PRE_RE.test(l.match(/\(([^)]+)\)$/)[0])) {
            const [, inner] = l.match(/\(([^)]+)\)$/);
            l = l.replace(/\s*\([^)]+\)$/, '');
            if (!r.dept) r.dept = inner;
          }
          if (forced === 'name') {
            l = l.replace(/\(([^)]+)\)/, (_, inner) => { if (KANA_ONLY.test(inner.trim()) && !r.kana) r.kana = inner.trim(); return ''; }).trim();
          }
          if (!r[simple]) r[simple] = l.replace(/\s*(様|さま|殿)$/, '');
          lastAddr = false;
          continue;
        }
        if (forced === 'memo') { r.notes.push(l); lastAddr = false; continue; }
        if (forced === 'altname') { r.addAlt(l, lm[1], false); lastAddr = false; continue; }
        if (forced === 'tags') { l.split(/[,、\s]+/).forEach((t) => pushUniq(r.tags, t.replace(/^#/, ''))); continue; }
      }

      l = l.replace(/https?:\/\/\S+|www\.[^\s]+/gi, (m) => { pushUniq(r.urls, m); return ' '; });
      l = l.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, (m) => { pushUniq(r.emails, m); return ' '; });
      l = extractPhones(l, r, forced);

      // 郵便番号
      addrNow = false;
      l = l.replace(new RegExp(`〒\\s*(\\d{3})\\s*[${HYPHEN}]?\\s*(\\d{4})`), (_, a, b) => { setZip(`${a}-${b}`); return ' '; });
      if (forced === 'zip') { const z = digits(l); if (z.length === 7) setZip(`${z.slice(0, 3)}-${z.slice(3)}`); continue; }
      l = l.replace(/\s+/g, ' ').trim();

      // 住所
      if (forced === 'address') {
        l = l.replace(/\s*\u241F\s*/g, ' ').replace(/(?<![\d-])(\d{3})-(\d{4})(?![\d-])\s*/, (_, a, b) => { setZip(`${a}-${b}`); return ''; }).replace(/\s+,/g, ',').trim();
        if (lastAddr && curAddr()) curA().address += ' ' + l; else setAddress(l);
        lastAddr = true;
        continue;
      }
      const enLine = EN_ADDR_RE.test(l) && !/[一-龥ぁ-ん]/.test(l);
      if (curAddr() && lastAddr && enLine) {
        l = l.replace(/(?<![\d-])(\d{3})-(\d{4})(?![\d-])/, (_, a, b) => { setZip(`${a}-${b}`); return ''; });
        curA().address += ', ' + l.replace(/\s+,/g, ',').trim();
        l = '';
        addrNow = true;
      } else if (enLine && /\d|floor|bldg|building/i.test(l)) {
        l = l.replace(/(?<![\d-])(\d{3})-(\d{4})(?![\d-])/, (_, a, b) => { setZip(`${a}-${b}`); return ''; });
        setAddress(l.replace(/\s*\u241F\s*/g, ' ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim());
        l = '';
        addrNow = true;
      } else if (lastAddr && curAddr() && l && !PREF_RE.test(l) && !isCompany(l) && (BUILDING_RE.test(l) || /^[\d\-]+$/.test(l) || (!/\d/.test(curAddr()) && /\d/.test(l)))) {
        // 住所の続き（建物名・部屋番号・番地の折り返し）
        curA().address += ' ' + l.replace(/\s*\u241F\s*/g, ' ').trim();
        l = '';
        addrNow = true;
      } else {
        let idx = l.search(PREF_RE);
        if (idx < 0) { const cm = l.match(CITY_RE); if (cm) idx = cm.index; }
        if (idx >= 0) {
          const { addr, rest } = takeAddress(l, idx);
          setAddress(addr);
          l = rest;
          addrNow = true;
        }
      }
      // 〒なしの郵便番号（住所の行か、それだけの行）
      l = l.replace(/(?<![\d-])(\d{3})-(\d{4})(?![\d-])/, (m, a, b) => {
        if (addrNow || l.trim() === m || PREF_RE.test(rawLine)) { setZip(`${a}-${b}`); return ' '; }
        return m;
      });
      lastAddr = addrNow;

      l = l.replace(LABEL_WORDS_RE, '$1 ').replace(/\s+/g, ' ').trim()
        .replace(/^[:：/|,、・\s\u241F]+|[:：/|,、・\s\u241F]+$/g, '');
      if (!l) continue;

      // 「※」「★」などで始まる行はメモ
      if (/^(※|[★☆＊*◉●・]+(?=[\p{L}\p{N}]))/u.test(rt)) { r.notes.push(l.replace(/\s*\u241F\s*/g, ' ')); continue; }
      // 宛先の指定は名前の候補にするだけで、2人目の名前とはみなさない
      if (CARE_OF_RE.test(l)) {
        if (!r.name && !/気付\s*$/.test(l)) {
          const nm = leadingName(l.replace(/^\S+方[\s\u241F]+/, '').replace(/[\s\u241F]*(様)?[\s\u241F]*(宛|気付|c\/o)\s*$/i, '').replace(/\u241F/g, ' ').trim());
          if (nm) r.name = nm;
        }
        r.notes.push(l.replace(/\s*\u241F\s*/g, ' '));
        continue;
      }
      // 名前のあとの「〜様」の行は別名（本名など）とみなし、警告しない
      if (r.name && /(様|さま)$/.test(l)) {
        const t = l.replace(/\s*\u241F\s*/g, ' ');
        if (isPersonName(t)) r.addAlt(t, '別名', false); else r.notes.push(t);
        continue;
      }

      // かっこ内（ふりがな・補足）
      l = l.replace(/\(([^)]{2,})\)/g, (_, inner) => {
        inner = inner.trim();
        const ak = inner.match(ALT_KIND_RE);
        if (KANA_ONLY.test(inner) && !r.kana) r.kana = inner;
        else if (ak) r.addAlt(ak[2], ak[1], false);
        else if (isPersonName(inner)) r.addAlt(inner, '別名', false);
        else r.notes.push(inner);
        return ' ';
      }).replace(/\s+/g, ' ').trim();
      if (!l) continue;

      const segs = l.split(/\u241F|[/|、]|,(?!\s*(?:ltd|inc|llc)\b)|\s(?=様$)/i).map((s) => s && s.trim()).filter(Boolean);
      // 「山田　太郎」のように全角空白で区切られた姓と名はつなげる
      const shortName = /^[一-龥々ヶぁ-んァ-ヶー○〇◯]{1,4}$/;
      if (!r.name && segs.length >= 2 && shortName.test(segs[0]) && shortName.test(segs[1].replace(/\s*(様|さま|殿|さん)$/, ''))) {
        segs.splice(0, 2, segs[0] + ' ' + segs[1]);
      }
      for (const seg of segs) {
        classifySegment(seg.replace(/\s*(様|さま|殿|御中|さん|くん|ちゃん)$/, ''), r);
      }
    }

    // 会社名がなく「森デザイン室」のような組織名だけがあるときは、それを会社名（事務所名）として扱う
    if (!r.company && r.dept && ORG_UNIT_RE.test(r.dept) && !r.dept.includes(' ')) { r.company = r.dept; r.dept = ''; }
    r.addresses = addrs.filter((x) => x.address || x.zip);
    r.zip = r.addresses[0] ? r.addresses[0].zip : '';
    r.address = r.addresses[0] ? r.addresses[0].address : '';
    if (!r.name && r.kana) r.name = r.kana;
    if (!r.name && r.alts.length) r.name = r.alts.shift().name;
    // 名前のリスト（先頭が主な名前）
    r.names = [];
    const pushName = (name, kind) => { if (name && !r.names.some((x) => normalize(x.name) === normalize(name))) r.names.push({ name, kind }); };
    pushName(r.name, '');
    for (const x of r.alts) pushName(x.name, x.kind);
    if (r.alias) pushName(r.alias, 'ローマ字');
    // 2つ目の名前の後に、メールか住所がもう1組出てくるなら2人分が混ざっている可能性
    const addrN = r.addresses.filter((x) => x.address).length;
    for (const x of r.alts) {
      if (x.at && ((x.at.emails > 0 && r.emails.length > x.at.emails) || (x.at.addrs > 0 && addrN > x.at.addrs))) {
        pushUniq(r.warnings, `2人分が混ざっている可能性（${x.name}）`);
      }
    }
    delete r.addAlt;
    if (r.phones.length >= 5) pushUniq(r.warnings, '電話番号が多い');
    r.display = r.name || r.company || r.emails[0] || (r.phones[0] && r.phones[0].number) || firstLine || '(空)';
    return r;
  }

  function classifySegment(seg, r) {
    if (!seg) return;
    if (/[a-z]/i.test(seg) && CORP_EN_RE.test(seg) && !/[一-龥ぁ-んァ-ヶ]/.test(seg)) {
      if (!r.company) r.company = seg; else r.notes.push(seg);
      return;
    }
    const words = seg.split(' ');
    // 部署・役職だけの並び（会社名が出た後か、役職語を含むとき）
    // 「〇〇大学〇〇学部〇〇学科」は大学名と学部に分ける
    const univ = seg.match(/^(\S+?大学院?)(\S*(学部|研究科|学科|学府|専攻).*)$/);
    if (univ) {
      if (!r.company) r.company = univ[1]; else r.notes.push(univ[1]);
      r.dept = r.dept ? r.dept + ' ' + univ[2] : univ[2];
      return;
    }
    if (words.every(isDept)) { r.dept = r.dept ? r.dept + ' ' + seg : seg; return; }
    let buf = [];
    const flush = () => {
      let t = buf.join(' ').trim();
      buf = [];
      if (!t) return;
      if (!r.name) t = takeBilingualName(t, r);
      if (!t) return;
      const latinOnly = (x) => x && !/[一-龥ぁ-んァ-ヶ]/.test(x);
      if (latinOnly(r.name) && !latinOnly(t) && leadingName(t)) {
        // 先に英字の名前があり、後から日本語の名前が出てきた。英字はローマ字として読めればローマ字表記、だめなら別名かメモ
        if (!r.alias && romajiName(r.name)) r.alias = r.name;
        else if (isPersonName(r.name)) r.addAlt(r.name, '別名', false);
        else r.notes.push(r.name);
        r.name = '';
      }
      const nm = !r.name && leadingName(t);
      // 日本語の名前のあとのローマ字の名前は英字表記（「山田 太郎」→「YAMADA Taro」）
      if (r.name && !r.alias && /[一-龥ぁ-ん]/.test(r.name) && /^[A-Za-z][A-Za-z'-]*( [A-Za-z][A-Za-z'-]*){1,2}$/.test(t)) {
        const kana = romajiName(t);
        if (kana) { r.alias = t; if (!r.kana) r.kana = kana; return; }
        // ローマ字として読めない英字の名前（芸名・屋号など）は、人名らしければ別名
        if (isPersonName(t)) { r.addAlt(t, '別名', false); return; }
        r.notes.push(t);
        return;
      }
      if (r.name && isPersonName(t) && normalize(t) !== normalize(r.name)) {
        // 同じ名字の別表記（門倉多仁亜・門倉たにあ）は混ざりの判定に使わない
        r.addAlt(t, '別名', normalize(t).slice(0, 2) !== normalize(r.name).slice(0, 2));
        return;
      }
      if (KANA_ONLY.test(t) && r.name && !r.kana) r.kana = t;
      else if (nm) { r.name = nm; const rest = t.slice(nm.length).trim(); if (rest) r.notes.push(rest); }
      else if (KANA_ONLY.test(t) && !r.kana) r.kana = t;
      else r.notes.push(t);
    };
    for (let i = 0; i < words.length; i++) {
      let w = words[i];
      if (CORP_PRE_RE.test(w) && w.replace(CORP_PRE_RE, '') === '' && words[i + 1]) w += ' ' + words[++i];
      if (isCompany(w)) {
        flush();
        if (r.company && !/[一-龥ぁ-んァ-ヶ]/.test(r.company)) { r.notes.push(r.company); r.company = ''; }
        if (!r.company) r.company = w; else r.notes.push(w);
      } else if (isDept(w) && (r.company || (i === 0 && words.length > 1)) && w.length >= 2) {
        flush();
        r.dept = r.dept ? r.dept + ' ' + w : w;
      } else buf.push(w);
    }
    flush();
  }

  // 「SAITO Taro 斎藤太郎」「斎藤太郎 (Taro Saito)」のようなローマ字と漢字の併記から、名前・英字表記・よみを取る
  function takeBilingualName(t, r) {
    const LAT = "[A-Za-z][A-Za-z'-]*";
    const JP = '[一-龥々ヶ]{1,4}(?: [一-龥々ヶ]{1,4})?';
    let m = t.match(new RegExp(`^((?:${LAT} ){1,2}${LAT}) (${JP})(?: (.*))?$`));
    let latin, jp, rest;
    if (m) [, latin, jp, rest] = m;
    else if ((m = t.match(new RegExp(`^(${JP}) ((?:${LAT} ){1,2}${LAT})(?: (.*))?$`)))) [, jp, latin, rest] = m;
    else return t;
    if (!nameLike(jp)) return t;
    r.name = jp;
    if (!romajiName(latin)) { r.addAlt(latin, '別名', false); return rest || ''; }
    r.alias = latin;
    if (!r.kana) r.kana = romajiName(latin);
    return rest || '';
  }

  // ローマ字の氏名をひらがなにする。全部大文字の語を姓とみなして先頭に置き、姓の語末 -to/-do は「とう/どう」と読む
  function romajiName(latin) {
    const words = latin.split(' ');
    const capsIdx = words.findIndex((w) => w.length >= 2 && w === w.toUpperCase() && /[A-Z]/.test(w));
    const ordered = capsIdx > 0 ? [words[capsIdx], ...words.filter((_, i) => i !== capsIdx)] : words;
    const kana = ordered.map((w, i) => {
      let k = romajiToKana(w);
      if (!k) return k;
      const surname = i === 0 && capsIdx >= 0;
      if (surname && /[^m]o?[td]o$/i.test(w) && !/moto$/i.test(w) && !/^(seto|mito)$/i.test(w) && !/う$/.test(k)) k += 'う';
      if (!surname) {
        // 名前でよくある長音の省略: Taro→たろう、Shota→しょうた
        if (/ro$/i.test(w) && !/(?<![cs])hiro$/i.test(w)) k += 'う';
        k = k.replace(/^(しょ|りょ|きょ|ちょ|じょ|しゅ|りゅ|きゅ|じゅ)(?=[^んうぁ-ぉゃゅょ])/, '$1う');
      }
      return k;
    });
    return kana.every(Boolean) ? kana.join(' ') : '';
  }

  const ROMAJI = {
    a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
    ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ', kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ',
    sa: 'さ', shi: 'し', si: 'し', su: 'す', se: 'せ', so: 'そ', sha: 'しゃ', shu: 'しゅ', sho: 'しょ', sya: 'しゃ', syu: 'しゅ', syo: 'しょ',
    ta: 'た', chi: 'ち', ti: 'ち', tsu: 'つ', tu: 'つ', te: 'て', to: 'と', cha: 'ちゃ', chu: 'ちゅ', cho: 'ちょ', tya: 'ちゃ', tyu: 'ちゅ', tyo: 'ちょ',
    na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の', nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ',
    ha: 'は', hi: 'ひ', fu: 'ふ', hu: 'ふ', he: 'へ', ho: 'ほ', hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ',
    ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も', mya: 'みゃ', myu: 'みゅ', myo: 'みょ',
    ya: 'や', yu: 'ゆ', yo: 'よ', ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ', rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ',
    wa: 'わ', wo: 'を', ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご', gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ',
    za: 'ざ', ji: 'じ', zi: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ', ja: 'じゃ', ju: 'じゅ', jo: 'じょ', jya: 'じゃ', jyu: 'じゅ', jyo: 'じょ',
    da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど', ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ', bya: 'びゃ', byu: 'びゅ', byo: 'びょ',
    pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ', pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ', fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ',
  };
  function romajiToKana(word) {
    const w = word.toLowerCase().replace(/[ōô]/g, 'ou').replace(/[ūû]/g, 'uu').replace(/[āâ]/g, 'aa').replace(/['-]/g, (c) => (c === "'" ? "'" : ''));
    let out = '';
    for (let i = 0; i < w.length;) {
      const c = w[i];
      if (c === "'") { i++; continue; }
      // 長音の h（Ohno→おおの、Satoh→さとう）
      if (c === 'h' && w[i - 1] === 'o' && !/[aiueoy]/.test(w[i + 1] || '')) { out += i === 1 ? 'お' : 'う'; i++; continue; }
      if (c === 'n' && !/[aiueoy]/.test(w[i + 1] || '')) { out += 'ん'; i += w[i + 1] === 'n' && !/[aiueoy]/.test(w[i + 2] || '') ? 2 : 1; continue; }
      if (c === 'm' && /[bmp]/.test(w[i + 1] || '')) { out += 'ん'; i++; continue; }
      if (c === w[i + 1] && !/[aiueon]/.test(c)) { out += 'っ'; i++; continue; }
      if (c === 't' && w.startsWith('tch', i)) { out += 'っ'; i++; continue; }
      let hit = false;
      for (const len of [3, 2, 1]) {
        const k = ROMAJI[w.substr(i, len)];
        if (k) { out += k; i += len; hit = true; break; }
      }
      if (!hit) return '';
    }
    return out;
  }

  // ---------- 宛名 ----------
  function splitAddress(addr) {
    const m = String(addr).match(/^(.*?\d[^\s]*)\s+(.+)$/);
    return m ? [m[1], m[2]] : [addr];
  }

  // zip: 原文に郵便番号が無いときに補う番号（住所から引いたもの、または不明を表す '？？？-？？？？'）
  function atena(a, { withCompany = true, zip = '', index = 0, name = '' } = {}) {
    if (name) a = { ...a, name };
    const ad = (a.addresses && a.addresses[index]) || { zip: a.zip, address: a.address };
    const lines = [];
    if (ad.zip || zip) lines.push('〒' + (ad.zip || zip));
    if (ad.address) lines.push(...splitAddress(ad.address));
    const person = a.name && a.name !== a.company && a.name !== a.kana ? a.name : (a.name && !a.company ? a.name : '');
    if (a.company && (withCompany || !person)) {
      lines.push(a.company);
      if (a.dept) lines.push(a.dept);
    }
    if (person) lines.push(person + ' 様');
    else if (a.company) lines[lines.length - 1] += ' 御中';
    return lines.join('\n');
  }

  // ---------- 検索 ----------
  const FIELD_ALIAS = {};
  for (const [k, ws] of Object.entries({
    name: ['名前', '氏名', 'name'], kana: ['かな', 'ふりがな', 'よみ', 'kana'],
    company: ['会社', '勤務先', 'company', '部署', '役職'], address: ['住所', 'address', '〒', '郵便'],
    phone: ['電話', '電話番号', 'tel', 'phone', '携帯', 'fax'], email: ['メール', 'mail', 'email'],
    tags: ['タグ', 'tag', 'tags'], text: ['原文', 'メモ', 'memo', 'text'], status: ['状態', 'status', 'is'],
  })) for (const w of ws) FIELD_ALIAS[normalize(w)] = k;

  // 要確認（⚠）: 2人分が混ざっていそうな件・名前も会社もない件など。検索では「状態:要確認」
  function needsCheck(a) {
    return a.warnings.length > 0 || (!a.name && !a.company);
  }

  function fieldValue(a, rec, key) {
    switch (key) {
      case 'company': return normalize(a.company + ' ' + a.dept);
      case 'address': return normalize((a.addresses || []).map((x) => x.zip + ' ' + x.address).join(' '));
      case 'phone': return a.phones.map((p) => digits(p.number)).join(' ');
      case 'email': return normalize(a.emails.join(' '));
      case 'text': return normalize(rec.text);
      case 'name': return normalize((a.names || []).map((x) => x.name).join(' ') + ' ' + a.kana);
      case 'status': return needsCheck(a) ? normalize('要確認') : '';
      default: return normalize(a[key]);
    }
  }

  // スペース区切りはAND、| はOR、先頭の - は除外、"…" は語句、項目名:語 は項目指定
  function parseQuery(q) {
    const tokens = [];
    const re = /(-?)(?:([^\s:"]+):)?(?:"([^"]*)"|(\S+))/g;
    const src = String(q || '').normalize('NFKC');
    let m;
    while ((m = re.exec(src))) {
      const [, neg, fname, quoted, plain] = m;
      let field = null;
      let text = quoted ?? plain ?? '';
      if (fname) {
        field = FIELD_ALIAS[normalize(fname)] || null;
        if (!field) text = fname + ':' + text;
      }
      const alts = text.split('|').map((a) => (field === 'phone' ? digits(a) : normalize(a))).filter(Boolean);
      if (alts.length) tokens.push({ neg: !!neg, field, alts });
    }
    return tokens;
  }

  // records: [{id, text, ...}], index: Map(id -> analyze結果)
  function search(records, index, q) {
    const tokens = parseQuery(q);
    if (!tokens.length) return records.slice();
    return records.filter((rec) => {
      const a = index.get(rec.id);
      const all = normalize(rec.text + ' ' + a.kana + ' ' + a.alias);
      return tokens.every((t) => {
        const hit = t.alts.some((x) => {
          if (!t.field) return all.includes(x) || (/^\d+$/.test(x) && a.phones.some((p) => digits(p.number).includes(x)));
          if (t.field === 'tags') return a.tags.some((tag) => normalize(tag).includes(x));
          return fieldValue(a, rec, t.field).includes(x);
        });
        return t.neg ? !hit : hit;
      });
    });
  }

  // ---------- 一括取り込み ----------
  const SEP_LINE = /^\s*([-=_*~─━―＝]{3,})\s*$/;

  function looksCsv(text) {
    const first = String(text).split(/\r?\n/, 1)[0] || '';
    if ((first.match(/[,\t]/g) || []).length < 1) return false;
    const heads = first.split(/[,\t]/).map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase());
    return heads.filter((h) => LABEL_OF[h] || ['名前', '氏名', '住所', '電話', 'メール'].includes(h)).length >= 2;
  }

  function lineInfo(line) {
    const t = line.normalize('NFKC').trim();
    if (!t) return { gap: true };
    if (isDecoration(t)) return { gap: true, sep: true };
    const a = analyze(line);
    const lm = t.match(LABEL_RE);
    const labeledName = lm && LABEL_OF[lm[1].toLowerCase()] === 'name';
    const body = !!(a.phones.length || a.emails.length || a.zip || a.address || a.urls.length);
    const kanaOnly = KANA_ONLY.test(t.replace(/[()（）]/g, ''));
    const name = !!a.name && !kanaOnly && (labeledName || !!a.alias || isPersonName(a.name));
    return {
      name, body, kanaOnly,
      title: !name && !body && t.length <= 24 && !/\d/.test(t) && nameLike(t),
      closing: CLOSING_RE.test(t),
      latin: name && !/[一-龥ぁ-んァ-ヶ]/.test(a.name),
      org: !name && !body && !!(a.company || a.dept),
      company: a.company, zip: a.zip, address: a.address,
    };
  }

  // 縦に並んだ複数人のテキストを1人ずつに分ける。
  // 迷ったら分ける（混ざるより、分かれすぎを後で結合するほうが安全）
  function splitSmart(text) {
    return splitSmartRanges(text).map((r) => r.text);
  }

  // 分割結果を元の行番号の範囲つきで返す（start〜end-1 行目）
  function splitSmartRanges(text) {
    const out = [];
    let lineNo = 0;
    let cur = [];
    const state = () => {
      const st = { any: false, name: false, nameLatin: false, body: false, company: '', zip: '', address: '', lastAnchor: -1, gapAfterBody: false, sepAfterBody: false };
      cur.forEach((it, i) => {
        const f = it.info;
        if (f.gap) { if (st.body) { st.gapAfterBody = true; if (f.sep) st.sepAfterBody = true; } return; }
        st.any = true;
        if (f.name) { st.name = true; st.nameLatin = f.latin; st.lastAnchor = i; }
        if (f.body) { st.body = true; st.gapAfterBody = false; st.sepAfterBody = false; st.lastAnchor = i; }
        if (f.company && !st.company) st.company = f.company;
        if (f.zip && !st.zip) st.zip = f.zip;
        if (f.address && !st.address) st.address = f.address;
      });
      return st;
    };
    // 新しい人の始まりなら 'name'（名前の行から）か 'body'（名前のない次の項目）を返す
    const startsNew = (f, st) => {
      if (!st.any) return false;
      if (f.name) {
        if (st.name && !st.body && f.latin !== st.nameLatin) return false; // 「山田 太郎」の次の「Taro Yamada」
        return st.name || st.body ? 'name' : false;
      }
      // 連絡先のあとに罫線があり、その後に名前でない行が続くなら別の項目（お知らせ等）として分ける
      if (st.body && st.sepAfterBody && !f.closing) return 'body';
      return conflicts(f, st) ? 'body' : false;
    };
    const conflicts = (f, st) => {
      if (f.company && st.company && normalize(f.company) !== normalize(st.company) && (st.name || st.body)) return true;
      if (f.zip && st.zip && f.zip !== st.zip) return true;
      if (f.address && st.address && !f.zip && PREF_RE.test(f.address)) return true;
      if ((f.org || (f.company && f.body)) && st.body && st.gapAfterBody) return true;
      return false;
    };
    const flush = (items) => {
      // 前後の罫線・空行は外す（人と人の区切りだったもの）
      let a = 0, b = items.length;
      while (a < b && items[a].info.gap) a++;
      while (b > a && items[b - 1].info.gap) b--;
      const s = items.slice(a, b).map((it) => it.line).join('\n').replace(/\s+$/, '');
      if (s.trim()) out.push({ text: s, lines: items.slice(a, b).map((it) => it.no) });
    };
    for (const line of String(text).split('\n')) {
      const info = lineInfo(line);
      const no = lineNo++;
      if (info.gap) { cur.push({ line, info, no }); continue; }
      const st = state();
      const why = startsNew(info, st);
      if (why) {
        // 最後の名前・連絡先の行より後ろにある会社名・部署・空行は、次の人の見出しとして持っていく
        let k = cur.length;
        while (k > st.lastAnchor + 1 && (cur[k - 1].info.org || cur[k - 1].info.gap || cur[k - 1].info.closing)) k--;
        // 名前のない項目（店など）に切り替わるときは、直前の見出しらしい1行も持っていく
        if (why === 'body' && k === cur.length && k > st.lastAnchor + 1 && cur[k - 1].info.title) k--;
        while (k < cur.length && cur[k].info.gap) k++;
        const moved = cur.slice(k).filter((it) => !it.info.sep);
        flush(cur.slice(0, k));
        cur = moved;
      }
      cur.push({ line, info, no });
    }
    flush(cur);
    return out;
  }

  // 上の人の続きと分かる行（住所・郵便番号・電話・メール・URL・住所の種類の見出し・口座・※★のメモ）
  function isContinuation(line, next) {
    let t = line.normalize('NFKC').trim();
    if (isDecoration(t) && next != null) return isContinuation(next);
    if (ADDR_LABEL_RE.test(line) || BANK_RE.test(t) || /^[※★☆＊*◉・<＜(（【\[#]/.test(t) || /支店/.test(t)) return true;
    if (/^〒?\s*\d{3}-?\d{4}$/.test(t)) return true;
    const f = lineInfo(line);
    return !!f.body && !f.name;
  }

  // 空行で区切る。ただし空行1行だけで区切られた、名前を含まない部分（住所・電話・口座・メモだけ）は
  // 上の人の続きとしてつなげる。名前を含む部分や、空行2行以上の後は別の人
  function splitBlank(t) {
    const blocks = [];
    let cur = [], gap = 0;
    for (const line of t.split('\n')) {
      if (!line.trim()) { if (cur.length) { blocks.push({ lines: cur, gapBefore: blocks.pendingGap ?? 99 }); cur = []; blocks.pendingGap = 0; } gap++; blocks.pendingGap = gap; continue; }
      if (!cur.length) { blocks.pendingGap = gap; }
      gap = 0;
      cur.push(line);
    }
    if (cur.length) blocks.push({ lines: cur, gapBefore: blocks.pendingGap ?? 99 });
    const out = [];
    for (const b of blocks) {
      // 新しい名前があるか（口座名義と、上の件にすでに出ている名前は数えない）
      let bank = false;
      const prev = out.length ? normalize(out[out.length - 1]) : '';
      const hasName = b.lines.some((l) => {
        const t = l.normalize('NFKC').trim();
        if (isDecoration(t)) { bank = false; return false; }
        if (bank || (BANK_RE.test(t) && !/@/.test(t))) { bank = true; return false; }
        if (!lineInfo(l).name) return false;
        const nm = analyze(l).name;
        return !(prev && nm && prev.includes(normalize(nm)));
      });
      if (out.length && b.gapBefore === 1 && !hasName && isContinuation(b.lines[0], b.lines.find((l) => !isDecoration(l.normalize('NFKC').trim())))) out[out.length - 1] += '\n\n' + b.lines.join('\n');
      else out.push(b.lines.join('\n'));
    }
    return out;
  }

  // 取り込み前の確認用。混ざっていそうな件・前の人の続きらしい件に印を付ける
  function entryWarnings(text) {
    const a = analyze(text);
    const w = [...a.warnings];
    if (!a.name && !a.company) w.push('名前なし（前の人の続き？）');
    return w;
  }

  function splitEntries(text, mode = 'auto') {
    const t = String(text || '').replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
      .split('\n').map((l) => (KANA_HEAD_RE.test(l) ? '' : l)).join('\n');
    // 既定は空行だけで区切る（空行が別の人に変わる目印。それ以外では区切らない）
    if (mode === 'auto') mode = looksCsv(t) ? 'csv' : 'blank';
    let entries;
    if (mode === 'csv') entries = csvToTexts(t);
    else if (mode === 'smart') entries = splitSmart(t);
    else if (mode === 'blank') entries = splitBlank(t);
    else if (mode === 'sep') entries = t.split('\n').reduce((acc, l) => { if (SEP_LINE.test(l)) acc.push(''); else acc[acc.length - 1] += l + '\n'; return acc; }, ['']);
    else entries = t.split('\n');
    // 罫線だけ・記号だけの件は捨てる
    return { mode, entries: entries.map((e) => e.replace(/^\n+|\s+$/g, '')).filter((e) => /[\p{L}\p{N}]{2,}/u.test(e)) };
  }

  function parseCsvRows(text) {
    const delim = (text.split('\n', 1)[0].match(/\t/g) || []).length > (text.split('\n', 1)[0].match(/,/g) || []).length ? '\t' : ',';
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((v) => v.trim()));
  }

  // CSVの1行を「見出し: 値」のテキストにする（原文として保存し、解析は共通の仕組みで行う）
  function csvToTexts(text) {
    const rows = parseCsvRows(text);
    if (rows.length < 2) return [];
    const head = rows[0].map((h) => h.trim());
    const textCol = head.findIndex((h) => ['元のテキスト', '原文'].includes(h));
    return rows.slice(1).map((r) => {
      if (textCol >= 0 && r[textCol]) return r[textCol];
      return head.map((h, i) => (r[i] && r[i].trim() ? `${h}: ${r[i].trim()}` : '')).filter(Boolean).join('\n');
    });
  }

  function toCsv(records, index) {
    const esc = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ['名前', '別名', 'ふりがな', '会社', '部署・役職', '郵便番号', '住所', '電話', '携帯', 'FAX', 'メール', 'タグ', '元のテキスト'];
    const rows = records.map((rec) => {
      const a = index.get(rec.id);
      const ph = (k) => a.phones.filter((p) => p.kind === k).map((p) => p.number).join(' / ');
      return [a.name, (a.names || []).slice(1).map((x) => (x.kind ? `${x.kind}:` : '') + x.name).join(' / '), a.kana, a.company, a.dept, (a.addresses || []).map((x) => x.zip).join(' / '), (a.addresses || []).map((x) => x.address).join(' / '), ph('tel'), ph('mobile'), ph('fax'), a.emails.join(' / '), a.tags.join(', '), rec.text].map(esc).join(',');
    });
    return [head.join(','), ...rows].join('\r\n') + '\r\n';
  }

  const api = { normalize, digits, analyze, needsCheck, atena, splitAddress, parseQuery, search, splitEntries, splitSmart, splitSmartRanges, entryWarnings, isPersonName, csvToTexts, toCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
