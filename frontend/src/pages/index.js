/**
 * ダッシュボードページ
 * KPI表示 + グラフ (時間帯別コール、業種別案件化率) + AI総合分析
 */
import { useState, useEffect } from 'react';
import Layout from '../components/common/Layout';
import useAuth from '../hooks/useAuth';
import api from '../utils/api';
import toast from 'react-hot-toast';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const PERIODS = [
  { value: 'daily', label: '日別' },
  { value: 'weekly', label: '週別' },
  { value: 'monthly', label: '月別' },
  { value: 'cumulative', label: '累計' },
];

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

const ScoreCircle = ({ score, size = 64 }) => {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - ((score || 0) / 100) * circumference;
  const color = score >= 70 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={radius} strokeWidth="4" fill="none" stroke="#f1f5f9" />
        <circle cx={size/2} cy={size/2} r={radius} strokeWidth="4" fill="none" stroke={color}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-500" />
      </svg>
      <span className="absolute text-sm font-bold" style={{ color }}>{score || '-'}</span>
    </div>
  );
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [hourlyCalls, setHourlyCalls] = useState([]);
  const [industryData, setIndustryData] = useState([]);
  const [connectionTable, setConnectionTable] = useState(null);
  const [loading, setLoading] = useState(true);

  // KPI期間・スコープ切替
  const [kpiPeriod, setKpiPeriod] = useState('daily');
  const [kpiScope, setKpiScope] = useState('team');
  const [kpiTargetUserId, setKpiTargetUserId] = useState(null);
  const [operators, setOperators] = useState([]);

  // 稼働時間編集
  const [showWorkHoursModal, setShowWorkHoursModal] = useState(false);
  const [workStartTime, setWorkStartTime] = useState('09:30');
  const [workEndTime, setWorkEndTime] = useState('18:00');
  const [savingWorkHours, setSavingWorkHours] = useState(false);

  // 時間文字列を分に変換するヘルパー
  const parseTimeToMinutes = (t) => {
    const [h, m] = (t || '0:0').split(':').map(Number);
    return h * 60 + m;
  };

  // 稼働時間を計算（時間単位）
  const calcWorkHours = (start, end) => {
    const diff = parseTimeToMinutes(end) - parseTimeToMinutes(start);
    return diff > 0 ? (diff / 60) : 0;
  };

  // 稼働時間保存
  const handleSaveWorkHours = async () => {
    setSavingWorkHours(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await api.post('/api/dashboard/work-hours', {
        date: today, start_time: workStartTime, end_time: workEndTime,
      });
      setStats(prev => ({
        ...prev,
        manualWorkHours: { start_time: workStartTime, end_time: workEndTime },
      }));
      setShowWorkHoursModal(false);
      toast.success('稼働時間を保存しました');
    } catch (err) {
      toast.error('保存に失敗しました');
    } finally {
      setSavingWorkHours(false);
    }
  };

  // コールデータコピー（値のみ改行区切り）
  const handleCopyCallData = () => {
    if (!stats) return;
    const wh = stats.manualWorkHours;
    const workValue = wh ? calcWorkHours(wh.start_time, wh.end_time) : (stats.workMinutes || 0);
    const lines = [workValue, stats.callCount || 0, stats.recallGained || 0,
      stats.recallDone || 0, stats.effectiveCount || 0, stats.personCount || 0, stats.projectCount || 0];
    navigator.clipboard.writeText(lines.join('\n'));
    toast.success('コールデータをコピーしました');
  };

  // 日報報告用コピー
  const handleCopyDailyReport = () => {
    if (!stats) return;
    const wh = stats.manualWorkHours;
    const workTimeStr = wh ? `${wh.start_time}〜${wh.end_time}` : `${stats.workMinutes || 0}分`;
    const lines = [
      `コール時間：${workTimeStr}`,
      `コール数：${stats.callCount || 0}`,
      `リコール取得数：${stats.recallGained || 0}`,
      `リコール消化数：${stats.recallDone || 0}`,
      `有効接続数：${stats.effectiveCount || 0}`,
      `担当接続数：${stats.personCount || 0}`,
      `案件獲得数：${stats.projectCount || 0}`,
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    toast.success('日報データをコピーしました');
  };

  // AI分析用state
  const [analysisScope, setAnalysisScope] = useState('team');
  const [analysisTargetUserId, setAnalysisTargetUserId] = useState(null);
  const [analysisPeriod, setAnalysisPeriod] = useState('daily');
  const [analysisDate, setAnalysisDate] = useState(new Date().toISOString().slice(0, 10));
  const [analysisMonth, setAnalysisMonth] = useState(new Date().toISOString().slice(0, 7));
  const [analysisWeek, setAnalysisWeek] = useState(() => {
    const d = new Date().getDate();
    return Math.min(Math.ceil(d / 7), 5);
  });
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

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

  // 期間からdate_from/date_toを計算
  const calcAnalysisRange = () => {
    const pad = (n) => String(n).padStart(2, '0');
    switch (analysisPeriod) {
      case 'daily':
        return { date_from: analysisDate, date_to: analysisDate };
      case 'weekly': {
        const [year, m] = analysisMonth.split('-').map(Number);
        const lastDay = new Date(year, m, 0).getDate();
        const fromDay = (analysisWeek - 1) * 7 + 1;
        const toDay = analysisWeek === 5 ? lastDay : Math.min(analysisWeek * 7, lastDay);
        return { date_from: `${year}-${pad(m)}-${pad(fromDay)}`, date_to: `${year}-${pad(m)}-${pad(toDay)}` };
      }
      case 'monthly': {
        const [year, m] = analysisMonth.split('-').map(Number);
        const lastDay = new Date(year, m, 0).getDate();
        return { date_from: `${year}-${pad(m)}-01`, date_to: `${year}-${pad(m)}-${pad(lastDay)}` };
      }
      case 'cumulative':
        return { date_from: '2000-01-01', date_to: '2099-12-31' };
      default:
        return {};
    }
  };

  const isManager = user?.role === 'admin' || user?.role === 'manager';

  // オペレーター一覧取得（user確定後）
  useEffect(() => {
    if (isManager) {
      api.get('/api/calls/operators').then(res => {
        setOperators(res.data.data || []);
      }).catch(() => {});
    }
  }, [isManager]);

  // 初回: チャートデータ取得
  useEffect(() => {
    fetchChartData();
  }, []);

  // KPI期間・スコープ変更時にstats再取得
  useEffect(() => {
    fetchStats();
  }, [kpiPeriod, kpiScope, kpiTargetUserId]);

  const fetchStats = async () => {
    try {
      const params = { period: kpiPeriod, scope: kpiScope };
      if (kpiScope === 'operator' && kpiTargetUserId) {
        params.target_user_id = kpiTargetUserId;
      }
      const res = await api.get('/api/dashboard/stats', { params });
      const statsData = res.data.data;
      setStats(statsData);
      if (statsData.manualWorkHours?.start_time) {
        setWorkStartTime(statsData.manualWorkHours.start_time);
        setWorkEndTime(statsData.manualWorkHours.end_time);
      }
    } catch (err) {
      console.error('KPIデータ取得失敗:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchChartData = async () => {
    try {
      const [hourlyRes, industryRes, connRes] = await Promise.all([
        api.get('/api/dashboard/hourly-calls'),
        api.get('/api/dashboard/industry-conversion'),
        api.get('/api/dashboard/hourly-industry-connections'),
      ]);
      setHourlyCalls(hourlyRes.data.data);
      setIndustryData(industryRes.data.data);
      setConnectionTable(connRes.data.data);
    } catch (err) {
      console.error('チャートデータ取得失敗:', err);
    }
  };

  const handleTeamAnalysis = async () => {
    try {
      setAnalysisLoading(true);
      setAnalysis(null);
      const range = calcAnalysisRange();

      if (analysisScope === 'team') {
        const { data } = await api.post('/api/ai/analysis/team', {
          period: analysisPeriod,
          ...range,
        });
        if (data.success) setAnalysis(data.data);
      } else if (analysisTargetUserId) {
        const { data } = await api.get(`/api/ai/analysis/operator/${analysisTargetUserId}`, {
          params: { period: analysisPeriod, ...range },
        });
        if (data.success) setAnalysis(data.data);
      }
    } catch (err) {
      const errMsg = err.response?.data?.message || err.message || '分析に失敗しました';
      console.error('AI分析エラー:', errMsg);
      toast.error(errMsg);
    } finally {
      setAnalysisLoading(false);
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">ダッシュボード</h1>
            <div className="flex items-center gap-3 mt-0.5">
              <p className="text-sm text-gray-400">営業活動サマリー</p>
              <button onClick={handleCopyCallData}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                コールデータ
              </button>
              <button onClick={handleCopyDailyReport}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                日報コピー
              </button>
            </div>
          </div>
        </div>
        {/* 期間トグル + スコープトグル */}
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {PERIODS.map(p => (
              <button key={p.value} onClick={() => setKpiPeriod(p.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  kpiPeriod === p.value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>{p.label}</button>
            ))}
          </div>
          {isManager && (
            <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
              {[{ value: 'team', label: '全体' }, { value: 'operator', label: 'オペレーター別' }].map(s => (
                <button key={s.value} onClick={() => {
                  setKpiScope(s.value);
                  if (s.value !== 'operator') setKpiTargetUserId(null);
                  if (s.value === 'operator' && operators.length > 0 && !kpiTargetUserId) {
                    setKpiTargetUserId(String(operators[0].id));
                  }
                }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    kpiScope === s.value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>{s.label}</button>
              ))}
            </div>
          )}
          {isManager && kpiScope === 'operator' && (
            <select value={kpiTargetUserId || ''} onChange={e => setKpiTargetUserId(e.target.value)}
              className="input text-sm py-1.5">
              {operators.map(op => (
                <option key={op.id} value={String(op.id)}>{op.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* KPIカード */}
      {(() => {
        // 稼働時間計算（/h率用）
        const wh = stats?.manualWorkHours;
        let totalWorkHours = 0;
        if (wh?.totalMinutes) {
          totalWorkHours = wh.totalMinutes / 60;
        } else if (wh?.start_time && wh?.end_time) {
          totalWorkHours = calcWorkHours(wh.start_time, wh.end_time);
        } else {
          totalWorkHours = (stats?.workMinutes || 0) / 60;
        }
        const perHour = (val) => totalWorkHours > 0 ? (val / totalWorkHours).toFixed(1) : '-';

        return (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-6">
            {KPI_CONFIG.map((config) => {
              // 稼働時間カードの特別処理
              if (config.key === 'workMinutes') {
                let displayValue, displaySuffix;
                let avgDaily = null;
                if (wh?.totalMinutes) {
                  displayValue = (wh.totalMinutes / 60).toFixed(1);
                  displaySuffix = '時間';
                  if (wh.entryCount && wh.entryCount > 0) {
                    avgDaily = (wh.totalMinutes / 60 / wh.entryCount).toFixed(1);
                  }
                } else if (wh?.start_time && wh?.end_time) {
                  displayValue = calcWorkHours(wh.start_time, wh.end_time).toFixed(1);
                  displaySuffix = '時間';
                } else {
                  displayValue = stats?.workMinutes ?? 0;
                  displaySuffix = '分';
                }
                const canEdit = !isManager || (kpiScope === 'operator' && kpiPeriod === 'daily');
                return (
                  <div key={config.key} onClick={canEdit ? () => setShowWorkHoursModal(true) : undefined}
                    className={canEdit ? 'cursor-pointer' : ''}>
                    <div className="card p-4 animate-fade-in">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-[11px] font-medium text-gray-400 mb-1">{config.label}</p>
                          <p className="text-2xl font-bold text-gray-900 tracking-tight">
                            {displayValue}
                            <span className="text-xs font-medium text-gray-400 ml-0.5">{displaySuffix}</span>
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {avgDaily ? `平均 ${avgDaily}h/日` : wh?.start_time ? `${wh.start_time}〜${wh.end_time}` : '\u00A0'}
                          </p>
                        </div>
                        <div className={`w-9 h-9 bg-gradient-to-br ${config.gradient} rounded-lg flex items-center justify-center shadow-sm`}>
                          <KpiIcon type={config.gradient} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }
              // 案件獲得の獲得効率表示
              if (config.key === 'projectCount') {
                const val = stats?.[config.key] || 0;
                const efficiency = val > 0 ? (totalWorkHours / val).toFixed(1) : '-';
                return (
                  <div key={config.key} className="card p-4 animate-fade-in">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[11px] font-medium text-gray-400 mb-1">{config.label}</p>
                        <p className="text-2xl font-bold text-gray-900 tracking-tight">
                          {val}<span className="text-xs font-medium text-gray-400 ml-0.5">{config.suffix}</span>
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{efficiency}h/件</p>
                      </div>
                      <div className={`w-9 h-9 bg-gradient-to-br ${config.gradient} rounded-lg flex items-center justify-center shadow-sm`}>
                        <KpiIcon type={config.gradient} />
                      </div>
                    </div>
                  </div>
                );
              }
              // その他: /h率付き
              const val = stats?.[config.key] || 0;
              const rate = perHour(val);
              return (
                <div key={config.key} className="card p-4 animate-fade-in">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[11px] font-medium text-gray-400 mb-1">{config.label}</p>
                      <p className="text-2xl font-bold text-gray-900 tracking-tight">
                        {val}<span className="text-xs font-medium text-gray-400 ml-0.5">{config.suffix}</span>
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{rate}/h</p>
                    </div>
                    <div className={`w-9 h-9 bg-gradient-to-br ${config.gradient} rounded-lg flex items-center justify-center shadow-sm`}>
                      <KpiIcon type={config.gradient} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* 稼働時間入力モーダル */}
      {showWorkHoursModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowWorkHoursModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-5 w-80 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-800 mb-4">稼働時間を入力</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">開始時間</label>
                <input type="time" value={workStartTime} min="08:00" max="21:00"
                  onChange={(e) => setWorkStartTime(e.target.value)} className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">終了時間</label>
                <input type="time" value={workEndTime} min="08:00" max="21:00"
                  onChange={(e) => setWorkEndTime(e.target.value)} className="input text-sm" />
              </div>
              {workStartTime && workEndTime && (
                <p className="text-center text-lg font-bold text-blue-600">
                  {calcWorkHours(workStartTime, workEndTime).toFixed(1)} <span className="text-sm font-medium text-gray-400">時間</span>
                </p>
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowWorkHoursModal(false)}
                className="flex-1 py-2 text-sm font-medium text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                キャンセル
              </button>
              <button onClick={handleSaveWorkHours} disabled={savingWorkHours}
                className="flex-1 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
                {savingWorkHours ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI総合分析セクション（管理者/マネージャーのみ） */}
      {isManager && (
        <div className="card p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-gray-800">AI総合分析</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {analysisScope === 'team' ? 'チーム全体' : operators.find(o => String(o.id) === String(analysisTargetUserId))?.name || 'オペレーター'}のパフォーマンスをAIが分析
              </p>
            </div>
          </div>

          {/* スコープ切替 + 期間セレクター + 実行ボタン */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
              <button onClick={() => { setAnalysisScope('team'); setAnalysis(null); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  analysisScope === 'team' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>全体</button>
              <button onClick={() => {
                setAnalysisScope('operator');
                setAnalysis(null);
                if (operators.length > 0 && !analysisTargetUserId) setAnalysisTargetUserId(String(operators[0].id));
              }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  analysisScope === 'operator' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>オペレーター別</button>
            </div>
            {analysisScope === 'operator' && (
              <select value={analysisTargetUserId || ''} onChange={e => { setAnalysisTargetUserId(e.target.value); setAnalysis(null); }}
                className="input text-sm py-1.5">
                {operators.map(op => (
                  <option key={op.id} value={op.id}>{op.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
              {PERIODS.map(p => (
                <button key={p.value} onClick={() => setAnalysisPeriod(p.value)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    analysisPeriod === p.value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>{p.label}</button>
              ))}
            </div>
            {analysisPeriod === 'daily' && (
              <input type="date" className="input text-sm" value={analysisDate}
                onChange={e => setAnalysisDate(e.target.value)} />
            )}
            {analysisPeriod === 'weekly' && (
              <>
                <input type="month" className="input text-sm" value={analysisMonth}
                  onChange={e => { setAnalysisMonth(e.target.value); setAnalysisWeek(1); }} />
                <select className="input text-sm" value={analysisWeek}
                  onChange={e => setAnalysisWeek(Number(e.target.value))}>
                  {getWeeksInMonth(analysisMonth).map(w => (
                    <option key={w.num} value={w.num}>{w.label}</option>
                  ))}
                </select>
              </>
            )}
            {analysisPeriod === 'monthly' && (
              <input type="month" className="input text-sm" value={analysisMonth}
                onChange={e => setAnalysisMonth(e.target.value)} />
            )}
            <button onClick={handleTeamAnalysis} disabled={analysisLoading}
              className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
              {analysisLoading ? (
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
                  分析実行
                </>
              )}
            </button>
          </div>

          {/* 分析結果 */}
          {analysis?.analysis ? (
            <div className="space-y-4">
              {/* スコア + サマリー */}
              <div className="flex items-start gap-4 bg-gray-50 rounded-lg p-4">
                <ScoreCircle score={analysis.analysis.team_score} size={72} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-700 mb-1">チームスコア</p>
                  <p className="text-xs text-gray-600">{analysis.analysis.summary}</p>
                </div>
              </div>

              {/* 統計サマリー */}
              {analysis.totalStats && (
                <div className="grid grid-cols-4 gap-2">
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <p className="text-lg font-bold text-blue-700">{analysis.totalStats.totalCalls}</p>
                    <p className="text-[10px] text-blue-500">総架電数</p>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-3 text-center">
                    <p className="text-lg font-bold text-emerald-700">{analysis.totalStats.effectiveConnections}</p>
                    <p className="text-[10px] text-emerald-500">有効接続</p>
                  </div>
                  <div className="bg-violet-50 rounded-lg p-3 text-center">
                    <p className="text-lg font-bold text-violet-700">{analysis.totalStats.personConnections}</p>
                    <p className="text-[10px] text-violet-500">担当者接続</p>
                  </div>
                  <div className="bg-rose-50 rounded-lg p-3 text-center">
                    <p className="text-lg font-bold text-rose-700">{analysis.totalStats.projects}</p>
                    <p className="text-[10px] text-rose-500">案件獲得</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-100">
                  <p className="text-xs font-bold text-emerald-700 mb-2">チームの強み</p>
                  <ul className="text-xs text-emerald-800 space-y-1">
                    {analysis.analysis.strengths?.map((s, i) => <li key={i}>・{s}</li>)}
                  </ul>
                </div>
                <div className="bg-red-50 rounded-lg p-4 border border-red-100">
                  <p className="text-xs font-bold text-red-700 mb-2">チームの課題</p>
                  <ul className="text-xs text-red-800 space-y-1">
                    {analysis.analysis.weaknesses?.map((w, i) => <li key={i}>・{w}</li>)}
                  </ul>
                </div>
              </div>

              {analysis.analysis.trends && (
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <p className="text-xs font-bold text-gray-700 mb-1">トレンド</p>
                  <p className="text-xs text-gray-600">{analysis.analysis.trends}</p>
                </div>
              )}

              <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                <p className="text-xs font-bold text-blue-700 mb-2">改善アクション</p>
                <ul className="text-xs text-blue-800 space-y-1">
                  {analysis.analysis.recommendations?.map((r, i) => <li key={i}>✓ {r}</li>)}
                </ul>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {analysis.analysis.top_performers?.length > 0 && (
                  <div className="bg-amber-50 rounded-lg p-4 border border-amber-100">
                    <p className="text-xs font-bold text-amber-700 mb-2">活躍オペレーター</p>
                    <ul className="text-xs text-amber-800 space-y-1">
                      {analysis.analysis.top_performers.map((t, i) => <li key={i}>★ {t}</li>)}
                    </ul>
                  </div>
                )}
                {analysis.analysis.needs_support?.length > 0 && (
                  <div className="bg-purple-50 rounded-lg p-4 border border-purple-100">
                    <p className="text-xs font-bold text-purple-700 mb-2">サポート推奨</p>
                    <ul className="text-xs text-purple-800 space-y-1">
                      {analysis.analysis.needs_support.map((n, i) => <li key={i}>→ {n}</li>)}
                    </ul>
                  </div>
                )}
              </div>

              {analysis.analysis.skill_breakdown && (
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <p className="text-xs font-bold text-gray-700 mb-3">スキル別分析</p>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                    {[
                      { key: 'opening', label: '第一声' },
                      { key: 'clarity', label: '明瞭さ' },
                      { key: 'hearing', label: 'ヒアリング' },
                      { key: 'rebuttal', label: '切り返し' },
                      { key: 'closing', label: 'クロージング' },
                    ].map(({ key, label }) => {
                      const skill = analysis.analysis.skill_breakdown[key];
                      if (!skill) return null;
                      return (
                        <div key={key} className="bg-white rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-medium text-gray-500">{label}</span>
                            <span className={`text-sm font-bold ${skill.avg >= 70 ? 'text-emerald-600' : skill.avg >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                              {skill.avg}
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-400 leading-tight">{skill.comment}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : analysis?.stats ? (
            /* オペレーター別データ表示 */
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-blue-700">{analysis.stats.total_calls || 0}</p>
                  <p className="text-[10px] text-blue-500">総架電数</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-emerald-700">{analysis.stats.effective_connections || 0}</p>
                  <p className="text-[10px] text-emerald-500">有効接続</p>
                </div>
                <div className="bg-violet-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-violet-700">{analysis.stats.person_connections || 0}</p>
                  <p className="text-[10px] text-violet-500">担当者接続</p>
                </div>
                <div className="bg-rose-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-rose-700">{analysis.stats.projects || 0}</p>
                  <p className="text-[10px] text-rose-500">案件獲得</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="bg-amber-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-amber-700">{analysis.stats.interested || 0}</p>
                  <p className="text-[10px] text-amber-500">興味あり</p>
                </div>
                <div className="bg-cyan-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-cyan-700">{analysis.stats.recalls || 0}</p>
                  <p className="text-[10px] text-cyan-500">リコール</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-gray-700">{analysis.stats.no_answer || 0}</p>
                  <p className="text-[10px] text-gray-500">不通</p>
                </div>
              </div>

              {/* スコア平均 */}
              {analysis.scoreAvgs?.overall && (
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <p className="text-xs font-bold text-gray-700 mb-3">AIスコア平均 ({analysis.scoreAvgs.eval_count || 0}件)</p>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                    {[
                      { key: 'overall', label: '総合' },
                      { key: 'opening', label: '第一声' },
                      { key: 'clarity', label: '明瞭さ' },
                      { key: 'hearing', label: 'ヒアリング' },
                      { key: 'rebuttal', label: '切り返し' },
                      { key: 'closing', label: 'クロージング' },
                    ].map(({ key, label }) => {
                      const val = analysis.scoreAvgs[key];
                      return (
                        <div key={key} className="bg-white rounded-lg p-2 text-center">
                          <span className="text-[10px] text-gray-500">{label}</span>
                          <p className={`text-sm font-bold ${val >= 70 ? 'text-emerald-600' : val >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                            {val || '-'}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 直近の評価一覧 */}
              {analysis.evaluations?.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <p className="text-xs font-bold text-gray-700 mb-3">直近の評価 ({analysis.evaluations.length}件)</p>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {analysis.evaluations.map((ev, i) => (
                      <div key={i} className="bg-white rounded-lg p-3 text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-gray-700">{ev.company_name || '企業'}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">{ev.result_code}</span>
                            <span className={`font-bold ${ev.overall_score >= 70 ? 'text-emerald-600' : ev.overall_score >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                              {ev.overall_score}点
                            </span>
                          </div>
                        </div>
                        {ev.summary && <p className="text-gray-500 text-[10px]">{ev.summary}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : analysis && !analysis.analysis && !analysis.stats ? (
            <p className="text-sm text-gray-400 text-center py-4">{analysis.message || 'データがありません'}</p>
          ) : (
            <p className="text-sm text-gray-400 text-center py-4">期間を選択して「分析実行」を押してください</p>
          )}
        </div>
      )}

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
          <h2 className="text-sm font-bold text-gray-800 mb-4">業種別案件化率 <span className="text-[11px] font-normal text-gray-400">(累計)</span></h2>
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
          <h2 className="text-sm font-bold text-gray-800">時間帯×業種別 接続数/接続率 <span className="text-[11px] font-normal text-gray-400">(累計)</span></h2>
          <p className="text-[11px] text-gray-400 mt-0.5">不通を除く接続数と接続率のクロス集計</p>
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
                    {connectionTable.industries.map((ind) => {
                      const conn = row[ind] || 0;
                      const total = row[`${ind}_total`] || 0;
                      const rate = total > 0 ? Math.round(conn / total * 100) : 0;
                      return (
                        <td key={ind} className={`px-3 py-1.5 text-center ${conn > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                          <span className="font-bold">{conn}</span>
                          {total > 0 && <span className="text-[10px] text-gray-400 ml-0.5">({rate}%)</span>}
                        </td>
                      );
                    })}
                    <td className={`px-3 py-1.5 text-center ${row.total > 0 ? 'text-blue-700' : 'text-gray-300'}`}>
                      <span className="font-bold">{row.total}</span>
                      {row.totalCalls > 0 && <span className="text-[10px] text-blue-400 ml-0.5">({Math.round(row.total / row.totalCalls * 100)}%)</span>}
                    </td>
                  </tr>
                ))}
                {/* 合計行 */}
                <tr className="bg-gray-50 border-t border-gray-200">
                  <td className="px-3 py-2 text-gray-700 font-bold">合計</td>
                  {connectionTable.industries.map((ind, i) => {
                    const conn = connectionTable.totals[ind] || 0;
                    const total = connectionTable.totalCalls[ind] || 0;
                    const rate = total > 0 ? Math.round(conn / total * 100) : 0;
                    return (
                      <td key={ind} className="px-3 py-2 text-center font-bold" style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>
                        {conn}
                        {total > 0 && <span className="text-[10px] font-normal text-gray-400 ml-0.5">({rate}%)</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center font-bold text-blue-700">
                    {connectionTable.totals.total || 0}
                    {connectionTable.totalCalls?.total > 0 && <span className="text-[10px] font-normal text-blue-400 ml-0.5">({Math.round(connectionTable.totals.total / connectionTable.totalCalls.total * 100)}%)</span>}
                  </td>
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
