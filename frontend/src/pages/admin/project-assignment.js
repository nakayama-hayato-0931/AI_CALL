/**
 * 案件割り振りページ
 * - 各営業の案件状況（ステータス別件数）
 * - 未割当案件一覧（失注・バラシ除外）
 * - このページから営業を割り当てると案件管理に反映
 */
import { Fragment, useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

// 表示対象ステータス（失注・バラシ除外済み）と日本語ラベル
const STATUS_LABELS = {
  NEW: '新規',
  MENSETSU_KAKUTEI: '面接日確定',
  INTERVIEW_SET: '面接日確定',
  INTERVIEW_DONE: '面接実施済',
  WAITING_RESULT: '結果待ち',
  KEKKA_MACHI: '結果待ち',
  SHORUI_CHU: '書類選考中',
  SHORUI_OCHI: '書類選考落ち',
  NAITEI: '内定',
  NAITEI_TORIKESHI: '内定取消',
  FUGOKAKU: '不合格',
  HORYU: '保留',
  MODOSHI: '戻し',
  MODORI: '戻り',
  MAIL_SENT: 'メール送信済',
  HIRED: '採用',
  BOSHUCHU: '募集中',
  KISON_NASHI: '既存無し',
};

// 表示用カラーマップ
const STATUS_COLOR = {
  NEW: 'bg-gray-100 text-gray-700',
  MENSETSU_KAKUTEI: 'bg-blue-50 text-blue-700',
  INTERVIEW_SET: 'bg-blue-50 text-blue-700',
  INTERVIEW_DONE: 'bg-indigo-50 text-indigo-700',
  WAITING_RESULT: 'bg-amber-50 text-amber-700',
  KEKKA_MACHI: 'bg-amber-50 text-amber-700',
  NAITEI: 'bg-emerald-50 text-emerald-700',
  FUGOKAKU: 'bg-red-50 text-red-700',
  SHORUI_CHU: 'bg-cyan-50 text-cyan-700',
  HORYU: 'bg-slate-100 text-slate-600',
  MODOSHI: 'bg-orange-50 text-orange-700',
};

const formatDate = (d) => {
  if (!d) return '-';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '-';
    return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;
  } catch { return '-'; }
};

export default function ProjectAssignmentPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [salesUsers, setSalesUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState({}); // { projectId: true }
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!user) return;
    if (!['admin', 'manager', 'sales', 'consultant'].includes(user.role)) {
      router.push('/');
      return;
    }
    fetchData();
    fetchSalesUsers();
  }, [user]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get('/api/projects/assignment-overview');
      if (res.success) setData(res.data);
    } catch (err) {
      toast.error('取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const fetchSalesUsers = async () => {
    try {
      const { data: res } = await api.get('/api/projects/sales-users');
      if (res.success) setSalesUsers(res.data || []);
    } catch (err) { /* ignore */ }
  };

  const handleAssign = async (projectId, salesUserId) => {
    setAssigning(prev => ({ ...prev, [projectId]: true }));
    try {
      await api.put(`/api/projects/${projectId}/assign`, {
        sales_user_id: salesUserId || null,
      });
      toast.success('割り当てました');
      await fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || '割り当てに失敗しました');
    } finally {
      setAssigning(prev => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
    }
  };

  if (!user) return null;
  if (!['admin', 'manager', 'sales', 'consultant'].includes(user.role)) {
    return <Layout><div className="p-6">権限がありません</div></Layout>;
  }

  const filteredProjects = data?.unassigned?.projects?.filter(p => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (p.company_name || '').toLowerCase().includes(s) ||
      (p.job_number || '').toLowerCase().includes(s) ||
      (p.owner_name || '').toLowerCase().includes(s)
    );
  }) || [];

  // 全営業のstatusCountsから登場するステータスキーを集める
  const usedStatuses = new Set();
  if (data) {
    for (const s of data.sales) Object.keys(s.statusCounts).forEach(k => usedStatuses.add(k));
    Object.keys(data.unassigned.statusCounts || {}).forEach(k => usedStatuses.add(k));
  }
  // 表示順
  const STATUS_ORDER = [
    'NEW', 'MAIL_SENT', 'SHORUI_CHU', 'MENSETSU_KAKUTEI', 'INTERVIEW_SET',
    'INTERVIEW_DONE', 'WAITING_RESULT', 'KEKKA_MACHI', 'NAITEI',
    'NAITEI_TORIKESHI', 'FUGOKAKU', 'SHORUI_OCHI', 'HORYU', 'MODOSHI',
    'MODORI', 'BOSHUCHU', 'KISON_NASHI', 'HIRED',
  ];
  const statusList = STATUS_ORDER.filter(s => usedStatuses.has(s))
    .concat([...usedStatuses].filter(s => !STATUS_ORDER.includes(s)));

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold">案件割り振り</h1>
            <p className="text-sm text-gray-500 mt-1">
              失注・バラシは除外。営業を割り当てると案件管理に即時反映されます。
            </p>
          </div>
          <button
            onClick={fetchData}
            className="text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50"
          >
            更新
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500">読み込み中...</div>
        ) : !data ? (
          <div className="text-center py-12 text-gray-500">データがありません</div>
        ) : (
          <>
            {/* 営業別サマリ */}
            <div className="bg-white rounded-lg shadow mb-6 overflow-hidden">
              <div className="px-4 py-3 border-b bg-gray-50">
                <h2 className="font-bold text-sm">営業別案件状況</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left sticky left-0 bg-gray-50">営業</th>
                      <th className="px-3 py-2 text-center bg-blue-50">合計</th>
                      {statusList.map(s => (
                        <th key={s} className="px-3 py-2 text-center whitespace-nowrap">
                          {STATUS_LABELS[s] || s}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.sales.map(s => (
                      <tr key={s.userId} className="border-t hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium sticky left-0 bg-white">
                          {s.name}
                          {!s.isActive && <span className="ml-1 text-xs text-gray-400">(無効)</span>}
                        </td>
                        <td className="px-3 py-2 text-center font-bold bg-blue-50">{s.total}</td>
                        {statusList.map(st => (
                          <td key={st} className="px-3 py-2 text-center">
                            {s.statusCounts[st] ? (
                              <span className={`inline-block px-2 py-0.5 rounded ${STATUS_COLOR[st] || 'bg-gray-100 text-gray-600'}`}>
                                {s.statusCounts[st]}
                              </span>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="border-t bg-amber-50 font-semibold">
                      <td className="px-3 py-2 sticky left-0 bg-amber-50">未割当</td>
                      <td className="px-3 py-2 text-center bg-amber-100">{data.unassigned.total}</td>
                      {statusList.map(st => (
                        <td key={st} className="px-3 py-2 text-center">
                          {data.unassigned.statusCounts[st] ? (
                            <span className={`inline-block px-2 py-0.5 rounded ${STATUS_COLOR[st] || 'bg-gray-100 text-gray-600'}`}>
                              {data.unassigned.statusCounts[st]}
                            </span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      ))}
                    </tr>
                    {data.sales.length === 0 && (
                      <tr><td colSpan={statusList.length + 2} className="px-3 py-6 text-center text-gray-400">営業ユーザーがいません</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 未割当案件一覧 */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between flex-wrap gap-2">
                <h2 className="font-bold text-sm">
                  未割当案件 <span className="ml-2 text-xs text-gray-500">{filteredProjects.length} / {data.unassigned.total}件</span>
                </h2>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="企業名・求人番号・OPで検索"
                  className="border rounded px-2 py-1 text-sm w-64"
                />
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left">求人番号</th>
                      <th className="px-3 py-2 text-left">企業名</th>
                      <th className="px-3 py-2 text-left">担当OP</th>
                      <th className="px-3 py-2 text-left">ステータス</th>
                      <th className="px-3 py-2 text-left">案件獲得日</th>
                      <th className="px-3 py-2 text-left">面接日</th>
                      <th className="px-3 py-2 text-left">メモ</th>
                      <th className="px-3 py-2 text-left">営業を割り当て</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProjects.length === 0 ? (
                      <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">未割当案件はありません</td></tr>
                    ) : filteredProjects.map(p => (
                      <tr key={p.id} className="border-t hover:bg-gray-50">
                        <td className="px-3 py-2 text-xs text-gray-500">{p.job_number || '-'}</td>
                        <td className="px-3 py-2 font-medium">
                          <a
                            href={`/admin/projects?focus=${p.id}`}
                            className="text-blue-600 hover:underline"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {p.company_name || '-'}
                          </a>
                        </td>
                        <td className="px-3 py-2 text-xs">{p.owner_name || '-'}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_COLOR[p.status] || 'bg-gray-100 text-gray-600'}`}>
                            {STATUS_LABELS[p.status] || p.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs">{formatDate(p.created_at)}</td>
                        <td className="px-3 py-2 text-xs">{formatDate(p.interview_date)}</td>
                        <td className="px-3 py-2 text-xs text-gray-500 max-w-xs truncate">{p.memo || '-'}</td>
                        <td className="px-3 py-2">
                          <select
                            disabled={!!assigning[p.id]}
                            defaultValue=""
                            onChange={e => {
                              const v = e.target.value;
                              if (v) handleAssign(p.id, v);
                            }}
                            className="border rounded px-2 py-1 text-sm"
                          >
                            <option value="">選択...</option>
                            {salesUsers.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                          {assigning[p.id] && (
                            <span className="ml-2 text-xs text-gray-400">割り当て中...</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
