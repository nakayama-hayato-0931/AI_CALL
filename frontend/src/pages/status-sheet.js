/**
 * ステータスシート閲覧ページ（オペレーター/リーダー用）
 * オペレーター: 自分の公開済みシートのみ
 * リーダー: 自分 + 全員切替可能
 */
import { useState, useEffect } from 'react';
import Layout from '../components/common/Layout';
import useAuth from '../hooks/useAuth';
import api from '../utils/api';

export default function StatusSheetView() {
  const { user, loading: authLoading } = useAuth();
  const [mySheet, setMySheet] = useState(null);
  const [allSheets, setAllSheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('mine'); // 'mine' or 'all'
  const [expandedUser, setExpandedUser] = useState(null);
  const [trainingData, setTrainingData] = useState({});

  const isLeader = user?.operator_level === 'リーダー';

  useEffect(() => {
    if (!authLoading && user) {
      fetchMySheet();
      if (isLeader) fetchAllSheets();
    }
  }, [authLoading, user]);

  const fetchMySheet = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/api/ai/analysis/my-status-sheet');
      if (data.success) setMySheet(data.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchAllSheets = async () => {
    try {
      const { data } = await api.get('/api/ai/analysis/published-status-sheets');
      if (data.success) setAllSheets(data.data || []);
    } catch (err) { console.error(err); }
  };

  const fetchTraining = async (userId) => {
    try {
      const { data } = await api.get(`/api/ai/analysis/training/${userId}`);
      if (data.success) setTrainingData(prev => ({ ...prev, [userId]: data.data }));
    } catch (err) { console.error(err); }
  };

  const parseJSON = (val) => {
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch { return val; }
    }
    return val;
  };

  const renderSheet = (sheet, isExpanded = true) => {
    const cs = parseJSON(sheet.current_status);
    const tp = parseJSON(sheet.training_plan);
    const ns = parseJSON(sheet.next_steps);
    const targets = parseJSON(sheet.targets);
    const scenario = parseJSON(sheet.scenario);
    const isBeginner = sheet.operator_level === '初級';

    return (
      <div className="space-y-5">
        {/* 1. 現在の育成状況 */}
        <div>
          <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 bg-blue-500 text-white rounded flex items-center justify-center text-xs font-bold">1</span>
            現在の育成状況
          </h3>
          <p className="text-xs text-gray-600 mb-3">{cs?.summary}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-100">
              <p className="text-xs font-bold text-emerald-700 mb-2">できていること</p>
              <ul className="text-xs text-emerald-800 space-y-1.5">
                {cs?.can_do?.map((item, i) => <li key={i}>・{item}</li>)}
              </ul>
            </div>
            <div className="bg-red-50 rounded-lg p-4 border border-red-100">
              <p className="text-xs font-bold text-red-700 mb-2">改善が必要な点</p>
              <ul className="text-xs text-red-800 space-y-1.5">
                {cs?.improvements?.map((item, i) => <li key={i}>・{item}</li>)}
              </ul>
            </div>
          </div>
        </div>

        {/* 2. 育成プラン */}
        <div>
          <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 bg-purple-500 text-white rounded flex items-center justify-center text-xs font-bold">2</span>
            育成プラン
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { key: 'short_term', label: '短期', bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-700', sub: 'text-blue-500' },
              { key: 'mid_term', label: '中期', bg: 'bg-indigo-50', border: 'border-indigo-100', text: 'text-indigo-700', sub: 'text-indigo-500' },
              { key: 'long_term', label: '長期', bg: 'bg-violet-50', border: 'border-violet-100', text: 'text-violet-700', sub: 'text-violet-500' },
            ].map(({ key, label, bg, border, text, sub }) => {
              const plan = tp?.[key];
              if (!plan) return null;
              return (
                <div key={key} className={`${bg} rounded-lg p-4 border ${border}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className={`text-xs font-bold ${text}`}>{label}</p>
                    <span className={`text-[10px] ${sub}`}>{plan.period}</span>
                  </div>
                  <p className="text-[10px] font-medium text-gray-600 mb-1">目標:</p>
                  <ul className="text-xs text-gray-700 space-y-1 mb-2">
                    {plan.goals?.map((g, i) => <li key={i}>・{g}</li>)}
                  </ul>
                  <p className="text-[10px] font-medium text-gray-600 mb-1">方法:</p>
                  <ul className="text-xs text-gray-700 space-y-1">
                    {plan.methods?.map((m, i) => <li key={i}>・{m}</li>)}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        {/* 3. ネクストステップ */}
        <div>
          <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 bg-amber-500 text-white rounded flex items-center justify-center text-xs font-bold">3</span>
            ネクストステップ
          </h3>
          <div className="space-y-3">
            {(Array.isArray(ns) ? ns : []).map((step, i) => (
              <div key={i} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <p className="text-sm font-medium text-gray-800 mb-2">{step.action}</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] font-medium text-gray-400 mb-0.5">理由</p>
                    <p className="text-xs text-gray-600">{step.reason}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-gray-400 mb-0.5">期限</p>
                    <p className="text-xs text-gray-600">{step.deadline}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-gray-400 mb-0.5">達成基準</p>
                    <p className="text-xs text-gray-600">{step.success_criteria}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 4. 目標値 */}
        {targets && (
          <div>
            <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              <span className="w-6 h-6 bg-emerald-500 text-white rounded flex items-center justify-center text-xs font-bold">4</span>
              目標値
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {targets.individual_targets && (
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                  <p className="text-xs font-bold text-blue-700 mb-3">個別目標</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'コール数/h', value: targets.individual_targets.calls_per_h },
                      { label: '有効接続/h', value: targets.individual_targets.effective_per_h },
                      { label: '担当接続/h', value: targets.individual_targets.person_per_h },
                      { label: '案件1件あたり', value: targets.individual_targets.hours_per_project ? `${targets.individual_targets.hours_per_project}h` : '-' },
                    ].map((item, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-blue-500">{item.label}</span>
                        <span className="font-medium text-blue-800">{item.value}</span>
                      </div>
                    ))}
                  </div>
                  {targets.individual_targets.rationale && (
                    <p className="text-[10px] text-blue-500 mt-2 pt-2 border-t border-blue-100">{targets.individual_targets.rationale}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 5. 改善シナリオ */}
        {scenario && (
          <div>
            <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              <span className="w-6 h-6 bg-orange-500 text-white rounded flex items-center justify-center text-xs font-bold">5</span>
              数値改善シナリオ
            </h3>
            <div className="bg-orange-50 rounded-lg p-4 border border-orange-100">
              <div className="flex items-center gap-6 mb-4">
                <div className="text-center">
                  <p className="text-[10px] text-gray-500">現在CPA</p>
                  <p className="text-lg font-bold text-red-600">
                    {scenario.current_cpa ? `¥${Number(scenario.current_cpa).toLocaleString()}` : '-'}
                  </p>
                </div>
                <span className="text-gray-400">→</span>
                <div className="text-center">
                  <p className="text-[10px] text-gray-500">目標CPA</p>
                  <p className="text-lg font-bold text-emerald-600">
                    {scenario.target_cpa ? `¥${Number(scenario.target_cpa).toLocaleString()}` : '-'}
                  </p>
                </div>
              </div>
              {scenario.summary && (
                <p className="text-xs text-gray-700 bg-white/60 rounded p-2">{scenario.summary}</p>
              )}
            </div>
          </div>
        )}

        {/* 6. 研修進捗（初級のみ） */}
        {isBeginner && trainingData[sheet.user_id] && (
          <div>
            <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              <span className="w-6 h-6 bg-teal-500 text-white rounded flex items-center justify-center text-xs font-bold">6</span>
              研修進捗
            </h3>
            <div className="bg-teal-50 rounded-lg border border-teal-100 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-teal-100/50 border-b border-teal-200">
                    <th className="text-left py-2 px-3 text-teal-700 font-medium w-8">#</th>
                    <th className="text-left py-2 px-3 text-teal-700 font-medium">研修内容</th>
                    <th className="text-center py-2 px-3 text-teal-700 font-medium w-16">完了</th>
                  </tr>
                </thead>
                <tbody>
                  {trainingData[sheet.user_id].map(step => (
                    <tr key={step.step_number} className={`border-b border-teal-100 ${step.is_completed ? 'bg-teal-50/50' : 'bg-white'}`}>
                      <td className="py-2 px-3 text-teal-600 font-medium">{step.step_number}</td>
                      <td className={`py-2 px-3 ${step.is_completed ? 'text-teal-600 line-through' : 'text-gray-700'}`}>{step.step_name}</td>
                      <td className="py-2 px-3 text-center">
                        {step.is_completed ? <span className="text-teal-500">✓</span> : <span className="text-gray-300">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-2 bg-teal-100/30 border-t border-teal-200">
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-teal-200 rounded-full h-1.5 overflow-hidden">
                    <div className="bg-teal-500 h-full rounded-full transition-all"
                      style={{ width: `${Math.round((trainingData[sheet.user_id].filter(s => s.is_completed).length / trainingData[sheet.user_id].length) * 100)}%` }} />
                  </div>
                  <span className="text-[10px] text-teal-600 font-medium whitespace-nowrap">
                    {trainingData[sheet.user_id].filter(s => s.is_completed).length}/{trainingData[sheet.user_id].length} 完了
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (authLoading || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </Layout>
    );
  }

  const sheetsToShow = viewMode === 'mine' ? (mySheet ? [mySheet] : []) : allSheets;

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-lg font-bold text-gray-900">育成ステータスシート</h1>
        <p className="text-xs text-gray-500 mt-1">あなたの育成状況・目標・ネクストステップ</p>
      </div>

      {/* リーダー用切替 */}
      {isLeader && (
        <div className="flex bg-gray-100 rounded-lg p-0.5 w-fit mb-4">
          <button onClick={() => setViewMode('mine')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${viewMode === 'mine' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            自分のシート
          </button>
          <button onClick={() => setViewMode('all')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${viewMode === 'all' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            全員のシート
          </button>
        </div>
      )}

      {sheetsToShow.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-gray-400">公開されたステータスシートがありません</p>
          <p className="text-xs text-gray-300 mt-1">管理者がシートを作成・公開すると表示されます</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sheetsToShow.map(sheet => {
            const isExpanded = viewMode === 'mine' || expandedUser === sheet.user_id;
            return (
              <div key={sheet.id || sheet.user_id} className="card overflow-hidden">
                <button
                  onClick={() => {
                    if (viewMode === 'all') {
                      const newId = isExpanded ? null : sheet.user_id;
                      setExpandedUser(newId);
                      if (newId && sheet.operator_level === '初級' && !trainingData[newId]) fetchTraining(newId);
                    } else {
                      if (sheet.operator_level === '初級' && !trainingData[sheet.user_id]) fetchTraining(sheet.user_id);
                    }
                  }}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold">
                      {sheet.user_name?.charAt(0)}
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-800">{sheet.user_name}</p>
                      <p className="text-[10px] text-gray-400">更新: {new Date(sheet.updated_at).toLocaleDateString('ja-JP')}</p>
                    </div>
                    {sheet.operator_level && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        sheet.operator_level === '上級' || sheet.operator_level === 'リーダー' ? 'bg-emerald-100 text-emerald-700' :
                        sheet.operator_level === '中級' ? 'bg-blue-100 text-blue-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>{sheet.operator_level}</span>
                    )}
                  </div>
                  {viewMode === 'all' && (
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  )}
                </button>
                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-gray-100 pt-4">
                    {renderSheet(sheet)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
