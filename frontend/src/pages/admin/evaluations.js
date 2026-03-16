import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
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

const ScoreBar = ({ label, score }) => (
  <div className="flex items-center gap-2">
    <span className="text-xs text-gray-500 w-20">{label}</span>
    <div className="flex-1 bg-gray-100 rounded-full h-2.5">
      <div className={`h-2.5 rounded-full transition-all ${score >= 70 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
        style={{ width: `${score}%` }} />
    </div>
    <span className={`text-xs font-bold w-8 text-right ${score >= 70 ? 'text-emerald-600' : score >= 50 ? 'text-amber-600' : 'text-red-500'}`}>{score}</span>
  </div>
);

const ScoreCircle = ({ score, size = 56 }) => {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={radius} strokeWidth="4" fill="none" stroke="#f1f5f9" />
        <circle cx={size/2} cy={size/2} r={radius} strokeWidth="4" fill="none" stroke={color}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-500" />
      </svg>
      <span className="absolute text-sm font-bold" style={{ color }}>{score}</span>
    </div>
  );
};

// 月内の週リストを計算
const getWeeksInMonth = (yearMonth) => {
  const [year, month] = yearMonth.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const weeks = [
    { num: 1, label: '第1週 (1日〜7日)' },
    { num: 2, label: '第2週 (8日〜14日)' },
    { num: 3, label: '第3週 (15日〜21日)' },
    { num: 4, label: '第4週 (22日〜28日)' },
  ];
  if (lastDay > 28) {
    weeks.push({ num: 5, label: `第5週 (29日〜${lastDay}日)` });
  }
  return weeks;
};

/** 期間からdate_from / date_to を計算 */
const calcDateRange = (period, dailyDate, month, weekNum) => {
  const pad = (n) => String(n).padStart(2, '0');
  switch (period) {
    case 'daily':
      return { date_from: dailyDate, date_to: dailyDate };
    case 'weekly': {
      const [year, m] = month.split('-').map(Number);
      const lastDay = new Date(year, m, 0).getDate();
      const fromDay = (weekNum - 1) * 7 + 1;
      const toDay = weekNum === 5 ? lastDay : Math.min(weekNum * 7, lastDay);
      return { date_from: `${year}-${pad(m)}-${pad(fromDay)}`, date_to: `${year}-${pad(m)}-${pad(toDay)}` };
    }
    case 'monthly': {
      const [year, m] = month.split('-').map(Number);
      const lastDay = new Date(year, m, 0).getDate();
      return { date_from: `${year}-${pad(m)}-01`, date_to: `${year}-${pad(m)}-${pad(lastDay)}` };
    }
    case 'cumulative':
      return { date_from: '', date_to: '' };
    default:
      return { date_from: '', date_to: '' };
  }
};

export default function AdminEvaluations() {
  const { user } = useAuth();
  const router = useRouter();
  const [evaluations, setEvaluations] = useState([]);
  const [pagination, setPagination] = useState({});
  const [operators, setOperators] = useState([]);
  const [period, setPeriod] = useState('daily');
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().slice(0, 10));
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [weekNum, setWeekNum] = useState(() => {
    const d = new Date().getDate();
    return Math.min(Math.ceil(d / 7), 5);
  });
  const [filters, setFilters] = useState({ user_id: '', date_from: '', date_to: '' });
  const [expandedId, setExpandedId] = useState(null);
  const [expandedTranscript, setExpandedTranscript] = useState(null);
  const [page, setPage] = useState(1);
  const [summaryStats, setSummaryStats] = useState(null);

  useEffect(() => {
    if (user && user.role !== 'admin' && user.role !== 'manager') { router.push('/'); return; }
    if (user) fetchOperators();
  }, [user]);

  // 期間変更時にフィルターの日付を自動設定
  useEffect(() => {
    const range = calcDateRange(period, dailyDate, month, weekNum);
    setFilters(f => ({ ...f, date_from: range.date_from, date_to: range.date_to }));
    setPage(1);
  }, [period, dailyDate, month, weekNum]);

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
        // サマリー計算
        const evals = data.data.evaluations;
        if (evals.length > 0) {
          const avgScore = Math.round(evals.reduce((s, e) => s + (e.overall_score || 0), 0) / evals.length);
          setSummaryStats({ count: data.data.pagination.total, avgScore });
        } else {
          setSummaryStats(null);
        }
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
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">AI評価一覧</h1>
        <p className="text-sm text-gray-400 mt-0.5">オペレーターのAI評価結果を閲覧・管理</p>
      </div>

      {/* 期間タブ */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                period === p.value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>{p.label}</button>
          ))}
        </div>
        {period === 'daily' && (
          <input type="date" className="input text-sm" value={dailyDate} onChange={e => setDailyDate(e.target.value)} />
        )}
        {period === 'weekly' && (
          <>
            <input type="month" className="input text-sm" value={month}
              onChange={e => { setMonth(e.target.value); setWeekNum(1); }} />
            <select className="input text-sm" value={weekNum}
              onChange={e => setWeekNum(Number(e.target.value))}>
              {getWeeksInMonth(month).map(w => (
                <option key={w.num} value={w.num}>{w.label}</option>
              ))}
            </select>
          </>
        )}
        {period === 'monthly' && (
          <input type="month" className="input text-sm" value={month}
            onChange={e => setMonth(e.target.value)} />
        )}
      </div>

      {/* サマリーカード */}
      {summaryStats && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="card p-4">
            <p className="text-[11px] font-medium text-gray-400 mb-1">評価件数</p>
            <p className="text-2xl font-bold text-gray-900">{summaryStats.count}<span className="text-xs text-gray-400 ml-1">件</span></p>
          </div>
          <div className="card p-4">
            <p className="text-[11px] font-medium text-gray-400 mb-1">平均スコア</p>
            <p className={`text-2xl font-bold ${summaryStats.avgScore >= 70 ? 'text-emerald-600' : summaryStats.avgScore >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
              {summaryStats.avgScore}<span className="text-xs text-gray-400 ml-1">点</span>
            </p>
          </div>
        </div>
      )}

      {/* フィルター */}
      <div className="card p-4 mb-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="input-label">オペレーター</label>
          <select className="input text-sm" value={filters.user_id}
            onChange={e => { setFilters({...filters, user_id: e.target.value}); setPage(1); }}>
            <option value="">全員</option>
            {operators.map(op => <option key={op.id} value={op.id}>{op.name}</option>)}
          </select>
        </div>
        {filters.user_id && (period === 'daily') && (
          <button onClick={() => handleRunEvaluation(filters.user_id, dailyDate)}
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
              <tr key={ev.id} className="border-b border-gray-100 hover:bg-gray-50/50 cursor-pointer group"
                onClick={() => setExpandedId(expandedId === ev.id ? null : ev.id)}>
                <td colSpan="6" className="p-0">
                  {/* メイン行 */}
                  <div className="flex items-center">
                    <div className="table-cell font-medium flex-shrink-0 w-24">{ev.operator_name}</div>
                    <div className="table-cell flex-1">{ev.company_name}</div>
                    <div className="table-cell text-gray-400 flex-shrink-0 w-28">
                      {new Date(ev.call_started_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="table-cell flex-shrink-0 w-28">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        ev.result_code === 'PROJECT' ? 'bg-blue-100 text-blue-700' :
                        ev.result_code === 'INTERESTED' ? 'bg-emerald-100 text-emerald-700' :
                        ev.result_code === 'RECALL' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{ev.result_code}</span>
                    </div>
                    <div className="table-cell text-right flex-shrink-0 w-16">
                      <ScoreCircle score={ev.overall_score} size={40} />
                    </div>
                    <div className="table-cell text-gray-400 flex-shrink-0 w-8">{expandedId === ev.id ? '▲' : '▼'}</div>
                  </div>

                  {/* 展開詳細 */}
                  {expandedId === ev.id && (
                    <div className="px-4 pb-4 pt-2 bg-gray-50/50 border-t border-gray-100" onClick={e => e.stopPropagation()}>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* スコアバー */}
                        <div className="space-y-2.5">
                          <ScoreBar label="オープニング" score={ev.opening_score} />
                          <ScoreBar label="明瞭さ" score={ev.clarity_score} />
                          <ScoreBar label="ヒアリング" score={ev.hearing_score} />
                          <ScoreBar label="切り返し" score={ev.rebuttal_score} />
                          <ScoreBar label="クロージング" score={ev.closing_score} />
                        </div>
                        {/* フィードバック */}
                        <div className="space-y-2">
                          <div className="bg-white rounded-lg p-3 border border-gray-100">
                            <p className="text-[11px] font-semibold text-gray-500 mb-1">要約</p>
                            <p className="text-xs text-gray-700">{ev.summary}</p>
                          </div>
                          {ev.good_points && (
                            <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
                              <p className="text-[11px] font-semibold text-emerald-700 mb-1">良い点</p>
                              <p className="text-xs text-emerald-800 whitespace-pre-line">{ev.good_points}</p>
                            </div>
                          )}
                          {ev.improvement_points && (
                            <div className="bg-red-50 rounded-lg p-3 border border-red-100">
                              <p className="text-[11px] font-semibold text-red-700 mb-1">改善点</p>
                              <p className="text-xs text-red-800 whitespace-pre-line">{ev.improvement_points}</p>
                            </div>
                          )}
                          {ev.next_improvement && (
                            <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                              <p className="text-[11px] font-semibold text-blue-700 mb-1">次回アクション</p>
                              <p className="text-xs text-blue-800">{ev.next_improvement}</p>
                            </div>
                          )}
                        </div>
                      </div>
                      {ev.transcript && (
                        <div className="mt-3">
                          <button
                            onClick={() => setExpandedTranscript(expandedTranscript === ev.id ? null : ev.id)}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                              <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                            </svg>
                            {expandedTranscript === ev.id ? '通話ログを閉じる' : '通話ログを表示'}
                          </button>
                          {expandedTranscript === ev.id && (
                            <div className="mt-2 bg-white border border-gray-200 rounded-lg p-3 max-h-80 overflow-y-auto">
                              <pre className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">{ev.transcript}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </td>
              </tr>
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
          {Array.from({ length: Math.min(pagination.totalPages, 10) }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`px-3 py-1 rounded text-sm ${p === page ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>{p}</button>
          ))}
        </div>
      )}
    </Layout>
  );
}
