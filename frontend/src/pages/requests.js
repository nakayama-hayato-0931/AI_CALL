import { useState, useEffect } from 'react';
import Layout from '../components/common/Layout';
import useAuth from '../hooks/useAuth';
import api from '../utils/api';
import toast from 'react-hot-toast';

const STATUS_LABELS = {
  pending: { label: '未対応', style: 'bg-amber-100 text-amber-700' },
  reviewed: { label: '確認済', style: 'bg-blue-100 text-blue-700' },
  resolved: { label: '対応済', style: 'bg-emerald-100 text-emerald-700' },
};

export default function RequestsPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) fetchRequests();
  }, [user]);

  const fetchRequests = async () => {
    try {
      const { data } = await api.get('/api/requests');
      if (data.success) setRequests(data.data);
    } catch (err) { /* ignore */ }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!subject.trim() || !content.trim()) {
      toast.error('件名と内容を入力してください');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post('/api/requests', { subject: subject.trim(), content: content.trim() });
      if (data.success) {
        toast.success('メッセージを送信しました');
        setSubject('');
        setContent('');
        fetchRequests();
      }
    } catch (err) {
      toast.error('送信に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;

  return (
    <Layout>
      <h1 className="text-xl font-bold text-gray-900 mb-6">メッセージ</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左: 新規メッセージフォーム */}
        <div className="card p-5">
          <h2 className="text-sm font-bold text-gray-800 mb-4">新規メッセージ</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="input-label">件名</label>
              <input
                type="text"
                className="input"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="件名を入力..."
                maxLength={255}
              />
            </div>
            <div>
              <label className="input-label">内容</label>
              <textarea
                className="input resize-none"
                rows={6}
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="要望の内容を詳しく記入してください..."
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full disabled:opacity-50"
            >
              {submitting ? '送信中...' : 'メッセージを送信'}
            </button>
          </form>
        </div>

        {/* 右: メッセージ履歴 */}
        <div>
          <h2 className="text-sm font-bold text-gray-800 mb-3">メッセージ履歴</h2>
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {requests.length === 0 && (
              <div className="card p-8 text-center text-gray-400 text-sm">まだメッセージがありません</div>
            )}
            {requests.map(r => {
              const st = STATUS_LABELS[r.status] || STATUS_LABELS.pending;
              return (
                <div key={r.id} className="card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.style}`}>{st.label}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(r.created_at).toLocaleString('ja-JP')}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-gray-900 mb-1">{r.subject}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{r.content}</p>

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
        </div>
      </div>
    </Layout>
  );
}
