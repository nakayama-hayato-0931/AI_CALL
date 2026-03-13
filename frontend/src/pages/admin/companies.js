import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const TABS = [
  { value: 'list', label: '架電リスト' },
  { value: 'area', label: 'エリア設定' },
];

// 都道府県の地方グループ（北から順）
const REGION_GROUPS = [
  { name: '北海道', prefs: ['北海道'] },
  { name: '東北', prefs: ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'] },
  { name: '関東', prefs: ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'] },
  { name: '中部', prefs: ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県'] },
  { name: '関西', prefs: ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'] },
  { name: '中国', prefs: ['鳥取県', '島根県', '岡山県', '広島県', '山口県'] },
  { name: '四国', prefs: ['徳島県', '香川県', '愛媛県', '高知県'] },
  { name: '九州', prefs: ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県'] },
  { name: '沖縄', prefs: ['沖縄県'] },
];
const ALL_PREFS = REGION_GROUPS.flatMap(g => g.prefs);

// 都道府県→地方名マップ
const prefToRegionName = {};
REGION_GROUPS.forEach(g => g.prefs.forEach(p => { prefToRegionName[p] = g.name; }));

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
  const [dbIndustries, setDbIndustries] = useState([]);
  const [selectedIndustries, setSelectedIndustries] = useState([]);
  const [industryInput, setIndustryInput] = useState('');
  const [selectedPrefs, setSelectedPrefs] = useState([]);
  const [addingRules, setAddingRules] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  // NGワード（全業種共通）
  const [excludeWords, setExcludeWords] = useState([]);
  const [ngKeywordInput, setNgKeywordInput] = useState('');

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
        setDbIndustries(data.data.industries);
      }
    } catch (err) { toast.error('エリアルール取得に失敗しました'); }
    try {
      const { data } = await api.get('/api/admin/exclude-words');
      if (data.success) setExcludeWords(data.data);
    } catch (err) { /* ignore */ }
  };

  // --- 業種キーワード追加 ---
  const addIndustryKeyword = (keyword) => {
    const trimmed = keyword.trim();
    if (!trimmed || selectedIndustries.includes(trimmed)) return;
    setSelectedIndustries(prev => [...prev, trimmed]);
    setIndustryInput('');
  };
  const removeIndustryKeyword = (keyword) => {
    setSelectedIndustries(prev => prev.filter(k => k !== keyword));
  };
  // DB値から候補をフィルタ（入力中の文字に部分一致、既に追加済みは除外）
  const industrySuggestions = industryInput.trim()
    ? dbIndustries.filter(ind => ind.includes(industryInput.trim()) && !selectedIndustries.includes(ind))
    : [];

  // --- 都道府県トグル ---
  const togglePref = (pref) => {
    setSelectedPrefs(prev => prev.includes(pref) ? prev.filter(p => p !== pref) : [...prev, pref]);
  };

  // --- 地方一括トグル ---
  const toggleRegionGroup = (group) => {
    const allChecked = group.prefs.every(p => selectedPrefs.includes(p));
    if (allChecked) {
      setSelectedPrefs(prev => prev.filter(p => !group.prefs.includes(p)));
    } else {
      setSelectedPrefs(prev => [...new Set([...prev, ...group.prefs])]);
    }
  };

  // --- 全国一括トグル ---
  const toggleAll = () => {
    if (selectedPrefs.length === ALL_PREFS.length) {
      setSelectedPrefs([]);
    } else {
      setSelectedPrefs([...ALL_PREFS]);
    }
  };

  // --- 地方の開閉 ---
  const toggleCollapse = (name) => {
    setCollapsedGroups(prev => ({ ...prev, [name]: !prev[name] }));
  };

  // --- 地方チェック状態 ---
  const getGroupCheckState = (group) => {
    const checked = group.prefs.filter(p => selectedPrefs.includes(p)).length;
    if (checked === 0) return 'none';
    if (checked === group.prefs.length) return 'all';
    return 'partial';
  };

  // --- ルール一括追加 ---
  const handleAddRules = async () => {
    if (selectedIndustries.length === 0 || selectedPrefs.length === 0) {
      toast.error('業種と地域をそれぞれ1つ以上選択してください'); return;
    }
    setAddingRules(true);
    let added = 0, skipped = 0;
    for (const ind of selectedIndustries) {
      for (const pref of selectedPrefs) {
        try {
          const { data } = await api.post('/api/admin/industry-region-rules', {
            industry_name: ind, region: pref,
          });
          if (data.success) added++;
        } catch (err) {
          if (err.response?.status === 400) skipped++;
          else { toast.error(`${ind}→${pref} の追加に失敗しました`); }
        }
      }
    }
    setAddingRules(false);
    if (added > 0) toast.success(`${added}件のルールを追加しました${skipped > 0 ? `（${skipped}件は既存）` : ''}`);
    else if (skipped > 0) toast.error('選択したルールは全て登録済みです');
    setSelectedIndustries([]);
    setSelectedPrefs([]);
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

  // --- 業種ごとの一括削除 ---
  const handleDeleteIndustryRules = async (industry, ruleList) => {
    if (!confirm(`${industry} のルール（${ruleList.length}件）を全て削除しますか？`)) return;
    for (const rule of ruleList) {
      try { await api.delete(`/api/admin/industry-region-rules/${rule.id}`); } catch (err) { /* skip */ }
    }
    toast.success(`${industry} のルールを削除しました`);
    fetchRules();
  };

  // --- NGワード管理（全業種共通） ---
  const handleAddNgWord = async () => {
    if (!ngKeywordInput.trim()) { toast.error('NGワードを入力してください'); return; }
    try {
      const { data } = await api.post('/api/admin/exclude-words', {
        keyword: ngKeywordInput.trim(),
      });
      if (data.success) {
        toast.success('NGワードを追加しました');
        setNgKeywordInput('');
        fetchRules();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'NGワード追加に失敗しました');
    }
  };

  const handleDeleteNgWord = async (id) => {
    try {
      const { data } = await api.delete(`/api/admin/exclude-words/${id}`);
      if (data.success) { toast.success('NGワードを削除しました'); fetchRules(); }
    } catch (err) { toast.error('NGワード削除に失敗しました'); }
  };

  // ルールを業種でグループ化
  const groupedRules = rules.reduce((acc, rule) => {
    if (!acc[rule.industry_name]) acc[rule.industry_name] = [];
    acc[rule.industry_name].push(rule);
    return acc;
  }, {});

  // ルール内の都道府県を地方でグループ化するヘルパー
  const groupPrefsByRegion = (ruleList) => {
    const regionMap = {};
    for (const rule of ruleList) {
      const regionName = prefToRegionName[rule.region] || 'その他';
      if (!regionMap[regionName]) regionMap[regionName] = [];
      regionMap[regionName].push(rule);
    }
    // REGION_GROUPS順で返す
    const ordered = [];
    for (const g of REGION_GROUPS) {
      if (regionMap[g.name]) {
        const isFullRegion = g.prefs.length === regionMap[g.name].length;
        ordered.push({ regionName: g.name, rules: regionMap[g.name], isFullRegion });
      }
    }
    if (regionMap['その他']) ordered.push({ regionName: 'その他', rules: regionMap['その他'], isFullRegion: false });
    return ordered;
  };

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
          <div className="card p-4 mb-4 bg-blue-50 border-blue-100">
            <p className="text-sm text-blue-800">
              業種キーワードごとに架電可能な都道府県を設定します。キーワードは企業の「業種」に部分一致で判定されます。
              職種にNGワードが含まれる場合は除外されます（例: 飲食店でも職種が事務なら除外）。
              ルール未設定時は全企業が表示されます。管理者画面では常に全企業が閲覧できます。
            </p>
          </div>

          {/* ルール追加フォーム */}
          <div className="card p-5 mb-6">
            <h3 className="text-sm font-bold text-gray-700 mb-4">ルール追加</h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-4">

              {/* 業種キーワード入力 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="input-label">業種キーワード（部分一致）</label>
                  {selectedIndustries.length > 0 && (
                    <button onClick={() => setSelectedIndustries([])} className="text-xs text-gray-400 hover:text-gray-600">クリア</button>
                  )}
                </div>
                {/* 追加済みタグ */}
                {selectedIndustries.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {selectedIndustries.map(kw => (
                      <span key={kw} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {kw}
                        <button onClick={() => removeIndustryKeyword(kw)} className="text-blue-400 hover:text-red-500">&times;</button>
                      </span>
                    ))}
                  </div>
                )}
                {/* 入力フィールド */}
                <div className="relative">
                  <input type="text" className="input text-sm" placeholder="例: 飲食、工事、事務 など..."
                    value={industryInput} onChange={e => setIndustryInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); addIndustryKeyword(industryInput); }
                    }} />
                  {industryInput.trim() && (
                    <button onClick={() => addIndustryKeyword(industryInput)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-blue-600 hover:text-blue-800 font-medium">追加</button>
                  )}
                </div>
                {/* DB値サジェスト */}
                {industrySuggestions.length > 0 && (
                  <div className="border border-gray-200 rounded-lg mt-1 max-h-32 overflow-y-auto bg-white shadow-sm">
                    {industrySuggestions.slice(0, 8).map(ind => (
                      <button key={ind} onClick={() => addIndustryKeyword(ind)}
                        className="block w-full text-left px-3 py-1.5 text-xs text-gray-600 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                        {ind}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-1.5">
                  Enterで追加。企業の「業種」に含まれるキーワードで判定されます。
                </p>
              </div>

              {/* 地域選択（階層ツリー） */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="input-label">地域（複数選択可）</label>
                  {selectedPrefs.length > 0 && (
                    <button onClick={() => setSelectedPrefs([])} className="text-xs text-gray-400 hover:text-gray-600">クリア</button>
                  )}
                </div>
                <div className="border border-gray-200 rounded-lg p-3 max-h-64 overflow-y-auto">
                  {/* 全国 */}
                  <label className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer font-medium transition-colors ${
                    selectedPrefs.length === ALL_PREFS.length ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}>
                    <input type="checkbox"
                      checked={selectedPrefs.length === ALL_PREFS.length}
                      ref={el => { if (el) el.indeterminate = selectedPrefs.length > 0 && selectedPrefs.length < ALL_PREFS.length; }}
                      onChange={toggleAll}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm text-gray-900 font-bold">全国</span>
                    <span className="text-xs text-gray-400 ml-auto">{selectedPrefs.length}/{ALL_PREFS.length}</span>
                  </label>

                  <div className="mt-1 space-y-0.5">
                    {REGION_GROUPS.map(group => {
                      const checkState = getGroupCheckState(group);
                      const isCollapsed = collapsedGroups[group.name];
                      return (
                        <div key={group.name}>
                          {/* 地方ヘッダー */}
                          <div className={`flex items-center gap-1 px-2 py-1.5 rounded transition-colors ${
                            checkState !== 'none' ? 'bg-blue-50/50' : 'hover:bg-gray-50'
                          }`}>
                            <button onClick={() => toggleCollapse(group.name)}
                              className="text-gray-400 hover:text-gray-600 w-4 text-xs flex-shrink-0">
                              {isCollapsed ? '▶' : '▼'}
                            </button>
                            <label className="flex items-center gap-2 cursor-pointer flex-1">
                              <input type="checkbox"
                                checked={checkState === 'all'}
                                ref={el => { if (el) el.indeterminate = checkState === 'partial'; }}
                                onChange={() => toggleRegionGroup(group)}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                              <span className="text-sm text-gray-800 font-medium">{group.name}</span>
                              <span className="text-xs text-gray-400 ml-auto">
                                {group.prefs.filter(p => selectedPrefs.includes(p)).length}/{group.prefs.length}
                              </span>
                            </label>
                          </div>
                          {/* 都道府県（展開時） */}
                          {!isCollapsed && (
                            <div className="ml-6 space-y-0">
                              {group.prefs.map(pref => (
                                <label key={pref} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors ${
                                  selectedPrefs.includes(pref) ? 'bg-blue-50/70' : 'hover:bg-gray-50'
                                }`}>
                                  <input type="checkbox" checked={selectedPrefs.includes(pref)}
                                    onChange={() => togglePref(pref)}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                  <span className="text-xs text-gray-600">{pref}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {selectedPrefs.length > 0 && (
                  <p className="text-xs text-blue-600 mt-1">{selectedPrefs.length}都道府県選択中</p>
                )}
              </div>
            </div>

            {/* 選択プレビュー + 追加ボタン */}
            <div className="flex items-center justify-between border-t border-gray-100 pt-4">
              <div className="text-xs text-gray-500">
                {selectedIndustries.length > 0 && selectedPrefs.length > 0
                  ? `${selectedIndustries.length}キーワード × ${selectedPrefs.length}都道府県 = ${selectedIndustries.length * selectedPrefs.length}件のルールを追加`
                  : '業種キーワードと地域をそれぞれ選択してください'}
              </div>
              <button onClick={handleAddRules}
                disabled={selectedIndustries.length === 0 || selectedPrefs.length === 0 || addingRules}
                className="btn-primary !py-2.5 px-6 disabled:opacity-50">
                {addingRules ? '追加中...' : '一括追加'}
              </button>
            </div>
          </div>

          {/* ルール一覧 */}
          <h3 className="text-sm font-bold text-gray-700 mb-3">設定済みルール</h3>
          <div className="space-y-3">
            {Object.keys(groupedRules).length === 0 ? (
              <div className="card p-8 text-center text-gray-400">
                エリアルールが設定されていません。<br />
                ルールを追加すると、オペレーターの架電リストにフィルターが適用されます。
              </div>
            ) : (
              Object.entries(groupedRules).map(([industry, ruleList]) => {
                const prefGroups = groupPrefsByRegion(ruleList);
                const isAllJapan = ruleList.length === ALL_PREFS.length;
                return (
                  <div key={industry} className="card p-4">
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-sm font-bold text-gray-800">{industry}</span>
                      <div className="flex items-center gap-2">
                        {isAllJapan && (
                          <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">全国</span>
                        )}
                        <span className="text-xs text-gray-400">{ruleList.length}都道府県</span>
                        <button onClick={() => handleDeleteIndustryRules(industry, ruleList)}
                          className="text-xs text-red-400 hover:text-red-600 ml-1">一括削除</button>
                      </div>
                    </div>
                    {!isAllJapan && (
                      <div className="space-y-1.5">
                        {prefGroups.map(({ regionName, rules: regionRules, isFullRegion }) => (
                          <div key={regionName} className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-gray-500 w-10 flex-shrink-0">{regionName}</span>
                            {isFullRegion ? (
                              <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">全域</span>
                            ) : (
                              regionRules.map(rule => (
                                <span key={rule.id}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  {rule.region}
                                  <button onClick={() => handleDeleteRule(rule.id, rule.industry_name, rule.region)}
                                    className="text-emerald-400 hover:text-red-500 transition-colors">&times;</button>
                                </span>
                              ))
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {Object.keys(groupedRules).length > 0 && (
            <div className="mt-4 text-xs text-gray-400">
              {Object.keys(groupedRules).length} 業種 / {rules.length} ルール設定済み
            </div>
          )}

          {/* ==================== NGワード設定 ==================== */}
          <div className="mt-8 border-t border-gray-200 pt-6">
            <h3 className="text-sm font-bold text-gray-700 mb-2">NGワード設定（職種除外）</h3>
            <p className="text-xs text-gray-400 mb-4">
              全ルール共通のNGワードです。職種にNGワードが含まれる企業は、業種ルールに一致しても架電リストから除外されます。
            </p>

            {/* NGワード追加フォーム */}
            <div className="card p-4 mb-4">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="input-label">NGワード</label>
                  <input type="text" className="input text-sm" placeholder="例: 事務、経理、ドライバー..."
                    value={ngKeywordInput} onChange={e => setNgKeywordInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddNgWord(); } }} />
                </div>
                <button onClick={handleAddNgWord} disabled={!ngKeywordInput.trim()}
                  className="btn-primary !py-2.5 px-5 disabled:opacity-50">追加</button>
              </div>
            </div>

            {/* NGワード一覧 */}
            {excludeWords.length === 0 ? (
              <div className="text-xs text-gray-400 text-center py-4">NGワードは設定されていません</div>
            ) : (
              <div className="card p-4">
                <div className="flex flex-wrap gap-2">
                  {excludeWords.map(ew => (
                    <span key={ew.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                      {ew.keyword}
                      <button onClick={() => handleDeleteNgWord(ew.id)}
                        className="text-red-400 hover:text-red-600 transition-colors">&times;</button>
                    </span>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-3">{excludeWords.length}件のNGワード設定済み</p>
              </div>
            )}
          </div>
        </>
      )}
    </Layout>
  );
}
