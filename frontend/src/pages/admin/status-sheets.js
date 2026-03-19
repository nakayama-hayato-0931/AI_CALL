/**
 * 育成ステータスシート管理ページ
 * 各オペレーターの育成状況・プラン・ネクストステップを一覧・生成・編集
 */
import { useState, useEffect } from 'react';
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

  useEffect(() => {
    if (!authLoading && user) {
      fetchSheets();
      fetchOperators();
    }
  }, [authLoading, user]);

  const fetchOperators = async () => {
    try {
      const { data } = await api.get('/api/analytics/operators');
      if (data.success) setOperators(data.data || []);
    } catch (err) { console.error(err); }
  };

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
      </div>

      {/* ステータスシート一覧 */}
      {sheets.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-gray-400">ステータスシートがありません</p>
          <p className="text-xs text-gray-300 mt-1">「AI生成」ボタンで各オペレーターのシートを作成してください</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sheets.map(sheet => {
            const cs = parseJSON(sheet.current_status);
            const tp = parseJSON(sheet.training_plan);
            const ns = parseJSON(sheet.next_steps);
            const isExpanded = expandedUser === sheet.user_id;
            const isEditing = editingId === sheet.id;

            return (
              <div key={sheet.id} className="card overflow-hidden">
                {/* ヘッダー */}
                <button
                  onClick={() => setExpandedUser(isExpanded ? null : sheet.user_id)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold">
                      {sheet.user_name?.charAt(0)}
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-800">{sheet.user_name}</p>
                      <p className="text-[10px] text-gray-400">
                        {sheet.period_from} 〜 {sheet.period_to}
                        {' / '}更新: {new Date(sheet.updated_at).toLocaleDateString('ja-JP')}
                      </p>
                    </div>
                    {sheet.operator_level && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        sheet.operator_level === '上級' ? 'bg-emerald-100 text-emerald-700' :
                        sheet.operator_level === '中級' ? 'bg-blue-100 text-blue-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>{sheet.operator_level}</span>
                    )}
                  </div>
                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {/* 展開コンテンツ */}
                {isExpanded && (
                  <div className="px-5 pb-5 space-y-5 border-t border-gray-100 pt-4">
                    {/* 編集ボタン */}
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
