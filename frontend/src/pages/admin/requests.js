import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const STATUS_LABELS = {
  pending: { label: '未対応', style: 'bg-amber-100 text-amber-700' },
  reviewed: { label: '確認済', style: 'bg-blue-100 text-blue-700' },
  resolved: { label: '対応済', style: 'bg-emerald-100 text-emerald-700' },
};

export default function AdminRequests() {
  const { user } = useAuth();
  const router = useRouter();
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [replyTarget, setReplyTarget] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replyStatus, setReplyStatus] = useState('reviewed');

  useEffect(() => {
    if (user && user.role !== 'admin' && user.role !== 'manager') { router.push('/'); return; }
  }, [user]);

  useEffect(() => {
    if (user) fetchRequests();
  }, [user, statusFilter]);

  const fetchRequests = async () => {
    try {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const { data } = await api.get(`/api/admin/requests${params}`);
      if (data.success) setRequests(data.data);
    } catch (err) { toast.error('メッセージ取得に失敗しました'); }
  };

  const handleReply = async () => {
    if (!replyTarget) return;
    try {
      const body = {};
      if (replyText) body.admin_reply = replyText;
      if (replyStatus) body.status = replyStatus;
      const { data } = await api.put(`/api/admin/requests/${replyTarget.id}`, body);
      if (data.success) {
        toast.success('返信しました');
        setReplyTarget(null);
        setReplyText('');
        setReplyStatus('reviewed');
        fetchRequests();
      }
    } catch (err) {
      toast.error('返信に失敗しました');
    }
  };

  if (!user || (user.role !== 'admin' && user.role !== 'manager')) return null;

  return (
    <Layout>
      <h1 className="text-xl font-bold text-gray-900 mb-6">メッセージ管理</h1>

      {/* フィルター */}
      <div className="card p-4 mb-6 flex items-end gap-4">
        <div>
          <label className="input-label">ステータス</label>
          <select className="input text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">すべて</option>
            <option value="pending">未対応</option>
            <option value="reviewed">確認済</option>
            <option value="resolved">対応済</option>
          </select>
        </div>
      </div>

      {/* メッセージ一覧 */}
      <div className="space-y-3">
        {requests.length === 0 && (
          <div className="card p-8 text-center text-gray-400">メッセージがありません</div>
        )}
        {requests.map(r => {
          const st = STATUS_LABELS[r.status] || STATUS_LABELS.pending;
          return (
            <div key={r.id} className="card p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.style}`}>{st.label}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(r.created_at).toLocaleString('ja-JP')}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-gray-900">{r.subject}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">送信者: {r.requester_name} ({r.requester_email})</p>
                </div>
                <button
                  onClick={() => { setReplyTarget(r); setReplyText(r.admin_reply || ''); setReplyStatus(r.status === 'pending' ? 'reviewed' : r.status); }}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap"
                >
                  返信する
                </button>
              </div>

              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {r.content}
              </div>

              {r.admin_reply && (
                <div className="mt-3 border-l-2 border-blue-300 pl-3">
                  <p className="text-xs text-blue-600 font-medium mb-1">
                    管理者返信 ({r.replier_name} / {r.replied_at ? new Date(r.replied_at).toLocaleString('ja-JP') : ''})
                  </p>
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{r.admin_reply}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 返信モーダル */}
      {replyTarget && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setReplyTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900 mb-1">メッセージに返信</h3>
            <p className="text-sm text-gray-500 mb-4">{replyTarget.subject}</p>

            <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600 mb-4 max-h-32 overflow-y-auto whitespace-pre-wrap">
              {replyTarget.content}
            </div>

            <div className="mb-4">
              <label className="input-label">ステータス</label>
              <select className="input text-sm" value={replyStatus} onChange={e => setReplyStatus(e.target.value)}>
                <option value="pending">未対応</option>
                <option value="reviewed">確認済</option>
                <option value="resolved">対応済</option>
              </select>
            </div>

            <div className="mb-5">
              <label className="input-label">返信内容</label>
              <textarea
                className="input resize-none"
                rows={4}
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                placeholder="返信を入力..."
              />
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={() => setReplyTarget(null)} className="btn-secondary !py-2 px-5">キャンセル</button>
              <button onClick={handleReply} className="btn-primary !py-2 px-5">返信する</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
