/**
 * リコール管理ページ
 * 今日・明日・期限超過のリコールを表示
 */
import React, { useState, useEffect } from 'react';
import Layout from '../components/common/Layout';
import api from '../utils/api';
import toast from 'react-hot-toast';

export default function RecallsPage() {
  const [recalls, setRecalls] = useState({ today: [], tomorrow: [], overdue: [], other: [] });
  const [counts, setCounts] = useState({ today: 0, tomorrow: 0, overdue: 0, other: 0 });
  const [activeTab, setActiveTab] = useState('today');
  const [loading, setLoading] = useState(true);
  const [expandedTranscript, setExpandedTranscript] = useState(null);

  const fetchRecalls = async () => {
    try {
      const { data } = await api.get('/api/recalls');
      setRecalls({ today: data.data.today, tomorrow: data.data.tomorrow, overdue: data.data.overdue, other: data.data.other || [] });
      setCounts(data.data.counts);
    } catch (err) {
      toast.error('リコールの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecalls();
  }, []);

  const handleComplete = async (id) => {
    try {
      await api.put(`/api/recalls/${id}/complete`);
      toast.success('リコールを完了しました');
      fetchRecalls();
    } catch (err) {
      toast.error('完了処理に失敗しました');
    }
  };

  const handleCancel = async (id) => {
    try {
      await api.put(`/api/recalls/${id}/cancel`);
      toast.success('リコールをキャンセルしました');
      fetchRecalls();
    } catch (err) {
      toast.error('キャンセルに失敗しました');
    }
  };

  const tabs = [
    { key: 'today', label: '今日', count: counts.today, color: 'blue' },
    { key: 'tomorrow', label: '明日', count: counts.tomorrow, color: 'gray' },
    { key: 'overdue', label: '期限超過', count: counts.overdue, color: 'red' },
    { key: 'other', label: 'その他', count: counts.other, color: 'purple' },
  ];

  const activeRecalls = recalls[activeTab] || [];

  return (
    <Layout>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">リコール管理</h1>
        <p className="text-sm text-gray-400 mt-0.5">リコール予定の確認・管理</p>
      </div>

      {/* タブ */}
      <div className="flex gap-1 mb-5 bg-gray-100/80 rounded-xl p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-all duration-150 flex items-center gap-2 ${
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold flex items-center justify-center ${
                tab.key === 'overdue'
                  ? 'bg-red-100 text-red-600'
                  : activeTab === tab.key
                    ? 'bg-blue-100 text-blue-600'
                    : 'bg-gray-200 text-gray-500'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* リコール一覧 */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="flex items-center justify-center gap-3 text-gray-400">
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm">読み込み中...</span>
            </div>
          </div>
        ) : activeRecalls.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <p className="text-sm text-gray-400">リコールはありません</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="table-header">リコール日時</th>
                <th className="table-header">企業名</th>
                <th className="table-header">電話番号</th>
                <th className="table-header">業種</th>
                <th className="table-header">前回メモ</th>
                <th className="table-header">通話ログ</th>
                <th className="table-header text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {activeRecalls.map((recall) => {
                const rowKey = recall.source_type === 'interested' ? `int_${recall.id}` : recall.id;
                return (
                <React.Fragment key={rowKey}>
                <tr className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                  <td className="table-cell text-gray-500">
                    {new Date(recall.recall_at).toLocaleString('ja-JP')}
                  </td>
                  <td className="table-cell font-medium text-gray-900">{recall.company_name}</td>
                  <td className="table-cell text-gray-600">{recall.phone_number}</td>
                  <td className="table-cell text-gray-500">{recall.industry || '-'}</td>
                  <td className="table-cell text-gray-400 max-w-xs truncate">{recall.call_memo || '-'}</td>
                  <td className="table-cell">
                    {recall.call_transcript ? (
                      <div>
                        <button
                          onClick={() => setExpandedTranscript(expandedTranscript === rowKey ? null : rowKey)}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                          </svg>
                          {expandedTranscript === rowKey ? '閉じる' : '表示'}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">-</span>
                    )}
                  </td>
                  <td className="table-cell text-center">
                    {recall.source_type === 'interested' ? (
                      <span className="px-2.5 py-1 bg-blue-50 text-blue-600 text-xs font-medium rounded-full">興味あり</span>
                    ) : recall.source_type === 'future_recall' ? (
                      <div className="flex items-center justify-center gap-2">
                        <span className="px-2.5 py-1 bg-purple-50 text-purple-600 text-xs font-medium rounded-full">予定</span>
                        <button
                          onClick={() => handleCancel(recall.id)}
                          className="px-3 py-1.5 bg-gray-50 text-gray-500 text-xs font-medium rounded-md hover:bg-gray-100 transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleComplete(recall.id)}
                          className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-md hover:bg-emerald-100 transition-colors"
                        >
                          完了
                        </button>
                        <button
                          onClick={() => handleCancel(recall.id)}
                          className="px-3 py-1.5 bg-gray-50 text-gray-500 text-xs font-medium rounded-md hover:bg-gray-100 transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
                {expandedTranscript === rowKey && recall.call_transcript && (
                  <tr className="bg-gray-50/50">
                    <td colSpan="7" className="px-4 pb-4 pt-2">
                      <div className="bg-white border border-gray-200 rounded-lg p-3 max-h-80 overflow-y-auto">
                        <pre className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">{recall.call_transcript}</pre>
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
