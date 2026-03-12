import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const ScoreBar = ({ label, score }) => (
  <div className="flex items-center gap-2">
    <span className="text-xs text-gray-500 w-16">{label}</span>
    <div className="flex-1 bg-gray-100 rounded-full h-2">
      <div className={`h-2 rounded-full ${score >= 70 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
        style={{ width: `${score}%` }} />
    </div>
    <span className="text-xs font-medium w-8 text-right">{score}</span>
  </div>
);

export default function AdminEvaluations() {
  const { user } = useAuth();
  const router = useRouter();
  const [evaluations, setEvaluations] = useState([]);
  const [pagination, setPagination] = useState({});
  const [operators, setOperators] = useState([]);
  const [filters, setFilters] = useState({ user_id: '', date_from: '', date_to: '' });
  const [expandedId, setExpandedId] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (user && user.role !== 'admin' && user.role !== 'manager') { router.push('/'); return; }
    if (user) { fetchOperators(); fetchEvaluations(); }
  }, [user]);

  useEffect(() => {
    if (user) fetchEvaluations();
  }, [page, filters]);

  const fetchOperators = async () => {
    try {
      const { data } = await api.get('/api/admin/users');
      if (data.success) setOperators(data.data.filter(u => u.role === 'operator' && u.is_active));
    } catch (err) { /* ignore */ }
  };

  const fetchEvaluations = async () => {
    try {
      const params = new URLSearchParams({ page, limit: 20 });
      if (filters.user_id) params.append('user_id', filters.user_id);
      if (filters.date_from) params.append('date_from', filters.date_from);
      if (filters.date_to) params.append('date_to', filters.date_to);
      const { data } = await api.get(`/api/ai/admin/evaluations?${params}`);
      if (data.success) {
        setEvaluations(data.data.evaluations);
        setPagination(data.data.pagination);
      }
    } catch (err) { toast.error('評価取得に失敗しました'); }
  };

  const handleRunEvaluation = async (targetUserId, targetDate) => {
    if (!confirm('このオペレーターのAI評価を実行しますか？')) return;
    try {
      const { data } = await api.post('/api/ai/evaluate-daily', {
        date: targetDate,
        target_user_id: targetUserId,
      });
      toast.success(`${data.data.evaluatedCount}件の評価を実行しました`);
      fetchEvaluations();
    } catch (err) { toast.error(err.response?.data?.message || '評価に失敗しました'); }
  };

  if (!user || (user.role !== 'admin' && user.role !== 'manager')) return null;

  return (
    <Layout>
      <h1 className="text-xl font-bold text-gray-900 mb-6">AI評価一覧</h1>

      {/* フィルター */}
      <div className="card p-4 mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="input-label">オペレーター</label>
          <select className="input text-sm" value={filters.user_id}
            onChange={e => { setFilters({...filters, user_id: e.target.value}); setPage(1); }}>
            <option value="">全員</option>
            {operators.map(op => <option key={op.id} value={op.id}>{op.name}</option>)}
          </select>
        </div>
        <div>
          <label className="input-label">開始日</label>
          <input type="date" className="input text-sm" value={filters.date_from}
            onChange={e => { setFilters({...filters, date_from: e.target.value}); setPage(1); }} />
        </div>
        <div>
          <label className="input-label">終了日</label>
          <input type="date" className="input text-sm" value={filters.date_to}
            onChange={e => { setFilters({...filters, date_to: e.target.value}); setPage(1); }} />
        </div>
        {filters.user_id && filters.date_from && (
          <button onClick={() => handleRunEvaluation(filters.user_id, filters.date_from)}
            className="btn-primary text-sm">AI評価実行</button>
        )}
      </div>

      {/* 評価リスト */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="table-header">OP</th>
              <th className="table-header">企業名</th>
              <th className="table-header">日時</th>
              <th className="table-header">結果</th>
              <th className="table-header text-right">総合</th>
              <th className="table-header"></th>
            </tr>
          </thead>
          <tbody>
            {evaluations.map(ev => (
              <>
                <tr key={ev.id} className="border-b border-gray-100 hover:bg-gray-50/50 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === ev.id ? null : ev.id)}>
                  <td className="table-cell font-medium">{ev.operator_name}</td>
                  <td className="table-cell">{ev.company_name}</td>
                  <td className="table-cell text-gray-400">{new Date(ev.call_started_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="table-cell">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      ev.result_code === 'PROJECT' ? 'bg-blue-100 text-blue-700' :
                      ev.result_code === 'INTERESTED' ? 'bg-emerald-100 text-emerald-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{ev.result_code}</span>
                  </td>
                  <td className="table-cell text-right">
                    <span className={`text-lg font-bold ${ev.overall_score >= 70 ? 'text-emerald-600' : ev.overall_score >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                      {ev.overall_score}
                    </span>
                  </td>
                  <td className="table-cell text-gray-400">{expandedId === ev.id ? '▲' : '▼'}</td>
                </tr>
                {expandedId === ev.id && (
                  <tr key={`${ev.id}-detail`}>
                    <td colSpan="6" className="p-4 bg-gray-50/50">
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <ScoreBar label="オープニング" score={ev.opening_score} />
                          <ScoreBar label="明瞭さ" score={ev.clarity_score} />
                          <ScoreBar label="ヒアリング" score={ev.hearing_score} />
                          <ScoreBar label="切り返し" score={ev.rebuttal_score} />
                          <ScoreBar label="クロージング" score={ev.closing_score} />
                        </div>
                        <div className="text-xs space-y-2">
                          <div><span className="font-semibold text-gray-700">要約:</span> <span className="text-gray-600">{ev.summary}</span></div>
                          {ev.good_points && <div><span className="font-semibold text-emerald-700">良い点:</span> <span className="text-gray-600">{ev.good_points}</span></div>}
                          {ev.improvement_points && <div><span className="font-semibold text-amber-700">改善点:</span> <span className="text-gray-600">{ev.improvement_points}</span></div>}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        {evaluations.length === 0 && (
          <div className="text-center py-8 text-gray-400">評価データがありません</div>
        )}
      </div>

      {/* ページネーション */}
      {pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`px-3 py-1 rounded text-sm ${p === page ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>{p}</button>
          ))}
        </div>
      )}
    </Layout>
  );
}
