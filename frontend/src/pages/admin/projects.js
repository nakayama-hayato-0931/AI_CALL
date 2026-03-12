import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const STATUS_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'NEW', label: '新規' },
  { value: 'MAIL_SENT', label: 'メール送付済' },
  { value: 'INTERVIEW_SET', label: '面談設定済' },
  { value: 'INTERVIEW_DONE', label: '面談完了' },
  { value: 'WAITING_RESULT', label: '結果待ち' },
  { value: 'HIRED', label: '成約' },
  { value: 'LOST', label: '失注' },
];

const STATUS_STYLES = {
  NEW: 'bg-blue-100 text-blue-700',
  MAIL_SENT: 'bg-cyan-100 text-cyan-700',
  INTERVIEW_SET: 'bg-purple-100 text-purple-700',
  INTERVIEW_DONE: 'bg-indigo-100 text-indigo-700',
  WAITING_RESULT: 'bg-amber-100 text-amber-700',
  HIRED: 'bg-emerald-100 text-emerald-700',
  LOST: 'bg-gray-100 text-gray-500',
};

export default function AdminProjects() {
  const { user } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [pagination, setPagination] = useState({});
  const [operators, setOperators] = useState([]);
  const [status, setStatus] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (user && user.role !== 'admin' && user.role !== 'manager') { router.push('/'); return; }
    if (user) fetchOperators();
  }, [user]);

  useEffect(() => {
    if (user) fetchProjects();
  }, [user, status, ownerId, page]);

  const fetchOperators = async () => {
    try {
      const { data } = await api.get('/api/admin/users');
      if (data.success) setOperators(data.data.filter(u => u.role === 'operator'));
    } catch (err) { /* ignore */ }
  };

  const fetchProjects = async () => {
    try {
      const params = new URLSearchParams({ page, limit: 20 });
      if (status) params.append('status', status);
      if (ownerId) params.append('owner_user_id', ownerId);
      const { data } = await api.get(`/api/projects?${params}`);
      if (data.success) {
        setProjects(data.data.projects);
        setPagination(data.data.pagination);
      }
    } catch (err) { toast.error('案件取得に失敗しました'); }
  };

  if (!user || (user.role !== 'admin' && user.role !== 'manager')) return null;

  return (
    <Layout>
      <h1 className="text-xl font-bold text-gray-900 mb-6">案件管理</h1>

      {/* フィルター */}
      <div className="card p-4 mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="input-label">ステータス</label>
          <select className="input text-sm" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="input-label">オペレーター</label>
          <select className="input text-sm" value={ownerId} onChange={e => { setOwnerId(e.target.value); setPage(1); }}>
            <option value="">全員</option>
            {operators.map(op => <option key={op.id} value={op.id}>{op.name}</option>)}
          </select>
        </div>
      </div>

      {/* テーブル */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="table-header">企業名</th>
              <th className="table-header">電話番号</th>
              <th className="table-header">担当OP</th>
              <th className="table-header">面談日</th>
              <th className="table-header">面談形式</th>
              <th className="table-header">メール</th>
              <th className="table-header">ステータス</th>
              <th className="table-header">作成日</th>
            </tr>
          </thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50/50 cursor-pointer"
                onClick={() => router.push(`/projects/${p.id}`)}>
                <td className="table-cell font-medium">{p.company_name}</td>
                <td className="table-cell text-gray-500">{p.phone_number}</td>
                <td className="table-cell">{p.owner_name}</td>
                <td className="table-cell text-gray-500">
                  {p.interview_date ? new Date(p.interview_date).toLocaleDateString('ja-JP') : '-'}
                </td>
                <td className="table-cell">{p.interview_type === 'online' ? 'オンライン' : p.interview_type === 'in_person' ? '対面' : '-'}</td>
                <td className="table-cell">{p.mail_sent ? '済' : '未'}</td>
                <td className="table-cell">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[p.status] || 'bg-gray-100'}`}>
                    {STATUS_OPTIONS.find(s => s.value === p.status)?.label || p.status}
                  </span>
                </td>
                <td className="table-cell text-gray-400">{new Date(p.created_at).toLocaleDateString('ja-JP')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {projects.length === 0 && (
          <div className="text-center py-8 text-gray-400">案件がありません</div>
        )}
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`px-3 py-1 rounded text-sm ${p === page ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>{p}</button>
          ))}
        </div>
      )}
    </Layout>
  );
}
