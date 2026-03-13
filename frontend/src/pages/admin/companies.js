import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const TABS = [
  { value: 'list', label: '架電リスト' },
  { value: 'area', label: 'エリア設定' },
];

// プリセット選択肢
const PRESET_INDUSTRIES = [
  '飲食', '小売', '製造', '建設', 'IT', '不動産', '医療', '教育',
  '金融', '運輸', '農業', 'サービス', '卸売', '美容', '介護', 'その他',
];
const PRESET_REGIONS = [
  '全国', '北海道', '東北', '関東', '中部', '関西', '中国', '四国', '九州', '沖縄',
];

export default function AdminCompanies() {
  const { user } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('list');

  // === 架電リスト タブ ===
  const [companies, setCompanies] = useState([]);
  const [operators, setOperators] = useState([]);
  const [pagination, setPagination] = useState({});
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [assignModal, setAssignModal] = useState(null);
  const [selectedOp, setSelectedOp] = useState('');

  // === エリア設定 タブ ===
  const [rules, setRules] = useState([]);
  const [industries, setIndustries] = useState([]);
  const [regions, setRegions] = useState([]);
  const [selectedIndustries, setSelectedIndustries] = useState([]);
  const [selectedRegions, setSelectedRegions] = useState([]);
  const [addingRules, setAddingRules] = useState(false);

  useEffect(() => {
    if (user && user.role !== 'admin' && user.role !== 'manager') { router.push('/'); return; }
    if (user) fetchOperators();
  }, [user]);

  useEffect(() => {
    if (user) fetchCompanies();
  }, [user, page, search]);

  useEffect(() => {
    if (user && activeTab === 'area') fetchRules();
  }, [user, activeTab]);

  // === 架電リスト 関数 ===
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

  // === エリア設定 関数 ===
  const fetchRules = async () => {
    try {
      const { data } = await api.get('/api/admin/industry-region-rules');
      if (data.success) {
        setRules(data.data.rules);
        // プリセット + DB値をマージして重複排除（プリセット順を維持、DB独自値は末尾に追加）
        const extraIndustries = data.data.industries.filter(i => !PRESET_INDUSTRIES.includes(i)).sort();
        const mergedIndustries = [...PRESET_INDUSTRIES, ...extraIndustries];
        const extraRegions = data.data.regions.filter(r => !PRESET_REGIONS.includes(r)).sort();
        const mergedRegions = [...PRESET_REGIONS, ...extraRegions];
        setIndustries(mergedIndustries);
        setRegions(mergedRegions);
      }
    } catch (err) { toast.error('エリアルール取得に失敗しました'); }
  };

  const toggleIndustry = (ind) => {
    setSelectedIndustries(prev => prev.includes(ind) ? prev.filter(i => i !== ind) : [...prev, ind]);
  };
  const toggleRegion = (reg) => {
    setSelectedRegions(prev => prev.includes(reg) ? prev.filter(r => r !== reg) : [...prev, reg]);
  };

  const handleAddRules = async () => {
    if (selectedIndustries.length === 0 || selectedRegions.length === 0) {
      toast.error('業種と地域をそれぞれ1つ以上選択してください'); return;
    }
    setAddingRules(true);
    let added = 0, skipped = 0;
    for (const ind of selectedIndustries) {
      for (const reg of selectedRegions) {
        try {
          const { data } = await api.post('/api/admin/industry-region-rules', {
            industry_name: ind, region: reg,
          });
          if (data.success) added++;
        } catch (err) {
          if (err.response?.status === 400) skipped++; // 重複
          else { toast.error(`${ind}→${reg} の追加に失敗しました`); }
        }
      }
    }
    setAddingRules(false);
    if (added > 0) toast.success(`${added}件のルールを追加しました${skipped > 0 ? `（${skipped}件は既存）` : ''}`);
    else if (skipped > 0) toast.error('選択したルールは全て登録済みです');
    setSelectedIndustries([]);
    setSelectedRegions([]);
    fetchRules();
  };

  const handleDeleteRule = async (id, industryName, region) => {
    if (!confirm(`${industryName} → ${region} のルールを削除しますか？`)) return;
    try {
      const { data } = await api.delete(`/api/admin/industry-region-rules/${id}`);
      if (data.success) {
        toast.success('ルールを削除しました');
        fetchRules();
      }
    } catch (err) { toast.error('ルール削除に失敗しました'); }
  };

  // ルールを業種でグループ化
  const groupedRules = rules.reduce((acc, rule) => {
    if (!acc[rule.industry_name]) acc[rule.industry_name] = [];
    acc[rule.industry_name].push(rule);
    return acc;
  }, {});

  if (!user || (user.role !== 'admin' && user.role !== 'manager')) return null;

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">架電リスト管理</h1>
        <p className="text-sm text-gray-400 mt-0.5">架電リストの管理とエリア設定</p>
      </div>

      {/* タブ */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-6 w-fit">
        {TABS.map(t => (
          <button key={t.value} onClick={() => setActiveTab(t.value)}
            className={`px-5 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === t.value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>{t.label}</button>
        ))}
      </div>

      {/* ============ 架電リストタブ ============ */}
      {activeTab === 'list' && (
        <>
          {/* 検索 */}
          <form onSubmit={handleSearch} className="card p-4 mb-6 flex items-end gap-4">
            <div className="flex-1">
              <label className="input-label">企業名・電話番号で検索</label>
              <input type="text" className="input text-sm" placeholder="検索キーワード..."
                value={searchInput} onChange={e => setSearchInput(e.target.value)} />
            </div>
            <button type="submit" className="btn-primary !py-2.5 px-6">検索</button>
            {search && (
              <button type="button" onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}
                className="btn-secondary !py-2.5 px-4">クリア</button>
            )}
          </form>

          {pagination.total !== undefined && (
            <p className="text-sm text-gray-500 mb-3">全 {pagination.total.toLocaleString()} 件</p>
          )}

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
                              <button onClick={() => handleUnassign(c.id, op.id, c.company_name, op.name)}
                                className="ml-0.5 text-blue-400 hover:text-red-500 transition-colors" title="割り当て解除">&times;</button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-300 text-xs">未割り当て</span>
                      )}
                    </td>
                    <td className="table-cell">
                      <button onClick={() => { setAssignModal(c); setSelectedOp(''); }}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ 割り当て</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {companies.length === 0 && (
              <div className="text-center py-8 text-gray-400">企業がありません</div>
            )}
          </div>

          {pagination.totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                .filter(p => Math.abs(p - page) <= 3 || p === 1 || p === pagination.totalPages)
                .map((p, idx, arr) => (
                  <span key={p}>
                    {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-gray-400">...</span>}
                    <button onClick={() => setPage(p)}
                      className={`px-3 py-1 rounded text-sm ${p === page ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>{p}</button>
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
        </>
      )}

      {/* ============ エリア設定タブ ============ */}
      {activeTab === 'area' && (
        <>
          {/* 説明 */}
          <div className="card p-4 mb-4 bg-blue-50 border-blue-100">
            <p className="text-sm text-blue-800">
              業種ごとに架電可能な地域を設定します。ルールが設定された業種×地域の企業のみ、オペレーターの架電リストに表示されます。
              管理者画面では全企業が閲覧できます。
            </p>
          </div>

          {/* ルール追加フォーム */}
          <div className="card p-4 mb-6">
            <h3 className="text-sm font-bold text-gray-700 mb-3">ルール追加</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {/* 業種選択 */}
              <div>
                <label className="input-label mb-2">業種（複数選択可）</label>
                <div className="border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto space-y-1">
                  {industries.map(ind => (
                    <label key={ind} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                      selectedIndustries.includes(ind) ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}>
                      <input type="checkbox" checked={selectedIndustries.includes(ind)}
                        onChange={() => toggleIndustry(ind)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <span className="text-sm text-gray-700">{ind}</span>
                    </label>
                  ))}
                </div>
                {selectedIndustries.length > 0 && (
                  <p className="text-xs text-blue-600 mt-1">{selectedIndustries.length}件選択中</p>
                )}
              </div>
              {/* 地域選択 */}
              <div>
                <label className="input-label mb-2">地域（複数選択可）</label>
                <div className="border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto space-y-1">
                  {regions.map(reg => (
                    <label key={reg} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                      selectedRegions.includes(reg) ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}>
                      <input type="checkbox" checked={selectedRegions.includes(reg)}
                        onChange={() => toggleRegion(reg)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <span className="text-sm text-gray-700">{reg}</span>
                    </label>
                  ))}
                </div>
                {selectedRegions.length > 0 && (
                  <p className="text-xs text-blue-600 mt-1">{selectedRegions.length}件選択中</p>
                )}
              </div>
            </div>
            {/* 選択プレビュー + 追加ボタン */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500">
                {selectedIndustries.length > 0 && selectedRegions.length > 0
                  ? `${selectedIndustries.length}業種 × ${selectedRegions.length}地域 = ${selectedIndustries.length * selectedRegions.length}件のルールを追加`
                  : '業種と地域をそれぞれ選択してください'}
              </div>
              <button onClick={handleAddRules}
                disabled={selectedIndustries.length === 0 || selectedRegions.length === 0 || addingRules}
                className="btn-primary !py-2.5 px-6 disabled:opacity-50">
                {addingRules ? '追加中...' : '一括追加'}
              </button>
            </div>
          </div>

          {/* ルール一覧（業種ごとにグループ化） */}
          <div className="space-y-3">
            {Object.keys(groupedRules).length === 0 ? (
              <div className="card p-8 text-center text-gray-400">
                エリアルールが設定されていません。<br />
                ルールを追加すると、オペレーターの架電リストにフィルターが適用されます。
              </div>
            ) : (
              Object.entries(groupedRules).map(([industry, ruleList]) => (
                <div key={industry} className="card p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-gray-800 w-24 flex-shrink-0">{industry}</span>
                    <div className="flex flex-wrap gap-2">
                      {ruleList.map(rule => (
                        <span key={rule.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {rule.region}
                          <button onClick={() => handleDeleteRule(rule.id, rule.industry_name, rule.region)}
                            className="text-emerald-400 hover:text-red-500 transition-colors font-bold">&times;</button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* サマリー */}
          {Object.keys(groupedRules).length > 0 && (
            <div className="mt-4 text-xs text-gray-400">
              {Object.keys(groupedRules).length} 業種 / {rules.length} ルール設定済み
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
