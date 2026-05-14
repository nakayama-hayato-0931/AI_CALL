/**
 * 業種別分析ページ
 * 各業種 × 月別で各種転換率を比較
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const METRICS = [
  { key: 'projectRate', label: '案件化率', num: 'projectCount', den: 'callCount', desc: '案件数 / コール数' },
  { key: 'naiteiPerProject', label: '内定率（案件比）', num: 'naiteiCount', den: 'projectCount', desc: '内定数 / 案件数' },
  { key: 'interviewPerProject', label: '面接実施率（案件比）', num: 'interviewDoneCount', den: 'projectCount', desc: '面接実施数 / 案件数' },
  { key: 'naiteiPerInterview', label: '内定率（面接比）', num: 'naiteiCount', den: 'interviewDoneCount', desc: '内定数 / 面接実施数' },
  { key: 'lostPerProject', label: '失注率（案件比）', num: 'lostCount', den: 'projectCount', desc: '失注数 / 案件数' },
  { key: 'barashiPerProject', label: 'バラシ率（案件比）', num: 'barashiCount', den: 'projectCount', desc: 'バラシ数 / 案件数' },
];

const COUNT_METRICS = [
  { key: 'projectCount', label: '案件数' },
  { key: 'callCount', label: 'コール数' },
  { key: 'naiteiCount', label: '内定数' },
  { key: 'interviewDoneCount', label: '面接実施数' },
  { key: 'lostCount', label: '失注数' },
  { key: 'barashiCount', label: 'バラシ数' },
];

const fmtMonth = (ym) => {
  const [y, m] = ym.split('-');
  return `${Number(m)}月`;
};

// 内定率系のグラデーション（高いほど良い）
const goodRateColor = (v) => {
  if (v >= 30) return 'bg-emerald-100 text-emerald-800';
  if (v >= 15) return 'bg-emerald-50 text-emerald-700';
  if (v >= 5) return 'bg-amber-50 text-amber-700';
  if (v > 0) return 'bg-red-50 text-red-600';
  return 'text-gray-300';
};
// 失注/バラシ率系のグラデーション（低いほど良い）
const badRateColor = (v) => {
  if (v >= 30) return 'bg-red-100 text-red-800';
  if (v >= 15) return 'bg-red-50 text-red-700';
  if (v >= 5) return 'bg-amber-50 text-amber-700';
  if (v > 0) return 'bg-emerald-50 text-emerald-700';
  return 'text-gray-300';
};

const colorForMetric = (metricKey, value) => {
  const v = Number(value) || 0;
  if (metricKey === 'lostPerProject' || metricKey === 'barashiPerProject') return badRateColor(v);
  return goodRateColor(v);
};

export default function IndustryAnalysisPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(6);
  const [selectedMetric, setSelectedMetric] = useState('projectRate');
  const [viewMode, setViewMode] = useState('rate'); // 'rate' | 'count'

  useEffect(() => {
    if (user && !['admin', 'manager', 'consultant'].includes(user.role)) {
      router.push('/');
      return;
    }
    if (user) fetchData();
  }, [user, months]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get(`/api/analytics/industry-monthly-analysis?months=${months}`);
      if (res.success) setData(res.data);
    } catch (err) {
      toast.error('業種別分析の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const currentMetric = METRICS.find(m => m.key === selectedMetric) || METRICS[0];

  if (!user) return null;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold">業種別分析</h1>
            <p className="text-sm text-gray-500 mt-1">
              業種カテゴリ × 月別の転換率比較。案件は獲得日（created_at）、内定は内定日（naitei_date）ベース。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">直近:</label>
            <select
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value={3}>3ヶ月</option>
              <option value={6}>6ヶ月</option>
              <option value={12}>12ヶ月</option>
              <option value={24}>24ヶ月</option>
            </select>
            <button onClick={fetchData} className="text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50">更新</button>
          </div>
        </div>

        {/* 表示モード: 率 / 件数 */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-3 w-fit">
          <button
            onClick={() => setViewMode('rate')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${viewMode === 'rate' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >率（％）</button>
          <button
            onClick={() => setViewMode('count')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${viewMode === 'count' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >件数</button>
        </div>

        {/* 指標切替（率モード時のみ） */}
        {viewMode === 'rate' && (
          <div className="flex flex-wrap gap-1 bg-gray-50 p-1.5 rounded-lg mb-4 border border-gray-200">
            {METRICS.map(m => (
              <button
                key={m.key}
                onClick={() => setSelectedMetric(m.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  selectedMetric === m.key
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
                title={m.desc}
              >{m.label}</button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-500">読み込み中...</div>
        ) : !data || data.industries.length === 0 ? (
          <div className="text-center py-12 text-gray-500">データがありません</div>
        ) : viewMode === 'rate' ? (
          /* 率モード: 単一指標 × 業種×月 のマトリクス */
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50">
              <h2 className="font-bold text-base">{currentMetric.label}</h2>
              <p className="text-xs text-gray-500 mt-0.5">{currentMetric.desc}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-base">
                <thead className="bg-gray-50 text-sm">
                  <tr>
                    <th className="px-4 py-3 text-left sticky left-0 bg-gray-50 z-10">業種</th>
                    {data.months.map(ym => (
                      <th key={ym} className="px-4 py-3 text-center whitespace-nowrap">{fmtMonth(ym)}</th>
                    ))}
                    <th className="px-4 py-3 text-center bg-blue-50 whitespace-nowrap">通算</th>
                  </tr>
                </thead>
                <tbody>
                  {data.industries.map(ind => (
                    <tr key={ind.industry} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium sticky left-0 bg-white">{ind.industry}</td>
                      {ind.monthlyData.map(m => {
                        const v = m[selectedMetric];
                        const denominator = m[currentMetric.den];
                        return (
                          <td key={m.ym} className="px-4 py-3 text-center">
                            {denominator > 0 ? (
                              <span
                                className={`inline-block px-2 py-0.5 rounded font-semibold ${colorForMetric(selectedMetric, v)}`}
                                title={`${m[currentMetric.num]} / ${denominator}`}
                              >
                                {v}%
                              </span>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-center bg-blue-50/40 font-bold">
                        {ind.total[currentMetric.den] > 0 ? (
                          <span
                            className={`inline-block px-2 py-0.5 rounded ${colorForMetric(selectedMetric, ind.total[selectedMetric])}`}
                            title={`${ind.total[currentMetric.num]} / ${ind.total[currentMetric.den]}`}
                          >
                            {ind.total[selectedMetric]}%
                          </span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* 件数モード: 全指標の生件数を業種×月で表示（指標タブ切替） */
          <div className="space-y-5">
            {COUNT_METRICS.map(metric => (
              <div key={metric.key} className="bg-white rounded-lg shadow overflow-hidden">
                <div className="px-4 py-2 border-b bg-gray-50">
                  <h3 className="font-bold text-sm">{metric.label}</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left sticky left-0 bg-gray-50">業種</th>
                        {data.months.map(ym => (
                          <th key={ym} className="px-3 py-2 text-center whitespace-nowrap">{fmtMonth(ym)}</th>
                        ))}
                        <th className="px-3 py-2 text-center bg-blue-50">通算</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.industries.map(ind => (
                        <tr key={ind.industry} className="border-t hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium sticky left-0 bg-white">{ind.industry}</td>
                          {ind.monthlyData.map(m => (
                            <td key={m.ym} className="px-3 py-2 text-center">
                              {m[metric.key] > 0 ? m[metric.key] : <span className="text-gray-300">-</span>}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-center bg-blue-50/40 font-bold">
                            {ind.total[metric.key] || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
