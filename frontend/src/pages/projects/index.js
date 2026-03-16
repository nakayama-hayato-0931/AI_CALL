/**
 * 案件管理ページ (一覧)
 * 案件一覧・ステータスフィルター
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const STATUS_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'NEW', label: '新規' },
  { value: 'MAIL_SENT', label: 'メール送信済' },
  { value: 'INTERVIEW_SET', label: '面接設定済' },
  { value: 'INTERVIEW_DONE', label: '面接完了' },
  { value: 'WAITING_RESULT', label: '結果待ち' },
  { value: 'HIRED', label: '採用' },
  { value: 'LOST', label: '失注' },
];

const STATUS_STYLES = {
  NEW: 'bg-blue-50 text-blue-700',
  MAIL_SENT: 'bg-amber-50 text-amber-700',
  INTERVIEW_SET: 'bg-violet-50 text-violet-700',
  INTERVIEW_DONE: 'bg-indigo-50 text-indigo-700',
  WAITING_RESULT: 'bg-orange-50 text-orange-700',
  HIRED: 'bg-emerald-50 text-emerald-700',
  LOST: 'bg-gray-100 text-gray-500',
};

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchProjects = async (page = 1) => {
    try {
      const params = { page, limit: 20 };
      if (statusFilter) params.status = statusFilter;
      const { data } = await api.get('/api/projects', { params });
      setProjects(data.data.projects);
      setPagination(data.data.pagination);
    } catch (err) {
      toast.error('案件の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [statusFilter]);

  return (
    <Layout>
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">案件管理</h1>
          <p className="text-sm text-gray-400 mt-0.5">案件の一覧と進捗管理</p>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input !w-auto min-w-[160px]"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

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
        ) : projects.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
            </div>
            <p className="text-sm text-gray-400">案件がありません</p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="table-header">企業名</th>
                  <th className="table-header">電話番号</th>
                  <th className="table-header">担当OP</th>
                  <th className="table-header">担当営業</th>
                  <th className="table-header">面接日</th>
                  <th className="table-header">メール</th>
                  <th className="table-header">面接形式</th>
                  <th className="table-header">書類選考</th>
                  <th className="table-header">ステータス</th>
                  <th className="table-header text-center">詳細</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors cursor-pointer" onClick={() => router.push(`/projects/${p.id}`)}>
                    <td className="table-cell font-medium text-gray-900">{p.company_name}</td>
                    <td className="table-cell text-gray-600">{p.phone_number}</td>
                    <td className="table-cell text-gray-500">{p.owner_name || '-'}</td>
                    <td className="table-cell text-gray-500">{p.sales_name || '-'}</td>
                    <td className="table-cell text-gray-500">
                      {p.interview_date ? new Date(p.interview_date).toLocaleString('ja-JP') : '-'}
                    </td>
                    <td className="table-cell">
                      {p.mail_sent ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                          送信済
                        </span>
                      ) : (
                        <span className="text-gray-400">未送信</span>
                      )}
                    </td>
                    <td className="table-cell text-gray-500">
                      {p.interview_type === 'online' ? 'オンライン' : p.interview_type === 'in_person' ? '対面' : '-'}
                    </td>
                    <td className="table-cell text-gray-500">
                      {p.document_screening === 'required' ? 'あり' : p.document_screening === 'not_required' ? 'なし' : '-'}
                    </td>
                    <td className="table-cell">
                      <span className={`badge ${STATUS_STYLES[p.status] || 'bg-gray-100 text-gray-500'}`}>
                        {STATUS_OPTIONS.find((s) => s.value === p.status)?.label || p.status}
                      </span>
                    </td>
                    <td className="table-cell text-center">
                      <svg className="w-4 h-4 text-gray-400 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {pagination.totalPages > 1 && (
              <div className="flex justify-center gap-1.5 py-4 border-t border-gray-100">
                {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={(e) => { e.stopPropagation(); fetchProjects(page); }}
                    className={`w-8 h-8 text-sm rounded-lg transition-all ${
                      page === pagination.page
                        ? 'bg-blue-600 text-white font-medium shadow-sm'
                        : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
