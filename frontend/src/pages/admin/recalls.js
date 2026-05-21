/**
 * リコール管理（管理者）
 * - 全オペレーターのリコール一覧、期限超過ハイライト
 * - フィルター（状態・担当者・期間）
 * - ステータス変更・担当変更・削除
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const STATUS_LABELS = {
  pending: '待機中',
  done: '完了',
  cancelled: 'キャンセル',
};

const fmtDateTime = (s) => {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

const fmtOverdue = (mins) => {
  const m = Number(mins) || 0;
  if (m < 60) return `${m}分超過`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間超過`;
  const d = Math.floor(h / 24);
  return `${d}日超過`;
};

export default function RecallsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [operators, setOperators] = useState([]);
  // filters
  const [statusFilter, setStatusFilter] = useState('pending');
  const [userFilter, setUserFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    if (user && !['admin', 'manager', 'consultant'].includes(user.role)) {
      router.push('/');
      return;
    }
    if (user) {
      fetchData();
      fetchOperators();
    }
  }, [user, statusFilter, userFilter, dateFrom, dateTo]);

  const fetchOperators = async () => {
    try {
      const { data } = await api.get('/api/admin/users');
      if (data.success) {
        setOperators((data.data || []).filter(u =>
          ['operator', 'intern'].includes(u.role) && !u.is_test_account && u.is_active
        ));
      }
    } catch (err) { /* ignore */ }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter);
      if (userFilter) params.append('user_id', userFilter);
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      const { data: res } = await api.get(`/api/admin/recalls?${params}`);
      if (res.success) setData(res.data);
    } catch (err) {
      toast.error('リコール一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (id, status) => {
    try {
      await api.put(`/api/admin/recalls/${id}`, { status });
      toast.success('更新しました');
      fetchData();
    } catch (err) {
      toast.error('更新に失敗しました');
    }
  };

  const handleReassign = async (id, userId) => {
    try {
      await api.put(`/api/admin/recalls/${id}/reassign`, { user_id: Number(userId) });
      toast.success('担当を変更しました');
      fetchData();
    } catch (err) {
      toast.error('担当変更に失敗しました');
    }
  };

  const handleDelete = async (id) => {
    if (typeof window !== 'undefined' && !window.confirm('削除しますか？')) return;
    try {
      await api.delete(`/api/admin/recalls/${id}`);
      toast.success('削除しました');
      fetchData();
    } catch (err) {
      toast.error('削除に失敗しました');
    }
  };

  if (!user) return null;
  if (!['admin', 'manager', 'consultant'].includes(user.role)) {
    return <Layout><div className="p-6">権限がありません</div></Layout>;
  }

  const isOverdue = (r) => r.status === 'pending' && Number(r.overdue_minutes) > 0;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h1 className="text-2xl font-bold">リコール管理</h1>
          <button onClick={fetchData} className="text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50">更新</button>
        </div>

        {/* サマリ */}
        {data?.summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-red-500">
              <div className="text-xs text-gray-500">期限超過</div>
              <div className="text-2xl font-bold text-red-600">{data.summary.overdue_count || 0}件</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-amber-500">
              <div className="text-xs text-gray-500">予定（未対応）</div>
              <div className="text-2xl font-bold">{data.summary.upcoming_count || 0}件</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-emerald-500">
              <div className="text-xs text-gray-500">完了</div>
              <div className="text-2xl font-bold">{data.summary.done_count || 0}件</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-gray-400">
              <div className="text-xs text-gray-500">キャンセル</div>
              <div className="text-2xl font-bold">{data.summary.cancelled_count || 0}件</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
              <div className="text-xs text-gray-500">総数</div>
              <div className="text-2xl font-bold">{data.summary.total || 0}件</div>
            </div>
          </div>
        )}

        {/* オペレーター別サマリ */}
        {data?.byUser && data.byUser.length > 0 && (
          <div className="bg-white rounded-lg shadow mb-4 overflow-hidden">
            <div className="px-4 py-2 border-b bg-gray-50 text-sm font-bold">オペレーター別 未対応</div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left">オペレーター</th>
                    <th className="px-3 py-2 text-right">期限超過</th>
                    <th className="px-3 py-2 text-right">予定</th>
                    <th className="px-3 py-2 text-right">未対応合計</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.byUser.map(u => (
                    <tr key={u.user_id} className="border-t hover:bg-gray-50">
                      <td className="px-3 py-2">{u.user_name}</td>
                      <td className="px-3 py-2 text-right">
                        {Number(u.overdue_count) > 0 ? (
                          <span className="font-bold text-red-600">{u.overdue_count}件</span>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2 text-right">{u.upcoming_count || 0}件</td>
                      <td className="px-3 py-2 text-right font-semibold">{u.pending_count || 0}件</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => { setUserFilter(String(u.user_id)); setStatusFilter('pending'); }}
                          className="text-xs text-blue-600 hover:underline"
                        >このユーザーで絞り込み</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* フィルター */}
        <div className="bg-white rounded-lg shadow p-4 mb-4 flex flex-wrap gap-3 items-center">
          <div>
            <label className="text-xs text-gray-500 block">ステータス</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border rounded px-2 py-1 text-sm">
              <option value="all">すべて</option>
              <option value="pending">未対応</option>
              <option value="overdue">期限超過のみ</option>
              <option value="done">完了</option>
              <option value="cancelled">キャンセル</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block">担当オペ</label>
            <select value={userFilter} onChange={e => setUserFilter(e.target.value)} className="border rounded px-2 py-1 text-sm">
              <option value="">全員</option>
              {operators.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block">リコール日 From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
          <button onClick={() => { setStatusFilter('pending'); setUserFilter(''); setDateFrom(''); setDateTo(''); }}
            className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50">クリア</button>
        </div>

        {/* リスト */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {loading ? (
            <div className="text-center py-8 text-gray-500">読み込み中...</div>
          ) : !data || data.recalls.length === 0 ? (
            <div className="text-center py-8 text-gray-500">該当するリコールはありません</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left">状態</th>
                    <th className="px-3 py-2 text-left">リコール日時</th>
                    <th className="px-3 py-2 text-left">企業名</th>
                    <th className="px-3 py-2 text-left">電話番号</th>
                    <th className="px-3 py-2 text-left">担当オペ</th>
                    <th className="px-3 py-2 text-left">メモ</th>
                    <th className="px-3 py-2 text-left">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recalls.map(r => {
                    const overdue = isOverdue(r);
                    return (
                      <tr key={r.id} className={`border-t hover:bg-gray-50 ${overdue ? 'bg-red-50/50' : ''}`}>
                        <td className="px-3 py-2">
                          {overdue ? (
                            <span className="inline-block px-2 py-0.5 rounded bg-red-100 text-red-800 text-xs font-bold">
                              超過 {fmtOverdue(r.overdue_minutes)}
                            </span>
                          ) : (
                            <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                              r.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                              r.status === 'done' ? 'bg-emerald-100 text-emerald-800' :
                              'bg-gray-100 text-gray-600'
                            }`}>{STATUS_LABELS[r.status] || r.status}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtDateTime(r.recall_at)}</td>
                        <td className="px-3 py-2 font-medium">{r.company_name}</td>
                        <td className="px-3 py-2 text-xs">{r.phone_number || '-'}</td>
                        <td className="px-3 py-2 text-xs">
                          {r.user_name}
                          <select
                            value=""
                            onChange={e => { if (e.target.value) handleReassign(r.id, e.target.value); }}
                            className="ml-1 border rounded px-1 py-0.5 text-xs"
                            title="担当変更"
                          >
                            <option value="">変更</option>
                            {operators.filter(u => u.id !== r.user_id).map(u => (
                              <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500 max-w-xs truncate" title={r.last_memo}>{r.last_memo || '-'}</td>
                        <td className="px-3 py-2 text-xs">
                          {r.status === 'pending' && (
                            <>
                              <button onClick={() => handleStatusChange(r.id, 'done')} className="text-emerald-600 hover:underline mr-2">完了</button>
                              <button onClick={() => handleStatusChange(r.id, 'cancelled')} className="text-gray-600 hover:underline mr-2">取消</button>
                            </>
                          )}
                          {r.status !== 'pending' && (
                            <button onClick={() => handleStatusChange(r.id, 'pending')} className="text-amber-600 hover:underline mr-2">戻す</button>
                          )}
                          <button onClick={() => handleDelete(r.id)} className="text-red-600 hover:underline">削除</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
