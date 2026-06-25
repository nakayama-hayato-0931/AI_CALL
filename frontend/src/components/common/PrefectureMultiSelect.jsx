/**
 * PrefectureMultiSelect
 * 都道府県を地方ごとにグルーピングして複数選択できる popover UI。
 * - 地域名クリック: 配下の都道府県を全選択/全解除 (indeterminate 表示)
 * - 都道府県名クリック: 個別 toggle
 * - 0 件 or 47 件すべて選択時は「すべて」、 1〜46 件選択中は「N件選択」とヘッダ表示
 * - ボタンを押すと popover が開閉。 外側クリックで閉じる。
 *
 * Props:
 *   value:    string[]                — 現在選択中の都道府県名 (フル名: "東京都" / "北海道")
 *   onChange: (next: string[]) => void
 *   label?:   string                  — ボタン左に出すラベル (例: "都道府県")
 *   className?: string                — 外側 wrapper の追加クラス
 */
import { useEffect, useRef, useState } from 'react';

// 都道府県の地方グループ (companies.js と揃える)
export const REGION_GROUPS = [
  { name: '北海道', prefs: ['北海道'] },
  { name: '東北', prefs: ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'] },
  { name: '関東', prefs: ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'] },
  { name: '中部', prefs: ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県'] },
  { name: '近畿', prefs: ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'] },
  { name: '中国', prefs: ['鳥取県', '島根県', '岡山県', '広島県', '山口県'] },
  { name: '四国', prefs: ['徳島県', '香川県', '愛媛県', '高知県'] },
  { name: '九州', prefs: ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'] },
];

export const ALL_PREFECTURES = REGION_GROUPS.flatMap(g => g.prefs);

export default function PrefectureMultiSelect({ value, onChange, label = '都道府県', className = '' }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  // 値正規化 (null/undefined → [])
  const selected = Array.isArray(value) ? value : [];
  const selectedSet = new Set(selected);

  // 全選択判定: 0 件 or 47 件すべて選択 → 「すべて」
  const isAll = selected.length === 0 || selected.length === ALL_PREFECTURES.length;
  const headerLabel = isAll
    ? `${label} (すべて)`
    : `${label} (${selected.length}件選択)`;

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const togglePrefecture = (pref) => {
    const next = new Set(selected);
    if (next.has(pref)) next.delete(pref);
    else next.add(pref);
    // 47 件すべて選択された場合は「全国 (= 空配列)」扱いにする方が後段の SQL に優しい。
    // ただし呼び出し側で長さ判定したい場合もあるので、ここでは正直に 47 件返す。
    onChange(Array.from(next));
  };

  const toggleRegion = (group) => {
    const groupSelected = group.prefs.filter(p => selectedSet.has(p)).length;
    const allOn = groupSelected === group.prefs.length;
    const next = new Set(selected);
    if (allOn) {
      group.prefs.forEach(p => next.delete(p));
    } else {
      group.prefs.forEach(p => next.add(p));
    }
    onChange(Array.from(next));
  };

  const clearAll = () => onChange([]);
  const selectAll = () => onChange([...ALL_PREFECTURES]);

  return (
    <div ref={wrapperRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`border rounded px-2 py-1 text-sm bg-white hover:bg-gray-50 flex items-center gap-1 ${
          isAll ? 'border-gray-300 text-gray-700' : 'border-blue-400 text-blue-700 font-medium'
        }`}
      >
        <span>{headerLabel}</span>
        <span className="text-xs text-gray-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-[480px] max-w-[90vw] bg-white border border-gray-200 rounded-lg shadow-lg p-3"
          style={{ left: 0 }}
        >
          {/* ヘッダ: 一括操作 */}
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
            <div className="text-xs text-gray-600">
              {isAll
                ? <span className="font-semibold">全国 (すべて)</span>
                : <span className="font-semibold text-blue-700">{selected.length}件選択中</span>}
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={selectAll}
                className="text-[11px] px-2 py-0.5 rounded border border-gray-200 hover:bg-gray-50">
                全選択
              </button>
              <button type="button" onClick={clearAll}
                className="text-[11px] px-2 py-0.5 rounded border border-gray-200 hover:bg-gray-50">
                クリア
              </button>
              <button type="button" onClick={() => setOpen(false)}
                className="text-[11px] px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700">
                閉じる
              </button>
            </div>
          </div>

          {/* 地方グループ */}
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {REGION_GROUPS.map(group => {
              const groupSelected = group.prefs.filter(p => selectedSet.has(p)).length;
              const allOn = groupSelected === group.prefs.length;
              const someOn = groupSelected > 0 && groupSelected < group.prefs.length;
              return (
                <div key={group.name} className="border border-gray-100 rounded p-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <button
                      type="button"
                      onClick={() => toggleRegion(group)}
                      className={`flex items-center gap-1.5 text-xs font-semibold px-1.5 py-0.5 rounded transition-colors ${
                        allOn ? 'bg-blue-100 text-blue-800'
                        : someOn ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={allOn}
                        ref={el => { if (el) el.indeterminate = someOn; }}
                        onChange={() => toggleRegion(group)}
                        className="w-3.5 h-3.5 accent-blue-600 cursor-pointer pointer-events-none"
                      />
                      {group.name}
                    </button>
                    <span className="text-[10px] text-gray-400">
                      {groupSelected}/{group.prefs.length}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 pl-1">
                    {group.prefs.map(p => {
                      const on = selectedSet.has(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => togglePrefecture(p)}
                          className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${
                            on
                              ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
