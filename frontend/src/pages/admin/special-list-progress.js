/**
 * 特別リスト架電進捗ページ
 * バッチ一覧 + 進捗バー + 結果内訳 + CSVエクスポート
 */
import { useState, useEffect } from 'react';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const RESULT_LABELS = { NO_ANSWER: '不通', NG: 'NG', RECALL: 'リコール', INTERESTED: '興味あり', PROJECT: '案件化' };
const RESULT_COLORS = { NO_ANSWER: 'bg-gray-200', NG: 'bg-red-200', RECALL: 'bg-amber-200', INTERESTED: 'bg-blue-200', PROJECT: 'bg-emerald-200' };

export default function SpecialListProgressPage() {
  const { user } = useAuth();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailModal, setDetailModal] = useState(null);
  const [details, setDetails] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (user && ['admin', 'manager', 'consultant'].includes(user.role)) fetchBatches();
  }, [user]);

  const fetchBatches = async () => {
    try {
      const { data } = await api.get('/api/admin/special-list-batches');
      if (data.success) setBatches(data.data);
    } catch (err) { toast.error('データの取得に失敗しました'); }
    finally { setLoading(false); }
  };

  const openDetails = async (batch) => {
    setDetailModal(batch);
    setDetailLoading(true);
    try {
      const { data } = await api.get(`/api/admin/special-list-batches/${batch.id}/details`);
      if (data.success) setDetails(data.data);
    } catch (err) { toast.error('詳細の取得に失敗しました'); }
    finally { setDetailLoading(false); }
  };

  const handleExport = async (batchId, batchName) => {
    try {
      const response = await api.get(`/api/admin/special-list-batches/${batchId}/export`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${batchName}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('CSVをダウンロードしました');
    } catch (err) { toast.error('エクスポートに失敗しました'); }
  };

  if (!user || !['admin', 'manager', 'consultant'].includes(user.role)) return null;

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">特別リスト進捗</h1>
        <p className="text-sm text-gray-400 mt-0.5">インポートした特別リストの架電進捗と結果を確認</p>
      </div>

      {loading ? (
        <div className="card p-8 text-center text-gray-400">読み込み中...</div>
      ) : batches.length === 0 ? (
        <div className="card p-8 text-center text-gray-400">インポートされた特別リストはありません</div>
      ) : (
        <div className="space-y-4">
          {batches.map(b => {
            const total = b.current_count || b.total_count;
            const called = b.called_count || 0;
            const uncalled = total - called;
            const pct = total > 0 ? ((called / total) * 100).toFixed(0) : 0;
            return (
              <div key={b.id} className="card p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">{b.name}</h3>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {new Date(b.created_at).toLocaleDateString('ja-JP')} / {b.created_by_name || '-'} / {total}件
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openDetails(b)}
                      className="px-3 py-1.5 text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg font-medium transition-colors">
                      詳細
                    </button>
                    <button onClick={() => handleExport(b.id, b.name)}
                      className="px-3 py-1.5 text-xs bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg font-medium transition-colors">
                      CSV出力
                    </button>
                  </div>
                </div>

                {/* 進捗バー */}
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-500">架電進捗</span>
                    <span className="font-medium text-blue-600">{called}/{total} ({pct}%)</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                    <div className="bg-blue-500 h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {/* 結果内訳 */}
                <div className="flex flex-wrap gap-2 text-[10px]">
                  <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600">未架電 {uncalled}</span>
                  {b.no_answer_count > 0 && <span className="px-2 py-1 rounded-full bg-gray-200 text-gray-700">不通 {b.no_answer_count}</span>}
                  {b.ng_count > 0 && <span className="px-2 py-1 rounded-full bg-red-100 text-red-600">NG {b.ng_count}</span>}
                  {b.recall_count > 0 && <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700">リコール {b.recall_count}</span>}
                  {b.interested_count > 0 && <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">興味あり {b.interested_count}</span>}
                  {b.project_count > 0 && <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">案件化 {b.project_count}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 詳細モーダル */}
      {detailModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setDetailModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-800">{detailModal.name}</h3>
                <p className="text-[10px] text-gray-400">{detailModal.current_count || detailModal.total_count}件</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleExport(detailModal.id, detailModal.name)}
                  className="px-3 py-1.5 text-xs bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg font-medium">CSV出力</button>
                <button onClick={() => setDetailModal(null)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
              </div>
            </div>
            <div className="overflow-auto max-h-[70vh]">
              {detailLoading ? (
                <p className="text-center py-8 text-gray-400 text-sm">読み込み中...</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">企業名</th>
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">電話番号</th>
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">業種</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-600">架電数</th>
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">最終結果</th>
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">最終架電日</th>
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">架電者</th>
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">メモ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.map((c, i) => (
                      <tr key={c.id} className={`border-b border-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/30'}`}>
                        <td className="py-2 px-3 font-medium">{c.company_name}</td>
                        <td className="py-2 px-3 text-gray-500">{c.phone_number}</td>
                        <td className="py-2 px-3 text-gray-500">{c.industry || '-'}</td>
                        <td className="py-2 px-3 text-right font-semibold">{c.call_count}</td>
                        <td className="py-2 px-3">
                          {c.last_result ? (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              c.last_result === 'PROJECT' ? 'bg-emerald-100 text-emerald-700' :
                              c.last_result === 'INTERESTED' ? 'bg-blue-100 text-blue-700' :
                              c.last_result === 'RECALL' ? 'bg-amber-100 text-amber-700' :
                              c.last_result === 'NG' ? 'bg-red-100 text-red-600' :
                              'bg-gray-100 text-gray-600'
                            }`}>{RESULT_LABELS[c.last_result] || c.last_result}</span>
                          ) : <span className="text-gray-300">未架電</span>}
                        </td>
                        <td className="py-2 px-3 text-gray-500">{c.last_called_at ? new Date(c.last_called_at).toLocaleDateString('ja-JP') : '-'}</td>
                        <td className="py-2 px-3 text-gray-500">{c.last_caller || '-'}</td>
                        <td className="py-2 px-3 text-gray-500 max-w-[200px] truncate" title={c.last_memo}>{c.last_memo || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
