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
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

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
        if (form.role === 'operator' || editingUser.role === 'operator') {
          payload.commute_type = form.commute_type || null;
          payload.commute_teiki_monthly = form.commute_type === 'teiki' && form.commute_teiki_monthly ? Number(form.commute_teiki_monthly) : null;
          payload.commute_daily_amount = form.commute_type === 'daily' && form.commute_daily_amount ? Number(form.commute_daily_amount) : null;
        }
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
    setForm({
      name: u.name, email: u.email || '', password: '', role: u.role,
      commute_type: u.commute_type || '',
      commute_teiki_monthly: u.commute_teiki_monthly || '',
      commute_daily_amount: u.commute_daily_amount || '',
    });
    setShowForm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      const { data } = await api.delete(`/api/admin/users/${deleteTarget.id}`);
      toast.success(data.message || '削除しました');
      setDeleteTarget(null);
      fetchUsers();
    } catch (err) {
      toast.error(err.response?.data?.message || '削除に失敗しました');
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (u) => {
    try {
      await api.put(`/api/admin/users/${u.id}`, { is_active: u.is_active ? 0 : 1 });
      toast.success(u.is_active ? '無効化しました' : '有効化しました');
      fetchUsers();
    } catch (err) { toast.error('更新に失敗しました'); }
  };

  const handleLevelChange = async (u, level) => {
    try {
      await api.put(`/api/admin/users/${u.id}`, { operator_level: level || null });
      toast.success('ランクを更新しました');
      fetchUsers();
    } catch (err) { toast.error('更新に失敗しました'); }
  };

  if (!user || user.role !== 'admin') return null;

  return (
    <Layout>
      {/* 完全削除確認モーダル */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-gray-900">ユーザーの完全削除</h3>
            </div>
            <p className="text-sm text-gray-600 mb-2">
              <span className="font-bold text-red-600">{deleteTarget.name}</span> を完全に削除します。
            </p>
            <p className="text-xs text-gray-500 mb-1">この操作は取り消せません。以下のデータも削除されます:</p>
            <ul className="text-xs text-gray-500 mb-4 ml-4 list-disc space-y-0.5">
              <li>AI評価データ</li>
              <li>ステータスシート</li>
              <li>稼働時間・出勤記録</li>
              <li>リコール予定</li>
            </ul>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting}
                className="btn-secondary text-sm">キャンセル</button>
              <button onClick={handleDeleteConfirm} disabled={deleting}
                className="btn-danger text-sm flex items-center gap-1.5">
                {deleting ? (
                  <>
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    削除中...
                  </>
                ) : '完全に削除する'}
              </button>
            </div>
          </div>
        </div>
      )}

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
            {/* 交通費（オペレーターのみ） */}
            {(form.role === 'operator') && (
              <div className="col-span-2 bg-gray-50 rounded-lg p-4 border border-gray-200">
                <p className="text-xs font-bold text-gray-600 mb-3">交通費</p>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="radio" name="commute_type" value="teiki"
                        checked={form.commute_type === 'teiki'}
                        onChange={() => setForm({...form, commute_type: 'teiki'})}
                        className="text-blue-600" />
                      定期券（月額）
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="radio" name="commute_type" value="daily"
                        checked={form.commute_type === 'daily'}
                        onChange={() => setForm({...form, commute_type: 'daily'})}
                        className="text-blue-600" />
                      1日あたり
                    </label>
                    {form.commute_type && (
                      <button type="button" onClick={() => setForm({...form, commute_type: '', commute_teiki_monthly: '', commute_daily_amount: ''})}
                        className="text-[10px] text-gray-400 hover:text-gray-600 ml-1">クリア</button>
                    )}
                  </div>
                  {form.commute_type === 'teiki' && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-500">月額:</span>
                      <input type="number" className="input text-xs w-28" placeholder="15000"
                        value={form.commute_teiki_monthly}
                        onChange={e => setForm({...form, commute_teiki_monthly: e.target.value})} />
                      <span className="text-xs text-gray-400">円</span>
                    </div>
                  )}
                  {form.commute_type === 'daily' && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-500">1日往復:</span>
                      <input type="number" className="input text-xs w-28" placeholder="1000"
                        value={form.commute_daily_amount}
                        onChange={e => setForm({...form, commute_daily_amount: e.target.value})} />
                      <span className="text-xs text-gray-400">円</span>
                    </div>
                  )}
                </div>
              </div>
            )}
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
              <th className="table-header">ランク</th>
              <th className="table-header">交通費</th>
              <th className="table-header">ステータス</th>
              <th className="table-header">作成日</th>
              <th className="table-header">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-gray-100 hover:bg-blue-50/30 transition-colors">
                <td className="table-cell font-medium">{u.name}</td>
                <td className="table-cell text-gray-500">{u.email || <span className="text-gray-300">-</span>}</td>
                <td className="table-cell">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_STYLES[u.role] || 'bg-gray-100 text-gray-700'}`}>
                    {ROLE_OPTIONS.find(r => r.value === u.role)?.label || u.role}
                  </span>
                </td>
                <td className="table-cell">
                  {u.role === 'operator' ? (
                    <select value={u.operator_level || ''} onChange={e => handleLevelChange(u, e.target.value)}
                      className="text-xs border border-gray-200 rounded px-1.5 py-0.5">
                      <option value="">未設定</option>
                      <option value="初級">初級</option>
                      <option value="中級">中級</option>
                      <option value="上級">上級</option>
                    </select>
                  ) : <span className="text-gray-300 text-xs">-</span>}
                </td>
                <td className="table-cell text-xs text-gray-500">
                  {u.role === 'operator' && u.commute_type ? (
                    u.commute_type === 'teiki'
                      ? `定期 ¥${Number(u.commute_teiki_monthly || 0).toLocaleString()}/月`
                      : `¥${Number(u.commute_daily_amount || 0).toLocaleString()}/日`
                  ) : <span className="text-gray-300">-</span>}
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
                      <button onClick={() => setDeleteTarget(u)} className="text-red-500 hover:text-red-700 text-xs font-medium ml-2">削除</button>
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
