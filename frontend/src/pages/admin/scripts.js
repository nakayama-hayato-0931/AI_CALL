import { useState, useEffect } from 'react';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const TABS = [
  { value: 'pending', label: '承認待ち' },
  { value: 'rebuttal', label: 'アウト返し' },
  { value: 'qa', label: 'Q&A' },
];

const CATEGORIES_REBUTTAL = ['断り対応', '担当者不在', '費用質問', '面接形式', '書類選考', '時間がない', '他社利用中', 'その他'];
const CATEGORIES_QA = ['会社概要', '国籍', '日本語力', 'ビザ', '生活', '費用', 'その他'];

export default function AdminScripts() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('pending');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  // 編集中
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  // 追加フォーム
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ type: 'rebuttal', category: '', industry: '', trigger_text: '', response_text: '' });

  // データ取得
  const fetchItems = async () => {
    setLoading(true);
    try {
      const params = {};
      if (activeTab === 'pending') {
        params.status = 'pending';
      } else {
        params.type = activeTab;
        params.status = 'approved';
      }
      params.limit = 100;
      const { data } = await api.get('/api/admin/scripts', { params });
      setItems(data.data.items || []);
      setTotal(data.data.total || 0);
    } catch (err) {
      toast.error('スクリプトの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // 承認待ち件数取得
  const fetchPendingCount = async () => {
    try {
      const { data } = await api.get('/api/admin/scripts', { params: { status: 'pending', limit: 1 } });
      setPendingCount(data.data.total || 0);
    } catch {}
  };

  useEffect(() => {
    fetchItems();
    fetchPendingCount();
  }, [activeTab]);

  // 承認
  const handleApprove = async (id) => {
    try {
      await api.put(`/api/admin/scripts/${id}/approve`);
      toast.success('承認しました');
      fetchItems();
      fetchPendingCount();
    } catch (err) {
      toast.error('承認に失敗しました');
    }
  };

  // 却下
  const handleReject = async (id) => {
    try {
      await api.put(`/api/admin/scripts/${id}/reject`);
      toast.success('却下しました');
      fetchItems();
      fetchPendingCount();
    } catch (err) {
      toast.error('却下に失敗しました');
    }
  };

  // 削除
  const handleDelete = async (id) => {
    if (!confirm('このスクリプトを削除しますか？')) return;
    try {
      await api.delete(`/api/admin/scripts/${id}`);
      toast.success('削除しました');
      fetchItems();
    } catch (err) {
      toast.error('削除に失敗しました');
    }
  };

  // 編集開始
  const startEdit = (item) => {
    setEditingId(item.id);
    setEditForm({
      type: item.type,
      category: item.category || '',
      industry: item.industry || '',
      trigger_text: item.trigger_text,
      response_text: item.response_text,
    });
  };

  // 編集保存
  const handleSaveEdit = async () => {
    if (!editForm.trigger_text || !editForm.response_text) {
      toast.error('質問/反論と回答は必須です');
      return;
    }
    try {
      await api.put(`/api/admin/scripts/${editingId}`, editForm);
      toast.success('更新しました');
      setEditingId(null);
      fetchItems();
    } catch (err) {
      toast.error('更新に失敗しました');
    }
  };

  // 追加
  const handleAdd = async () => {
    const type = activeTab === 'pending' ? addForm.type : activeTab;
    if (!addForm.trigger_text || !addForm.response_text) {
      toast.error('質問/反論と回答は必須です');
      return;
    }
    try {
      await api.post('/api/admin/scripts', { ...addForm, type });
      toast.success('追加しました');
      setAddForm({ type: 'rebuttal', category: '', industry: '', trigger_text: '', response_text: '' });
      setShowAddForm(false);
      fetchItems();
    } catch (err) {
      toast.error('追加に失敗しました');
    }
  };

  const categories = activeTab === 'qa' ? CATEGORIES_QA : CATEGORIES_REBUTTAL;

  return (
    <Layout>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">スクリプト管理</h1>
        <p className="text-sm text-gray-400 mt-0.5">アウト返し・Q&Aの管理・承認</p>
      </div>

      {/* タブ */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-5 w-fit">
        {TABS.map(t => (
          <button
            key={t.value}
            onClick={() => { setActiveTab(t.value); setEditingId(null); setShowAddForm(false); }}
            className={`relative px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === t.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {t.value === 'pending' && pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 追加ボタン */}
      {activeTab !== 'pending' && (
        <div className="mb-4">
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="btn-primary text-sm"
          >
            {showAddForm ? 'キャンセル' : '+ 追加'}
          </button>
        </div>
      )}

      {/* 追加フォーム */}
      {showAddForm && activeTab !== 'pending' && (
        <div className="card p-4 mb-4">
          <h3 className="text-sm font-bold text-gray-800 mb-3">新規追加</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="input-label">カテゴリ</label>
              <select
                value={addForm.category}
                onChange={e => setAddForm({ ...addForm, category: e.target.value })}
                className="input text-sm"
              >
                <option value="">選択してください</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="input-label">業種（任意）</label>
              <input
                type="text"
                value={addForm.industry}
                onChange={e => setAddForm({ ...addForm, industry: e.target.value })}
                className="input text-sm"
                placeholder="全業種共通の場合は空欄"
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="input-label">質問 / 反論 *</label>
            <input
              type="text"
              value={addForm.trigger_text}
              onChange={e => setAddForm({ ...addForm, trigger_text: e.target.value })}
              className="input text-sm"
              placeholder="例: 興味ない / 採用していない"
            />
          </div>
          <div className="mb-3">
            <label className="input-label">回答 *</label>
            <textarea
              value={addForm.response_text}
              onChange={e => setAddForm({ ...addForm, response_text: e.target.value })}
              className="input text-sm resize-none"
              rows={3}
              placeholder="回答テキストを入力..."
            />
          </div>
          <button onClick={handleAdd} className="btn-primary text-sm">追加する</button>
        </div>
      )}

      {/* スクリプト一覧 */}
      <div className="space-y-2">
        {loading ? (
          <div className="py-12 text-center">
            <svg className="animate-spin w-6 h-6 text-gray-400 mx-auto" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : items.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-sm text-gray-400">
              {activeTab === 'pending' ? '承認待ちのスクリプトはありません' : 'スクリプトがありません'}
            </p>
          </div>
        ) : (
          items.map(item => (
            <div key={item.id} className="card p-4">
              {editingId === item.id ? (
                /* 編集モード */
                <div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="input-label">カテゴリ</label>
                      <select
                        value={editForm.category}
                        onChange={e => setEditForm({ ...editForm, category: e.target.value })}
                        className="input text-sm"
                      >
                        <option value="">選択してください</option>
                        {(editForm.type === 'qa' ? CATEGORIES_QA : CATEGORIES_REBUTTAL).map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="input-label">業種</label>
                      <input
                        type="text"
                        value={editForm.industry}
                        onChange={e => setEditForm({ ...editForm, industry: e.target.value })}
                        className="input text-sm"
                      />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="input-label">質問 / 反論</label>
                    <input
                      type="text"
                      value={editForm.trigger_text}
                      onChange={e => setEditForm({ ...editForm, trigger_text: e.target.value })}
                      className="input text-sm"
                    />
                  </div>
                  <div className="mb-3">
                    <label className="input-label">回答</label>
                    <textarea
                      value={editForm.response_text}
                      onChange={e => setEditForm({ ...editForm, response_text: e.target.value })}
                      className="input text-sm resize-none"
                      rows={3}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleSaveEdit} className="btn-primary text-sm">保存</button>
                    <button onClick={() => setEditingId(null)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">キャンセル</button>
                  </div>
                </div>
              ) : (
                /* 表示モード */
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          item.type === 'rebuttal' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'
                        }`}>
                          {item.type === 'rebuttal' ? 'アウト返し' : 'Q&A'}
                        </span>
                        {item.category && (
                          <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{item.category}</span>
                        )}
                        {item.industry && (
                          <span className="text-[10px] text-purple-500 bg-purple-50 px-2 py-0.5 rounded-full">{item.industry}</span>
                        )}
                        {activeTab === 'pending' && (
                          <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">承認待ち</span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-gray-800 mb-1">{item.trigger_text}</p>
                      <p className="text-sm text-gray-600 leading-relaxed">{item.response_text}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {activeTab === 'pending' ? (
                        <>
                          <button
                            onClick={() => startEdit(item)}
                            className="text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                          >編集</button>
                          <button
                            onClick={() => handleApprove(item.id)}
                            className="text-xs text-white bg-emerald-500 hover:bg-emerald-600 px-3 py-1 rounded transition-colors font-medium"
                          >承認</button>
                          <button
                            onClick={() => handleReject(item.id)}
                            className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                          >却下</button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(item)}
                            className="text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                          >編集</button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                          >削除</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 件数表示 */}
      {!loading && items.length > 0 && (
        <p className="text-xs text-gray-400 mt-3 text-right">{items.length} / {total} 件</p>
      )}
    </Layout>
  );
}
