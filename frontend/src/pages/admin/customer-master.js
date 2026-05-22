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

export default function CustomerMasterPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState({
    search: '', result: '', user_id: '', industry: '', date_from: '', date_to: '',
  });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [faxCrmEnabled, setFaxCrmEnabled] = useState(false);
  const [operators, setOperators] = useState([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (user && !['admin', 'manager', 'consultant'].includes(user.role)) {
      router.push('/');
      return;
    }
    if (user) {
      fetchList();
      fetchOperators();
    }
  }, [user, filters]);

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
      const { data } = await api.get(`/api/admin/customer-master?${params}`);
      if (data.success) {
        setList(data.data.customers || []);
        setFaxCrmEnabled(!!data.data.faxCrmEnabled);
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

  const syncToFaxCrm = async () => {
    if (!selectedId) return;
    if (!faxCrmEnabled) { toast.error('FAX CRM 連携が無効です'); return; }
    setSyncing(true);
    try {
      const { data } = await api.post(`/api/admin/customer-master/${selectedId}/sync-to-faxcrm`);
      if (data.success) {
        toast.success(data.message || `送信完了: ${data.data?.pushed || 0}件`);
        openDetail(selectedId);
      } else {
        toast.error(data.message || '送信失敗');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || '送信に失敗しました');
    } finally {
      setSyncing(false);
    }
  };

  const syncFromFaxCrm = async () => {
    if (!selectedId) return;
    if (!faxCrmEnabled) { toast.error('FAX CRM 連携が無効です'); return; }
    if (typeof window !== 'undefined' && !window.confirm('fax-crm 側のFAX履歴を callcenter に取込しますか？\n（重複は自動でスキップされます）')) return;
    setSyncing(true);
    try {
      const { data } = await api.post(`/api/admin/customer-master/${selectedId}/sync-from-faxcrm`);
      if (data.success) {
        toast.success(data.message || `取込完了: ${data.data?.inserted || 0}件`);
        openDetail(selectedId);
      } else {
        toast.error(data.message || '取込失敗');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || '取込に失敗しました');
    } finally {
      setSyncing(false);
    }
  };

  const syncBoth = async () => {
    if (!selectedId) return;
    if (!faxCrmEnabled) { toast.error('FAX CRM 連携が無効です'); return; }
    if (typeof window !== 'undefined' && !window.confirm('双方向同期を実行します。\n1) callcenter → fax-crm に架電履歴を送信\n2) fax-crm → callcenter に FAX 履歴を取込\nよろしいですか？')) return;
    setSyncing(true);
    try {
      const r1 = await api.post(`/api/admin/customer-master/${selectedId}/sync-to-faxcrm`);
      const r2 = await api.post(`/api/admin/customer-master/${selectedId}/sync-from-faxcrm`);
      const pushed = r1.data?.data?.pushed || 0;
      const inserted = r2.data?.data?.inserted || 0;
      toast.success(`双方向同期 完了: 送信${pushed}件 / 取込${inserted}件`);
      openDetail(selectedId);
    } catch (err) {
      toast.error(err.response?.data?.message || '同期に失敗しました');
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
            </p>
          </div>
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

            <button type="button" onClick={clearAll}
              className="text-sm px-3 py-1 rounded border border-gray-300 hover:bg-gray-50">クリア</button>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          {/* 左: 顧客一覧 */}
          <div className="col-span-5 bg-white rounded-lg shadow overflow-hidden">
            <div className="px-3 py-2 border-b bg-gray-50 text-sm font-bold flex justify-between">
              <span>顧客一覧</span>
              <span className="text-xs text-gray-500">{list.length}件</span>
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
                    </tr>
                  </thead>
                  <tbody>
                    {list.map(c => (
                      <tr key={c.id}
                        onClick={() => openDetail(c.id)}
                        className={`border-t cursor-pointer ${selectedId === c.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                        <td className="px-2 py-1.5">
                          <div className="font-medium text-gray-900 truncate max-w-[180px]" title={c.company_name}>{c.company_name}</div>
                          <div className="text-[10px] text-gray-400">{c.phone_number || ''}</div>
                        </td>
                        <td className="px-2 py-1.5 text-right">{c.call_count || 0}</td>
                        <td className="px-2 py-1.5 text-right">{Number(c.ng_count) > 0 ? <span className="text-red-600 font-medium">{c.ng_count}</span> : '-'}</td>
                        <td className="px-2 py-1.5 text-right">{Number(c.project_count) > 0 ? <span className="text-emerald-700 font-semibold">{c.project_count}</span> : '-'}</td>
                        <td className="px-2 py-1.5 text-[10px] text-gray-500">
                          {c.last_result && <span className="block">{RESULT_LABEL[c.last_result] || c.last_result}</span>}
                          <span>{fmtDate(c.last_call_at)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
                    <h2 className="text-lg font-bold">{detail.company.company_name}</h2>
                    {canEdit && (
                      <div className="flex flex-wrap gap-1">
                        <button onClick={syncToFaxCrm} disabled={syncing || !faxCrmEnabled}
                          className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300"
                          title="callcenter の架電履歴を fax-crm に送信（肉付けマージ）">
                          callcenter から送信
                        </button>
                        <button onClick={syncFromFaxCrm} disabled={syncing || !faxCrmEnabled}
                          className="text-xs px-2 py-1 rounded bg-orange-600 text-white hover:bg-orange-700 disabled:bg-gray-300"
                          title="fax-crm の FAX 履歴を callcenter に取込">
                          callcenter へ取込
                        </button>
                        <button onClick={syncBoth} disabled={syncing || !faxCrmEnabled}
                          className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-gray-300"
                          title="双方向同期（送信＋取込）">
                          双方向同期
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-gray-500">電話:</span> {detail.company.phone_number || '-'}</div>
                    <div><span className="text-gray-500">業種:</span> {detail.company.industry || '-'}</div>
                    <div><span className="text-gray-500">住所:</span> {detail.company.address || '-'}</div>
                    <div><span className="text-gray-500">地域:</span> {detail.company.region || '-'}</div>
                  </div>
                  {detail.company.comment && (
                    <div className="mt-2 text-xs text-gray-600">
                      <span className="text-gray-500">コメント:</span> {detail.company.comment}
                    </div>
                  )}
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

                {/* NG理由集計 */}
                {detail.ngBreakdown && detail.ngBreakdown.length > 0 && (
                  <div className="bg-white rounded-lg shadow p-4">
                    <h3 className="text-sm font-bold text-red-700 mb-2">NG理由（過去）</h3>
                    <div className="space-y-1">
                      {detail.ngBreakdown.map(r => (
                        <div key={r.ng_reason} className="flex justify-between text-xs">
                          <span>{r.ng_reason}</span>
                          <span className="font-bold text-red-600">{r.cnt}回</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 案件 */}
                {detail.projects && detail.projects.length > 0 && (
                  <div className="bg-white rounded-lg shadow p-4">
                    <h3 className="text-sm font-bold text-emerald-700 mb-2">案件 ({detail.projects.length}件)</h3>
                    <div className="space-y-1">
                      {detail.projects.map(p => (
                        <div key={p.id} className="flex flex-wrap items-center gap-2 text-xs bg-emerald-50 rounded px-2 py-1">
                          <span className="font-medium">{p.job_number || `#${p.id}`}</span>
                          <span className="px-1.5 py-0.5 bg-white rounded text-[10px]">{p.status}</span>
                          <span className="text-gray-500">{fmtDate(p.created_at)}</span>
                          {p.owner_name && <span className="text-gray-500">OP: {p.owner_name}</span>}
                          {p.sales_name && <span className="text-gray-500">営業: {p.sales_name}</span>}
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
