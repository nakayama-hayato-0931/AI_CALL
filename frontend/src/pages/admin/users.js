import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const ROLE_OPTIONS = [
  { value: 'operator', label: 'オペレーター' },
  { value: 'manager', label: 'マネージャー' },
  { value: 'admin', label: '管理者' },
  { value: 'sales', label: '営業' },
];

const ROLE_STYLES = {
  admin: 'bg-red-100 text-red-700',
  manager: 'bg-purple-100 text-purple-700',
  operator: 'bg-blue-100 text-blue-700',
  sales: 'bg-green-100 text-green-700',
};

export default function AdminUsers() {
  const { user } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'operator' });

  useEffect(() => {
    if (user && user.role !== 'admin') { router.push('/'); return; }
    if (user) fetchUsers();
  }, [user]);

  const fetchUsers = async () => {
    try {
      const { data } = await api.get('/api/admin/users');
      if (data.success) setUsers(data.data);
    } catch (err) { toast.error('ユーザー取得に失敗しました'); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingUser) {
        const payload = { name: form.name, email: form.email, role: form.role };
        if (form.password) payload.password = form.password;
        await api.put(`/api/admin/users/${editingUser.id}`, payload);
        toast.success('ユーザーを更新しました');
      } else {
        await api.post('/api/admin/users', form);
        toast.success('ユーザーを作成しました');
      }
      setShowForm(false);
      setEditingUser(null);
      setForm({ name: '', email: '', password: '', role: 'operator' });
      fetchUsers();
    } catch (err) {
      toast.error(err.response?.data?.message || 'エラーが発生しました');
    }
  };

  const handleEdit = (u) => {
    setEditingUser(u);
    setForm({ name: u.name, email: u.email || '', password: '', role: u.role });
    setShowForm(true);
  };

  const handleDelete = async (u) => {
    if (!confirm(`${u.name} を無効化しますか？`)) return;
    try {
      await api.delete(`/api/admin/users/${u.id}`);
      toast.success('ユーザーを無効化しました');
      fetchUsers();
    } catch (err) {
      toast.error(err.response?.data?.message || 'エラーが発生しました');
    }
  };

  const handleToggleActive = async (u) => {
    try {
      await api.put(`/api/admin/users/${u.id}`, { is_active: u.is_active ? 0 : 1 });
      toast.success(u.is_active ? '無効化しました' : '有効化しました');
      fetchUsers();
    } catch (err) { toast.error('更新に失敗しました'); }
  };

  if (!user || user.role !== 'admin') return null;

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">ユーザー管理</h1>
        <button
          onClick={() => { setShowForm(true); setEditingUser(null); setForm({ name: '', email: '', password: '', role: 'operator' }); }}
          className="btn-primary text-sm"
        >+ ユーザー追加</button>
      </div>

      {showForm && (
        <div className="card p-5 mb-6">
          <h2 className="text-sm font-bold text-gray-800 mb-4">{editingUser ? 'ユーザー編集' : '新規ユーザー'}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            <div>
              <label className="input-label">名前 *</label>
              <input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
            </div>
            <div>
              <label className="input-label">メール {form.role !== 'operator' ? '*' : ''}</label>
              <input className="input" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required={form.role !== 'operator'} placeholder={form.role === 'operator' ? '省略可' : ''} />
            </div>
            <div>
              <label className="input-label">パスワード {editingUser ? '(変更する場合のみ)' : '*'}</label>
              <input className="input" type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required={!editingUser} />
            </div>
            <div>
              <label className="input-label">ロール</label>
              <select className="input" value={form.role} onChange={e => setForm({...form, role: e.target.value})}>
                {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="col-span-2 flex gap-2">
              <button type="submit" className="btn-primary text-sm">{editingUser ? '更新' : '作成'}</button>
              <button type="button" onClick={() => { setShowForm(false); setEditingUser(null); }} className="btn-secondary text-sm">キャンセル</button>
            </div>
          </form>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="table-header">名前</th>
              <th className="table-header">メール</th>
              <th className="table-header">ロール</th>
              <th className="table-header">ステータス</th>
              <th className="table-header">作成日</th>
              <th className="table-header">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                <td className="table-cell font-medium">{u.name}</td>
                <td className="table-cell text-gray-500">{u.email || <span className="text-gray-300">-</span>}</td>
                <td className="table-cell">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_STYLES[u.role] || 'bg-gray-100 text-gray-700'}`}>
                    {ROLE_OPTIONS.find(r => r.value === u.role)?.label || u.role}
                  </span>
                </td>
                <td className="table-cell">
                  <button onClick={() => handleToggleActive(u)} className={`px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer ${u.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {u.is_active ? '有効' : '無効'}
                  </button>
                </td>
                <td className="table-cell text-gray-400">{new Date(u.created_at).toLocaleDateString('ja-JP')}</td>
                <td className="table-cell">
                  <div className="flex gap-1">
                    <button onClick={() => handleEdit(u)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">編集</button>
                    {u.id !== user.id && (
                      <button onClick={() => handleDelete(u)} className="text-red-500 hover:text-red-700 text-xs font-medium ml-2">削除</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
