// データファイルの中身の確認と、別のPCでの変更との合わせ方（Electron版・Tauri版で共通）
(function (root) {
  function parse(text) {
    const j = JSON.parse(text);
    if (!j || !Array.isArray(j.records)) throw new Error('住所録のデータファイルではありません（records がありません）');
    return j;
  }

  // 3者の突き合わせ。base: 前回読み書きした時点の { id → updated }、mine: このアプリの今の全件、
  // theirs: ファイルの今の全件（別のPCでの変更が入っている）、deleted: このアプリで前回から削除した id
  //  - 追加はどちらの分も残す
  //  - 削除は、相手が手を入れていなければ反映する
  //  - 同じ件を両方で直していたら、更新日時の新しいほう
  function merge(base, mine, theirs, deleted = new Set()) {
    const out = new Map();
    const M = new Map(mine.map((r) => [r.id, r]));
    const T = new Map(theirs.map((r) => [r.id, r]));
    for (const t of theirs) {
      const theyChanged = !base.has(t.id) || base.get(t.id) !== t.updated;
      if (deleted.has(t.id) && !theyChanged) continue;
      const m = M.get(t.id);
      out.set(t.id, m && String(m.updated) > String(t.updated) ? m : t);
    }
    for (const m of mine) {
      if (T.has(m.id)) continue;
      const weChanged = !base.has(m.id) || base.get(m.id) !== m.updated;
      if (weChanged) out.set(m.id, m); // 自分が足した・直した件。相手が消していても残す
    }
    return [...out.values()];
  }

  const api = { parse, merge };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StoreCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
