/**
 * /special-list - 特別リスト独立ページ
 *
 * 2026-06-24 特別リスト再設計:
 *   - 1 ページ 100 件のページネーション (800 件想定)
 *   - 1 ページ内で D&D 並び替え (@dnd-kit/sortable)
 *   - operator/sales: 自分固定
 *   - admin/manager/consultant: ユーザー選択ドロップダウンで他人の sort_order も操作可能
 *   - 並べ替え後は自動 PUT /reorder で永続化
 *   - 業種/地域フィルタ
 *   - 行クリックで案件モーダル (関連案件があれば) または企業詳細
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import Layout from '../components/common/Layout';
import useAuth from '../hooks/useAuth';
import api from '../utils/api';
import toast from 'react-hot-toast';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const PRIVILEGED_ROLES = ['admin', 'manager', 'consultant'];
const PAGE_SIZE = 100;

const RESULT_LABEL = {
  NO_ANSWER: '不通',
  NG: 'NG',
  RECALL: 'リコール',
  INTERESTED: '興味あり',
  PROJECT: '案件化',
  SKIP: 'スキップ',
};
const RESULT_BADGE = {
  NO_ANSWER: 'bg-gray-100 text-gray-700',
  NG: 'bg-red-100 text-red-700',
  RECALL: 'bg-amber-100 text-amber-800',
  INTERESTED: 'bg-emerald-100 text-emerald-800',
  PROJECT: 'bg-blue-100 text-blue-800',
  SKIP: 'bg-slate-100 text-slate-700',
};

// 優先度バッジのスタイル (A=赤、 B=黄、 C=青、 D=灰)。
const PRIORITY_BADGE = {
  A: 'bg-red-100 text-red-700 border-red-200',
  B: 'bg-amber-100 text-amber-800 border-amber-200',
  C: 'bg-blue-100 text-blue-700 border-blue-200',
  D: 'bg-gray-100 text-gray-600 border-gray-200',
};
// 統計カード用の色 (priority と同系統だが、 カード全体の枠+背景+プログレスバー色も合わせる)。
const PRIORITY_CARD = {
  A: { border: 'border-red-200', bg: 'bg-red-50', label: 'text-red-700', bar: 'bg-red-500' },
  B: { border: 'border-amber-200', bg: 'bg-amber-50', label: 'text-amber-800', bar: 'bg-amber-500' },
  C: { border: 'border-blue-200', bg: 'bg-blue-50', label: 'text-blue-700', bar: 'bg-blue-500' },
  D: { border: 'border-gray-200', bg: 'bg-gray-50', label: 'text-gray-700', bar: 'bg-gray-500' },
};
const PRIORITIES = ['A', 'B', 'C', 'D'];

/** 統計カード 1 枠。 全体 (label='全体') と A/B/C/D 共通で使う。 */
function StatCard({ label, total, called, completionRate, tone }) {
  // tone: 'total' (全体) | 'A' | 'B' | 'C' | 'D'
  const palette = tone === 'total'
    ? { border: 'border-slate-300', bg: 'bg-white', label: 'text-slate-700', bar: 'bg-slate-700' }
    : PRIORITY_CARD[tone] || PRIORITY_CARD.C;
  const rate = Number.isFinite(completionRate) ? completionRate : 0;
  const barWidth = Math.min(100, Math.max(0, rate));
  return (
    <div className={`border ${palette.border} ${palette.bg} rounded-lg p-3`}>
      <div className={`text-[11px] font-semibold ${palette.label} mb-1`}>{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-bold text-gray-900">{called}</span>
        <span className="text-xs text-gray-500">/ {total}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className={`h-full ${palette.bar} transition-all`} style={{ width: `${barWidth}%` }} />
        </div>
        <span className="text-[11px] font-mono text-gray-700 w-12 text-right">{rate.toFixed(1)}%</span>
      </div>
    </div>
  );
}

const fmtDateTime = (s) => {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/* 並べ替えハンドル SVG */
const GripIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-gray-400">
    <circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" />
  </svg>
);

function SortableRow({ row, onClick, displayIndex, onChangePriority }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.company_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 'auto',
  };

  const priority = row.priority || 'C';
  const badgeStyle = PRIORITY_BADGE[priority] || PRIORITY_BADGE.C;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid grid-cols-[40px_48px_64px_2fr_1.4fr_1.2fr_1.2fr_1.4fr_1.6fr] gap-2 items-center px-2 py-2 border-b border-gray-100 bg-white hover:bg-gray-50 transition-colors ${isDragging ? 'shadow-lg ring-1 ring-blue-200' : ''}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 hover:bg-gray-100 rounded touch-none"
        title="ドラッグで並び替え"
        aria-label="ドラッグハンドル"
      >
        <GripIcon />
      </button>
      <div className="text-xs text-gray-400 font-mono text-right pr-1">{displayIndex}</div>
      <div>
        {/* 優先度バッジ兼 セレクト。 クリックでドロップダウン → 行単位で priority を変更。 */}
        <select
          value={priority}
          onChange={(e) => onChangePriority && onChangePriority(row.company_id, e.target.value)}
          className={`text-xs font-bold rounded border px-1.5 py-0.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-300 ${badgeStyle}`}
          title="優先度を変更"
          aria-label="優先度"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
      <div className="min-w-0 cursor-pointer" onClick={onClick}>
        <div className="text-sm font-medium text-gray-900 truncate">{row.company_name || '-'}</div>
        {row.region && <div className="text-[10px] text-gray-400 truncate">{row.region}</div>}
      </div>
      <div className="text-xs text-gray-600 font-mono truncate">{row.phone_number || '-'}</div>
      <div className="text-xs text-gray-600 truncate">
        {row.industry || '-'}
        {row.industry_category && row.industry_category !== 'その他' && (
          <span className="ml-1 text-[10px] px-1 py-0 rounded bg-gray-100 text-gray-600">{row.industry_category}</span>
        )}
      </div>
      <div>
        {row.last_result ? (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${RESULT_BADGE[row.last_result] || 'bg-gray-100 text-gray-600'}`}>
            {RESULT_LABEL[row.last_result] || row.last_result}
          </span>
        ) : (
          <span className="text-[10px] text-gray-300">未架電</span>
        )}
      </div>
      <div className="text-[11px] text-gray-500">{fmtDateTime(row.last_called_at)}</div>
      <div className="text-[11px] text-gray-500 truncate" title={row.last_memo || ''}>{row.last_memo || '-'}</div>
    </div>
  );
}

export default function SpecialListPage() {
  const { user } = useAuth();
  const role = user?.role;
  const isPrivileged = role && PRIVILEGED_ROLES.includes(role);

  const [targetUserId, setTargetUserId] = useState(null);
  const [userOptions, setUserOptions] = useState([]);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [industryFilter, setIndustryFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  // 統計 (バックエンド集計、 全ページ通しの値。 フィルタ無関係)
  const [stats, setStats] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // 初期化: 自分の id を default に
  useEffect(() => {
    if (user?.id && targetUserId === null) {
      setTargetUserId(user.id);
    }
  }, [user, targetUserId]);

  // 管理者: ユーザー候補をロード
  useEffect(() => {
    if (!isPrivileged) return;
    api.get('/api/companies/special-list/users')
      .then(res => {
        if (res.data.success) setUserOptions(res.data.data || []);
      })
      .catch(() => { /* silent */ });
  }, [isPrivileged]);

  const loadList = useCallback(async () => {
    if (!targetUserId) return;
    setLoading(true);
    try {
      const params = { user_id: targetUserId, page, limit: PAGE_SIZE };
      const { data } = await api.get('/api/companies/special-list', { params });
      if (data.success) {
        setItems(data.data.items || []);
        setTotal(data.data.total || 0);
        setTotalPages(data.data.totalPages || 1);
        setStats(data.data.stats || null);
      }
    } catch (err) {
      toast.error('特別リストの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [targetUserId, page]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // 並び替え後 → PUT /reorder。 priority も含めて送る (D&D 移動で priority が変わる可能性があるため)。
  const persistOrder = useCallback(async (orderedItems) => {
    if (!targetUserId || orderedItems.length === 0) return;
    setSaving(true);
    try {
      // 現在ページの先頭 sort_order をベースに、 連番で振り直す。
      const baseSortOrder = (page - 1) * PAGE_SIZE + 1;
      const payload = {
        user_id: targetUserId,
        items: orderedItems.map((it, idx) => ({
          company_id: it.company_id,
          sort_order: baseSortOrder + idx,
          priority: it.priority || 'C',
        })),
      };
      await api.put('/api/companies/special-list/reorder', payload);
      toast.success('並び順を保存しました');
    } catch (err) {
      toast.error('並び順の保存に失敗しました');
      // 失敗時は再取得して整合性回復
      loadList();
    } finally {
      setSaving(false);
    }
  }, [targetUserId, page, loadList]);

  // D&D 移動で別の priority グループに入った場合、 ドロップ先の priority を引き継ぐ。
  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIndex = prev.findIndex((it) => it.company_id === active.id);
      const newIndex = prev.findIndex((it) => it.company_id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      // ドロップ先 (over) の priority を取得して、 移動アイテムにも適用する。
      const targetPriority = prev[newIndex]?.priority || 'C';
      const moved = { ...prev[oldIndex], priority: targetPriority };
      const without = prev.filter((_, i) => i !== oldIndex);
      // newIndex は oldIndex 削除前のインデックスなので、 削除後は newIndex を補正する必要あり
      const adjustedIndex = oldIndex < newIndex ? newIndex - 1 : newIndex;
      const next = [
        ...without.slice(0, adjustedIndex),
        moved,
        ...without.slice(adjustedIndex),
      ];
      // priority -> sort_order の順で整合性を保ち、 sort_order をフロント側で振り直す
      // (実際の並び順は priority ASC, sort_order ASC で決まるため、 単純連番でよい)
      const baseSortOrder = (page - 1) * PAGE_SIZE + 1;
      const reindexed = next.map((it, idx) => ({ ...it, sort_order: baseSortOrder + idx }));
      // 永続化は次の tick で
      persistOrder(reindexed);
      return reindexed;
    });
  }, [page, persistOrder]);

  // 行単位の priority 変更 (ドロップダウンで A/B/C/D を選択)。
  const handleChangePriority = useCallback((companyId, newPriority) => {
    if (!PRIORITIES.includes(newPriority)) return;
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.company_id === companyId);
      if (idx < 0) return prev;
      if (prev[idx].priority === newPriority) return prev;
      // priority だけ更新し、 priority + sort_order でソートし直す
      const updated = [...prev];
      updated[idx] = { ...updated[idx], priority: newPriority };
      // priority 昇順 → sort_order 昇順 で並び替え
      updated.sort((a, b) => {
        const ap = a.priority || 'C';
        const bp = b.priority || 'C';
        if (ap !== bp) return ap < bp ? -1 : 1;
        return (a.sort_order || 0) - (b.sort_order || 0);
      });
      const baseSortOrder = (page - 1) * PAGE_SIZE + 1;
      const reindexed = updated.map((it, i) => ({ ...it, sort_order: baseSortOrder + i }));
      persistOrder(reindexed);
      return reindexed;
    });
  }, [page, persistOrder]);

  // フィルタ (クライアント側、 1 ページ内)
  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (industryFilter && !(it.industry || '').includes(industryFilter)
          && (it.industry_category || '') !== industryFilter) return false;
      if (regionFilter && !(it.region || '').includes(regionFilter)
          && !(it.address || '').includes(regionFilter)) return false;
      if (resultFilter) {
        if (resultFilter === 'UNTOUCHED') {
          if (it.last_result) return false;
        } else if ((it.last_result || '') !== resultFilter) return false;
      }
      return true;
    });
  }, [items, industryFilter, regionFilter, resultFilter]);

  const distinctIndustries = useMemo(() => {
    const s = new Set();
    items.forEach((it) => { if (it.industry) s.add(it.industry); });
    return Array.from(s).sort();
  }, [items]);

  const distinctRegions = useMemo(() => {
    const s = new Set();
    items.forEach((it) => { if (it.region) s.add(it.region); });
    return Array.from(s).sort();
  }, [items]);

  const handleRowClick = (row) => {
    // 案件モーダルは案件 ID がないと開けない。
    // 行クリックでは Google 検索で社名を引く軽量挙動に留める (顧客マスタは別ページ)。
    if (!row.company_name) return;
    const query = encodeURIComponent(`${row.company_name} ${row.phone_number || ''}`);
    window.open(`https://www.google.com/search?q=${query}`, '_blank');
  };

  if (!user) return null;

  return (
    <Layout wide>
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">特別リスト</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              ドラッグ&ドロップで並び順を変更できます (1 ページ {PAGE_SIZE} 件、 ページをまたいだ並び替えは不可)。
              優先度は A→B→C→D の順、 別グループに移動すると優先度が自動更新されます。
            </p>
          </div>
          <div className="text-xs text-gray-500">
            {saving && <span className="text-blue-600 mr-3">保存中...</span>}
            合計 <span className="font-semibold text-gray-900">{total}</span> 件
          </div>
        </div>

        {/* 統計カード (全体 + A/B/C/D)。 stats は全ページ通しの集計でフィルタ無関係。 */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard
              label="全体"
              tone="total"
              total={stats.total || 0}
              called={stats.called || 0}
              completionRate={stats.completion_rate || 0}
            />
            {PRIORITIES.map((p) => {
              const s = stats.by_priority?.[p] || { total: 0, called: 0, completion_rate: 0 };
              return (
                <StatCard
                  key={p}
                  label={`優先度 ${p}`}
                  tone={p}
                  total={s.total || 0}
                  called={s.called || 0}
                  completionRate={s.completion_rate || 0}
                />
              );
            })}
          </div>
        )}

        {/* フィルタ + ユーザー選択 */}
        <div className="card p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {isPrivileged && (
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">対象ユーザー</label>
                <select
                  value={targetUserId || ''}
                  onChange={(e) => { setTargetUserId(Number(e.target.value)); setPage(1); }}
                  className="input text-xs w-full"
                >
                  {user?.id && !userOptions.some(u => u.id === user.id) && (
                    <option value={user.id}>{user.name} (自分)</option>
                  )}
                  {userOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role}) {u.assignment_count > 0 ? `- ${u.assignment_count}件` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">業種</label>
              <select
                value={industryFilter}
                onChange={(e) => setIndustryFilter(e.target.value)}
                className="input text-xs w-full"
              >
                <option value="">全て</option>
                {distinctIndustries.map((ind) => (
                  <option key={ind} value={ind}>{ind}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">地域</label>
              <select
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                className="input text-xs w-full"
              >
                <option value="">全て</option>
                {distinctRegions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">最終架電結果</label>
              <select
                value={resultFilter}
                onChange={(e) => setResultFilter(e.target.value)}
                className="input text-xs w-full"
              >
                <option value="">全て</option>
                <option value="UNTOUCHED">未架電</option>
                <option value="NO_ANSWER">不通</option>
                <option value="NG">NG</option>
                <option value="RECALL">リコール</option>
                <option value="INTERESTED">興味あり</option>
                <option value="PROJECT">案件化</option>
                <option value="SKIP">スキップ</option>
              </select>
            </div>
          </div>
        </div>

        {/* リスト本体 */}
        <div className="card overflow-hidden">
          {/* ヘッダ */}
          <div className="grid grid-cols-[40px_48px_64px_2fr_1.4fr_1.2fr_1.2fr_1.4fr_1.6fr] gap-2 items-center px-2 py-2 border-b border-gray-200 bg-gray-50 text-[11px] font-semibold text-gray-600">
            <div></div>
            <div className="text-right pr-1">#</div>
            <div>優先度</div>
            <div>企業名</div>
            <div>電話番号</div>
            <div>業種</div>
            <div>最終結果</div>
            <div>最終架電日時</div>
            <div>メモ抜粋</div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">読み込み中...</div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              {items.length === 0 ? '特別リストに企業がありません' : 'フィルタ条件に一致する企業がありません'}
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={filteredItems.map(it => it.company_id)} strategy={verticalListSortingStrategy}>
                {filteredItems.map((row) => {
                  const indexInItems = items.findIndex(it => it.company_id === row.company_id);
                  const displayIndex = (page - 1) * PAGE_SIZE + indexInItems + 1;
                  return (
                    <SortableRow
                      key={row.company_id}
                      row={row}
                      displayIndex={displayIndex}
                      onClick={() => handleRowClick(row)}
                      onChangePriority={handleChangePriority}
                    />
                  );
                })}
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* ページネーション */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 py-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >前へ</button>
            <span className="text-xs text-gray-600">
              {page} / {totalPages} ページ
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >次へ</button>
            {/* ジャンプ */}
            <select
              value={page}
              onChange={(e) => setPage(Number(e.target.value))}
              className="input text-xs"
            >
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <option key={p} value={p}>{p} ページ目</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </Layout>
  );
}
