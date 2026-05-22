/**
 * 顧客マスタ
 * - callcenter の companies と FAX CRM の contact_events を統合表示
 * - 各顧客で架電履歴 / NG理由 / 手動アクション(FAX等) / FAX CRM 履歴 を確認
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

export default function CustomerMasterPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [faxCrmEnabled, setFaxCrmEnabled] = useState(false);

  useEffect(() => {
    if (user && !['admin', 'manager', 'consultant'].includes(user.role)) {
      router.push('/');
      return;
    }
    if (user) fetchList();
  }, [user, search]);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
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

  if (!user) return null;
  if (!['admin', 'manager', 'consultant'].includes(user.role)) {
    return <Layout><div className="p-6">権限がありません</div></Layout>;
  }

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold">顧客マスタ</h1>
            <p className="text-sm text-gray-500 mt-1">
              架電結果・NG理由・手動アクション・FAX CRMの履歴を統合して確認できます。
              {faxCrmEnabled
                ? <span className="ml-2 inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-xs">FAX CRM 連携 有効</span>
                : <span className="ml-2 inline-block px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">FAX CRM 連携 未設定</span>}
            </p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); }} className="flex items-center gap-2">
            <input type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)}
              placeholder="企業名・電話番号で検索"
              className="border rounded px-3 py-1.5 text-sm w-64" />
            <button type="submit" className="text-sm px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700">検索</button>
            {search && (
              <button type="button" onClick={() => { setSearch(''); setSearchInput(''); }}
                className="text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50">クリア</button>
            )}
          </form>
        </div>

        <div className="grid grid-cols-12 gap-4">
          {/* 左: 顧客一覧 */}
          <div className="col-span-5 bg-white rounded-lg shadow overflow-hidden">
            <div className="px-3 py-2 border-b bg-gray-50 text-sm font-bold flex justify-between">
              <span>顧客一覧</span>
              <span className="text-xs text-gray-500">{list.length}件</span>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
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
                  <h2 className="text-lg font-bold mb-2">{detail.company.company_name}</h2>
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

                {/* 架電履歴 */}
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="text-sm font-bold mb-2 text-blue-700">架電履歴 ({detail.calls.length}件)</h3>
                  {detail.calls.length === 0 ? (
                    <p className="text-xs text-gray-400">記録なし</p>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {detail.calls.map(c => (
                        <div key={c.id} className="border border-blue-100 bg-blue-50/40 rounded p-2 text-xs">
                          <div className="flex justify-between items-center">
                            <span className="font-semibold">{RESULT_LABEL[c.result_code] || c.result_code}</span>
                            <span className="text-gray-500 text-[11px]">{fmtDateTime(c.call_started_at)}</span>
                          </div>
                          <div className="text-gray-600 mt-0.5">担当: {c.operator_name || '-'}</div>
                          {c.result_code === 'NG' && c.ng_reason && (
                            <div className="text-red-600 mt-0.5">NG理由: {c.ng_reason}</div>
                          )}
                          {(c.contact_person_name || c.contact_person_phone) && (
                            <div className="text-indigo-700 mt-0.5">
                              担当者: {c.contact_person_name || '?'}{c.contact_person_gender ? ` (${c.contact_person_gender})` : ''}
                              {c.contact_person_phone && <span className="ml-2">TEL: {c.contact_person_phone}</span>}
                            </div>
                          )}
                          {c.contact_person_impression && (
                            <div className="text-gray-600 mt-0.5">印象: {c.contact_person_impression}</div>
                          )}
                          {c.memo && <div className="text-gray-600 mt-0.5 whitespace-pre-wrap">{c.memo}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 手動アクション */}
                {detail.manualActions && detail.manualActions.length > 0 && (
                  <div className="bg-white rounded-lg shadow p-4">
                    <h3 className="text-sm font-bold mb-2 text-purple-700">手動アクション ({detail.manualActions.length}件)</h3>
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {detail.manualActions.map(a => (
                        <div key={a.id} className="border border-purple-100 bg-purple-50/40 rounded p-2 text-xs">
                          <div className="flex justify-between items-center">
                            <span className="font-semibold">{a.action_type}</span>
                            <span className="text-gray-500 text-[11px]">{fmtDate(a.action_date)}</span>
                          </div>
                          <div className="text-gray-600 mt-0.5">担当: {a.user_name || '-'}</div>
                          {a.result && <div className="text-gray-700 mt-0.5">結果: {a.result}</div>}
                          {a.memo && <div className="text-gray-600 mt-0.5">{a.memo}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* FAX CRM 履歴 */}
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="text-sm font-bold mb-2 text-orange-700">FAX CRM 履歴</h3>
                  {detail.faxCrmStatus === 'disabled' ? (
                    <p className="text-xs text-gray-400">FAX CRM 連携が未設定です（環境変数 FAX_CRM_API_URL を設定してください）</p>
                  ) : detail.faxCrmStatus !== 'ok' ? (
                    <p className="text-xs text-amber-600">FAX CRM への接続に失敗: {detail.faxCrmStatus}</p>
                  ) : detail.faxHistory.length === 0 ? (
                    <p className="text-xs text-gray-400">FAX 履歴なし</p>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {detail.faxHistory.map((e, i) => (
                        <div key={e.id || i} className="border border-orange-100 bg-orange-50/40 rounded p-2 text-xs">
                          <div className="flex justify-between items-center">
                            <span className="font-semibold">{e.event_type || 'FAX'}{e.result_label ? ` - ${e.result_label}` : ''}</span>
                            <span className="text-gray-500 text-[11px]">{fmtDateTime(e.occurred_at)}</span>
                          </div>
                          {e.operator_name && <div className="text-gray-600 mt-0.5">担当: {e.operator_name}</div>}
                          {e.memo && <div className="text-gray-600 mt-0.5 whitespace-pre-wrap">{e.memo}</div>}
                        </div>
                      ))}
                    </div>
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
