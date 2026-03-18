/**
 * 架電リストページ
 * 企業一覧テーブル + 折りたたみCSVインポート + ロック状態表示
 */
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Layout from '../components/common/Layout';
import useAuth from '../hooks/useAuth';
import api from '../utils/api';
import toast from 'react-hot-toast';

const LOCK_TIMEOUT_MINUTES = 5;

// 住所から都道府県を抽出
const PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
const extractPref = (address) => {
  if (!address) return null;
  for (const p of PREFS) { if (address.startsWith(p)) return p; }
  return null;
};

const RESULT_STYLES = {
  INTERESTED: { label: '興味あり', style: 'bg-emerald-50 text-emerald-700' },
  CALLBACK: { label: 'コールバック', style: 'bg-blue-50 text-blue-700' },
  NO_ANSWER: { label: '不通', style: 'bg-gray-100 text-gray-500' },
  REFUSED: { label: '拒否', style: 'bg-red-50 text-red-600' },
  WRONG_NUMBER: { label: '番号違い', style: 'bg-amber-50 text-amber-700' },
  NOT_AVAILABLE: { label: '不在', style: 'bg-orange-50 text-orange-600' },
  GATEKEEPER: { label: '受付止め', style: 'bg-violet-50 text-violet-700' },
  MEETING_SET: { label: '面談設定', style: 'bg-teal-50 text-teal-700' },
};

export default function CallListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const fileInputRef = useRef(null);
  const isManager = user?.role === 'admin' || user?.role === 'manager';

  // クエリパラメータからタブを自動選択
  const queryTab = router.query.tab;

  // CSV import state
  const [showImport, setShowImport] = useState(true);
  const [importTab, setImportTab] = useState('calllist'); // 'calllist' | 'special' | 'ng' | 'existing'
  const [listView, setListView] = useState('calllist'); // 'calllist' | 'special' - 企業一覧の表示切替

  // クエリパラメータが変わったらタブを切り替え
  useEffect(() => {
    if (queryTab === 'ng' || queryTab === 'existing' || queryTab === 'calllist' || queryTab === 'special') {
      setImportTab(queryTab);
      setShowImport(true);
      if (queryTab === 'special') setListView('special');
    }
  }, [queryTab]);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  // 手動入力モード
  const [entryMode, setEntryMode] = useState('file'); // 'file' | 'manual'
  const [manualForm, setManualForm] = useState({
    company_name: '', phone_number: '', industry: '', job_type: '', comment: '', address: '', region: ''
  });
  const [manualSubmitting, setManualSubmitting] = useState(false);

  // 優先オペレーター設定（管理者/マネージャーのみ）
  const [operators, setOperators] = useState([]);
  const [selectedOperators, setSelectedOperators] = useState([]);
  const [graceDays, setGraceDays] = useState(5);

  useEffect(() => {
    if (isManager) {
      api.get('/api/calls/operators').then(({ data }) => setOperators(data.data || [])).catch(() => {});
    }
  }, [isManager]);

  // 除外リスト統計（件数・最終更新日）
  const [exclusionStats, setExclusionStats] = useState({ ng: null, existing_project: null });
  const fetchExclusionStats = async () => {
    try {
      const { data } = await api.get('/api/csv/exclusion-stats');
      setExclusionStats(data.data);
    } catch (err) { /* ignore */ }
  };
  useEffect(() => { fetchExclusionStats(); }, []);

  // Pickup state
  const [pickingUp, setPickingUp] = useState(null); // company ID being picked up

  // Company list state
  const [companies, setCompanies] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [industry, setIndustry] = useState('');
  const [region, setRegion] = useState('');
  const [showExcluded, setShowExcluded] = useState(false);

  // 企業一覧取得
  const fetchCompanies = async (page = 1) => {
    try {
      setLoading(true);
      const params = { page, limit: 20 };
      if (search) params.search = search;
      if (industry) params.industry = industry;
      if (region) params.region = region;
      if (showExcluded) params.show_excluded = '1';
      if (listView === 'special') params.list_type = 'special';
      const { data } = await api.get('/api/companies', { params });
      setCompanies(data.data.companies);
      setPagination(data.data.pagination);
    } catch (err) {
      toast.error('企業一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, [industry, region, showExcluded, listView]);

  // 30秒ごとにリスト自動リフレッシュ（ロック状態をリアルタイム反映）
  useEffect(() => {
    const interval = setInterval(() => {
      fetchCompanies(pagination.page || 1);
    }, 30000);
    return () => clearInterval(interval);
  }, [pagination.page, search, industry, region, showExcluded]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchCompanies(1);
  };

  // ピックアップ: ロック取得 → 架電画面へ遷移
  const handlePickup = async (company) => {
    const lock = getLockStatus(company);
    if (lock.status === 'locked') {
      toast.error(`${lock.label}`);
      return;
    }
    setPickingUp(company.id);
    try {
      await api.post(`/api/companies/${company.id}/lock`);
      toast.success(`${company.company_name} をピックアップしました`);
      router.push(`/call?pickup=${company.id}`);
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error('この企業は他のオペレーターが対応中です');
        fetchCompanies(pagination.page || 1); // リスト更新
      } else {
        toast.error('ピックアップに失敗しました');
      }
      setPickingUp(null);
    }
  };

  // ロック状態判定
  const getLockStatus = (company) => {
    if (!company.locked_by_user_id) {
      return { status: 'free', label: '空き' };
    }
    if (company.locked_at) {
      const lockedAt = new Date(company.locked_at);
      const elapsed = Date.now() - lockedAt.getTime();
      if (elapsed >= LOCK_TIMEOUT_MINUTES * 60 * 1000) {
        return { status: 'free', label: '空き' };
      }
    }
    return {
      status: 'locked',
      label: `${company.locked_by_user_name || 'ユーザー'}が対応中`,
    };
  };

  // === CSV Import handlers (既存ロジック維持) ===
  const handleFileChange = (e) => {
    const selected = e.target.files?.[0];
    if (selected) {
      if (!/\.(csv|xls|xlsx)$/i.test(selected.name)) {
        toast.error('CSV・XLS・XLSXファイルを選択してください');
        return;
      }
      setFile(selected);
      setImportResult(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      if (!/\.(csv|xls|xlsx)$/i.test(dropped.name)) {
        toast.error('CSV・XLS・XLSXファイルを選択してください');
        return;
      }
      setFile(dropped);
      setImportResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error('ファイルを選択してください');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      // 優先オペレーター設定
      if ((importTab === 'calllist' || importTab === 'special') && isManager && selectedOperators.length > 0 && graceDays > 0) {
        formData.append('priority_operator_ids', JSON.stringify(selectedOperators));
        formData.append('grace_days', String(graceDays));
      }

      let url = '/api/csv/import';
      if (importTab === 'special') url = '/api/csv/import-special';
      else if (importTab === 'ng') url = '/api/csv/import-exclusion?list_type=ng';
      else if (importTab === 'existing') url = '/api/csv/import-exclusion?list_type=existing_project';

      const { data } = await api.post(url, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(data.data);
      toast.success(data.message);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (importTab === 'calllist' || importTab === 'special') { if (importTab === 'special') setListView('special'); fetchCompanies(1); }
      else { fetchCompanies(pagination.page || 1); fetchExclusionStats(); } // 除外フラグ更新・統計を反映
    } catch (err) {
      const msg = err.response?.data?.message || 'インポートに失敗しました';
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  // 手動登録ハンドラ
  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (importTab === 'calllist' || importTab === 'special') {
      if (!manualForm.company_name.trim() || !manualForm.phone_number.trim()) {
        toast.error('企業名と電話番号は必須です');
        return;
      }
    } else {
      if (!manualForm.company_name.trim() && !manualForm.phone_number.trim()) {
        toast.error('企業名または電話番号のどちらかは必須です');
        return;
      }
    }
    setManualSubmitting(true);
    try {
      if (importTab === 'calllist' || importTab === 'special') {
        const url = importTab === 'special' ? '/api/csv/manual-special' : '/api/csv/manual-company';
        const { data } = await api.post(url, manualForm);
        toast.success(data.message || '登録しました');
        if (importTab === 'special') setListView('special');
        fetchCompanies(1);
      } else {
        const listType = importTab === 'ng' ? 'ng' : 'existing_project';
        const { data } = await api.post('/api/csv/manual-exclusion', {
          company_name: manualForm.company_name,
          phone_number: manualForm.phone_number,
          list_type: listType,
        });
        toast.success(data.message || '登録しました');
        fetchExclusionStats();
        fetchCompanies(pagination.page || 1);
      }
      setManualForm({ company_name: '', phone_number: '', industry: '', job_type: '', comment: '', address: '', region: '' });
    } catch (err) {
      toast.error(err.response?.data?.message || '登録に失敗しました');
    } finally {
      setManualSubmitting(false);
    }
  };

  return (
    <Layout>
      {/* ヘッダー */}
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">リスト管理</h1>
          <p className="text-sm text-gray-400 mt-0.5">架電リスト・特別リスト・NGリスト・既存案件リストのインポート・手動登録</p>
        </div>
        <button
          onClick={() => setShowImport(!showImport)}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all ${
            showImport
              ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
              : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
          }`}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          インポート
          <svg className={`w-3.5 h-3.5 transition-transform ${showImport ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {/* 折りたたみインポートセクション */}
      {showImport && (
        <div className="mb-5 space-y-4 animate-fade-in">
          {/* タブ切り替え */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
            {[
              { key: 'calllist', label: '架電リスト' },
              { key: 'special', label: '特別リスト' },
              { key: 'ng', label: 'NGリスト' },
              { key: 'existing', label: '既存案件リスト' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setImportTab(tab.key); setFile(null); setImportResult(null); setEntryMode('file'); setManualForm({ company_name: '', phone_number: '', industry: '', job_type: '', comment: '', address: '', region: '' }); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                  importTab === tab.key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ファイル / 手動 サブ切り替え */}
          <div className="flex gap-1 bg-gray-50 p-0.5 rounded-md w-fit">
            {[
              { key: 'file', label: 'ファイルインポート' },
              { key: 'manual', label: '手動入力' },
            ].map((m) => (
              <button
                key={m.key}
                onClick={() => { setEntryMode(m.key); setImportResult(null); }}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${
                  entryMode === m.key
                    ? 'bg-white text-gray-800 shadow-sm'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {entryMode === 'file' ? (
          <>
          {/* フォーマット説明 */}
          <div className="card p-4">
            <div className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                importTab === 'calllist' ? 'bg-blue-50' : importTab === 'special' ? 'bg-purple-50' : importTab === 'ng' ? 'bg-red-50' : 'bg-amber-50'
              }`}>
                <svg className={`w-4 h-4 ${
                  importTab === 'calllist' ? 'text-blue-600' : importTab === 'special' ? 'text-purple-600' : importTab === 'ng' ? 'text-red-600' : 'text-amber-600'
                }`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </div>
              <div>
                {importTab === 'calllist' ? (
                  <>
                    <p className="text-sm font-medium text-gray-800 mb-1">架電リストインポート</p>
                    <p className="text-xs text-gray-600 mb-1.5">UrizoのXLSファイルをそのままアップロードできます</p>
                    <p className="text-xs text-gray-400">対応形式: <span className="font-medium">.xls / .xlsx / .csv</span></p>
                    <p className="text-xs text-gray-400 mt-0.5">重複判定: 電話番号 または 会社名が一致する場合はスキップ</p>
                    <p className="text-xs text-gray-400 mt-0.5">NG/既存案件リストに一致する企業も自動的にスキップされます</p>
                  </>
                ) : importTab === 'special' ? (
                  <>
                    <p className="text-sm font-medium text-gray-800 mb-1">特別リストインポート</p>
                    <p className="text-xs text-gray-600 mb-1.5">NGリスト・既存案件リストの除外を無視して追加されます</p>
                    <p className="text-xs text-gray-400">対応形式: <span className="font-medium">.xls / .xlsx / .csv</span></p>
                    <p className="text-xs text-gray-400 mt-0.5">重複判定: 特別リスト内で電話番号 または 会社名が一致する場合はスキップ</p>
                    <p className="text-xs text-gray-400 mt-0.5">特別リストの企業は自動架電・業種タブには表示されません（特別リストタブ専用）</p>
                  </>
                ) : importTab === 'ng' ? (
                  <>
                    <p className="text-sm font-medium text-gray-800 mb-1">NGリストインポート</p>
                    <p className="text-xs text-gray-600 mb-1.5">架電NGの企業リストを登録します</p>
                    <p className="text-xs text-gray-400">必須項目: 会社名（company_name）または 電話番号（phone_number）のどちらか</p>
                    <p className="text-xs text-gray-400 mt-0.5">既存の架電リストに一致する企業は自動的に除外されます</p>
                    <p className="text-xs text-gray-400 mt-0.5">電話番号は全角・ハイフン等を自動で正規化します</p>
                    {exclusionStats.ng && (
                      <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-3">
                        <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded">
                          登録数: {exclusionStats.ng.totalCount}件
                        </span>
                        <span className="text-xs text-gray-400">
                          最終更新: {new Date(exclusionStats.ng.lastUpdatedAt).toLocaleString('ja-JP')}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-gray-800 mb-1">既存案件リストインポート</p>
                    <p className="text-xs text-gray-600 mb-1.5">既に取引のある企業リストを登録します</p>
                    <p className="text-xs text-gray-400">必須項目: 会社名（company_name）または 電話番号（phone_number）のどちらか</p>
                    <p className="text-xs text-gray-400 mt-0.5">既存の架電リストに一致する企業は自動的に除外されます</p>
                    <p className="text-xs text-gray-400 mt-0.5">電話番号は全角・ハイフン等を自動で正規化します</p>
                    {exclusionStats.existing_project && (
                      <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-3">
                        <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                          登録数: {exclusionStats.existing_project.totalCount}件
                        </span>
                        <span className="text-xs text-gray-400">
                          最終更新: {new Date(exclusionStats.existing_project.lastUpdatedAt).toLocaleString('ja-JP')}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 優先オペレーター設定（管理者/マネージャー・架電リストのみ） */}
          {isManager && (importTab === 'calllist' || importTab === 'special') && (
            <div className="card p-4">
              <p className="text-xs font-medium text-gray-700 mb-2">優先オペレーター設定（任意）</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {operators.map((op) => (
                  <label key={op.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all border ${
                    selectedOperators.includes(op.id)
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                  }`}>
                    <input
                      type="checkbox"
                      checked={selectedOperators.includes(op.id)}
                      onChange={(e) => {
                        setSelectedOperators(prev =>
                          e.target.checked ? [...prev, op.id] : prev.filter(id => id !== op.id)
                        );
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                    />
                    {op.name}
                  </label>
                ))}
                {operators.length === 0 && <span className="text-xs text-gray-400">オペレーターが登録されていません</span>}
              </div>
              {selectedOperators.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">架電猶予日数:</label>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={graceDays}
                    onChange={(e) => setGraceDays(parseInt(e.target.value) || 5)}
                    className="input !w-20 !py-1 text-sm text-center"
                  />
                  <span className="text-xs text-gray-400">日間は選択されたオペレーターのみピックアップ可能</span>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-4 items-start">
            {/* ドロップエリア */}
            <div
              className={`card flex-1 p-6 border-2 border-dashed transition-all cursor-pointer ${
                dragOver
                  ? 'border-blue-400 bg-blue-50/50'
                  : file
                    ? 'border-emerald-300 bg-emerald-50/30'
                    : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/20'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="text-center">
                {file ? (
                  <>
                    <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-2">
                      <svg className="w-5 h-5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-gray-800">{file.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
                  </>
                ) : (
                  <>
                    <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-2">
                      <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </div>
                    <p className="text-sm text-gray-600">ファイルをドラッグ&ドロップ</p>
                    <p className="text-xs text-gray-400 mt-0.5">またはクリックして選択</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xls,.xlsx"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            {/* アップロードボタン + 結果 */}
            <div className="w-48 flex flex-col gap-3">
              <button
                onClick={handleUpload}
                disabled={!file || uploading}
                className="btn-primary w-full !py-3 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {uploading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    インポート中...
                  </span>
                ) : 'インポート実行'}
              </button>

              {importResult && (
                <div className="card p-3 animate-fade-in">
                  <div className="space-y-1.5 text-center">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">総行数</span>
                      <span className="font-bold text-gray-800">{importResult.totalRows}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-emerald-600">{importTab === 'calllist' ? '新規追加' : '登録'}</span>
                      <span className="font-bold text-emerald-700">{importResult.insertedCount}</span>
                    </div>
                    {importResult.duplicateCount > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-amber-600">重複スキップ</span>
                        <span className="font-bold text-amber-700">{importResult.duplicateCount}</span>
                      </div>
                    )}
                    {importResult.excludedCount > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-red-600">除外スキップ</span>
                        <span className="font-bold text-red-700">{importResult.excludedCount}</span>
                      </div>
                    )}
                    {importResult.skippedCount > 0 && importResult.skippedCount !== (importResult.duplicateCount || 0) + (importResult.excludedCount || 0) && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-amber-600">スキップ</span>
                        <span className="font-bold text-amber-700">{importResult.skippedCount}</span>
                      </div>
                    )}
                    {importResult.excludedCompaniesCount > 0 && (
                      <div className="flex items-center justify-between text-xs mt-1 pt-1 border-t border-gray-100">
                        <span className="text-red-600">架電リスト除外</span>
                        <span className="font-bold text-red-700">{importResult.excludedCompaniesCount}件</span>
                      </div>
                    )}
                    {importResult.autoAssigned > 0 && (
                      <div className="flex items-center justify-between text-xs mt-1 pt-1 border-t border-gray-100">
                        <span className="text-blue-600">自動割り当て</span>
                        <span className="font-bold text-blue-700">{importResult.autoAssigned}件</span>
                      </div>
                    )}
                  </div>
                  {importResult.errors && importResult.errors.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-100">
                      <p className="text-[10px] text-gray-500 mb-1">詳細（最大50件表示）</p>
                      <div className="max-h-24 overflow-y-auto space-y-0.5">
                        {importResult.errors.map((err, i) => (
                          <p key={i} className="text-[10px] text-red-500 bg-red-50 rounded px-1.5 py-0.5">
                            行{err.line}: {err.message}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          </>
          ) : (
          /* 手動入力フォーム */
          <div className="card p-5">
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    企業名 {(importTab === 'calllist' || importTab === 'special') && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="text"
                    value={manualForm.company_name}
                    onChange={(e) => setManualForm(f => ({ ...f, company_name: e.target.value }))}
                    className="input"
                    placeholder="株式会社〇〇"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    電話番号 {(importTab === 'calllist' || importTab === 'special') && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="text"
                    value={manualForm.phone_number}
                    onChange={(e) => setManualForm(f => ({ ...f, phone_number: e.target.value }))}
                    className="input"
                    placeholder="03-1234-5678"
                  />
                </div>
              </div>

              {(importTab === 'calllist' || importTab === 'special') && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">業種</label>
                      <select
                        value={manualForm.industry}
                        onChange={(e) => setManualForm(f => ({ ...f, industry: e.target.value }))}
                        className="input"
                      >
                        <option value="">選択してください</option>
                        <option value="飲食">飲食</option>
                        <option value="製造">製造</option>
                        <option value="小売">小売</option>
                        <option value="建設">建設</option>
                        <option value="宿泊">宿泊</option>
                        <option value="農業">農業</option>
                        <option value="介護">介護</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">職種</label>
                      <input
                        type="text"
                        value={manualForm.job_type}
                        onChange={(e) => setManualForm(f => ({ ...f, job_type: e.target.value }))}
                        className="input"
                        placeholder="営業、事務など"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">住所</label>
                    <input
                      type="text"
                      value={manualForm.address}
                      onChange={(e) => setManualForm(f => ({ ...f, address: e.target.value }))}
                      className="input"
                      placeholder="東京都渋谷区..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">コメント</label>
                    <input
                      type="text"
                      value={manualForm.comment}
                      onChange={(e) => setManualForm(f => ({ ...f, comment: e.target.value }))}
                      className="input"
                      placeholder="備考メモ"
                    />
                  </div>
                </>
              )}

              {importTab !== 'calllist' && importTab !== 'special' && (
                <p className="text-xs text-gray-400">
                  {importTab === 'ng' ? 'NGリスト' : '既存案件リスト'}に手動で1件登録します。企業名または電話番号のどちらかは必須です。
                  架電リストに該当企業がある場合は自動的に除外されます。
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={manualSubmitting}
                  className="btn-primary !py-2.5 px-6 disabled:opacity-40"
                >
                  {manualSubmitting ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      登録中...
                    </span>
                  ) : '登録'}
                </button>
              </div>
            </form>
          </div>
          )}
        </div>
      )}

      {/* リスト表示切替 */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit mb-4">
        {[
          { key: 'calllist', label: '架電リスト' },
          { key: 'special', label: '特別リスト' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setListView(tab.key); }}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
              listView === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 検索・フィルターバー */}
      <form onSubmit={handleSearch} className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input !pl-10"
            placeholder="企業名・電話番号で検索"
          />
        </div>
        <button type="submit" className="btn-primary !py-2.5 px-5">
          検索
        </button>
        <select
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className="input !w-auto min-w-[130px]"
        >
          <option value="">業種</option>
          <option value="飲食">飲食</option>
          <option value="製造">製造</option>
          <option value="小売">小売</option>
          <option value="建設">建設</option>
          <option value="宿泊">宿泊</option>
          <option value="農業">農業</option>
          <option value="介護">介護</option>
        </select>
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="input !w-auto min-w-[130px]"
        >
          <option value="">地域</option>
          <option value="北海道">北海道</option>
          <option value="東北">東北</option>
          <option value="関東">関東</option>
          <option value="中部">中部</option>
          <option value="近畿">近畿</option>
          <option value="中国">中国</option>
          <option value="四国">四国</option>
          <option value="九州">九州</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-500 cursor-pointer select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={showExcluded}
            onChange={(e) => setShowExcluded(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          除外済み表示
        </label>
      </form>

      {/* 企業一覧テーブル */}
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
        ) : companies.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
              </svg>
            </div>
            <p className="text-sm text-gray-400">企業データがありません</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="table-header" style={{width:'180px'}}>企業名</th>
                    <th className="table-header" style={{width:'110px'}}>電話番号</th>
                    <th className="table-header" style={{width:'80px'}}>業種</th>
                    <th className="table-header" style={{width:'100px'}}>職種</th>
                    <th className="table-header" style={{width:'70px'}}>地域</th>
                    <th className="table-header" style={{width:'90px'}}>最終架電</th>
                    <th className="table-header" style={{width:'70px'}}>最終結果</th>
                    <th className="table-header" style={{width:'70px'}}>ステータス</th>
                    <th className="table-header" style={{width:'36px'}}>除外</th>
                    <th className="table-header text-center" style={{width:'90px'}}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => {
                    const lock = getLockStatus(c);
                    const resultInfo = c.last_result ? RESULT_STYLES[c.last_result] : null;
                    return (
                      <tr key={c.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                        <td className="table-cell font-medium text-gray-900 truncate max-w-[180px]" title={c.company_name}>{c.company_name}</td>
                        <td className="table-cell text-gray-600 whitespace-nowrap">{c.phone_number}</td>
                        <td className="table-cell text-gray-500 truncate max-w-[80px]" title={c.industry || ''}>{c.industry || '-'}</td>
                        <td className="table-cell text-gray-500 truncate max-w-[100px]" title={c.job_type || ''}>{c.job_type || '-'}</td>
                        <td className="table-cell text-gray-500 whitespace-nowrap">{extractPref(c.address) || c.region || '-'}</td>
                        <td className="table-cell text-gray-500 whitespace-nowrap">
                          {c.last_call_date
                            ? new Date(c.last_call_date).toLocaleString('ja-JP')
                            : '-'}
                        </td>
                        <td className="table-cell">
                          {resultInfo ? (
                            <span className={`badge ${resultInfo.style}`}>
                              {resultInfo.label}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="table-cell">
                          {lock.status === 'free' ? (
                            <span className="text-emerald-600 text-xs font-medium">空き</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                              {lock.label}
                            </span>
                          )}
                        </td>
                        <td className="table-cell">
                          {c.exclusion_flag ? (
                            <span className="badge bg-red-50 text-red-600">除外</span>
                          ) : null}
                        </td>
                        <td className="table-cell text-center">
                          {!c.exclusion_flag && lock.status === 'free' ? (
                            <button
                              onClick={() => handlePickup(c)}
                              disabled={pickingUp === c.id}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-all disabled:opacity-50"
                            >
                              {pickingUp === c.id ? (
                                <>
                                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  処理中
                                </>
                              ) : (
                                <>
                                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                                  </svg>
                                  ピックアップ
                                </>
                              )}
                            </button>
                          ) : lock.status === 'locked' ? (
                            <span className="text-xs text-gray-400">対応中</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ページネーション */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between py-4 px-5 border-t border-gray-100">
                <p className="text-xs text-gray-400">
                  全{pagination.total}件中 {(pagination.page - 1) * pagination.limit + 1}-
                  {Math.min(pagination.page * pagination.limit, pagination.total)}件
                </p>
                <div className="flex gap-1.5">
                  {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      onClick={() => fetchCompanies(page)}
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
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
