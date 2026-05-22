/**
 * AI評価ページ
 * 日次架電データのAI自動評価 + 通話ログ検索
 */
import { useState, useEffect } from 'react';
import Layout from '../components/common/Layout';
import api, { directApi } from '../utils/api';
import toast from 'react-hot-toast';

const RESULT_BADGES = {
  NO_ANSWER: { bg: 'bg-gray-100', text: 'text-gray-600', label: '不通' },
  NG: { bg: 'bg-red-50', text: 'text-red-600', label: 'NG' },
  RECALL: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'リコール' },
  INTERESTED: { bg: 'bg-blue-50', text: 'text-blue-700', label: '興味あり' },
  PROJECT: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: '案件化' },
  SKIP: { bg: 'bg-gray-50', text: 'text-gray-400', label: 'SKIP' },
};

const ScoreBar = ({ label, score }) => {
  const color = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-gray-500 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${score || 0}%` }} />
      </div>
      <span className="w-8 text-right font-bold text-gray-700">{score ?? '-'}</span>
    </div>
  );
};

const ScoreCircle = ({ score, size = 'lg' }) => {
  const color = score >= 80 ? 'text-emerald-600' : score >= 60 ? 'text-amber-600' : 'text-red-500';
  const ringColor = score >= 80 ? 'stroke-emerald-500' : score >= 60 ? 'stroke-amber-400' : 'stroke-red-400';
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (circumference * (score || 0)) / 100;
  const s = size === 'lg' ? 'w-28 h-28' : 'w-16 h-16';
  const textSize = size === 'lg' ? 'text-3xl' : 'text-lg';

  return (
    <div className={`relative ${s} flex items-center justify-center`}>
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" strokeWidth="6" className="stroke-gray-100" />
        <circle cx="50" cy="50" r="40" fill="none" strokeWidth="6" strokeLinecap="round"
          className={ringColor} strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      </svg>
      <span className={`${textSize} font-bold ${color}`}>{score ?? '-'}</span>
    </div>
  );
};

export default function AIEvaluationPage() {
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const [mode, setMode] = useState('daily'); // 'daily' | 'monthly'
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [dateFrom, setDateFrom] = useState(weekAgo);
  const [dateTo, setDateTo] = useState(today);
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [dailySummary, setDailySummary] = useState(null);
  const [expandedCallId, setExpandedCallId] = useState(null);

  // 評価回数制限
  const [evalLimit, setEvalLimit] = useState(null); // { dailyLimit, usedToday, remainingEvals }

  // 通話ログ検索
  const [showLogSearch, setShowLogSearch] = useState(false);
  const [phone, setPhone] = useState('');
  const [dbCalls, setDbCalls] = useState([]);
  const [sheetLogs, setSheetLogs] = useState([]);
  const [searched, setSearched] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  // 月変更時にdateFrom/dateToを計算
  useEffect(() => {
    if (mode === 'monthly' && month) {
      const [y, m] = month.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const pad = n => String(n).padStart(2, '0');
      setDateFrom(`${y}-${pad(m)}-01`);
      setDateTo(`${y}-${pad(m)}-${pad(lastDay)}`);
    }
  }, [mode, month]);

  // 架電データ取得
  const fetchCalls = async () => {
    setLoading(true);
    try {
      const params = mode === 'daily' ? { date } : { dateFrom, dateTo };
      // 営業ユーザーはsalesの架電のみ表示
      const savedUser = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('user') || '{}') : {};
      if (savedUser.role === 'sales') params.call_type = 'sales';
      const { data } = await api.get('/api/logs/daily', { params });
      setCalls(data.data.calls || []);
    } catch (err) {
      toast.error('架電データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // サマリー取得
  const fetchSummary = async () => {
    try {
      const params = mode === 'daily' ? { date } : { dateFrom, dateTo };
      const { data } = await api.get('/api/ai/daily-summary', { params });
      setDailySummary(data.data);
    } catch (err) {
      console.error('サマリー取得失敗:', err);
    }
  };

  // 評価回数制限を取得
  const fetchEvalLimit = async () => {
    try {
      const { data } = await api.get('/api/ai/eval-limit');
      setEvalLimit(data.data);
    } catch (err) {
      console.error('評価回数制限取得失敗:', err);
    }
  };

  // 初回・日付/モード変更時
  useEffect(() => {
    fetchCalls();
    fetchSummary();
    fetchEvalLimit();
  }, [mode, date, month, dateFrom, dateTo]);

  // AI一括評価
  const handleBatchEvaluate = async () => {
    setEvaluating(true);
    try {
      const { data } = await directApi.post('/api/ai/evaluate-daily', { date });
      toast.success(data.message || 'AI評価完了');
      // データ再取得
      await fetchCalls();
      await fetchSummary();
      await fetchEvalLimit();
    } catch (err) {
      const msg = err.response?.data?.message || 'AI評価に失敗しました';
      toast.error(msg);
    } finally {
      setEvaluating(false);
    }
  };

  // 通話ログ検索
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!phone.trim()) {
      toast.error('電話番号を入力してください');
      return;
    }
    setSearchLoading(true);
    try {
      const { data } = await api.get('/api/logs/search', { params: { phone: phone.trim() } });
      setDbCalls(data.data.dbCalls || []);
      setSheetLogs(data.data.sheetLogs || []);
      setSearched(true);
      if (data.data.totalDbCalls === 0 && data.data.totalSheetLogs === 0) {
        toast('該当する通話ログが見つかりません');
      }
    } catch (err) {
      toast.error('検索に失敗しました');
    } finally {
      setSearchLoading(false);
    }
  };

  // 通話時間を計算
  const calcDuration = (start, end) => {
    if (!start || !end) return '-';
    const sec = Math.round((new Date(end) - new Date(start)) / 1000);
    if (sec < 60) return `${sec}秒`;
    return `${Math.floor(sec / 60)}分${sec % 60}秒`;
  };

  // 評価済み件数
  const evaluatedCount = calls.filter(c => c.evaluation_id).length;
  const unevaluatedCount = calls.filter(c => !c.evaluation_id && c.result_code && c.result_code !== 'SKIP').length;

  return (
    <Layout>
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">AI評価</h1>
          <p className="text-sm text-gray-400 mt-0.5">架電データからAIが自動採点・フィードバック</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* 日別/月間 切り替え */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setMode('daily')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'daily' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >日別</button>
            <button
              onClick={() => setMode('monthly')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >月間</button>
          </div>

          {/* 日付ピッカー */}
          {mode === 'daily' ? (
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input !w-44"
            />
          ) : (
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="input !w-44"
            />
          )}

          {/* AI一括評価（日別モードのみ） */}
          {mode === 'daily' && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleBatchEvaluate}
                disabled={evaluating || unevaluatedCount === 0 || (evalLimit && evalLimit.remainingEvals <= 0)}
                className="btn-primary flex items-center gap-2 disabled:opacity-40"
              >
                {evaluating ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    AI評価中...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                    </svg>
                    AI一括評価{unevaluatedCount > 0 ? ` (${unevaluatedCount}件)` : ''}
                  </>
                )}
              </button>
              {evalLimit && (
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                  evalLimit.remainingEvals > 1
                    ? 'bg-emerald-50 text-emerald-700'
                    : evalLimit.remainingEvals === 1
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-red-50 text-red-600'
                }`}>
                  残り{evalLimit.remainingEvals}/{evalLimit.dailyLimit}回
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 日次サマリーカード */}
      {dailySummary && dailySummary.evaluatedCalls > 0 && (
        <div className="card p-5 mb-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 左: スコア + 統計 */}
            <div className="flex items-center gap-6">
              <ScoreCircle score={dailySummary.avgScores?.overall_score} />
              <div className="space-y-2 flex-1">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-2xl font-bold text-gray-900">{dailySummary.totalCalls}</p>
                    <p className="text-[11px] text-gray-400">架電数</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-blue-600">{dailySummary.effectiveConnections}</p>
                    <p className="text-[11px] text-gray-400">有効接続</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-emerald-600">{dailySummary.projects}</p>
                    <p className="text-[11px] text-gray-400">案件化</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <ScoreBar label="第一声" score={dailySummary.avgScores?.opening_score} />
                  <ScoreBar label="明瞭さ" score={dailySummary.avgScores?.clarity_score} />
                  <ScoreBar label="ヒアリング" score={dailySummary.avgScores?.hearing_score} />
                  <ScoreBar label="切り返し" score={dailySummary.avgScores?.rebuttal_score} />
                  <ScoreBar label="クロージング" score={dailySummary.avgScores?.closing_score} />
                </div>
              </div>
            </div>

            {/* 右: フィードバック */}
            <div className="space-y-3 text-sm">
              <div className="text-xs font-semibold text-gray-500">日次サマリー</div>
              <p className="text-gray-600 text-xs">
                評価済み: {dailySummary.evaluatedCalls} / {dailySummary.totalCalls}件
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 架電ログテーブル */}
      <div className="card overflow-hidden mb-5">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-gray-800">架電ログ</h2>
            <span className="badge bg-blue-50 text-blue-700">{calls.length}件</span>
            {evaluatedCount > 0 && (
              <span className="badge bg-emerald-50 text-emerald-700">AI評価済: {evaluatedCount}</span>
            )}
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center">
            <svg className="animate-spin w-6 h-6 text-gray-400 mx-auto" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : calls.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
              </svg>
            </div>
            <p className="text-sm text-gray-400">この日の架電データはありません</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="table-header w-8">#</th>
                  <th className="table-header">時間</th>
                  <th className="table-header">企業名</th>
                  <th className="table-header">結果</th>
                  <th className="table-header">通話時間</th>
                  <th className="table-header text-center">有効接続</th>
                  <th className="table-header text-center">担当者</th>
                  <th className="table-header text-center">AIスコア</th>
                  <th className="table-header w-8"></th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call, idx) => {
                  const badge = RESULT_BADGES[call.result_code] || { bg: 'bg-gray-100', text: 'text-gray-500', label: call.result_code || '-' };
                  const isExpanded = expandedCallId === call.id;

                  return (
                    <tr key={call.id} className="group">
                      <td colSpan="9" className="p-0">
                        <div
                          onClick={() => setExpandedCallId(isExpanded ? null : call.id)}
                          className={`flex items-center border-b border-gray-50 cursor-pointer transition-colors ${
                            isExpanded ? 'bg-blue-50/50' : 'hover:bg-blue-50/30'
                          }`}
                        >
                          <span className="table-cell w-8 text-gray-400 text-xs">{idx + 1}</span>
                          <span className="table-cell w-16 text-gray-500 text-xs">
                            {new Date(call.call_started_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="table-cell flex-1 font-medium text-gray-900 truncate">{call.company_name}</span>
                          <span className="table-cell w-20">
                            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>{badge.label}</span>
                          </span>
                          <span className="table-cell w-20 text-gray-500 text-xs">{calcDuration(call.call_started_at, call.call_ended_at)}</span>
                          <span className="table-cell w-16 text-center">
                            {call.is_effective_connection ? (
                              <span className="text-emerald-600 font-bold text-xs">●</span>
                            ) : <span className="text-gray-300 text-xs">-</span>}
                          </span>
                          <span className="table-cell w-16 text-center">
                            {call.is_person_in_charge ? (
                              <span className="text-blue-600 font-bold text-xs">●</span>
                            ) : <span className="text-gray-300 text-xs">-</span>}
                          </span>
                          <span className="table-cell w-16 text-center">
                            {call.overall_score != null ? (
                              <span className={`font-bold text-sm ${
                                call.overall_score >= 80 ? 'text-emerald-600' :
                                call.overall_score >= 60 ? 'text-amber-600' : 'text-red-500'
                              }`}>
                                {call.overall_score}
                              </span>
                            ) : <span className="text-gray-300 text-xs">-</span>}
                          </span>
                          <span className="table-cell w-8 text-center">
                            <svg className={`w-4 h-4 text-gray-400 transition-transform inline-block ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </span>
                        </div>

                        {/* 展開詳細 */}
                        {isExpanded && (
                          <div className="px-5 py-4 bg-gray-50/80 border-b border-gray-100">
                            {call.evaluation_id ? (
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                {/* スコアバー */}
                                <div className="space-y-2">
                                  <h4 className="text-xs font-semibold text-gray-500 mb-3">スコア詳細</h4>
                                  <ScoreBar label="第一声" score={call.opening_score} />
                                  <ScoreBar label="明瞭さ" score={call.clarity_score} />
                                  <ScoreBar label="ヒアリング" score={call.hearing_score} />
                                  <ScoreBar label="切り返し" score={call.rebuttal_score} />
                                  <ScoreBar label="クロージング" score={call.closing_score} />
                                </div>

                                {/* フィードバック */}
                                <div className="space-y-3">
                                  {call.summary && (
                                    <div>
                                      <h4 className="text-xs font-semibold text-gray-500 mb-1">要約</h4>
                                      <p className="text-sm text-gray-600">{call.summary}</p>
                                    </div>
                                  )}
                                  {call.good_points && (
                                    <div className="bg-emerald-50 rounded-lg p-3">
                                      <h4 className="text-xs font-bold text-emerald-700 mb-1">良かった点</h4>
                                      <p className="text-xs text-emerald-800 whitespace-pre-line">{call.good_points}</p>
                                    </div>
                                  )}
                                  {call.improvement_points && (
                                    <div className="bg-red-50 rounded-lg p-3">
                                      <h4 className="text-xs font-bold text-red-700 mb-1">改善点</h4>
                                      <p className="text-xs text-red-800 whitespace-pre-line">{call.improvement_points}</p>
                                    </div>
                                  )}
                                  {call.next_improvement && (
                                    <div className="bg-blue-50 rounded-lg p-3">
                                      <h4 className="text-xs font-bold text-blue-700 mb-1">次回の改善ポイント</h4>
                                      <p className="text-xs text-blue-800">{call.next_improvement}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="text-center py-4">
                                <p className="text-sm text-gray-400 mb-2">AI評価はまだ実行されていません</p>
                                {call.memo && (
                                  <p className="text-xs text-gray-500 bg-white rounded-lg p-3 inline-block">メモ: {call.memo}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 通話ログ検索（折りたたみセクション） */}
      <div className="card overflow-hidden">
        <button
          onClick={() => setShowLogSearch(!showLogSearch)}
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span className="text-sm font-bold text-gray-800">通話ログ検索</span>
            <span className="text-[11px] text-gray-400">電話番号でCRM + スプレッドシートを検索</span>
          </div>
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${showLogSearch ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {showLogSearch && (
          <div className="px-5 pb-5 border-t border-gray-100">
            {/* 検索フォーム */}
            <form onSubmit={handleSearch} className="flex gap-2.5 my-4">
              <div className="relative flex-1 max-w-md">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="input !pl-10"
                  placeholder="電話番号を入力 (例: 03-1234-5678)"
                />
              </div>
              <button type="submit" disabled={searchLoading} className="btn-primary">
                {searchLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    検索中
                  </span>
                ) : '検索'}
              </button>
            </form>

            {searched && (
              <div className="space-y-5">
                {/* CRM通話履歴 */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-xs font-bold text-gray-600">CRM通話履歴</h3>
                    <span className="badge bg-blue-50 text-blue-700">{dbCalls.length}件</span>
                  </div>
                  {dbCalls.length === 0 ? (
                    <div className="p-4 text-center text-gray-400 text-xs bg-gray-50 rounded-lg">該当なし</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-100 bg-gray-50/50">
                            <th className="table-header">通話日時</th>
                            <th className="table-header">企業名</th>
                            <th className="table-header">オペレーター</th>
                            <th className="table-header">結果</th>
                            <th className="table-header">AI評価</th>
                            <th className="table-header">メモ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dbCalls.map((call) => (
                            <tr key={call.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                              <td className="table-cell text-gray-500">
                                {new Date(call.call_started_at).toLocaleString('ja-JP')}
                              </td>
                              <td className="table-cell font-medium text-gray-900">{call.company_name}</td>
                              <td className="table-cell text-gray-500">{call.operator_name || '-'}</td>
                              <td className="table-cell">
                                <span className="badge bg-gray-100 text-gray-700">{call.result_code || '-'}</span>
                              </td>
                              <td className="table-cell">
                                {call.overall_score != null ? (
                                  <span className={`font-bold ${
                                    call.overall_score >= 80 ? 'text-emerald-600' :
                                    call.overall_score >= 60 ? 'text-amber-600' : 'text-red-500'
                                  }`}>
                                    {call.overall_score}点
                                  </span>
                                ) : <span className="text-gray-400">-</span>}
                              </td>
                              <td className="table-cell text-gray-400 max-w-xs truncate">{call.memo || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Google Sheetsログ */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-xs font-bold text-gray-600">Google Sheets通話ログ</h3>
                    <span className="badge bg-emerald-50 text-emerald-700">{sheetLogs.length}件</span>
                  </div>
                  {sheetLogs.length === 0 ? (
                    <div className="p-4 text-center text-gray-400 text-xs bg-gray-50 rounded-lg">
                      該当なし (Google Sheets未連携の可能性あり)
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-100 bg-gray-50/50">
                            {Object.keys(sheetLogs[0]).map((key) => (
                              <th key={key} className="table-header whitespace-nowrap">{key}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sheetLogs.map((log, i) => (
                            <tr key={i} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                              {Object.values(log).map((val, j) => (
                                <td key={j} className="table-cell whitespace-nowrap text-gray-600">{val || '-'}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
