import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

export default function AdminCompanies() {
  const { user } = useAuth();
  const router = useRouter();
  const [companies, setCompanies] = useState([]);
  const [operators, setOperators] = useState([]);
  const [pagination, setPagination] = useState({});
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [assignModal, setAssignModal] = useState(null); // company object or null
  const [selectedOp, setSelectedOp] = useState('');

  useEffect(() => {
    if (user && user.role !== 'admin' && user.role !== 'manager') { router.push('/'); return; }
    if (user) fetchOperators();
  }, [user]);

  useEffect(() => {
    if (user) fetchCompanies();
  }, [user, page, search]);

  const fetchOperators = async () => {
    try {
      const { data } = await api.get('/api/admin/users');
      if (data.success) setOperators(data.data.filter(u => u.role === 'operator' && u.is_active));
    } catch (err) { /* ignore */ }
  };

  const fetchCompanies = async () => {
    try {
      const params = new URLSearchParams({ page, limit: 20 });
      if (search) params.append('search', search);
      const { data } = await api.get(`/api/admin/companies?${params}`);
      if (data.success) {
        setCompanies(data.data.companies);
        setPagination(data.data.pagination);
      }
    } catch (err) { toast.error('架電リスト取得に失敗しました'); }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const handleAssign = async () => {
    if (!assignModal || !selectedOp) return;
    try {
      const { data } = await api.post('/api/admin/companies/assign', {
        company_id: assignModal.id,
        user_id: parseInt(selectedOp),
      });
      if (data.success) {
        toast.success('割り当てを追加しました');
        setAssignModal(null);
        setSelectedOp('');
        fetchCompanies();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || '割り当てに失敗しました');
    }
  };

  const handleUnassign = async (companyId, userId, companyName, opName) => {
    if (!confirm(`${companyName} の ${opName} への割り当てを解除しますか？`)) return;
    try {
      const { data } = await api.delete(`/api/admin/companies/${companyId}/assign/${userId}`);
      if (data.success) {
        toast.success('割り当てを解除しました');
        fetchCompanies();
      }
    } catch (err) {
      toast.error('割り当て解除に失敗しました');
    }
  };

  if (!user || (user.role !== 'admin' && user.role !== 'manager')) return null;

  return (
    <Layout>
      <h1 className="text-xl font-bold text-gray-900 mb-6">架電リスト管理</h1>

      {/* 検索 */}
      <form onSubmit={handleSearch} className="card p-4 mb-6 flex items-end gap-4">
        <div className="flex-1">
          <label className="input-label">企業名・電話番号で検索</label>
          <input
            type="text"
            className="input text-sm"
            placeholder="検索キーワード..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary !py-2.5 px-6">検索</button>
        {search && (
          <button type="button" onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}
            className="btn-secondary !py-2.5 px-4">クリア</button>
        )}
      </form>

      {/* 件数表示 */}
      {pagination.total !== undefined && (
        <p className="text-sm text-gray-500 mb-3">全 {pagination.total.toLocaleString()} 件</p>
      )}

      {/* テーブル */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="table-header">企業名</th>
              <th className="table-header">電話番号</th>
              <th className="table-header">業種</th>
              <th className="table-header">地域</th>
              <th className="table-header">割り当てOP</th>
              <th className="table-header w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            {companies.map(c => (
              <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                <td className="table-cell font-medium">{c.company_name}</td>
                <td className="table-cell text-gray-500">{c.phone_number}</td>
                <td className="table-cell text-gray-500">{c.industry || '-'}</td>
                <td className="table-cell text-gray-500">{c.region || '-'}</td>
                <td className="table-cell">
                  {c.assigned_operators && c.assigned_operators.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {c.assigned_operators.map(op => (
                        <span key={op.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                          {op.name}
                          <button
                            onClick={() => handleUnassign(c.id, op.id, c.company_name, op.name)}
                            className="ml-0.5 text-blue-400 hover:text-red-500 transition-colors"
                            title="割り当て解除"
                          >
                            &times;
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-300 text-xs">未割り当て</span>
                  )}
                </td>
                <td className="table-cell">
                  <button
                    onClick={() => { setAssignModal(c); setSelectedOp(''); }}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    + 割り当て
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {companies.length === 0 && (
          <div className="text-center py-8 text-gray-400">企業がありません</div>
        )}
      </div>

      {/* ページネーション */}
      {pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
            .filter(p => Math.abs(p - page) <= 3 || p === 1 || p === pagination.totalPages)
            .map((p, idx, arr) => (
              <span key={p}>
                {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-gray-400">...</span>}
                <button
                  onClick={() => setPage(p)}
                  className={`px-3 py-1 rounded text-sm ${p === page ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
                >
                  {p}
                </button>
              </span>
            ))}
        </div>
      )}

      {/* 割り当てモーダル */}
      {assignModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setAssignModal(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900 mb-1">オペレーター割り当て</h3>
            <p className="text-sm text-gray-500 mb-5">{assignModal.company_name}</p>

            <div className="mb-5">
              <label className="input-label">オペレーターを選択</label>
              <select className="input" value={selectedOp} onChange={e => setSelectedOp(e.target.value)}>
                <option value="">選択してください</option>
                {operators
                  .filter(op => !assignModal.assigned_operators?.some(a => a.id === op.id))
                  .map(op => <option key={op.id} value={op.id}>{op.name}</option>)
                }
              </select>
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={() => setAssignModal(null)} className="btn-secondary !py-2 px-5">キャンセル</button>
              <button onClick={handleAssign} disabled={!selectedOp} className="btn-primary !py-2 px-5 disabled:opacity-50">割り当て</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
