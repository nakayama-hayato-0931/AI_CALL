import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const PERIODS = [
  { value: 'daily', label: '日別' },
  { value: 'weekly', label: '週別' },
  { value: 'monthly', label: '月別' },
  { value: 'cumulative', label: '累計' },
];

export default function AdminPerformance() {
  const { user } = useAuth();
  const router = useRouter();
  const [period, setPeriod] = useState('daily');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);

  useEffect(() => {
    if (user && !['admin','manager','consultant'].includes(user.role)) { router.push('/'); return; }
    if (user) fetchPerformance();
  }, [user, period, date]);

  const fetchPerformance = async () => {
    try {
      const { data: res } = await api.get(`/api/admin/performance?period=${period}&date=${date}`);
      if (res.success) setData(res.data);
    } catch (err) { toast.error('成績取得に失敗しました'); }
  };

  if (!user || (!['admin','manager','consultant'].includes(user.role))) return null;

  const totals = data?.operators?.reduce((acc, op) => ({
    total_calls: acc.total_calls + (op.total_calls || 0),
    effective_connections: acc.effective_connections + (op.effective_connections || 0),
    person_connections: acc.person_connections + (op.person_connections || 0),
    projects: acc.projects + (op.projects || 0),
  }), { total_calls: 0, effective_connections: 0, person_connections: 0, projects: 0 });

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">オペレーター実績</h1>
        <div className="flex items-center gap-3">
          {period !== 'cumulative' && (
            <input type="date" className="input text-sm" value={date} onChange={e => setDate(e.target.value)} />
          )}
        </div>
      </div>

      {/* 期間タブ */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        {PERIODS.map(p => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              period === p.value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >{p.label}</button>
        ))}
      </div>

      {data && (
        <>
          {/* 期間表示 */}
          <p className="text-sm text-gray-500 mb-4">
            期間: {data.dateFrom === '2000-01-01' ? '全期間' : `${data.dateFrom} 〜 ${data.dateTo}`}
          </p>

          {/* 成績テーブル */}
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="table-header">オペレーター</th>
                  <th className="table-header text-right">架電数</th>
                  <th className="table-header text-right">有効接続</th>
                  <th className="table-header text-right">担当者接続</th>
                  <th className="table-header text-right">案件獲得</th>
                  <th className="table-header text-right">AI平均スコア</th>
                  <th className="table-header text-right">案件化率</th>
                </tr>
              </thead>
              <tbody>
                {[...data.operators].sort((a, b) => (a.role === 'intern') - (b.role === 'intern')).map(op => (
                  <tr key={op.user_id} className="border-b border-gray-100 hover:bg-blue-50/30 transition-colors">
                    <td className="table-cell font-medium">
                      <Link href={`/admin/performance/${op.user_id}`} className="text-blue-600 hover:text-blue-800 hover:underline">
                        {op.name}
                      </Link>
                    </td>
                    <td className="table-cell text-right">{op.total_calls}</td>
                    <td className="table-cell text-right">{op.effective_connections}</td>
                    <td className="table-cell text-right">{op.person_connections}</td>
                    <td className="table-cell text-right font-semibold text-blue-600">{op.projects}</td>
                    <td className="table-cell text-right">
                      {op.avg_ai_score > 0 ? (
                        <span className={`font-medium ${op.avg_ai_score >= 70 ? 'text-emerald-600' : op.avg_ai_score >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                          {op.avg_ai_score}
                        </span>
                      ) : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="table-cell text-right">
                      {op.total_calls > 0 ? `${((op.projects / op.total_calls) * 100).toFixed(1)}%` : '-'}
                    </td>
                  </tr>
                ))}
                {/* 合計行 */}
                {totals && (
                  <tr className="bg-blue-50/50 font-semibold">
                    <td className="table-cell">合計</td>
                    <td className="table-cell text-right">{totals.total_calls}</td>
                    <td className="table-cell text-right">{totals.effective_connections}</td>
                    <td className="table-cell text-right">{totals.person_connections}</td>
                    <td className="table-cell text-right text-blue-600">{totals.projects}</td>
                    <td className="table-cell text-right">-</td>
                    <td className="table-cell text-right">
                      {totals.total_calls > 0 ? `${((totals.projects / totals.total_calls) * 100).toFixed(1)}%` : '-'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {data.operators.length === 0 && (
              <div className="text-center py-8 text-gray-400">データがありません</div>
            )}
          </div>
        </>
      )}
    </Layout>
  );
}
