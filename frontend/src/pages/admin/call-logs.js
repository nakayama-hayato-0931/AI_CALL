/**
 * 管理者用 架電結果ログ
 * 全オペレーターの架電結果を一覧表示・文字起こし閲覧
 */
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const RESULT_BADGES = {
  NO_ANSWER: { bg: 'bg-gray-100', text: 'text-gray-600', label: '不通' },
  NG: { bg: 'bg-red-50', text: 'text-red-600', label: 'NG' },
  RECALL: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'リコール' },
  INTERESTED: { bg: 'bg-blue-50', text: 'text-blue-700', label: '興味あり' },
  PROJECT: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: '案件化' },
  SKIP: { bg: 'bg-gray-50', text: 'text-gray-400', label: 'SKIP' },
};

const RESULT_OPTIONS = [
  { value: '', label: '全て' },
  { value: 'NO_ANSWER', label: '不通' },
  { value: 'NG', label: 'NG' },
  { value: 'RECALL', label: 'リコール' },
  { value: 'INTERESTED', label: '興味あり' },
  { value: 'PROJECT', label: '案件化' },
  { value: 'SKIP', label: 'SKIP' },
];

export default function AdminCallLogsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const [calls, setCalls] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // フィルター
  const [viewMode, setViewMode] = useState('daily');
  const [date, setDate] = useState(today);
  const [dateFrom, setDateFrom] = useState(weekAgo);
  const [dateTo, setDateTo] = useState(today);
  const [resultCode, setResultCode] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [operators, setOperators] = useState([]);

  // 展開（文字起こし表示）
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    if (user && !['admin', 'manager'].includes(user.role)) {
      router.push('/');
      return;
    }
    if (user) fetchOperators();
  }, [user]);

  useEffect(() => {
    if (user) fetchCalls();
  }, [user, page, viewMode, date, dateFrom, dateTo, resultCode, operatorId, search]);

  const fetchOperators = async () => {
    try {
      const { data } = await api.get('/api/calls/operators');
      if (data.success) setOperators(data.data);
    } catch (err) { /* ignore */ }
  };

  const fetchCalls = async () => {
    setLoading(true);
    try {
      const params = { page, limit: 50 };
      if (viewMode === 'daily') {
        params.date_from = date;
        params.date_to = date + ' 23:59:59';
      } else if (viewMode === 'range') {
        params.date_from = dateFrom;
        params.date_to = dateTo + ' 23:59:59';
      }
      if (operatorId) params.user_id = operatorId;
      if (resultCode) params.result_code = resultCode;
      if (search) params.search = search;

      const { data } = await api.get('/api/calls', { params });
      if (data.success) {
        setCalls(data.data.calls);
        setPagination({ ...data.data.pagination, resultSummary: data.data.resultSummary });
      }
    } catch (err) {
      toast.error('架電結果の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const calcDuration = (start, end) => {
    if (!start || !end) return '-';
    const sec = Math.round((new Date(end) - new Date(start)) / 1000);
    if (sec < 60) return `${sec}秒`;
    return `${Math.floor(sec / 60)}分${sec % 60}秒`;
  };

  const formatDateTime = (dt) => {
    if (!dt) return '-';
    return new Date(dt).toLocaleString('ja-JP', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  // 結果コード別の集計（バックエンドから全件分を取得、なければページ分で計算）
  const resultSummary = pagination.resultSummary || calls.reduce((acc, c) => {
    const code = c.result_code || 'UNKNOWN';
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {});

  if (!user || !['admin', 'manager'].includes(user.role)) return null;

  return (
    <Layout>
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">架電結果ログ</h1>
          <p className="text-sm text-gray-400 mt-0.5">全オペレーターの架電結果を確認</p>
        </div>
      </div>

      {/* フィルターバー */}
      <div className="card p-4 mb-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* 表示モード切替 */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {[
              { value: 'daily', label: '日別' },
              { value: 'range', label: '期間' },
              { value: 'all', label: '全て' },
            ].map(m => (
              <button key={m.value} onClick={() => { setViewMode(m.value); setPage(1); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === m.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>{m.label}</button>
            ))}
          </div>

          {/* 日付ピッカー */}
          {viewMode === 'daily' && (
            <input type="date" value={date} onChange={e => { setDate(e.target.value); setPage(1); }} className="input !w-44" />
          )}
          {viewMode === 'range' && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="input !w-40" />
              <span className="text-gray-400 text-xs">~</span>
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="input !w-40" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* ステータスフィルター */}
          <select value={resultCode} onChange={e => { setResultCode(e.target.value); setPage(1); }} className="input text-sm !w-auto">
            {RESULT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          {/* 担当者フィルター */}
          <select value={operatorId} onChange={e => { setOperatorId(e.target.value); setPage(1); }} className="input text-sm !w-auto">
            <option value="">全オペレーター</option>
            {operators.map(op => <option key={op.id} value={op.id}>{op.name}</option>)}
          </select>

          {/* 検索 */}
          <form onSubmit={handleSearch} className="flex gap-2 flex-1 max-w-md">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)}
                className="input !pl-9" placeholder="企業名・電話番号・メモで検索" />
            </div>
            <button type="submit" className="btn-primary text-sm">検索</button>
          </form>
        </div>
      </div>

      {/* 件数 + サマリー */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="text-xs text-gray-500">
          {pagination.total != null ? `${pagination.total}件` : ''}
          {viewMode === 'daily' && ` (${date})`}
        </span>
        {calls.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {Object.entries(resultSummary).map(([code, count]) => {
              const badge = RESULT_BADGES[code];
              if (!badge) return null;
              return (
                <span key={code} className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
                  {badge.label}: {count}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* テーブル */}
      <div className="card overflow-hidden">
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
            <p className="text-sm text-gray-400">架電データがありません</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="table-header">日時</th>
                  <th className="table-header">担当者</th>
                  <th className="table-header">企業名</th>
                  <th className="table-header">電話番号</th>
                  <th className="table-header">結果</th>
                  <th className="table-header">通話時間</th>
                  <th className="table-header text-center">有効接続</th>
                  <th className="table-header text-center">担当者接続</th>
                  <th className="table-header">メモ</th>
                  <th className="table-header text-center">文字起こし</th>
                </tr>
              </thead>
              <tbody>
                {calls.map(call => {
                  const badge = RESULT_BADGES[call.result_code] || { bg: 'bg-gray-100', text: 'text-gray-500', label: call.result_code || '-' };
                  const isExpanded = expandedId === call.id;
                  const hasTranscript = call.transcript && call.transcript.trim().length > 0;

                  return (
                    <React.Fragment key={call.id}>
                      <tr className={`border-b border-gray-50 transition-colors ${
                        isExpanded ? 'bg-blue-50/50' : 'hover:bg-blue-50/30'
                      }`}>
                        <td className="table-cell text-gray-500 text-xs whitespace-nowrap">
                          {formatDateTime(call.call_started_at)}
                        </td>
                        <td className="table-cell font-medium text-gray-700 text-xs">
                          {call.operator_name || '-'}
                        </td>
                        <td className="table-cell font-medium text-gray-900">
                          {call.company_name || '-'}
                        </td>
                        <td className="table-cell text-xs text-gray-500">
                          {call.phone_number || '-'}
                        </td>
                        <td className="table-cell">
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>{badge.label}</span>
                        </td>
                        <td className="table-cell text-gray-500 text-xs">
                          {calcDuration(call.call_started_at, call.call_ended_at)}
                        </td>
                        <td className="table-cell text-center">
                          {call.is_effective_connection ? <span className="text-emerald-600 font-bold text-lg">●</span> : <span className="text-gray-300 text-xs">-</span>}
                        </td>
                        <td className="table-cell text-center">
                          {call.is_person_in_charge ? <span className="text-blue-600 font-bold text-lg">●</span> : <span className="text-gray-300 text-xs">-</span>}
                        </td>
                        <td className="table-cell text-gray-400 text-xs max-w-[200px]">
                          <span className="truncate block">{call.memo || '-'}</span>
                        </td>
                        <td className="table-cell text-center">
                          {hasTranscript ? (
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : call.id)}
                              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                            >
                              <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                              表示
                            </button>
                          ) : (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const btn = e.currentTarget;
                                btn.disabled = true;
                                btn.textContent = '検索中...';
                                try {
                                  const { data } = await api.post(`/api/calls/${call.id}/refresh-transcript`);
                                  if (data.data?.found) {
                                    toast.success('文字起こしを取得しました');
                                    fetchCalls();
                                  } else {
                                    toast.error('文字起こしが見つかりませんでした');
                                    btn.textContent = '未取得';
                                    btn.disabled = false;
                                  }
                                } catch (err) {
                                  toast.error('取得に失敗しました');
                                  btn.textContent = '再試行';
                                  btn.disabled = false;
                                }
                              }}
                              className="text-[10px] text-amber-600 hover:text-amber-800 font-medium px-1.5 py-0.5 rounded border border-amber-200 hover:bg-amber-50"
                            >ログ取得</button>
                          )}
                        </td>
                      </tr>
                      {/* 展開: 文字起こし */}
                      {isExpanded && hasTranscript && (
                        <tr>
                          <td colSpan="10" className="p-0">
                            <div className="px-5 py-4 bg-gray-50/80 border-b border-gray-100">
                              <div className="flex items-center gap-2 mb-2">
                                <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                                </svg>
                                <h4 className="text-xs font-semibold text-gray-500">文字起こし</h4>
                              </div>
                              <div className="bg-white rounded-lg p-4 border border-gray-200 max-h-80 overflow-y-auto">
                                <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                                  {call.transcript}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ページネーション */}
      {pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
            className="px-3 py-1 rounded text-sm bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-40">
            ←
          </button>
          {Array.from({ length: Math.min(pagination.totalPages, 10) }, (_, i) => {
            const start = Math.max(1, Math.min(page - 4, pagination.totalPages - 9));
            return start + i;
          }).filter(p => p <= pagination.totalPages).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`px-3 py-1 rounded text-sm ${p === page ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>{p}</button>
          ))}
          <button onClick={() => setPage(Math.min(pagination.totalPages, page + 1))} disabled={page === pagination.totalPages}
            className="px-3 py-1 rounded text-sm bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-40">
            →
          </button>
        </div>
      )}
    </Layout>
  );
}
