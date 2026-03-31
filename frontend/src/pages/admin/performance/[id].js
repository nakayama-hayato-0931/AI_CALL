import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '../../../components/common/Layout';
import useAuth from '../../../hooks/useAuth';
import api, { directApi } from '../../../utils/api';
import toast from 'react-hot-toast';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

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
        style={{ width: `${Math.min(score, 100)}%` }} />
    </div>
    <span className={`text-xs font-bold w-8 text-right ${score >= 70 ? 'text-emerald-600' : score >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
      {score || '-'}
    </span>
  </div>
);

const ScoreCircle = ({ score, size = 80, label }) => {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - ((score || 0) / 100) * circumference;
  const color = score >= 70 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex flex-col items-center">
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg className="transform -rotate-90" width={size} height={size}>
          <circle cx={size/2} cy={size/2} r={radius} strokeWidth="5" fill="none" stroke="#f1f5f9" />
          <circle cx={size/2} cy={size/2} r={radius} strokeWidth="5" fill="none" stroke={color}
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-500" />
        </svg>
        <span className="absolute text-lg font-bold" style={{ color }}>{score || '-'}</span>
      </div>
      {label && <p className="text-[11px] text-gray-400 mt-1">{label}</p>}
    </div>
  );
};

const StatCard = ({ label, value, suffix, color }) => (
  <div className="card p-4">
    <p className="text-[11px] font-medium text-gray-400 mb-1">{label}</p>
    <p className={`text-2xl font-bold ${color || 'text-gray-900'}`}>
      {value ?? 0}<span className="text-xs font-medium text-gray-400 ml-0.5">{suffix}</span>
    </p>
  </div>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-medium text-gray-700 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {p.value}点</p>
      ))}
    </div>
  );
};

export default function OperatorDetailPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { id } = router.query;
  const [period, setPeriod] = useState('monthly');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [coaching, setCoaching] = useState(null);
  const [coachingLoading, setCoachingLoading] = useState(false);

  useEffect(() => {
    if (user && !['admin','manager','consultant'].includes(user.role)) { router.push('/'); return; }
    if (user && id) fetchDetail();
  }, [user, id, period, date]);

  const fetchDetail = async () => {
    try {
      setLoading(true);
      const { data: res } = await api.get(`/api/ai/analysis/operator/${id}?period=${period}&date=${date}`);
      if (res.success) setData(res.data);
    } catch (err) {
      toast.error('データ取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleCoaching = async () => {
    try {
      setCoachingLoading(true);
      setCoaching(null);
      const { data: res } = await directApi.post(`/api/ai/analysis/operator/${id}/coaching`, { period, date });
      if (res.success) {
        if (res.data.coaching) {
          setCoaching(res.data.coaching);
        } else {
          toast.error(res.data.message || 'データが不足しています');
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'コーチング生成に失敗しました');
    } finally {
      setCoachingLoading(false);
    }
  };

  if (!user || (!['admin','manager','consultant'].includes(user.role))) return null;

  const stats = data?.stats;
  const scoreAvgs = data?.scoreAvgs;
  const trend = data?.trend || [];

  // 推移チャート用データ
  const chartData = trend.map(t => ({
    date: new Date(t.date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }),
    総合: t.avg_score,
    第一声: t.avg_opening,
    明瞭さ: t.avg_clarity,
    ヒアリング: t.avg_hearing,
    切り返し: t.avg_rebuttal,
    クロージング: t.avg_closing,
  }));

  return (
    <Layout>
      {/* ヘッダー */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/performance" className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">
            {data?.operator?.name || '読み込み中...'}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">個人パフォーマンス詳細</p>
        </div>
      </div>

      {/* 期間タブ + 日付 */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                period === p.value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>{p.label}</button>
          ))}
        </div>
        {period !== 'cumulative' && (
          <input type="date" className="input text-sm" value={date} onChange={e => setDate(e.target.value)} />
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3 text-gray-400">
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm">読み込み中...</span>
          </div>
        </div>
      ) : data ? (
        <>
          {/* 期間表示 */}
          <p className="text-sm text-gray-500 mb-4">
            期間: {data.dateFrom === '2000-01-01' ? '全期間' : `${data.dateFrom} 〜 ${data.dateTo}`}
          </p>

          {/* コール統計カード */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="架電数" value={stats?.total_calls} suffix="件" />
            <StatCard label="有効接続" value={stats?.effective_connections} suffix="件" />
            <StatCard label="担当者接続" value={stats?.person_connections} suffix="件" />
            <StatCard label="案件獲得" value={stats?.projects} suffix="件" color="text-blue-600" />
          </div>

          {/* スコア平均 + 推移チャート */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
            {/* スコア内訳 */}
            <div className="card p-5">
              <h2 className="text-sm font-bold text-gray-800 mb-4">スコア内訳（平均）</h2>
              <div className="flex items-center gap-6 mb-4">
                <ScoreCircle score={scoreAvgs?.overall} size={80} label="総合スコア" />
                <div className="text-xs text-gray-500">
                  <p>評価件数: <span className="font-bold text-gray-700">{scoreAvgs?.eval_count || 0}</span>件</p>
                  <p className="mt-1">案件化率: <span className="font-bold text-gray-700">
                    {stats?.total_calls > 0 ? ((stats.projects / stats.total_calls) * 100).toFixed(1) : 0}%
                  </span></p>
                </div>
              </div>
              <div className="space-y-2.5">
                <ScoreBar label="第一声" score={scoreAvgs?.opening || 0} />
                <ScoreBar label="明瞭さ" score={scoreAvgs?.clarity || 0} />
                <ScoreBar label="ヒアリング" score={scoreAvgs?.hearing || 0} />
                <ScoreBar label="切り返し" score={scoreAvgs?.rebuttal || 0} />
                <ScoreBar label="クロージング" score={scoreAvgs?.closing || 0} />
              </div>
            </div>

            {/* 推移チャート */}
            <div className="card p-5">
              <h2 className="text-sm font-bold text-gray-800 mb-4">スコア推移</h2>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" fontSize={11} tickLine={false} tick={{ fill: '#94a3b8' }} />
                    <YAxis domain={[0, 100]} fontSize={11} tickLine={false} axisLine={false} tick={{ fill: '#94a3b8' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} iconSize={8} />
                    <Line type="monotone" dataKey="総合" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="第一声" stroke="#10b981" strokeWidth={1} dot={false} strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="ヒアリング" stroke="#f59e0b" strokeWidth={1} dot={false} strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="切り返し" stroke="#ef4444" strokeWidth={1} dot={false} strokeDasharray="3 3" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[260px] text-gray-400 text-sm">推移データなし</div>
              )}
            </div>
          </div>

          {/* AIコーチング */}
          <div className="card p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-gray-800">AIコーチング</h2>
              <button onClick={handleCoaching} disabled={coachingLoading}
                className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
                {coachingLoading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    分析中...
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                      <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                    </svg>
                    AIコーチング生成
                  </>
                )}
              </button>
            </div>

            {coaching ? (
              <div className="space-y-4">
                {/* コーチングスコア + サマリー */}
                <div className="flex items-start gap-4">
                  <ScoreCircle score={coaching.coaching_score} size={64} />
                  <p className="text-sm text-gray-700 flex-1">{coaching.summary}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* 強み */}
                  <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-100">
                    <p className="text-xs font-bold text-emerald-700 mb-2">強み</p>
                    <ul className="text-xs text-emerald-800 space-y-1">
                      {coaching.strengths?.map((s, i) => <li key={i}>・{s}</li>)}
                    </ul>
                  </div>
                  {/* 課題 */}
                  <div className="bg-red-50 rounded-lg p-4 border border-red-100">
                    <p className="text-xs font-bold text-red-700 mb-2">課題</p>
                    <ul className="text-xs text-red-800 space-y-1">
                      {coaching.weaknesses?.map((w, i) => <li key={i}>・{w}</li>)}
                    </ul>
                  </div>
                </div>

                {/* アクションアイテム */}
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                  <p className="text-xs font-bold text-blue-700 mb-2">アクションプラン</p>
                  <ul className="text-xs text-blue-800 space-y-1">
                    {coaching.action_items?.map((a, i) => <li key={i}>✓ {a}</li>)}
                  </ul>
                </div>

                {/* スキル別アドバイス */}
                {coaching.skill_advice && (
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                    <p className="text-xs font-bold text-gray-700 mb-2">スキル別アドバイス</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      {Object.entries(coaching.skill_advice).map(([key, advice]) => (
                        <div key={key} className="bg-white rounded p-2">
                          <span className="font-semibold text-gray-600">
                            {key === 'opening' ? '第一声' : key === 'clarity' ? '明瞭さ' : key === 'hearing' ? 'ヒアリング' : key === 'rebuttal' ? '切り返し' : 'クロージング'}:
                          </span>
                          <span className="text-gray-500 ml-1">{advice}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-6">
                「AIコーチング生成」ボタンを押すと、この期間のデータを元にAIがコーチングアドバイスを生成します
              </p>
            )}
          </div>

          {/* 直近の評価一覧 */}
          {data.evaluations?.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h2 className="text-sm font-bold text-gray-800">直近の評価一覧</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-header">企業名</th>
                    <th className="table-header">日時</th>
                    <th className="table-header">結果</th>
                    <th className="table-header text-right">総合</th>
                    <th className="table-header text-right">第一声</th>
                    <th className="table-header text-right">明瞭さ</th>
                    <th className="table-header text-right">ヒアリング</th>
                    <th className="table-header text-right">切り返し</th>
                    <th className="table-header text-right">クロージング</th>
                  </tr>
                </thead>
                <tbody>
                  {data.evaluations.map(ev => (
                    <tr key={ev.id} className="border-b border-gray-100 hover:bg-blue-50/30 transition-colors">
                      <td className="table-cell">{ev.company_name}</td>
                      <td className="table-cell text-gray-400">
                        {new Date(ev.call_started_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="table-cell">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          ev.result_code === 'PROJECT' ? 'bg-blue-100 text-blue-700' :
                          ev.result_code === 'INTERESTED' ? 'bg-emerald-100 text-emerald-700' :
                          ev.result_code === 'RECALL' ? 'bg-amber-100 text-amber-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>{ev.result_code}</span>
                      </td>
                      <td className="table-cell text-right">
                        <span className={`font-bold ${ev.overall_score >= 70 ? 'text-emerald-600' : ev.overall_score >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                          {ev.overall_score}
                        </span>
                      </td>
                      <td className="table-cell text-right text-gray-500">{ev.opening_score}</td>
                      <td className="table-cell text-right text-gray-500">{ev.clarity_score}</td>
                      <td className="table-cell text-right text-gray-500">{ev.hearing_score}</td>
                      <td className="table-cell text-right text-gray-500">{ev.rebuttal_score}</td>
                      <td className="table-cell text-right text-gray-500">{ev.closing_score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-8 text-gray-400">データがありません</div>
      )}
    </Layout>
  );
}
