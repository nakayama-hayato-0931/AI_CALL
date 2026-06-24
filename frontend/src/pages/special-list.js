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

function SortableRow({ row, onClick, displayIndex }) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid grid-cols-[40px_48px_2fr_1.4fr_1.2fr_1.2fr_1.4fr_1.6fr] gap-2 items-center px-2 py-2 border-b border-gray-100 bg-white hover:bg-gray-50 transition-colors ${isDragging ? 'shadow-lg ring-1 ring-blue-200' : ''}`}
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

  // 並び替え後 → PUT /reorder
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

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIndex = prev.findIndex((it) => it.company_id === active.id);
      const newIndex = prev.findIndex((it) => it.company_id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      // sort_order をフロント側でも振り直して表示と同期
      const baseSortOrder = (page - 1) * PAGE_SIZE + 1;
      const reindexed = next.map((it, idx) => ({ ...it, sort_order: baseSortOrder + idx }));
      // 永続化は次の tick で
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
              ドラッグ&ドロップで並び順を変更できます (1 ページ {PAGE_SIZE} 件、 ページをまたいだ並び替えは不可)
            </p>
          </div>
          <div className="text-xs text-gray-500">
            {saving && <span className="text-blue-600 mr-3">保存中...</span>}
            合計 <span className="font-semibold text-gray-900">{total}</span> 件
          </div>
        </div>

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
          <div className="grid grid-cols-[40px_48px_2fr_1.4fr_1.2fr_1.2fr_1.4fr_1.6fr] gap-2 items-center px-2 py-2 border-b border-gray-200 bg-gray-50 text-[11px] font-semibold text-gray-600">
            <div></div>
            <div className="text-right pr-1">#</div>
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
