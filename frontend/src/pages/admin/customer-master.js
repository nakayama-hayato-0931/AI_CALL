/**
 * 顧客マスタ
 * - callcenter の companies と FAX CRM の contact_events を統合表示
 * - フィルタ（結果/期間/オペレーター/業種）対応
 * - 架電 + 手動アクション + FAX を時系列タイムラインで表示
 * - fax-crm との双方向同期（callcenter→fax-crm push / fax-crm→callcenter pull）
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const fmtDate = (s) => {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
};
const fmtDateTime = (s) => {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `${fmtDate(s)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

const RESULT_LABEL = {
  NO_ANSWER: '不通', NG: 'NG', RECALL: 'リコール', INTERESTED: '興味あり', PROJECT: '案件化', SKIP: 'SKIP',
};
const RESULT_OPTIONS = ['NO_ANSWER', 'NG', 'RECALL', 'INTERESTED', 'PROJECT', 'SKIP'];

const KIND_BADGE = {
  call: { label: '架電', cls: 'bg-blue-100 text-blue-800' },
  manual: { label: '手動', cls: 'bg-purple-100 text-purple-800' },
  fax: { label: 'FAX', cls: 'bg-orange-100 text-orange-800' },
};

// 案件ステータス表示ラベル
const PROJECT_STATUS_LABEL = {
  NEW: '新規', MAIL_SENT: 'メール送信済', INTERVIEW_SET: '面接設定', MENSETSU_KAKUTEI: '面接確定',
  INTERVIEW_DONE: '面接済', WAITING_RESULT: '結果待ち', KEKKA_MACHI: '結果待ち',
  NAITEI: '内定', NAITEI_TORIKESHI: '内定取消', FUGOKAKU: '不合格',
  HIRED: '採用', LOST: '失注', BARASHI: 'バラシ', HORYU: '保留',
  BOSHUCHU: '募集中', SHORUI_CHU: '書類選考中', SHORUI_OCHI: '書類落ち',
  KISON_NASHI: '既存なし', MODOSHI: '戻し', MODORI: '戻り',
};
const INTERVIEW_TYPE_LABEL = {
  online: 'オンライン', in_person: '対面', offline: '対面', phone: '電話', web: 'Web',
};
const DOC_SCREENING_LABEL = {
  not_required: 'なし', required: 'あり', passed: '通過', failed: '不通過', pending: '選考中',
};

export default function CustomerMasterPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState({
    search: '', result: '', user_id: '', industry: '', date_from: '', date_to: '', show_excluded: '',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [faxCrmEnabled, setFaxCrmEnabled] = useState(false);
  const [operators, setOperators] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [editingFax, setEditingFax] = useState(false);
  const [faxInput, setFaxInput] = useState('');
  const [savingFax, setSavingFax] = useState(false);
  const [expandedTranscripts, setExpandedTranscripts] = useState({}); // { [timeline_idx]: true }

  useEffect(() => {
    if (user && !['admin', 'manager', 'consultant'].includes(user.role)) {
      router.push('/');
      return;
    }
    if (user) {
      fetchList();
      fetchOperators();
    }
  }, [user, filters, page, pageSize]);

  // フィルタが変わったら 1 ページ目に戻す
  useEffect(() => { setPage(1); }, [filters, pageSize]);

  // ?id= クエリがあれば自動的に詳細を開く (業種別分析等からの遷移用)
  useEffect(() => {
    if (!router.isReady) return;
    const qid = router.query.id;
    if (qid && Number(qid) && Number(qid) !== selectedId) {
      openDetail(Number(qid));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.id]);

  const fetchOperators = async () => {
    try {
      const { data } = await api.get('/api/admin/users');
      if (data.success) {
        const users = data.data?.users || data.data || [];
        setOperators(users.filter(u => u.role === 'operator'));
      }
    } catch (_e) { /* ignore */ }
  };

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) params.append(k, v); });
      params.append('page', String(page));
      params.append('limit', String(pageSize));
      const { data } = await api.get(`/api/admin/customer-master?${params}`);
      if (data.success) {
        setList(data.data.customers || []);
        setFaxCrmEnabled(!!data.data.faxCrmEnabled);
        setTotal(data.data.total || 0);
        setTotalPages(data.data.totalPages || 1);
      }
    } catch (err) {
      toast.error('顧客一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (id) => {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    setEditingFax(false);
    try {
      const { data } = await api.get(`/api/admin/customer-master/${id}`);
      if (data.success) setDetail(data.data);
    } catch (err) {
      toast.error('詳細の取得に失敗しました');
    } finally {
      setDetailLoading(false);
    }
  };

  const canEdit = user && ['admin', 'manager', 'editor'].includes(user.role);

  const addToNgList = async () => {
    if (!selectedId || !detail) return;
    if (typeof window === 'undefined') return;
    const reason = window.prompt(
      `「${detail.company.company_name}」を NG リストに追加します。\n理由（任意。後で見直し可能）:`,
      ''
    );
    // prompt returns null when cancelled
    if (reason === null) return;
    try {
      const { data } = await api.patch(`/api/admin/customer-master/${selectedId}`, {
        exclusion_flag: 1,
        exclusion_reason: reason || null,
      });
      if (data.success) {
        toast.success('NGリストに追加しました');
        openDetail(selectedId);
        fetchList();
      } else {
        toast.error(data.message || '更新失敗');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'NGリスト追加に失敗しました');
    }
  };

  const removeFromNgList = async () => {
    if (!selectedId || !detail) return;
    if (typeof window !== 'undefined' && !window.confirm(`「${detail.company.company_name}」を NG リストから外しますか？`)) return;
    try {
      const { data } = await api.patch(`/api/admin/customer-master/${selectedId}`, {
        exclusion_flag: 0,
        exclusion_reason: null,
      });
      if (data.success) {
        toast.success('NGリストから外しました');
        openDetail(selectedId);
        fetchList();
      } else {
        toast.error(data.message || '更新失敗');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || '更新に失敗しました');
    }
  };

  const saveFax = async () => {
    if (!selectedId) return;
    setSavingFax(true);
    try {
      const { data } = await api.patch(`/api/admin/customer-master/${selectedId}`, { fax_number: faxInput });
      if (data.success) {
        toast.success('FAX番号を更新しました');
        setEditingFax(false);
        openDetail(selectedId);
        fetchList();
      } else {
        toast.error(data.message || '更新失敗');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || '更新に失敗しました');
    } finally {
      setSavingFax(false);
    }
  };

  const importMissingFromFaxCrm = async () => {
    if (!faxCrmEnabled) { toast.error('FAX CRM 連携が無効です'); return; }
    if (typeof window !== 'undefined' && !window.confirm(
      'fax-crm に存在するが callcenter に未連携の顧客を一括取込します。\n' +
      '件数が多い場合は数十分〜数時間かかることがあります。\nよろしいですか？'
    )) return;
    setSyncing(true);
    const t = toast.loading('fax-crmから未連携顧客を取込中...');
    try {
      const { data } = await api.post(
        '/api/admin/customer-master/import-missing-from-faxcrm',
        {}, { timeout: 24 * 60 * 60 * 1000 }
      );
      toast.dismiss(t);
      if (data.success) {
        toast.success(data.message || '取込完了', { duration: 15000 });
        fetchList();
      } else {
        toast.error(data.message || '取込失敗');
      }
    } catch (err) {
      toast.dismiss(t);
      toast.error(err.response?.data?.message || '取込に失敗しました');
    } finally { setSyncing(false); }
  };

  const bulkSync = async (direction) => {
    if (!faxCrmEnabled) { toast.error('FAX CRM 連携が無効です'); return; }
    if (total === 0) { toast.error('対象の顧客がありません'); return; }
    const label = direction === 'push' ? 'callcenter → fax-crm 送信'
      : direction === 'pull' ? 'fax-crm → callcenter 取込'
      : '双方向同期';
    if (typeof window !== 'undefined' && !window.confirm(
      `現在のフィルタにマッチする 全${total} 社に対して「${label}」を実行します。\n` +
      `件数が多い場合は数分以上かかることがあります。\nよろしいですか？`
    )) return;
    setSyncing(true);
    const t = toast.loading(`一括同期 実行中... (全${total}社)`);
    try {
      // ids ではなく filters を送り、サーバ側で対象 ID を全件抽出
      const { data } = await api.post('/api/admin/customer-master/bulk-sync', {
        direction,
        apply_to_all: true,
        filters: {
          search: filters.search || undefined,
          result: filters.result || undefined,
          user_id: filters.user_id || undefined,
          industry: filters.industry || undefined,
          date_from: filters.date_from || undefined,
          date_to: filters.date_to || undefined,
          show_excluded: filters.show_excluded || undefined,
        },
      }, { timeout: 30 * 60 * 1000 }); // 30分タイムアウト
      toast.dismiss(t);
      if (data.success) {
        toast.success(data.message || '一括同期 完了');
        fetchList();
        if (selectedId) openDetail(selectedId);
      } else {
        toast.error(data.message || '一括同期 失敗');
      }
    } catch (err) {
      toast.dismiss(t);
      toast.error(err.response?.data?.message || '一括同期に失敗しました');
    } finally {
      setSyncing(false);
    }
  };

  if (!user) return null;
  if (!['admin', 'manager', 'consultant'].includes(user.role)) {
    return <Layout><div className="p-6">権限がありません</div></Layout>;
  }

  const applySearch = () => setFilters(f => ({ ...f, search: searchInput }));
  const updateFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const clearAll = () => {
    setSearchInput('');
    setFilters({ search: '', result: '', user_id: '', industry: '', date_from: '', date_to: '' });
  };

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold">顧客マスタ</h1>
            <p className="text-sm text-gray-500 mt-1">
              架電結果・NG理由・手動アクション・FAX CRM の履歴を統合して確認できます。
              {faxCrmEnabled
                ? <span className="ml-2 inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-xs">FAX CRM 連携 有効</span>
                : <span className="ml-2 inline-block px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">FAX CRM 連携 未設定</span>}
              <button
                onClick={async () => {
                  const cat = window.prompt('業種カテゴリを入力 (建設/飲食/製造/小売/宿泊/清掃/農業/介護):', '建設');
                  if (!cat) return;
                  try {
                    const { data } = await api.get(`/api/companies/diagnose/industry?category=${encodeURIComponent(cat)}`);
                    if (!data.success) { toast.error('業種診断失敗'); return; }
                    const d = data.data;
                    const c = d.counts;
                    const lines = [
                      `【業種診断: ${d.category}】`,
                      `検索キーワード: ${(d.keywords || []).join(', ')}`,
                      '',
                      `industry_category='${d.category}' の件数: ${c.by_industry_category?.toLocaleString?.()}`,
                      `industry テキストにキーワード含む全件: ${c.by_industry_keyword?.toLocaleString?.()}`,
                      `→ 分類漏れ (キーワード含むが category 不一致): ${c.miscategorized?.toLocaleString?.()}`,
                      '',
                      `▼ industry_category='${d.category}' の内訳:`,
                      `・未架電: ${c.untouched?.toLocaleString?.()}`,
                      `・永久除外状態 (SKIP/PROJECT/RECALL/INTERESTED): ${c.permanent_excluded?.toLocaleString?.()}`,
                      `・前回 NO_ANSWER: ${c.last_no_answer?.toLocaleString?.()}`,
                      `・前回 NG: ${c.last_ng?.toLocaleString?.()}`,
                    ];
                    if (d.miscategorized_samples && d.miscategorized_samples.length > 0) {
                      lines.push('');
                      lines.push(`▼ 分類漏れの実例 (上位${d.miscategorized_samples.length}件):`);
                      d.miscategorized_samples.forEach(s => {
                        lines.push(`・${s.company_name} (industry='${s.industry}', category='${s.industry_category || '未設定'}')`);
                      });
                    }
                    window.alert(lines.join('\n'));
                    // 分類漏れが多ければ再計算を提案
                    if (Number(c.miscategorized) > 100 && window.confirm(`分類漏れが${c.miscategorized.toLocaleString()}件あります。industry_category を全件再計算しますか?\n(まず dry-run で件数だけ試算します)`)) {
                      const dr = await api.post('/api/companies/diagnose/recompute-industry-category?dry_run=1');
                      const willChange = dr.data?.data?.will_change || 0;
                      if (window.confirm(`再計算により ${willChange.toLocaleString()} 件のレコードが更新されます。実行しますか?`)) {
                        const ex = await api.post('/api/companies/diagnose/recompute-industry-category');
                        toast.success(`${ex.data?.data?.updated?.toLocaleString?.() || 0} 件を再分類しました`, { duration: 6000 });
                      }
                    }
                  } catch (err) {
                    toast.error('業種診断失敗');
                  }
                }}
                className="ml-1 text-[11px] px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100"
                title="特定業種の件数・分類漏れを診断"
              >
                業種診断
              </button>
              <button
                onClick={async () => {
                  try {
                    const { data } = await api.get('/api/companies/diagnose/counts');
                    if (!data.success) { toast.error('件数取得失敗'); return; }
                    const c = data.data.counts;
                    const lines = [
                      '【companies テーブル 件数内訳】',
                      `全件: ${c.total?.toLocaleString?.() ?? c.total}`,
                      `├ 完全除外 (exclusion_flag=1): ${c.excluded?.toLocaleString?.() ?? c.excluded}`,
                      `├ 特別リスト (is_special=1): ${c.special?.toLocaleString?.() ?? c.special}`,
                      `├ 旧営業リスト (is_sales_list=1): ${c.sales_list?.toLocaleString?.() ?? c.sales_list}`,
                      '',
                      `顧客マスタ画面の表示対象 (exclusion_flag=0): ${c.customer_master_visible?.toLocaleString?.() ?? c.customer_master_visible}`,
                      `架電リスト管理の表示対象 (exclusion_flag=0 AND is_special=0 AND is_sales_list=0): ${c.call_list_admin?.toLocaleString?.() ?? c.call_list_admin}`,
                      '',
                      '▼ 架電リスト管理の表示対象 ' + (c.call_list_admin?.toLocaleString?.() ?? c.call_list_admin) + ' のうち:',
                      `・未架電: ${c.untouched?.toLocaleString?.() ?? c.untouched}`,
                      `・永久除外状態 (SKIP/PROJECT/RECALL/INTERESTED): ${c.permanent_excluded?.toLocaleString?.() ?? c.permanent_excluded}`,
                      `・前回 NO_ANSWER: ${c.last_no_answer?.toLocaleString?.() ?? c.last_no_answer}`,
                      `・前回 NG: ${c.last_ng?.toLocaleString?.() ?? c.last_ng}`,
                    ];
                    window.alert(lines.join('\n'));
                  } catch (err) {
                    toast.error('件数取得失敗');
                  }
                }}
                className="ml-2 text-[11px] px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100"
                title="顧客マスタと架電リストの件数差を確認"
              >
                件数内訳
              </button>
            </p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-1">
              <button onClick={() => bulkSync('push')} disabled={syncing || !faxCrmEnabled || total === 0}
                className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300"
                title="一覧の全社を callcenter → fax-crm に送信">
                一括 送信
              </button>
              <button onClick={() => bulkSync('pull')} disabled={syncing || !faxCrmEnabled || total === 0}
                className="text-xs px-2 py-1 rounded bg-orange-600 text-white hover:bg-orange-700 disabled:bg-gray-300"
                title="一覧の全社を fax-crm → callcenter に取込">
                一括 取込
              </button>
              <button onClick={() => bulkSync('both')} disabled={syncing || !faxCrmEnabled || total === 0}
                className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-gray-300"
                title="一覧の全社を双方向同期">
                一括 双方向同期
              </button>
              <button onClick={importMissingFromFaxCrm} disabled={syncing || !faxCrmEnabled}
                className="text-xs px-2 py-1 rounded bg-purple-600 text-white hover:bg-purple-700 disabled:bg-gray-300"
                title="fax-crm 側にあって callcenter 側に居ない顧客を一括作成">
                fax-crmから不足顧客を取込
              </button>
            </div>
          )}
        </div>

        {/* フィルタバー */}
        <div className="bg-white rounded-lg shadow p-3 mb-4">
          <div className="flex flex-wrap items-end gap-2">
            <form onSubmit={(e) => { e.preventDefault(); applySearch(); }} className="flex items-end gap-1">
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">検索</label>
                <input type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)}
                  placeholder="企業名・電話番号"
                  className="border rounded px-2 py-1 text-sm w-56" />
              </div>
              <button type="submit" className="text-sm px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">検索</button>
            </form>

            <div>
              <label className="block text-[11px] text-gray-500 mb-0.5">結果</label>
              <select value={filters.result} onChange={e => updateFilter('result', e.target.value)}
                className="border rounded px-2 py-1 text-sm">
                <option value="">全て</option>
                {RESULT_OPTIONS.map(r => <option key={r} value={r}>{RESULT_LABEL[r]}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-gray-500 mb-0.5">期間 (開始)</label>
              <input type="date" value={filters.date_from} onChange={e => updateFilter('date_from', e.target.value)}
                className="border rounded px-2 py-1 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-0.5">期間 (終了)</label>
              <input type="date" value={filters.date_to} onChange={e => updateFilter('date_to', e.target.value)}
                className="border rounded px-2 py-1 text-sm" />
            </div>

            <div>
              <label className="block text-[11px] text-gray-500 mb-0.5">オペレーター</label>
              <select value={filters.user_id} onChange={e => updateFilter('user_id', e.target.value)}
                className="border rounded px-2 py-1 text-sm">
                <option value="">全て</option>
                {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-gray-500 mb-0.5">業種</label>
              <input type="text" value={filters.industry} onChange={e => updateFilter('industry', e.target.value)}
                placeholder="例: 飲食"
                className="border rounded px-2 py-1 text-sm w-32" />
            </div>

            <div>
              <label className="block text-[11px] text-gray-500 mb-0.5">NGリスト</label>
              <select value={filters.show_excluded} onChange={e => updateFilter('show_excluded', e.target.value)}
                className="border rounded px-2 py-1 text-sm">
                <option value="">除外</option>
                <option value="1">含めて表示</option>
                <option value="only">NGリストのみ</option>
              </select>
            </div>

            <button type="button" onClick={clearAll}
              className="text-sm px-3 py-1 rounded border border-gray-300 hover:bg-gray-50">クリア</button>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          {/* 左: 顧客一覧 */}
          <div className="col-span-5 bg-white rounded-lg shadow overflow-hidden">
            <div className="px-3 py-2 border-b bg-gray-50 text-sm font-bold flex justify-between items-center">
              <span>顧客一覧</span>
              <span className="text-xs text-gray-500 font-normal">
                {total > 0
                  ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} / ${total}件`
                  : '0件'}
              </span>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
              {loading ? (
                <p className="text-center py-8 text-gray-400 text-sm">読み込み中...</p>
              ) : list.length === 0 ? (
                <p className="text-center py-8 text-gray-400 text-sm">該当する顧客がありません</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0 text-[11px]">
                    <tr>
                      <th className="px-2 py-1.5 text-left">企業名</th>
                      <th className="px-2 py-1.5 text-right">架電</th>
                      <th className="px-2 py-1.5 text-right">NG</th>
                      <th className="px-2 py-1.5 text-right">案件</th>
                      <th className="px-2 py-1.5 text-left">最終</th>
                      <th className="px-2 py-1.5 text-left">同期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map(c => (
                      <tr key={c.id}
                        onClick={() => openDetail(c.id)}
                        className={`border-t cursor-pointer ${selectedId === c.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                        <td className="px-2 py-1.5">
                          <div className="font-medium text-gray-900 truncate max-w-[180px] flex items-center gap-1" title={c.company_name}>
                            {Number(c.exclusion_flag) === 1 && (
                              <span className="inline-block px-1 py-0.5 rounded bg-red-100 text-red-700 text-[9px] font-bold flex-shrink-0" title={c.exclusion_reason || 'NGリスト'}>NG</span>
                            )}
                            <span className="truncate">{c.company_name}</span>
                          </div>
                          <div className="text-[10px] text-gray-400">{c.phone_number || ''}</div>
                        </td>
                        <td className="px-2 py-1.5 text-right">{c.call_count || 0}</td>
                        <td className="px-2 py-1.5 text-right">{Number(c.ng_count) > 0 ? <span className="text-red-600 font-medium">{c.ng_count}</span> : '-'}</td>
                        <td className="px-2 py-1.5 text-right">{Number(c.project_count) > 0 ? <span className="text-emerald-700 font-semibold">{c.project_count}</span> : '-'}</td>
                        <td className="px-2 py-1.5 text-[10px] text-gray-500">
                          {c.last_result && <span className="block">{RESULT_LABEL[c.last_result] || c.last_result}</span>}
                          <span>{fmtDate(c.last_call_at)}</span>
                        </td>
                        <td className="px-2 py-1.5 text-[10px]">
                          {(c.last_synced_to_faxcrm_at || c.last_synced_from_faxcrm_at) ? (
                            <div className="space-y-0.5">
                              {c.last_synced_to_faxcrm_at && (
                                <div className="text-blue-700" title={`送信: ${fmtDateTime(c.last_synced_to_faxcrm_at)}`}>
                                  <span className="inline-block w-4 text-center">↑</span>{fmtDate(c.last_synced_to_faxcrm_at)}
                                </div>
                              )}
                              {c.last_synced_from_faxcrm_at && (
                                <div className="text-orange-700" title={`取込: ${fmtDateTime(c.last_synced_from_faxcrm_at)}`}>
                                  <span className="inline-block w-4 text-center">↓</span>{fmtDate(c.last_synced_from_faxcrm_at)}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400">未同期</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {/* ページ切替 */}
            <div className="px-2 py-2 border-t bg-gray-50 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1">
                <span className="text-gray-500">表示</span>
                <select value={pageSize} onChange={e => setPageSize(parseInt(e.target.value, 10))}
                  className="border rounded px-1 py-0.5 text-xs">
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
                <span className="text-gray-500">件</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={page <= 1}
                  className="px-2 py-0.5 rounded border border-gray-300 hover:bg-white disabled:opacity-40">先頭</button>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                  className="px-2 py-0.5 rounded border border-gray-300 hover:bg-white disabled:opacity-40">前へ</button>
                <span className="px-2 text-gray-700">{page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                  className="px-2 py-0.5 rounded border border-gray-300 hover:bg-white disabled:opacity-40">次へ</button>
                <button onClick={() => setPage(totalPages)} disabled={page >= totalPages}
                  className="px-2 py-0.5 rounded border border-gray-300 hover:bg-white disabled:opacity-40">末尾</button>
              </div>
            </div>
          </div>

          {/* 右: 詳細 */}
          <div className="col-span-7">
            {!selectedId ? (
              <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">
                左の一覧から顧客を選択してください
              </div>
            ) : detailLoading ? (
              <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">読み込み中...</div>
            ) : !detail ? (
              <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">データを取得できませんでした</div>
            ) : (
              <div className="space-y-4">
                {/* 顧客基本情報 */}
                <div className="bg-white rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2 flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg font-bold">{detail.company.company_name}</h2>
                      {Number(detail.company.exclusion_flag) === 1 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 text-red-700 text-xs font-bold"
                              title={detail.company.exclusion_reason || ''}>
                          NGリスト
                          {detail.company.exclusion_reason && (
                            <span className="font-normal text-red-600 text-[11px]">／ {detail.company.exclusion_reason}</span>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-[11px] text-gray-500 text-right">
                        {detail.company.last_synced_to_faxcrm_at && (
                          <div className="text-blue-700">送信済: {fmtDateTime(detail.company.last_synced_to_faxcrm_at)}</div>
                        )}
                        {detail.company.last_synced_from_faxcrm_at && (
                          <div className="text-orange-700">取込済: {fmtDateTime(detail.company.last_synced_from_faxcrm_at)}</div>
                        )}
                        {!detail.company.last_synced_to_faxcrm_at && !detail.company.last_synced_from_faxcrm_at && (
                          <span className="text-gray-400">未同期</span>
                        )}
                      </div>
                      {canEdit && (
                        Number(detail.company.exclusion_flag) === 1 ? (
                          <button onClick={removeFromNgList}
                            className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50">
                            NGリスト解除
                          </button>
                        ) : (
                          <button onClick={addToNgList}
                            className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700">
                            NGリストに追加
                          </button>
                        )
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-gray-500">電話:</span> {detail.company.phone_number || '-'}</div>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500">FAX:</span>
                      {editingFax ? (
                        <>
                          <input type="text" value={faxInput} onChange={e => setFaxInput(e.target.value)}
                            className="border rounded px-2 py-0.5 text-xs w-40" placeholder="例: 03-1234-5678" />
                          <button onClick={saveFax} disabled={savingFax}
                            className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300">保存</button>
                          <button onClick={() => setEditingFax(false)} disabled={savingFax}
                            className="text-xs px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-50">取消</button>
                        </>
                      ) : (
                        <>
                          <span>{detail.company.fax_number || '-'}</span>
                          {canEdit && (
                            <button onClick={() => { setFaxInput(detail.company.fax_number || ''); setEditingFax(true); }}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 hover:bg-gray-50">編集</button>
                          )}
                        </>
                      )}
                    </div>
                    <div><span className="text-gray-500">業種:</span> {detail.company.industry || '-'}</div>
                    <div><span className="text-gray-500">地域:</span> {detail.company.region || '-'}</div>
                    <div className="col-span-2"><span className="text-gray-500">住所:</span> {detail.company.address || '-'}</div>
                  </div>
                  {detail.company.comment && (
                    <div className="mt-2 text-xs text-gray-600">
                      <span className="text-gray-500">コメント:</span> {detail.company.comment}
                    </div>
                  )}
                  {/* ピックアップ診断ボタン */}
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <button
                      onClick={async () => {
                        try {
                          const { data } = await api.get(`/api/companies/${detail.company.id}/pickup-diagnose`);
                          if (!data.success) { toast.error('診断に失敗しました'); return; }
                          const d = data.data;
                          const lines = [];
                          lines.push(`【診断】${d.summary}`);
                          if (d.reasons.length > 0) {
                            lines.push('');
                            lines.push('▼ 除外されている理由:');
                            d.reasons.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
                          }
                          if (d.ok.length > 0) {
                            lines.push('');
                            lines.push('▼ 通過した条件:');
                            d.ok.forEach((r) => lines.push(`・${r}`));
                          }
                          window.alert(lines.join('\n'));
                        } catch (err) {
                          toast.error('診断に失敗しました');
                        }
                      }}
                      className="text-xs px-3 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                    >
                      架電リスト ピックアップ診断
                    </button>
                    <span className="ml-2 text-[10px] text-gray-400">なぜ架電リストに出てこないか調べる</span>
                  </div>
                </div>

                {/* 担当者情報 */}
                {detail.contactPersons && detail.contactPersons.length > 0 && (
                  <div className="bg-white rounded-lg shadow p-4">
                    <h3 className="text-sm font-bold mb-2 text-indigo-700">担当者情報 ({detail.contactPersons.length}名)</h3>
                    <div className="space-y-2">
                      {detail.contactPersons.map((p, i) => (
                        <div key={i} className="border border-indigo-100 bg-indigo-50/40 rounded p-2 text-xs">
                          <div className="flex justify-between items-center">
                            <span className="font-semibold">
                              {p.name || '(名前未登録)'}{p.gender ? ` (${p.gender})` : ''}
                            </span>
                            <span className="text-gray-500 text-[11px]">最終: {fmtDate(p.last_at)}</span>
                          </div>
                          {p.phone && <div className="text-gray-700 mt-0.5">TEL: {p.phone}</div>}
                          {p.impression && <div className="text-gray-600 mt-0.5 whitespace-pre-wrap">印象: {p.impression}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 案件（面接情報・合格者含む） */}
                {detail.projects && detail.projects.length > 0 && (
                  <div className="bg-white rounded-lg shadow p-4">
                    <h3 className="text-sm font-bold text-emerald-700 mb-2">案件 ({detail.projects.length}件)</h3>
                    <div className="space-y-2">
                      {detail.projects.map(p => (
                        <div key={p.id} className="border border-emerald-100 bg-emerald-50/40 rounded p-2 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{p.job_number || `#${p.id}`}</span>
                            <span className="px-1.5 py-0.5 bg-white rounded text-[10px] font-medium">{PROJECT_STATUS_LABEL[p.status] || p.status || '-'}</span>
                            <span className="text-gray-500">獲得: {fmtDate(p.created_at)}</span>
                            {p.owner_name && <span className="text-gray-500">OP: {p.owner_name}</span>}
                            {p.sales_name && <span className="text-gray-500">営業: {p.sales_name}</span>}
                          </div>
                          {/* 面接情報 */}
                          {(p.interview_date || p.naitei_date || p.interview_type || p.interview_attendees || p.document_screening) && (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-gray-600">
                              {p.interview_date && <span>面接日: {fmtDateTime(p.interview_date)}</span>}
                              {p.interview_type && <span>形式: {INTERVIEW_TYPE_LABEL[p.interview_type] || p.interview_type}</span>}
                              {Number(p.interview_attendees) > 0 && <span>面接人数: {p.interview_attendees}名</span>}
                              {p.document_screening && <span>書類選考: {DOC_SCREENING_LABEL[p.document_screening] || p.document_screening}</span>}
                              {p.naitei_date && <span className="text-emerald-700 font-medium">内定日: {fmtDate(p.naitei_date)}</span>}
                            </div>
                          )}
                          {/* 合格者（内定者） */}
                          {p.hires && p.hires.length > 0 && (
                            <div className="mt-1.5 border-t border-emerald-200 pt-1.5">
                              <div className="text-[11px] font-semibold text-emerald-800 mb-0.5">合格者 ({p.hires.length}名)</div>
                              <div className="space-y-0.5">
                                {p.hires.map(h => (
                                  <div key={h.id} className="flex flex-wrap gap-x-3 text-[11px]">
                                    <span className="font-medium">{h.registration_number || '(登録番号なし)'}</span>
                                    {h.course && <span className="text-gray-500">{h.course}</span>}
                                    {Number(h.initial_payment) > 0 && <span className="text-emerald-700">初回入金: ¥{Number(h.initial_payment).toLocaleString()}</span>}
                                    {Number(h.expected_revenue) > 0 && <span className="text-blue-700">見込売上: ¥{Number(h.expected_revenue).toLocaleString()}</span>}
                                    {Number(h.is_cancelled) === 1 && <span className="text-red-500">(取消)</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 統合タイムライン（架電 + 手動 + FAX） */}
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="text-sm font-bold mb-2">アクション履歴 (時系列 {detail.timeline?.length || 0}件)</h3>
                  {(!detail.timeline || detail.timeline.length === 0) ? (
                    <p className="text-xs text-gray-400">記録なし</p>
                  ) : (
                    <div className="space-y-2 max-h-[500px] overflow-y-auto">
                      {detail.timeline.map((e, i) => {
                        const badge = KIND_BADGE[e.kind] || { label: e.kind, cls: 'bg-gray-100 text-gray-700' };
                        return (
                          <div key={i} className="border rounded p-2 text-xs">
                            <div className="flex justify-between items-center mb-0.5">
                              <div className="flex items-center gap-2">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>
                                <span className="font-semibold">
                                  {e.kind === 'call' && (RESULT_LABEL[e.result_code] || e.result_code || '-')}
                                  {e.kind === 'manual' && (e.action_type || '-')}
                                  {e.kind === 'fax' && (e.event_type || 'FAX')}
                                </span>
                                {e.kind === 'fax' && e.result_label && (
                                  <span className="text-gray-500">- {e.result_label}</span>
                                )}
                                {e.kind === 'manual' && e.result && (
                                  <span className="text-gray-500">- {e.result}</span>
                                )}
                              </div>
                              <span className="text-gray-500 text-[11px]">{fmtDateTime(e.at)}</span>
                            </div>
                            {e.operator_name && (
                              <div className="text-gray-600">担当: {e.operator_name}</div>
                            )}
                            {e.kind === 'call' && e.result_code === 'NG' && e.ng_reason && (
                              <div className="text-red-600">NG理由: {e.ng_reason}</div>
                            )}
                            {e.kind === 'call' && (e.contact_person_name || e.contact_person_phone) && (
                              <div className="text-indigo-700">
                                担当者: {e.contact_person_name || '?'}{e.contact_person_gender ? ` (${e.contact_person_gender})` : ''}
                                {e.contact_person_phone && <span className="ml-2">TEL: {e.contact_person_phone}</span>}
                              </div>
                            )}
                            {e.kind === 'call' && e.contact_person_impression && (
                              <div className="text-gray-600">印象: {e.contact_person_impression}</div>
                            )}
                            {e.memo && <div className="text-gray-600 mt-0.5 whitespace-pre-wrap">{e.memo}</div>}
                            {e.kind === 'call' && e.transcript && (
                              <div className="mt-1.5">
                                <button
                                  onClick={() => setExpandedTranscripts(prev => ({ ...prev, [i]: !prev[i] }))}
                                  className="text-[11px] text-blue-600 hover:text-blue-800 underline decoration-dotted underline-offset-2"
                                >
                                  {expandedTranscripts[i] ? '文字起こしを閉じる' : '文字起こしを表示'}
                                </button>
                                {expandedTranscripts[i] && (
                                  <pre className="mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-[11px] text-gray-700 whitespace-pre-wrap max-h-64 overflow-y-auto">{e.transcript}</pre>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {detail.faxCrmStatus && detail.faxCrmStatus !== 'ok' && detail.faxCrmStatus !== 'disabled' && (
                    <p className="text-xs text-amber-600 mt-2">FAX CRM 接続に失敗: {detail.faxCrmStatus}</p>
                  )}
                  {detail.faxCrmStatus === 'disabled' && (
                    <p className="text-xs text-gray-400 mt-2">FAX CRM 連携が未設定です（FAX_CRM_API_URL を設定すると FAX 履歴も統合表示されます）</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
