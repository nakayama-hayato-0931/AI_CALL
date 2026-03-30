/**
 * 育成ステータスシート管理ページ
 * 各オペレーターの育成状況・プラン・ネクストステップを一覧・生成・編集
 */
import { useState, useEffect, useMemo } from 'react';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

export default function StatusSheetsPage() {
  const { user, loading: authLoading } = useAuth();
  const [sheets, setSheets] = useState([]);
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingSingle, setGeneratingSingle] = useState(null);
  const [selectedOperator, setSelectedOperator] = useState('');
  const [expandedUser, setExpandedUser] = useState(null);

  // 編集
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState(null);
  const [alertMessage, setAlertMessage] = useState(null);
  const [trainingData, setTrainingData] = useState({});  // { userId: steps[] }
  const [trainingLoading, setTrainingLoading] = useState({});
  const [publishingId, setPublishingId] = useState(null);
  const [editingTargets, setEditingTargets] = useState(null); // userId being edited
  const [targetForm, setTargetForm] = useState({});
  // sortedEntries is now useMemo (below)

  // チーム目標
  const [teamTargets, setTeamTargets] = useState(null);
  const [editingTeamTargets, setEditingTeamTargets] = useState(false);
  const [teamTargetForm, setTeamTargetForm] = useState({});
  const [savingTeamTargets, setSavingTeamTargets] = useState(false);

  useEffect(() => {
    if (!authLoading && user) {
      fetchSheets();
      fetchOperators();
      fetchTeamTargets();
    }
  }, [authLoading, user]);

  const fetchTeamTargets = async () => {
    try {
      const { data } = await api.get('/api/ai/analysis/team-targets');
      if (data.success) {
        setTeamTargets(data.data);
        setTeamTargetForm(data.data);
      }
    } catch (err) { console.error(err); }
  };

  const handleSaveTeamTargets = async () => {
    setSavingTeamTargets(true);
    try {
      await api.put('/api/ai/analysis/team-targets', teamTargetForm);
      setTeamTargets(teamTargetForm);
      setEditingTeamTargets(false);
      toast.success('チーム目標値を更新しました');
    } catch (err) { toast.error('更新に失敗しました'); }
    finally { setSavingTeamTargets(false); }
  };

  const fetchOperators = async () => {
    try {
      const { data } = await api.get('/api/analytics/operators');
      if (data.success) {
        setOperators(data.data || []);
      }
    } catch (err) { console.error(err); }
  };

  // 初級オペレーターの研修データ取得（operators確定後）
  useEffect(() => {
    if (!operators.length) return;
    const fetchTrainingBatch = async () => {
      const beginners = operators.filter(op => op.operator_level === '初級');
      const batch = {};
      for (const op of beginners) {
        try {
          const { data } = await api.get(`/api/ai/analysis/training/${op.id}`);
          if (data.success) batch[op.id] = data.data;
        } catch (e) {}
      }
      if (Object.keys(batch).length > 0) {
        setTrainingData(prev => ({ ...prev, ...batch }));
      }
    };
    fetchTrainingBatch();
  }, [operators.length]);

  const fetchSheets = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/api/ai/analysis/status-sheets');
      if (data.success) {
        // user_idごとに最新1件のみ残す
        const map = new Map();
        data.data.forEach(s => {
          if (!map.has(s.user_id)) map.set(s.user_id, s);
        });
        setSheets(Array.from(map.values()));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    try {
      setGenerating(true);
      // 直近2週間固定
      const now = new Date();
      const twoWeeksAgo = new Date(now);
      twoWeeksAgo.setDate(now.getDate() - 14);
      const { data } = await api.post('/api/ai/analysis/status-sheets', {
        period: 'weekly',
        date_from: twoWeeksAgo.toISOString().slice(0, 10),
        date_to: now.toISOString().slice(0, 10),
      }, { timeout: 300000 });
      if (data.success) {
        const generated = data.data?.sheets || [];
        const withSheets = generated.filter(s => s.sheet);
        const skipped = generated.filter(s => !s.sheet);
        if (withSheets.length > 0) {
          const mapped = withSheets.map(s => ({
            id: s.userId,
            user_id: s.userId,
            user_name: s.name,
            period_from: data.data.dateFrom,
            period_to: data.data.dateTo,
            current_status: s.sheet.current_status,
            training_plan: s.sheet.training_plan,
            next_steps: s.sheet.next_steps,
            updated_at: new Date().toISOString(),
          }));
          setSheets(mapped);
          setExpandedUser(mapped[0]?.user_id || null);
          let msg = `${withSheets.length}件のステータスシートを生成しました。\n\n生成済み: ${withSheets.map(s => s.name).join('、')}`;
          if (skipped.length > 0) {
            msg += `\n\nスキップ: ${skipped.map(s => `${s.name}（${s.message || 'データなし'}）`).join('、')}`;
          }
          setAlertMessage(msg);
        } else {
          setAlertMessage(`生成できませんでした。\n\n${skipped.map(s => `${s.name}: ${s.message || 'データなし'}`).join('\n')}`);
        }
        fetchSheets();
      }
    } catch (err) {
      setAlertMessage(`生成に失敗しました: ${err.response?.data?.message || err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateSingle = async (opId, opName) => {
    try {
      setGeneratingSingle(opId);
      const { data } = await api.post(`/api/ai/analysis/status-sheets/${opId}/generate`, {}, { timeout: 120000 });
      if (data.success && data.data?.sheet?.sheet) {
        setAlertMessage(`${opName}のステータスシートを生成しました。`);
        fetchSheets();
      } else {
        setAlertMessage(`${opName}: ${data.data?.message || data.message || '生成できませんでした'}`);
      }
    } catch (err) {
      setAlertMessage(`${opName}の生成に失敗しました: ${err.response?.data?.message || err.message}`);
    } finally {
      setGeneratingSingle(null);
    }
  };

  const handleStartEdit = (sheet) => {
    setEditingId(sheet.id);
    setEditData({
      current_status: typeof sheet.current_status === 'string' ? JSON.parse(sheet.current_status) : sheet.current_status,
      training_plan: typeof sheet.training_plan === 'string' ? JSON.parse(sheet.training_plan) : sheet.training_plan,
      next_steps: typeof sheet.next_steps === 'string' ? JSON.parse(sheet.next_steps) : sheet.next_steps,
    });
  };

  const handleSaveEdit = async () => {
    try {
      await api.put(`/api/ai/analysis/status-sheets/${editingId}`, editData);
      setAlertMessage('ステータスシートを更新しました。');
      setEditingId(null);
      fetchSheets();
    } catch (err) {
      setAlertMessage('更新に失敗しました。');
    }
  };

  // ソート済みエントリ（operatorsベースで1人1エントリ保証）
  const sortedEntries = useMemo(() => {
    if (!operators.length) return [];
    // operatorsをidで重複排除
    const opMap = new Map();
    operators.forEach(op => { if (!opMap.has(op.id)) opMap.set(op.id, op); });
    const uniqueOps = Array.from(opMap.values());
    // sheetsをuser_idで重複排除
    const sheetMap = new Map();
    sheets.forEach(s => { if (!sheetMap.has(s.user_id)) sheetMap.set(s.user_id, s); });
    const levelOrder = { '初級': 0, '中級': 1, '上級': 2, 'リーダー': 2 };
    const entries = uniqueOps.map(op => {
      const sheet = sheetMap.get(op.id);
      if (sheet) return { ...sheet, operator_level: op.operator_level || sheet.operator_level };
      return {
        id: null, user_id: op.id, user_name: op.name, operator_level: op.operator_level || null,
        current_status: null, training_plan: null, next_steps: null, targets: null, scenario: null,
        updated_at: null, period_from: null, period_to: null, _placeholder: true,
      };
    });
    entries.sort((a, b) => {
      const la = levelOrder[a.operator_level] ?? 99;
      const lb = levelOrder[b.operator_level] ?? 99;
      if (la !== lb) return la - lb;
      return (a.user_name || '').localeCompare(b.user_name || '');
    });
    return entries;
  }, [sheets, operators]);

  const handleStartTargetEdit = (userId) => {
    const op = operators.find(o => o.id === userId) || {};
    setEditingTargets(userId);
    setTargetForm({
      target_work_hours: op.target_work_hours || '',
      target_calls_per_h: op.target_calls_per_h || '',
      target_effective_per_h: op.target_effective_per_h || '',
      target_person_per_h: op.target_person_per_h || '',
      target_project_hours: op.target_project_hours || '',
    });
  };

  const handleSaveTargets = async (userId) => {
    try {
      await api.put(`/api/admin/users/${userId}`, {
        target_work_hours: targetForm.target_work_hours !== '' ? Number(targetForm.target_work_hours) : null,
        target_calls_per_h: targetForm.target_calls_per_h !== '' ? Number(targetForm.target_calls_per_h) : null,
        target_effective_per_h: targetForm.target_effective_per_h !== '' ? Number(targetForm.target_effective_per_h) : null,
        target_person_per_h: targetForm.target_person_per_h !== '' ? Number(targetForm.target_person_per_h) : null,
        target_project_hours: targetForm.target_project_hours !== '' ? Number(targetForm.target_project_hours) : null,
      });
      toast.success('目標値を保存しました');
      setEditingTargets(null);
      fetchOperators();
    } catch (err) {
      toast.error('目標値の保存に失敗しました');
    }
  };

  const fetchTraining = async (userId) => {
    try {
      setTrainingLoading(prev => ({ ...prev, [userId]: true }));
      const { data } = await api.get(`/api/ai/analysis/training/${userId}`);
      if (data.success) setTrainingData(prev => ({ ...prev, [userId]: data.data }));
    } catch (err) { console.error(err); }
    finally { setTrainingLoading(prev => ({ ...prev, [userId]: false })); }
  };

  const handleTrainingUpdate = async (userId, stepNumber, field, value) => {
    try {
      await api.put(`/api/ai/analysis/training/${userId}/${stepNumber}`, { [field]: value });
      fetchTraining(userId);
    } catch (err) { toast.error('更新に失敗しました'); }
  };

  const handleTogglePublish = async (sheetId, currentState) => {
    try {
      setPublishingId(sheetId);
      await api.put(`/api/ai/analysis/status-sheets/${sheetId}/publish`, { is_published: !currentState });
      toast.success(!currentState ? '公開しました' : '非公開にしました');
      fetchSheets();
    } catch (err) { toast.error('切替に失敗しました'); }
    finally { setPublishingId(null); }
  };

  const parseJSON = (val) => {
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch { return val; }
    }
    return val;
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

  return (
    <Layout>
      {/* 確認ポップアップ */}
      {alertMessage && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setAlertMessage(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4 animate-fade-in" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-800 mb-3">結果</h3>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{alertMessage}</p>
            <div className="mt-5 flex justify-end">
              <button onClick={() => setAlertMessage(null)}
                className="btn-primary text-sm px-6">確認</button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-lg font-bold text-gray-900">育成ステータスシート</h1>
        <p className="text-xs text-gray-500 mt-1">各オペレーターの育成状況・育成プラン・ネクストステップを管理</p>
      </div>

      {/* チーム目標値 */}
      {teamTargets && (
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-700">チーム目標値（AI評価に使用）</h3>
            {!editingTeamTargets ? (
              <button onClick={() => { setTeamTargetForm({...teamTargets}); setEditingTeamTargets(true); }}
                className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded border border-blue-200 hover:bg-blue-50">設定</button>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setEditingTeamTargets(false)}
                  className="text-xs text-gray-500 px-2 py-1 rounded border">キャンセル</button>
                <button onClick={handleSaveTeamTargets} disabled={savingTeamTargets}
                  className="btn-primary text-xs disabled:opacity-50">{savingTeamTargets ? '保存中...' : '保存'}</button>
              </div>
            )}
          </div>
          {(() => {
            const fields = [
              { key: 'calls_per_h', label: 'コール/h', unit: '件', displayUnit: '/h' },
              { key: 'effective_per_h', label: '有効接続/h', unit: '件', displayUnit: '/h' },
              { key: 'person_per_h', label: '担当接続/h', unit: '件', displayUnit: '/h' },
              { key: 'recall_per_h', label: 'リコール/h', unit: '件', displayUnit: '/h' },
              { key: 'project_hours', label: '案件所要時間', unit: 'h', displayUnit: 'h' },
              { key: 'conversion_rate', label: '案件化率', unit: '%', displayUnit: '%' },
              { key: 'target_cpa', label: '目標CPA', unit: '円', displayUnit: '円' },
            ];
            return editingTeamTargets ? (
              <div className="grid grid-cols-3 md:grid-cols-7 gap-3">
                {fields.map(({ key, label, unit }) => (
                  <div key={key}>
                    <label className="text-[10px] text-gray-500 block mb-1">{label}</label>
                    <div className="flex items-center gap-1">
                      <input type="number" step={key === 'target_cpa' ? '1000' : '0.1'} className="input text-xs w-full"
                        value={teamTargetForm[key] || ''}
                        onChange={e => setTeamTargetForm(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))} />
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">{unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-4">
                {fields.map(({ key, label, displayUnit }) => (
                  <div key={key} className="text-center">
                    <p className="text-[10px] text-gray-400">{label.replace('/h','')}</p>
                    <p className="text-sm font-bold text-gray-700">
                      {key === 'target_cpa' && teamTargets[key] ? `¥${Number(teamTargets[key]).toLocaleString()}` : (teamTargets[key] || '-')}
                      {key !== 'target_cpa' && <span className="text-[10px] text-gray-400 font-normal ml-0.5">{displayUnit}</span>}
                    </p>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* 生成セクション */}
      <div className="card p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="text-xs font-medium text-gray-600">直近2週間のAI評価データから生成</span>
          <button onClick={handleGenerate} disabled={generating || generatingSingle}
            className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50 ml-auto">
            {generating ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                生成中...
              </>
            ) : 'AI生成 (全員)'}
          </button>
        </div>
        {operators.length > 0 && (
          <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
            <span className="text-xs text-gray-400 whitespace-nowrap">個別生成:</span>
            <select value={selectedOperator} onChange={e => setSelectedOperator(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-3 py-1.5">
              <option value="">オペレーターを選択</option>
              {operators.map(op => (
                <option key={op.id} value={op.id}>{op.name}</option>
              ))}
            </select>
            <button
              onClick={() => {
                const op = operators.find(o => o.id === Number(selectedOperator));
                if (op) handleGenerateSingle(op.id, op.name);
              }}
              disabled={!selectedOperator || generating || generatingSingle}
              className="text-xs px-4 py-1.5 rounded-lg border border-blue-300 bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
              {generatingSingle ? (
                <>
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  生成中...
                </>
              ) : '個別生成'}
            </button>
          </div>
        )}
        {generating && (
          <p className="text-xs text-gray-400 mt-2">全オペレーターのステータスシートをAIが生成中です。数分かかる場合があります。</p>
        )}
        <p className="text-[10px] text-gray-400 pt-2 border-t border-gray-100">ステータスシート生成時にAIが面談の要否を自動判定します</p>
      </div>

      {/* ステータスシート一覧（シートがないオペレーターも含む） */}
      {(() => {
        return sortedEntries.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-sm text-gray-400">オペレーターがいません</p>
          </div>
        ) : (
        <div className="space-y-3">
          {sortedEntries.map(sheet => {
            const cs = parseJSON(sheet.current_status);
            const tp = parseJSON(sheet.training_plan);
            const ns = parseJSON(sheet.next_steps);
            const targets = parseJSON(sheet.targets);
            const scenario = parseJSON(sheet.scenario);
            const isExpanded = expandedUser === sheet.user_id;
            const isEditing = editingId === sheet.id;
            const isBeginnerLevel = sheet.operator_level === '初級';
            const isPlaceholder = sheet._placeholder;

            return (
              <div key={sheet.id} className="card overflow-hidden">
                {/* ヘッダー */}
                <button
                  onClick={() => {
                    const newId = isExpanded ? null : sheet.user_id;
                    setExpandedUser(newId);
                    if (newId && isBeginnerLevel && !trainingData[newId]) fetchTraining(newId);
                  }}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      sheet.needs_meeting && !sheet.meeting_completed ? 'bg-red-100 text-red-600 ring-2 ring-red-300' : 'bg-blue-100 text-blue-600'
                    }`}>
                      {sheet.user_name?.charAt(0)}
                    </div>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium ${sheet.needs_meeting && !sheet.meeting_completed ? 'text-red-600' : 'text-gray-800'}`}>
                          {sheet.user_name}
                        </p>
                        {!!sheet.needs_meeting && !sheet.meeting_completed && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded font-medium">要面談</span>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-400">
                        {sheet.period_from ? (
                          <>{sheet.period_from} 〜 {sheet.period_to} / 更新: {new Date(sheet.updated_at).toLocaleDateString('ja-JP')}</>
                        ) : (
                          <span className="text-gray-300">ステータスシート未生成</span>
                        )}
                      </p>
                    </div>
                    {sheet.operator_level && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        sheet.operator_level === '上級' ? 'bg-emerald-100 text-emerald-700' :
                        sheet.operator_level === '中級' ? 'bg-blue-100 text-blue-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>{sheet.operator_level}</span>
                    )}
                    {/* 初級: 研修進捗サマリー */}
                    {isBeginnerLevel && trainingData[sheet.user_id] && (() => {
                      const steps = trainingData[sheet.user_id];
                      const completed = steps.filter(s => s.is_completed).length;
                      const total = steps.length;
                      const nextStep = steps.find(s => !s.is_completed);
                      return (
                        <div className="flex items-center gap-2 ml-1">
                          <div className="flex items-center gap-1">
                            <div className="w-16 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                              <div className="bg-teal-500 h-full rounded-full transition-all" style={{ width: `${(completed / total) * 100}%` }} />
                            </div>
                            <span className="text-[10px] text-teal-600 font-medium">{completed}/{total}</span>
                          </div>
                          {nextStep && (
                            <span className="text-[10px] text-gray-400">
                              Next: <span className="text-gray-600 font-medium">{nextStep.step_number}. {nextStep.step_name}</span>
                            </span>
                          )}
                          {completed === total && (
                            <span className="text-[10px] text-emerald-600 font-medium">研修完了</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={e => { e.stopPropagation(); handleTogglePublish(sheet.id, sheet.is_published); }}
                      disabled={publishingId === sheet.id}
                      className={`text-[10px] px-2.5 py-1 rounded-full font-medium transition-all ${
                        sheet.is_published
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                      }`}>
                      {sheet.is_published ? '公開中' : '非公開'}
                    </button>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </button>

                {/* 展開コンテンツ */}
                {isExpanded && (
                  <div className="px-5 pb-5 space-y-5 border-t border-gray-100 pt-4">
                    {/* 面談管理 */}
                    {sheet.id && (
                      <div className={`flex items-center gap-4 p-3 rounded-lg border ${sheet.needs_meeting && !sheet.meeting_completed ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={!!sheet.needs_meeting && !sheet.meeting_completed}
                            onChange={async (e) => {
                              try {
                                await api.put(`/api/ai/analysis/status-sheets/${sheet.id}/meeting`, { needs_meeting: e.target.checked, meeting_completed: false });
                                fetchSheets();
                              } catch (err) { toast.error('更新に失敗しました'); }
                            }}
                            className="w-4 h-4 text-red-600 border-gray-300 rounded" />
                          <span className="text-xs font-medium text-gray-700">要面談</span>
                        </label>
                        {sheet.needs_meeting && !sheet.meeting_completed && sheet.meeting_reason && (
                          <span className="text-[10px] text-red-500 ml-2">{sheet.meeting_reason}</span>
                        )}
                        {(sheet.needs_meeting || sheet.meeting_scheduled_date) && (
                          <>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-gray-500">予定日:</span>
                              <input type="date" value={sheet.meeting_scheduled_date?.slice(0,10) || ''}
                                onChange={async (e) => {
                                  try {
                                    await api.put(`/api/ai/analysis/status-sheets/${sheet.id}/meeting`, { meeting_scheduled_date: e.target.value || null });
                                    fetchSheets();
                                  } catch (err) { toast.error('更新に失敗しました'); }
                                }}
                                className="text-xs border border-gray-200 rounded px-2 py-1" />
                            </div>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input type="checkbox" checked={!!sheet.meeting_completed}
                                onChange={async (e) => {
                                  try {
                                    await api.put(`/api/ai/analysis/status-sheets/${sheet.id}/meeting`, { meeting_completed: e.target.checked });
                                    fetchSheets();
                                  } catch (err) { toast.error('更新に失敗しました'); }
                                }}
                                className="w-4 h-4 text-emerald-600 border-gray-300 rounded" />
                              <span className="text-xs text-gray-600">面談実施済</span>
                            </label>
                          </>
                        )}
                      </div>
                    )}
                    {/* プレースホルダー（シート未生成）の場合 */}
                    {isPlaceholder && !isBeginnerLevel && (
                      <div className="text-center py-4">
                        <p className="text-sm text-gray-400">ステータスシートが未生成です</p>
                        <p className="text-xs text-gray-300 mt-1">「AI生成」または「個別生成」で作成してください</p>
                      </div>
                    )}
                    {isPlaceholder && isBeginnerLevel && (
                      <>
                        <div className="text-center py-2">
                          <p className="text-xs text-gray-400">ステータスシートは「AI生成」で作成できます</p>
                        </div>
                      </>
                    )}
                    {/* 目標値設定 */}
                    <div className="bg-indigo-50 rounded-lg border border-indigo-100 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-indigo-700">個別目標値</p>
                        {editingTargets === sheet.user_id ? (
                          <div className="flex gap-2">
                            <button onClick={() => setEditingTargets(null)} className="text-[10px] text-gray-500 hover:text-gray-700 px-2 py-1 rounded border">キャンセル</button>
                            <button onClick={() => handleSaveTargets(sheet.user_id)} className="text-[10px] bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700">保存</button>
                          </div>
                        ) : (
                          <button onClick={() => handleStartTargetEdit(sheet.user_id)} className="text-[10px] text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded border border-indigo-200 hover:bg-indigo-100">設定</button>
                        )}
                      </div>
                      {editingTargets === sheet.user_id ? (
                        <div className="grid grid-cols-5 gap-2">
                          {[
                            { key: 'target_work_hours', label: '稼働(h/月)', ph: '80' },
                            { key: 'target_calls_per_h', label: 'コール(/h)', ph: '18' },
                            { key: 'target_effective_per_h', label: '有効接続(/h)', ph: '3.0' },
                            { key: 'target_person_per_h', label: '担当接続(/h)', ph: '1.5' },
                            { key: 'target_project_hours', label: '案件(h以内/件)', ph: '12' },
                          ].map(f => (
                            <div key={f.key}>
                              <label className="text-[10px] text-indigo-500 block mb-0.5">{f.label}</label>
                              <input type="number" step="0.5" className="w-full text-xs border border-indigo-200 rounded px-2 py-1 bg-white focus:ring-1 focus:ring-indigo-300 outline-none"
                                placeholder={f.ph} value={targetForm[f.key] || ''}
                                onChange={e => setTargetForm(prev => ({...prev, [f.key]: e.target.value}))} />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-5 gap-2 text-center">
                          {(() => {
                            const op = operators.find(o => o.id === sheet.user_id) || {};
                            return [
                              { label: '稼働', val: op.target_work_hours, unit: 'h/月', def: 80 },
                              { label: 'コール', val: op.target_calls_per_h, unit: '/h', def: 18 },
                              { label: '有効接続', val: op.target_effective_per_h, unit: '/h', def: 3 },
                              { label: '担当接続', val: op.target_person_per_h, unit: '/h', def: 1.5 },
                              { label: '案件', val: op.target_project_hours, unit: 'h以内', def: 12 },
                            ].map((t, i) => (
                              <div key={i}>
                                <p className="text-[10px] text-indigo-400">{t.label}</p>
                                <p className="text-sm font-semibold text-indigo-700">{t.val || <span className="text-indigo-300">{t.def}</span>}<span className="text-[10px] text-indigo-400 ml-0.5">{t.unit}</span></p>
                              </div>
                            ));
                          })()}
                        </div>
                      )}
                      <p className="text-[9px] text-indigo-300 mt-1.5">薄い数字はデフォルト値です。設定すると個別目標がオペレーターのダッシュボードに反映されます。</p>
                    </div>

                    {/* 編集ボタン（シートがある場合のみ） */}
                    {!isPlaceholder && (
                      <div className="flex justify-end gap-2">
                        {isEditing ? (
                          <>
                            <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded border">キャンセル</button>
                            <button onClick={handleSaveEdit} className="btn-primary text-xs">保存</button>
                          </>
                        ) : (
                          <button onClick={() => handleStartEdit(sheet)} className="text-xs text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded border border-blue-200 hover:bg-blue-50">編集</button>
                        )}
                      </div>
                    )}

                    {!isPlaceholder && (<>
                    {/* 1. 現在の育成状況 */}
                    <div>
                      <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                        <span className="w-6 h-6 bg-blue-500 text-white rounded flex items-center justify-center text-xs font-bold">1</span>
                        現在の育成状況
                      </h3>
                      {isEditing ? (
                        <div className="space-y-3">
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">総括</label>
                            <textarea className="input text-xs w-full" rows={2}
                              value={editData.current_status?.summary || ''}
                              onChange={e => setEditData(prev => ({
                                ...prev,
                                current_status: { ...prev.current_status, summary: e.target.value }
                              }))} />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-gray-500 mb-1 block">できていること (1行1項目)</label>
                              <textarea className="input text-xs w-full" rows={4}
                                value={editData.current_status?.can_do?.join('\n') || ''}
                                onChange={e => setEditData(prev => ({
                                  ...prev,
                                  current_status: { ...prev.current_status, can_do: e.target.value.split('\n').filter(Boolean) }
                                }))} />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 mb-1 block">改善が必要な点 (1行1項目)</label>
                              <textarea className="input text-xs w-full" rows={4}
                                value={editData.current_status?.improvements?.join('\n') || ''}
                                onChange={e => setEditData(prev => ({
                                  ...prev,
                                  current_status: { ...prev.current_status, improvements: e.target.value.split('\n').filter(Boolean) }
                                }))} />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
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
                        </>
                      )}
                    </div>

                    {/* 2. 育成プラン */}
                    <div>
                      <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                        <span className="w-6 h-6 bg-purple-500 text-white rounded flex items-center justify-center text-xs font-bold">2</span>
                        育成プラン
                      </h3>
                      {isEditing ? (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {[
                            { key: 'short_term', label: '短期' },
                            { key: 'mid_term', label: '中期' },
                            { key: 'long_term', label: '長期' },
                          ].map(({ key, label }) => (
                            <div key={key} className="bg-gray-50 rounded-lg p-3 border">
                              <p className="text-xs font-bold text-gray-600 mb-2">{label}</p>
                              <label className="text-[10px] text-gray-400">期間</label>
                              <input className="input text-xs w-full mb-2"
                                value={editData.training_plan?.[key]?.period || ''}
                                onChange={e => setEditData(prev => ({
                                  ...prev,
                                  training_plan: { ...prev.training_plan, [key]: { ...prev.training_plan?.[key], period: e.target.value } }
                                }))} />
                              <label className="text-[10px] text-gray-400">目標 (1行1項目)</label>
                              <textarea className="input text-xs w-full mb-2" rows={2}
                                value={editData.training_plan?.[key]?.goals?.join('\n') || ''}
                                onChange={e => setEditData(prev => ({
                                  ...prev,
                                  training_plan: { ...prev.training_plan, [key]: { ...prev.training_plan?.[key], goals: e.target.value.split('\n').filter(Boolean) } }
                                }))} />
                              <label className="text-[10px] text-gray-400">方法 (1行1項目)</label>
                              <textarea className="input text-xs w-full" rows={2}
                                value={editData.training_plan?.[key]?.methods?.join('\n') || ''}
                                onChange={e => setEditData(prev => ({
                                  ...prev,
                                  training_plan: { ...prev.training_plan, [key]: { ...prev.training_plan?.[key], methods: e.target.value.split('\n').filter(Boolean) } }
                                }))} />
                            </div>
                          ))}
                        </div>
                      ) : (
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
                      )}
                    </div>

                    {/* 3. ネクストステップ */}
                    <div>
                      <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                        <span className="w-6 h-6 bg-amber-500 text-white rounded flex items-center justify-center text-xs font-bold">3</span>
                        ネクストステップ
                      </h3>
                      {isEditing ? (
                        <div className="space-y-3">
                          {editData.next_steps?.map((step, i) => (
                            <div key={i} className="bg-gray-50 rounded-lg p-3 border grid grid-cols-1 md:grid-cols-2 gap-2">
                              <div className="md:col-span-2">
                                <label className="text-[10px] text-gray-400">アクション</label>
                                <input className="input text-xs w-full"
                                  value={step.action || ''}
                                  onChange={e => {
                                    const updated = [...editData.next_steps];
                                    updated[i] = { ...updated[i], action: e.target.value };
                                    setEditData(prev => ({ ...prev, next_steps: updated }));
                                  }} />
                              </div>
                              <div>
                                <label className="text-[10px] text-gray-400">理由</label>
                                <input className="input text-xs w-full"
                                  value={step.reason || ''}
                                  onChange={e => {
                                    const updated = [...editData.next_steps];
                                    updated[i] = { ...updated[i], reason: e.target.value };
                                    setEditData(prev => ({ ...prev, next_steps: updated }));
                                  }} />
                              </div>
                              <div>
                                <label className="text-[10px] text-gray-400">期限</label>
                                <input className="input text-xs w-full"
                                  value={step.deadline || ''}
                                  onChange={e => {
                                    const updated = [...editData.next_steps];
                                    updated[i] = { ...updated[i], deadline: e.target.value };
                                    setEditData(prev => ({ ...prev, next_steps: updated }));
                                  }} />
                              </div>
                              <div className="md:col-span-2">
                                <label className="text-[10px] text-gray-400">達成基準</label>
                                <input className="input text-xs w-full"
                                  value={step.success_criteria || ''}
                                  onChange={e => {
                                    const updated = [...editData.next_steps];
                                    updated[i] = { ...updated[i], success_criteria: e.target.value };
                                    setEditData(prev => ({ ...prev, next_steps: updated }));
                                  }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
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
                      )}
                    </div>
                    {/* 4. 目標値 */}
                    {targets && (
                      <div>
                        <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                          <span className="w-6 h-6 bg-emerald-500 text-white rounded flex items-center justify-center text-xs font-bold">4</span>
                          目標値
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {/* 組織全体目標 */}
                          {targets.org_targets && (
                            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                              <p className="text-xs font-bold text-gray-600 mb-3">組織全体目標（時間あたり）</p>
                              <div className="grid grid-cols-2 gap-2">
                                {[
                                  { label: 'コール数/h', value: targets.org_targets.calls_per_h },
                                  { label: '有効接続/h', value: targets.org_targets.effective_per_h },
                                  { label: '担当接続/h', value: targets.org_targets.person_per_h },
                                  { label: '案件1件あたり', value: targets.org_targets.hours_per_project ? `${targets.org_targets.hours_per_project}h` : '-' },
                                  { label: '目標CPA', value: targets.org_targets.target_cpa ? `\u00a5${Number(targets.org_targets.target_cpa).toLocaleString()}` : '-' },
                                ].map((item, i) => (
                                  <div key={i} className="flex justify-between text-xs">
                                    <span className="text-gray-500">{item.label}</span>
                                    <span className="font-medium text-gray-800">{item.value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* 個別目標 */}
                          {targets.individual_targets && (
                            <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                              <p className="text-xs font-bold text-blue-700 mb-3">個別目標（{sheet.user_name}）</p>
                              <div className="grid grid-cols-2 gap-2">
                                {[
                                  { label: 'コール数/h', value: targets.individual_targets.calls_per_h },
                                  { label: '有効接続/h', value: targets.individual_targets.effective_per_h },
                                  { label: '担当接続/h', value: targets.individual_targets.person_per_h },
                                  { label: '案件1件あたり', value: targets.individual_targets.hours_per_project ? `${targets.individual_targets.hours_per_project}h` : '-' },
                                  { label: '目標CPA', value: targets.individual_targets.target_cpa ? `\u00a5${Number(targets.individual_targets.target_cpa).toLocaleString()}` : '-' },
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
                          {/* CPA比較 */}
                          <div className="flex items-center gap-6 mb-4">
                            <div className="text-center">
                              <p className="text-[10px] text-gray-500">現在CPA</p>
                              <p className="text-lg font-bold text-red-600">
                                {scenario.current_cpa ? `\u00a5${Number(scenario.current_cpa).toLocaleString()}` : '-'}
                              </p>
                            </div>
                            <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                            <div className="text-center">
                              <p className="text-[10px] text-gray-500">目標CPA</p>
                              <p className="text-lg font-bold text-emerald-600">
                                {scenario.target_cpa ? `\u00a5${Number(scenario.target_cpa).toLocaleString()}` : '-'}
                              </p>
                            </div>
                          </div>
                          {/* 改善ステップ */}
                          {scenario.steps && scenario.steps.length > 0 && (
                            <div className="mb-3">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-orange-200">
                                    <th className="text-left py-1.5 text-orange-700 font-medium">指標</th>
                                    <th className="text-center py-1.5 text-orange-700 font-medium">現在</th>
                                    <th className="text-center py-1.5 text-orange-700 font-medium">目標</th>
                                    <th className="text-left py-1.5 text-orange-700 font-medium">効果</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {scenario.steps.map((s, i) => (
                                    <tr key={i} className="border-b border-orange-100">
                                      <td className="py-1.5 text-gray-700 font-medium">{s.metric}</td>
                                      <td className="py-1.5 text-center text-gray-600">{s.current}</td>
                                      <td className="py-1.5 text-center text-emerald-600 font-medium">{s.target}</td>
                                      <td className="py-1.5 text-gray-600">{s.impact}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          {scenario.summary && (
                            <p className="text-xs text-gray-700 bg-white/60 rounded p-2">{scenario.summary}</p>
                          )}
                        </div>
                      </div>
                    )}

                    </>)}
                    {/* 6. 研修進捗（初級のみ） */}
                    {isBeginnerLevel && (
                      <div>
                        <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                          <span className="w-6 h-6 bg-teal-500 text-white rounded flex items-center justify-center text-xs font-bold">6</span>
                          研修進捗
                        </h3>
                        {trainingLoading[sheet.user_id] ? (
                          <div className="flex items-center justify-center py-6">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-teal-500" />
                          </div>
                        ) : (
                          <div className="bg-teal-50 rounded-lg border border-teal-100 overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-teal-100/50 border-b border-teal-200">
                                  <th className="text-left py-2 px-3 text-teal-700 font-medium w-8">#</th>
                                  <th className="text-left py-2 px-3 text-teal-700 font-medium">研修内容</th>
                                  <th className="text-left py-2 px-3 text-teal-700 font-medium">実施担当者</th>
                                  <th className="text-left py-2 px-3 text-teal-700 font-medium w-32">実施日</th>
                                  <th className="text-center py-2 px-3 text-teal-700 font-medium w-16">完了</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(trainingData[sheet.user_id] || []).map((step) => (
                                  <tr key={step.step_number} className={`border-b border-teal-100 ${step.is_completed ? 'bg-teal-50/50' : 'bg-white'}`}>
                                    <td className="py-2 px-3 text-teal-600 font-medium">{step.step_number}</td>
                                    <td className={`py-2 px-3 ${step.is_completed ? 'text-teal-600 line-through' : 'text-gray-700'}`}>
                                      {step.step_name}
                                    </td>
                                    <td className="py-2 px-3">
                                      <input
                                        type="text"
                                        placeholder="担当者名"
                                        defaultValue={step.trainer_name || ''}
                                        onBlur={e => {
                                          if (e.target.value !== (step.trainer_name || '')) {
                                            handleTrainingUpdate(sheet.user_id, step.step_number, 'trainer_name', e.target.value);
                                          }
                                        }}
                                        className="text-xs border border-teal-200 rounded px-2 py-1 w-full bg-white focus:ring-1 focus:ring-teal-300 focus:border-teal-300 outline-none"
                                      />
                                    </td>
                                    <td className="py-2 px-3">
                                      <input
                                        type="date"
                                        defaultValue={step.training_date ? step.training_date.slice(0, 10) : ''}
                                        onBlur={e => {
                                          const cur = step.training_date ? step.training_date.slice(0, 10) : '';
                                          if (e.target.value !== cur) {
                                            handleTrainingUpdate(sheet.user_id, step.step_number, 'training_date', e.target.value || null);
                                          }
                                        }}
                                        className="text-xs border border-teal-200 rounded px-2 py-1 w-full bg-white focus:ring-1 focus:ring-teal-300 focus:border-teal-300 outline-none"
                                      />
                                    </td>
                                    <td className="py-2 px-3 text-center">
                                      <input
                                        type="checkbox"
                                        checked={!!step.is_completed}
                                        onChange={e => handleTrainingUpdate(sheet.user_id, step.step_number, 'is_completed', e.target.checked)}
                                        className="w-4 h-4 text-teal-600 border-teal-300 rounded focus:ring-teal-500 cursor-pointer"
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {(trainingData[sheet.user_id] || []).length > 0 && (
                              <div className="px-3 py-2 bg-teal-100/30 border-t border-teal-200">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 bg-teal-200 rounded-full h-1.5 overflow-hidden">
                                    <div
                                      className="bg-teal-500 h-full rounded-full transition-all"
                                      style={{ width: `${Math.round((trainingData[sheet.user_id].filter(s => s.is_completed).length / trainingData[sheet.user_id].length) * 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] text-teal-600 font-medium whitespace-nowrap">
                                    {trainingData[sheet.user_id].filter(s => s.is_completed).length}/{trainingData[sheet.user_id].length} 完了
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        );
      })()}
    </Layout>
  );
}
