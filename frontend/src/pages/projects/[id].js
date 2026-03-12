/**
 * 案件詳細ページ
 * 企業情報・案件化日時・面接情報・ステータス更新
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const STATUS_OPTIONS = [
  { value: 'NEW', label: '新規' },
  { value: 'MAIL_SENT', label: 'メール送信済' },
  { value: 'INTERVIEW_SET', label: '面接設定済' },
  { value: 'INTERVIEW_DONE', label: '面接完了' },
  { value: 'WAITING_RESULT', label: '結果待ち' },
  { value: 'HIRED', label: '採用' },
  { value: 'LOST', label: '失注' },
];

export default function ProjectDetailPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { id } = router.query;
  const isSales = user?.role === 'sales';
  const [project, setProject] = useState(null);
  const [callHistory, setCallHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    status: '', interview_date: '', interview_type: '',
    document_screening: '', mail_sent: false, memo: '',
  });

  useEffect(() => {
    if (id) fetchProject();
  }, [id]);

  const fetchProject = async () => {
    try {
      const { data } = await api.get(`/api/projects/${id}`);
      const p = data.data.project;
      setProject(p);
      setCallHistory(data.data.callHistory || []);
      setForm({
        status: p.status || '',
        interview_date: p.interview_date ? p.interview_date.slice(0, 16) : '',
        interview_type: p.interview_type || '',
        document_screening: p.document_screening || '',
        mail_sent: !!p.mail_sent,
        memo: p.memo || '',
      });
    } catch (err) {
      toast.error('案件の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    try {
      await api.put(`/api/projects/${id}`, {
        ...form,
        interview_date: form.interview_date || null,
        interview_type: form.interview_type || null,
        document_screening: form.document_screening || null,
      });
      toast.success('案件を更新しました');
      fetchProject();
    } catch (err) {
      toast.error('更新に失敗しました');
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

  if (!project) {
    return (
      <Layout>
        <div className="card p-12 text-center">
          <p className="text-red-500">案件が見つかりません</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">案件詳細</h1>
          <p className="text-sm text-gray-400 mt-0.5">{project.company_name}</p>
        </div>
        <button
          onClick={() => router.push(isSales ? '/sales/projects' : '/projects')}
          className="btn-secondary !py-2 flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          一覧に戻る
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 左: 企業情報 & 案件編集 */}
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-bold text-gray-800 mb-4">企業情報</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {[
                { label: '企業名', value: project.company_name },
                { label: '電話番号', value: project.phone_number },
                { label: '業種', value: project.industry },
                { label: '地域', value: project.region },
                { label: '担当者', value: project.owner_name },
              ].map((item) => (
                <div key={item.label} className="text-sm">
                  <span className="text-xs text-gray-400">{item.label}</span>
                  <p className="font-medium text-gray-800 mt-0.5">{item.value || '-'}</p>
                </div>
              ))}
              <div className="text-sm col-span-2">
                <span className="text-xs text-gray-400">案件化日時</span>
                <p className="font-medium text-gray-800 mt-0.5">
                  {new Date(project.created_at).toLocaleString('ja-JP')}
                </p>
              </div>
            </div>
          </div>

          {!isSales && (
            <div className="card p-5">
              <h2 className="text-sm font-bold text-gray-800 mb-4">案件編集</h2>
              <div className="space-y-4">
                <div>
                  <label className="input-label">ステータス</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="input"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="input-label">面接日時</label>
                  <input
                    type="datetime-local"
                    value={form.interview_date}
                    onChange={(e) => setForm({ ...form, interview_date: e.target.value })}
                    className="input"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="input-label">面接形式</label>
                    <select
                      value={form.interview_type}
                      onChange={(e) => setForm({ ...form, interview_type: e.target.value })}
                      className="input"
                    >
                      <option value="">未選択</option>
                      <option value="online">オンライン</option>
                      <option value="in_person">対面</option>
                    </select>
                  </div>
                  <div>
                    <label className="input-label">書類選考</label>
                    <select
                      value={form.document_screening}
                      onChange={(e) => setForm({ ...form, document_screening: e.target.value })}
                      className="input"
                    >
                      <option value="">未選択</option>
                      <option value="required">あり</option>
                      <option value="not_required">なし</option>
                    </select>
                  </div>
                </div>

                <label className="flex items-center gap-2.5 text-sm cursor-pointer group">
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                    form.mail_sent ? 'bg-blue-600 border-blue-600' : 'border-gray-300 group-hover:border-blue-400'
                  }`}>
                    {form.mail_sent && (
                      <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <input type="checkbox" checked={form.mail_sent} onChange={(e) => setForm({ ...form, mail_sent: e.target.checked })} className="sr-only" />
                  <span className="text-gray-700">メール送信済み</span>
                </label>

                <div>
                  <label className="input-label">メモ</label>
                  <textarea
                    value={form.memo}
                    onChange={(e) => setForm({ ...form, memo: e.target.value })}
                    rows={3}
                    className="input resize-none"
                  />
                </div>

                <button onClick={handleUpdate} className="btn-primary w-full">
                  更新する
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 右: 通話履歴 */}
        <div className="card p-5">
          <h2 className="text-sm font-bold text-gray-800 mb-4">通話履歴</h2>
          <div className="space-y-2.5 max-h-[640px] overflow-y-auto">
            {callHistory.length === 0 ? (
              <div className="py-8 text-center">
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-2">
                  <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-400">通話履歴なし</p>
              </div>
            ) : (
              callHistory.map((call) => (
                <div key={call.id} className="bg-gray-50/80 rounded-lg p-3.5">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs text-gray-400">
                      {new Date(call.call_started_at).toLocaleString('ja-JP')}
                    </span>
                    <span className="text-xs font-bold text-gray-700 bg-white px-2 py-0.5 rounded">
                      {call.result_code || '-'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">担当: {call.operator_name || '-'}</p>
                  {call.memo && (
                    <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">{call.memo}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
