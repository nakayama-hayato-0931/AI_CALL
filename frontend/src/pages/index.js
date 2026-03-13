/**
 * ダッシュボードページ
 * KPI表示 + グラフ (時間帯別コール、業種別案件化率)
 */
import { useState, useEffect } from 'react';
import Layout from '../components/common/Layout';
import api from '../utils/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const KPI_CONFIG = [
  { key: 'workMinutes', label: '稼働時間', suffix: '分', gradient: 'from-blue-500 to-blue-600' },
  { key: 'callCount', label: 'コール数', suffix: '件', gradient: 'from-sky-500 to-cyan-600' },
  { key: 'recallGained', label: 'リコール獲得', suffix: '件', gradient: 'from-emerald-500 to-green-600' },
  { key: 'recallDone', label: 'リコール消化', suffix: '件', gradient: 'from-teal-500 to-emerald-600' },
  { key: 'effectiveCount', label: '有効接続', suffix: '件', gradient: 'from-amber-500 to-orange-500' },
  { key: 'personCount', label: '担当接続', suffix: '件', gradient: 'from-violet-500 to-purple-600' },
  { key: 'projectCount', label: '案件獲得', suffix: '件', gradient: 'from-rose-500 to-pink-600' },
];

const KpiIcon = ({ type }) => {
  const cls = "w-5 h-5 text-white/90";
  const p = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", className: cls };
  const iconMap = {
    'from-blue-500 to-blue-600': <svg {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
    'from-sky-500 to-cyan-600': <svg {...p}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" /></svg>,
    'from-emerald-500 to-green-600': <svg {...p}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>,
    'from-teal-500 to-emerald-600': <svg {...p}><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>,
    'from-amber-500 to-orange-500': <svg {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>,
    'from-violet-500 to-purple-600': <svg {...p}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>,
    'from-rose-500 to-pink-600': <svg {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>,
  };
  return iconMap[type] || null;
};

const KpiCard = ({ config, value }) => (
  <div className="card p-4 animate-fade-in">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-[11px] font-medium text-gray-400 mb-1">{config.label}</p>
        <p className="text-2xl font-bold text-gray-900 tracking-tight">
          {value ?? 0}
          <span className="text-xs font-medium text-gray-400 ml-0.5">{config.suffix}</span>
        </p>
      </div>
      <div className={`w-9 h-9 bg-gradient-to-br ${config.gradient} rounded-lg flex items-center justify-center shadow-sm`}>
        <KpiIcon type={config.gradient} />
      </div>
    </div>
  </div>
);

const CustomBarTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-lg shadow-lg px-3 py-2 text-sm">
      <p className="font-medium text-gray-700">{label}時台</p>
      <p className="text-blue-600 font-bold">{payload[0].value}件</p>
    </div>
  );
};

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [hourlyCalls, setHourlyCalls] = useState([]);
  const [industryData, setIndustryData] = useState([]);
  const [connectionTable, setConnectionTable] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, hourlyRes, industryRes, connRes] = await Promise.all([
        api.get('/api/dashboard/stats'),
        api.get('/api/dashboard/hourly-calls'),
        api.get('/api/dashboard/industry-conversion'),
        api.get('/api/dashboard/hourly-industry-connections'),
      ]);
      setStats(statsRes.data.data);
      setHourlyCalls(hourlyRes.data.data);
      setIndustryData(industryRes.data.data);
      setConnectionTable(connRes.data.data);
    } catch (err) {
      console.error('ダッシュボードデータ取得失敗:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3 text-gray-400">
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm">読み込み中...</span>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">ダッシュボード</h1>
        <p className="text-sm text-gray-400 mt-0.5">本日の営業活動サマリー</p>
      </div>

      {/* KPIカード */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-6">
        {KPI_CONFIG.map((config) => (
          <KpiCard key={config.key} config={config} value={stats?.[config.key]} />
        ))}
      </div>

      {/* グラフエリア */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-5">
          <h2 className="text-sm font-bold text-gray-800 mb-4">時間帯別コール数</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={hourlyCalls} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="hour" tickFormatter={(h) => `${h}時`} fontSize={11} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} tick={{ fill: '#94a3b8' }} />
              <YAxis fontSize={11} tickLine={false} axisLine={false} tick={{ fill: '#94a3b8' }} />
              <Tooltip content={<CustomBarTooltip />} cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="count" fill="#3b82f6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-bold text-gray-800 mb-4">業種別案件化率</h2>
          {industryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={industryData} dataKey="total_calls" nameKey="industry" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} label={({ industry, conversion_rate }) => `${industry} ${conversion_rate}%`}>
                  {industryData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.07)', fontSize: '13px' }} />
                <Legend wrapperStyle={{ fontSize: '12px' }} iconType="circle" iconSize={8} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[260px] text-gray-400 text-sm">データなし</div>
          )}
        </div>
      </div>
      {/* 時間帯×業種別 接続数テーブル */}
      <div className="card mt-5 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-800">時間帯×業種別 接続数</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">不通を除く接続数のクロス集計</p>
        </div>
        {connectionTable && connectionTable.industries.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-3 py-2 text-left text-gray-500 font-semibold">時間</th>
                  {connectionTable.industries.map((ind, i) => (
                    <th key={ind} className="px-3 py-2 text-center font-semibold" style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>{ind}</th>
                  ))}
                  <th className="px-3 py-2 text-center text-gray-700 font-bold">合計</th>
                </tr>
              </thead>
              <tbody>
                {connectionTable.rows.map((row) => (
                  <tr key={row.hour} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                    <td className="px-3 py-1.5 text-gray-500 font-medium">{row.hour}時</td>
                    {connectionTable.industries.map((ind) => (
                      <td key={ind} className={`px-3 py-1.5 text-center ${row[ind] > 0 ? 'text-gray-900 font-bold' : 'text-gray-300'}`}>
                        {row[ind] || 0}
                      </td>
                    ))}
                    <td className={`px-3 py-1.5 text-center font-bold ${row.total > 0 ? 'text-blue-700' : 'text-gray-300'}`}>
                      {row.total}
                    </td>
                  </tr>
                ))}
                {/* 合計行 */}
                <tr className="bg-gray-50 border-t border-gray-200">
                  <td className="px-3 py-2 text-gray-700 font-bold">合計</td>
                  {connectionTable.industries.map((ind, i) => (
                    <td key={ind} className="px-3 py-2 text-center font-bold" style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>
                      {connectionTable.totals[ind] || 0}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center font-bold text-blue-700">{connectionTable.totals.total || 0}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">データなし</div>
        )}
      </div>
    </Layout>
  );
}
