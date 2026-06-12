import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const STATUS_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'NAITEI', label: '内定' },
  { value: 'NAITEI_TORIKESHI', label: '内定取消' },
  { value: 'FUGOKAKU', label: '不合格' },
  { value: 'KEKKA_MACHI', label: '結果待ち' },
  { value: 'MENSETSU_KAKUTEI', label: '面接確定' },
  { value: 'BOSHUCHU', label: '募集中' },
  { value: 'SHORUI_CHU', label: '書類選考中' },
  { value: 'LOST', label: '失注' },
  { value: 'BARASHI', label: 'バラシ' },
  { value: 'HORYU', label: '保留' },
  { value: 'SHORUI_OCHI', label: '書類選考落ち' },
  { value: 'KISON_NASHI', label: '既存対応なし' },
  { value: 'MODOSHI', label: '戻し' },
  { value: 'MODORI', label: '戻し戻り' },
];

const STATUS_STYLES = {
  NAITEI:           'bg-emerald-50 text-emerald-700 border border-emerald-200/60',
  NAITEI_TORIKESHI: 'bg-orange-50 text-orange-700 border border-orange-200/60',
  FUGOKAKU:         'bg-red-50 text-red-700 border border-red-200/60',
  KEKKA_MACHI:      'bg-blue-50 text-blue-700 border border-blue-200/60',
  MENSETSU_KAKUTEI: 'bg-emerald-50 text-emerald-700 border border-emerald-200/60',
  BOSHUCHU:         'bg-blue-50 text-blue-700 border border-blue-200/60',
  SHORUI_CHU:       'bg-blue-50 text-blue-700 border border-blue-200/60',
  LOST:             'bg-red-50 text-red-700 border border-red-200/60',
  BARASHI:          'bg-red-50 text-red-700 border border-red-200/60',
  HORYU:            'bg-amber-50 text-amber-700 border border-amber-200/60',
  SHORUI_OCHI:      'bg-red-50 text-red-700 border border-red-200/60',
  KISON_NASHI:      'bg-gray-50 text-gray-600 border border-gray-200/60',
  MODOSHI:          'bg-amber-50 text-amber-700 border border-amber-200/60',
  MODORI:           'bg-emerald-50 text-emerald-700 border border-emerald-200/60',
};

// 47都道府県と短縮形 → 正式名のマップ。
// c.region/c.prefecture に「関東」「近畿」「中部」等の地方区分が紛れているデータがあるため、
// 都道府県名だけを抽出して表示する。 region/prefecture が空なら address 先頭からも抽出。
const PREFECTURES = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
const PREF_SHORT = { '青森':'青森県','岩手':'岩手県','宮城':'宮城県','秋田':'秋田県','山形':'山形県','福島':'福島県','茨城':'茨城県','栃木':'栃木県','群馬':'群馬県','埼玉':'埼玉県','千葉':'千葉県','東京':'東京都','神奈川':'神奈川県','新潟':'新潟県','富山':'富山県','石川':'石川県','福井':'福井県','山梨':'山梨県','長野':'長野県','岐阜':'岐阜県','静岡':'静岡県','愛知':'愛知県','三重':'三重県','滋賀':'滋賀県','京都':'京都府','大阪':'大阪府','兵庫':'兵庫県','奈良':'奈良県','和歌山':'和歌山県','鳥取':'鳥取県','島根':'島根県','岡山':'岡山県','広島':'広島県','山口':'山口県','徳島':'徳島県','香川':'香川県','愛媛':'愛媛県','高知':'高知県','福岡':'福岡県','佐賀':'佐賀県','長崎':'長崎県','熊本':'熊本県','大分':'大分県','宮崎':'宮崎県','鹿児島':'鹿児島県','沖縄':'沖縄県' };
const pickPrefecture = (p) => {
  if (!p) return null;
  if (p.prefecture && PREFECTURES.includes(p.prefecture)) return p.prefecture;
  if (p.region && PREFECTURES.includes(p.region)) return p.region;
  if (p.region && PREF_SHORT[p.region]) return PREF_SHORT[p.region];
  const addr = p.address || '';
  if (addr) {
    for (const pref of PREFECTURES) if (addr.startsWith(pref)) return pref;
    for (const [short, full] of Object.entries(PREF_SHORT)) if (addr.startsWith(short)) return full;
  }
  return null;
};

const RESULT_BADGES = {
  NO_ANSWER: { bg: 'bg-gray-100', text: 'text-gray-600', label: '不通' },
  NG: { bg: 'bg-red-50', text: 'text-red-600', label: 'NG' },
  RECALL: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'リコール' },
  INTERESTED: { bg: 'bg-blue-50', text: 'text-blue-700', label: '興味あり' },
  PROJECT: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: '案件化' },
  SKIP: { bg: 'bg-gray-50', text: 'text-gray-400', label: 'SKIP' },
};

const getStatusLabel = (statusValue) => {
  const opt = STATUS_OPTIONS.find(s => s.value === statusValue);
  return opt ? opt.label : statusValue;
};

const formatPhone = (phone) => {
  if (!phone) return '-';
  return phone
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[ー－—―‐‑⁃₋−\-–\s　()（）.．+＋]/g, '');
};

export default function AdminProjects() {
  const { user } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [pagination, setPagination] = useState({});
  const [operators, setOperators] = useState([]);
  const [status, setStatus] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [docScreening, setDocScreening] = useState(''); // ''|required|not_required
  const [interviewKind, setInterviewKind] = useState(''); // ''|in_person|online
  const [myOnly, setMyOnly] = useState(false);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState('current'); // 'current' or 'legacy'
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // 架電種別（管理者切替連動）
  const [callType, setCallType] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('adminView') || 'operator';
    return 'operator';
  });
  useEffect(() => {
    const interval = setInterval(() => {
      const v = localStorage.getItem('adminView') || 'operator';
      setCallType(prev => prev !== v ? v : prev);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // 移行前インポート
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);

  // 担当営業
  const [salesUsers, setSalesUsers] = useState([]);
  const [selectedSalesUser, setSelectedSalesUser] = useState('');

  // 通話ログモーダル
  const [callLogModal, setCallLogModal] = useState(null);
  const [callLogs, setCallLogs] = useState([]);
  const [callLogsLoading, setCallLogsLoading] = useState(false);
  const [expandedTranscript, setExpandedTranscript] = useState(null);

  // 内定者情報モーダル
  const [hireModal, setHireModal] = useState(null);
  const [hires, setHires] = useState([]);
  const [hireCount, setHireCount] = useState(1);
  const [hireSaving, setHireSaving] = useState(false);
  const [modalNaiteiDate, setModalNaiteiDate] = useState('');
  const [modalAttendees, setModalAttendees] = useState('');
  // 不合格モーダル
  const [fugokakuModal, setFugokakuModal] = useState(null);
  const [fugokakuAttendees, setFugokakuAttendees] = useState('');
  // 書類選考あり 詳細モーダル
  const [screeningModal, setScreeningModal] = useState(null); // { projectId, companyName }
  const [screeningForm, setScreeningForm] = useState({ recruitment_start_date: '', resume_sent_date: '', interview_date: '' });
  const [screeningSaving, setScreeningSaving] = useState(false);

  // 手動案件追加モーダル
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualForm, setManualForm] = useState({
    company_name: '', phone_number: '', status: '', job_number: '',
    interview_date: '', interview_type: '', memo: '', contact_person: '', contact_info: '',
  });
  const [manualSaving, setManualSaving] = useState(false);

  useEffect(() => {
    if (user && !['admin','manager','consultant'].includes(user.role)) { router.push('/'); return; }
    if (user) {
      fetchOperators();
      fetchSalesUsers();
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchProjects();
  }, [user, status, ownerId, selectedSalesUser, myOnly, dateFrom, dateTo, docScreening, interviewKind, sortBy, sortOrder, page, activeTab, search, callType, router.query.work_category]);

  const fetchOperators = async () => {
    try {
      const { data } = await api.get('/api/admin/users');
      if (data.success) setOperators(data.data.filter(u => u.role === 'operator'));
    } catch (err) { /* ignore */ }
  };

  const handleImportLegacy = async () => {
    if (!importFile) return;
    try {
      setImporting(true);
      const formData = new FormData();
      formData.append('file', importFile);
      const { data } = await api.post('/api/projects/import-legacy', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (data.success) {
        toast.success(data.message || `${data.data.imported}件インポートしました`);
        setImportFile(null);
        fetchProjects();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'インポートに失敗しました');
    } finally {
      setImporting(false);
    }
  };

  const fetchSalesUsers = async () => {
    try {
      const { data } = await api.get('/api/projects/sales-users');
      if (data.success) setSalesUsers(data.data);
    } catch (err) { /* ignore */ }
  };

  const fetchProjects = async () => {
    try {
      const params = new URLSearchParams({ page, limit: 60, sort_by: sortBy, sort_order: sortOrder });
      if (activeTab === 'legacy') params.append('is_legacy', '1');
      if (status) params.append('status', status);
      if (myOnly) params.append('my_only', '1');
      else if (ownerId) params.append('owner_user_id', ownerId);
      if (selectedSalesUser) params.append('sales_user_id', selectedSalesUser);
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      if (docScreening) params.append('doc_screening', docScreening);
      if (interviewKind) params.append('interview_kind', interviewKind);
      if (search) params.append('search', search);
      if (callType && activeTab !== 'legacy') params.append('call_type', callType);
      // 業務カテゴリ (技人国/特定技能) URL クエリを渡す (特定技能管理画面からの絞込リンク用)
      const wcq = typeof router.query.work_category === 'string' ? router.query.work_category : '';
      if (wcq) params.append('work_category', wcq);
      const { data } = await api.get(`/api/projects?${params}`);
      if (data.success) {
        setProjects(data.data.projects);
        setPagination(data.data.pagination);
      }
    } catch (err) { toast.error('案件取得に失敗しました'); }
  };

  const handleSort = (col) => {
    if (sortBy === col) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortOrder('desc');
    }
    setPage(1);
  };

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return <span className="text-gray-300 ml-0.5">&#x25B4;&#x25BE;</span>;
    return <span className="text-blue-600 ml-0.5">{sortOrder === 'asc' ? '\u25B2' : '\u25BC'}</span>;
  };

  const isUrgentUnconfirmed = (p) => {
    if (p.mail_replied || p.phone_confirmed) return false;
    if (!p.interview_date) return false;
    const interview = new Date(p.interview_date);
    const now = new Date();
    const diffDays = (interview - now) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= 4;
  };

  const handleInlineStatusChange = async (e, projectId) => {
    e.stopPropagation();
    const newStatus = e.target.value;
    try {
      const proj = projects.find(p => p.id === projectId);
      const payload = { status: newStatus };
      // 募集中にしたら ①募集開始日 を当日で自動入力（未入力のときのみ）
      if (newStatus === 'BOSHUCHU' && proj && !proj.recruitment_start_date) {
        payload.recruitment_start_date = todayStr();
      }
      await api.put(`/api/projects/${projectId}`, payload);
      setProjects(prev => prev.map(p => p.id === projectId
        ? { ...p, status: newStatus, ...(payload.recruitment_start_date ? { recruitment_start_date: payload.recruitment_start_date } : {}) }
        : p));
      toast.success('ステータスを更新しました');
      if (newStatus === 'NAITEI') {
        setModalNaiteiDate('');
        setModalAttendees('');
        openHireModal(projectId, proj?.company_name || '');
      }
      if (newStatus === 'FUGOKAKU') {
        setFugokakuAttendees('');
        setFugokakuModal({ projectId, companyName: proj?.company_name || '' });
      }
    } catch (err) {
      toast.error('ステータスの更新に失敗しました');
    }
  };

  // 書類選考あり 詳細: ①募集開始日 ②履歴書送付日 の直近(最新)日付
  const screeningBaseDate = (p) => {
    const dates = [p.recruitment_start_date, p.resume_sent_date].filter(Boolean).map(d => String(d).slice(0, 10));
    if (dates.length === 0) return null;
    return dates.sort().slice(-1)[0]; // 最新
  };
  // 指定日からの経過日数（今日 - 日付）。null なら null
  const daysSince = (dateStr) => {
    if (!dateStr) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
    if (isNaN(d.getTime())) return null;
    return Math.floor((today - d) / (1000 * 60 * 60 * 24));
  };
  // 当日の日付文字列 YYYY-MM-DD（ローカル）
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  // 書類選考「あり」を強調表示するか（①②の直近から4日以上経過。面接日が入っていれば抑制）
  const screeningOverdue = (p) => {
    if (p.document_screening !== 'required') return false;
    if (p.interview_date) return false; // 面接日が入っていればアラート不要
    const elapsed = daysSince(screeningBaseDate(p));
    return elapsed != null && elapsed >= 4;
  };

  const openScreeningModal = (p) => {
    setScreeningModal({ projectId: p.id, companyName: p.company_name });
    setScreeningForm({
      recruitment_start_date: p.recruitment_start_date ? String(p.recruitment_start_date).slice(0, 10) : '',
      resume_sent_date: p.resume_sent_date ? String(p.resume_sent_date).slice(0, 10) : '',
      interview_date: p.interview_date ? String(p.interview_date).slice(0, 10) : '',
    });
  };

  const handleSaveScreening = async () => {
    if (!screeningModal) return;
    setScreeningSaving(true);
    try {
      await api.put(`/api/projects/${screeningModal.projectId}`, {
        recruitment_start_date: screeningForm.recruitment_start_date || null,
        resume_sent_date: screeningForm.resume_sent_date || null,
        interview_date: screeningForm.interview_date || null,
      });
      toast.success('書類選考の詳細を保存しました');
      setScreeningModal(null);
      fetchProjects();
    } catch { toast.error('保存に失敗しました'); }
    finally { setScreeningSaving(false); }
  };

  const openHireModal = async (projectId, companyName) => {
    setHireModal({ projectId, companyName });
    try {
      const { data } = await api.get(`/api/projects/${projectId}/hires`);
      const existing = data.data || [];
      if (existing.length > 0) { setHires(existing); setHireCount(existing.length); }
      else { setHires([{ registration_number: '', course: '国内', initial_payment: '', expected_revenue: '' }]); setHireCount(1); }
    } catch { setHires([{ registration_number: '', course: '国内', initial_payment: '', expected_revenue: '' }]); setHireCount(1); }
  };

  const handleHireCountChange = (count) => {
    const n = Math.max(0, Math.min(20, parseInt(count, 10) || 0));
    setHireCount(n);
    setHires(prev => n > prev.length
      ? [...prev, ...Array(n - prev.length).fill(null).map(() => ({ registration_number: '', course: '国内', initial_payment: '', expected_revenue: '' }))]
      : prev.slice(0, n));
  };

  const updateHire = (index, field, value) => {
    if (field === 'initial_payment' || field === 'expected_revenue') value = value.replace(/[^0-9]/g, '');
    setHires(prev => prev.map((h, i) => i === index ? { ...h, [field]: value } : h));
  };

  const handleSaveHires = async () => {
    if (!hireModal) return;
    setHireSaving(true);
    try {
      await api.put(`/api/projects/${hireModal.projectId}/hires`, { hires });
      // 内定日・面接人数も保存
      await api.put(`/api/projects/${hireModal.projectId}`, {
        naitei_date: modalNaiteiDate || null,
        interview_attendees: modalAttendees ? Number(modalAttendees) : null,
      });
      toast.success('内定者情報を保存しました');
      setHireModal(null);
      fetchProjects();
    } catch { toast.error('内定者情報の保存に失敗しました'); }
    finally { setHireSaving(false); }
  };

  const handleCheckboxToggle = async (projectId, field, value) => {
    try {
      await api.put(`/api/projects/${projectId}`, { [field]: value });
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, [field]: value ? 1 : 0 } : p));
    } catch (err) { toast.error('更新に失敗しました'); }
  };

  const handleSalesAssign = async (e, projectId) => {
    e.stopPropagation();
    const salesUserId = e.target.value || null;
    try {
      await api.put(`/api/projects/${projectId}`, { sales_user_id: salesUserId });
      setProjects(prev => prev.map(p => p.id === projectId ? {
        ...p,
        sales_user_id: salesUserId,
        sales_name: salesUsers.find(u => u.id === Number(salesUserId))?.name || null,
      } : p));
      toast.success('担当営業を更新しました');
    } catch (err) {
      toast.error('更新に失敗しました');
    }
  };

  const openCallLogs = async (e, project) => {
    e.stopPropagation();
    setCallLogModal({ projectId: project.id, companyName: project.company_name });
    setCallLogsLoading(true);
    setExpandedTranscript(null);
    try {
      const { data } = await api.get(`/api/projects/${project.id}/call-logs`);
      if (data.success) setCallLogs(data.data);
    } catch (err) {
      toast.error('通話ログの取得に失敗しました');
      setCallLogs([]);
    } finally {
      setCallLogsLoading(false);
    }
  };

  const calcDuration = (start, end) => {
    if (!start || !end) return '-';
    const sec = Math.round((new Date(end) - new Date(start)) / 1000);
    if (sec < 60) return `${sec}秒`;
    return `${Math.floor(sec / 60)}分${sec % 60}秒`;
  };

  if (!user || (!['admin','manager','consultant'].includes(user.role))) return null;

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-48px)]">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">案件管理
          <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${callType === 'sales' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
            {callType === 'sales' ? '営業' : 'オペレーター'}
          </span>
        </h1>
        <div className="flex items-center gap-2">
          {/* 募集開始日 一括補完 (管理者・マネージャー) */}
          {['admin', 'manager'].includes(user?.role) && (
            <button
              onClick={async () => {
                if (!confirm('4/1以降の「書類選考あり&募集中&募集開始日 未入力」の案件すべてに、案件獲得日と同日を募集開始日として一括入力します。続行?')) return;
                try {
                  const { data } = await api.post('/api/admin/backfill-recruitment-start-date');
                  if (data.success) {
                    toast.success(data.message || `${data.data?.updated || 0}件を補完しました`);
                    fetchProjects();
                  } else toast.error(data.message || '失敗しました');
                } catch (e) { toast.error(e.response?.data?.message || '失敗しました'); }
              }}
              title="4/1以降・書類選考あり・募集中・募集開始日未入力の案件に獲得日と同日を一括入力"
              className="px-3 py-2 rounded-lg text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 transition-all whitespace-nowrap">
              募集開始日 一括補完
            </button>
          )}
          {/* 求人番号 自動取得 (管理者・マネージャー) */}
          {['admin', 'manager'].includes(user?.role) && (
            <button
              onClick={async () => {
                if (!confirm('求人番号が未入力の案件について、同じ企業の他案件にある求人番号を自動でコピーして埋めます。続行?')) return;
                try {
                  const { data } = await api.post('/api/admin/backfill-job-numbers');
                  if (data.success) {
                    toast.success(data.message || `${data.data?.updated || 0}件を補完しました`, { duration: 6000 });
                    fetchProjects();
                  } else toast.error(data.message || '失敗しました');
                } catch (e) { toast.error(e.response?.data?.message || '失敗しました'); }
              }}
              title="求人番号未入力案件について、同企業の他案件にある求人番号を自動取得して埋める"
              className="px-3 py-2 rounded-lg text-xs font-medium bg-teal-600 text-white hover:bg-teal-700 transition-all whitespace-nowrap">
              求人番号 自動取得
            </button>
          )}
          {user?.role !== 'consultant' && (
            <button onClick={() => { setShowManualAdd(true); setManualForm({ company_name: '', phone_number: '', status: '', job_number: '', interview_date: '', interview_type: '', memo: '', contact_person: '', contact_info: '' }); }}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-all flex items-center gap-1.5">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              手動追加
            </button>
          )}
          <button onClick={() => { setMyOnly(!myOnly); setPage(1); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              myOnly ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {myOnly ? '自分の案件のみ' : '全員の案件'}
          </button>
        </div>
      </div>

      {/* タブ切り替え */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          <button onClick={() => { setActiveTab('current'); setPage(1); }}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'current' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            現在の案件
          </button>
          <button onClick={() => { setActiveTab('legacy'); setPage(1); }}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'legacy' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            移行前
          </button>
        </div>

        {/* 移行前タブのインポート */}
        {activeTab === 'legacy' && (
          <div className="flex items-center gap-2 ml-auto">
            <input type="file" accept=".csv,.xls,.xlsx"
              onChange={e => setImportFile(e.target.files?.[0] || null)}
              className="text-xs file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:bg-blue-50 file:text-blue-600 file:font-medium file:cursor-pointer" />
            <button onClick={handleImportLegacy} disabled={!importFile || importing}
              className="btn-primary text-xs disabled:opacity-40">
              {importing ? 'インポート中...' : 'CSVインポート'}
            </button>
            <span className="text-[10px] text-gray-400">日付,担当OP,企業名,電話番号,求人番号,担当営業,ステータス,面接日,面接方法,書類選考,メモ</span>
          </div>
        )}
      </div>

      {/* フィルター */}
      <div className="card p-4 mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="input-label">検索</label>
          <div className="flex gap-1">
            <input type="text" className="input text-sm w-48" placeholder="求人番号 or 企業名"
              value={searchInput} onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setSearch(searchInput); setPage(1); } }} />
            <button onClick={() => { setSearch(searchInput); setPage(1); }}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">検索</button>
          </div>
        </div>
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
        <div>
          <label className="input-label">担当営業</label>
          <select className="input text-sm" value={selectedSalesUser} onChange={e => { setSelectedSalesUser(e.target.value); setPage(1); }}>
            <option value="">全員</option>
            <option value="none">未割当</option>
            {salesUsers.map(su => <option key={su.id} value={su.id}>{su.name}</option>)}
          </select>
        </div>
        <div>
          <label className="input-label">期間（獲得日）</label>
          <div className="flex items-center gap-2">
            <input type="date" className="input text-sm" value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
            <span className="text-gray-400">〜</span>
            <input type="date" className="input text-sm" value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(1); }} />
          </div>
        </div>
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}
            className="text-xs text-gray-500 hover:text-red-500 underline pb-2">
            期間クリア
          </button>
        )}
        <div>
          <label className="input-label">書類選考</label>
          <select className="input text-sm" value={docScreening} onChange={e => { setDocScreening(e.target.value); setPage(1); }}>
            <option value="">すべて</option>
            <option value="required">あり</option>
            <option value="not_required">なし</option>
          </select>
        </div>
        <div>
          <label className="input-label">面接形式</label>
          <select className="input text-sm" value={interviewKind} onChange={e => { setInterviewKind(e.target.value); setPage(1); }}>
            <option value="">すべて</option>
            <option value="in_person">対面</option>
            <option value="online">オンライン</option>
          </select>
        </div>
      </div>

      {/* 該当件数 */}
      <div className="mb-3 text-sm text-gray-600">
        該当 <span className="font-bold text-gray-900">{pagination.total ?? 0}</span> 件
      </div>

      {/* テーブル */}
      <div className="card overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="overflow-x-auto overflow-y-auto flex-1">
          <table className="w-full text-sm table-fixed">
            <thead className="sticky top-0 z-20">
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="table-header cursor-pointer select-none" style={{width:'90px'}} onClick={() => handleSort('created_at')}>
                  獲得日<SortIcon col="created_at" />
                </th>
                <th className="table-header" style={{width:'80px'}}>担当OP</th>
                <th className="table-header" style={{width:'90px'}}>求人番号</th>
                <th className="table-header" style={{width:'160px'}}>企業名</th>
                <th className="table-header" style={{width:'90px'}}>担当営業</th>
                <th className="table-header" style={{width:'100px'}}>ステータス</th>
                <th className="table-header cursor-pointer select-none" style={{width:'90px'}} onClick={() => handleSort('interview_date')}>
                  面接日<SortIcon col="interview_date" />
                </th>
                <th className="table-header" style={{width:'60px'}}>書類選考</th>
                {docScreening === 'required' && (
                  <>
                    <th className="table-header" style={{width:'80px'}}>募集開始日</th>
                    <th className="table-header" style={{width:'90px'}}>履歴書送付日</th>
                  </>
                )}
                <th className="table-header" style={{width:'70px'}}>面接方法</th>
                <th className="table-header" style={{width:'60px'}}>メール送信</th>
                <th className="table-header" style={{width:'60px'}}>メール返信</th>
                <th className="table-header" style={{width:'60px'}}>電話確認</th>
                <th className="table-header" style={{width:'110px'}}>電話番号</th>
                <th className="table-header" style={{width:'70px'}}>通話ログ</th>
                <th className="table-header text-center" style={{width:'35px'}}>ログ確認</th>
                <th className="table-header text-center" style={{width:'35px'}}>求人済</th>
                <th className="table-header text-center" style={{width:'35px'}}>事前確認</th>
                {user?.role === 'admin' && <th className="table-header text-center" style={{width:'35px'}}></th>}
              </tr>
            </thead>
            <tbody>
              {projects.map(p => {
                const urgent = isUrgentUnconfirmed(p);
                // 行の色分け
                const hasMailOrPhone = p.mail_replied || p.phone_confirmed;
                const hasAllChecks = p.log_confirmed && p.job_posted && p.pre_confirmed;
                let rowBg = '';
                if (!hasMailOrPhone) {
                  rowBg = 'bg-amber-50/70'; // オレンジ: メール返信・電話確認どちらもなし
                } else if (!hasAllChecks) {
                  rowBg = 'bg-red-50/70'; // 赤: メール返信or電話確認あり、だがログ確認・求人済・事前確認のいずれかが未チェック
                }
                return (
                  <tr key={p.id} className={`border-b border-gray-100 hover:bg-blue-50/30 transition-colors cursor-pointer ${rowBg}`}
                    onClick={() => router.push(`/projects/${p.id}`)}>
                    <td className="table-cell text-gray-500 whitespace-nowrap">
                      {new Date(p.created_at).toLocaleDateString('ja-JP')}
                    </td>
                    <td className="table-cell truncate" title={p.owner_name}>{p.owner_name || '-'}</td>
                    <td className="table-cell text-gray-500 truncate" title={p.job_number || ''}>{p.job_number || '-'}</td>
                    <td className="table-cell font-medium" title={`${p.company_name || ''}${p.industry ? ' / ' + p.industry : ''}${pickPrefecture(p) ? ' / ' + pickPrefecture(p) : ''}`}>
                      <div className="truncate">{p.company_name}</div>
                      {(p.industry || pickPrefecture(p)) && (
                        <div className="text-[10px] text-gray-400 font-normal truncate">
                          {p.industry && <span>{p.industry}</span>}
                          {p.industry && pickPrefecture(p) && <span className="mx-1">/</span>}
                          {pickPrefecture(p) && <span>{pickPrefecture(p)}</span>}
                        </div>
                      )}
                    </td>
                    <td className="table-cell" onClick={e => e.stopPropagation()}>
                      <select
                        value={p.sales_user_id || ''}
                        onChange={e => handleSalesAssign(e, p.id)}
                        className={`select-no-arrow text-xs font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer text-center max-w-[80px] truncate ${
                          p.sales_user_id ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        <option value="">未割当</option>
                        {salesUsers.map(su => (
                          <option key={su.id} value={su.id}>{su.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="table-cell" onClick={e => e.stopPropagation()}>
                      <select
                        value={p.status || ''}
                        onChange={(e) => handleInlineStatusChange(e, p.id)}
                        className={`select-no-arrow text-xs font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer text-center ${STATUS_STYLES[p.status] || 'bg-gray-100 text-gray-500'}`}
                      >
                        <option value="">未設定</option>
                        {STATUS_OPTIONS.filter(s => s.value).map(s => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="table-cell text-gray-500 whitespace-nowrap">
                      {p.interview_date ? new Date(p.interview_date).toLocaleDateString('ja-JP') : '-'}
                    </td>
                    <td className="table-cell text-center whitespace-nowrap"
                        onClick={p.document_screening === 'required' ? (e => { e.stopPropagation(); openScreeningModal(p); }) : undefined}>
                      {p.document_screening === 'required' ? (() => {
                        const overdue = screeningOverdue(p);
                        const elapsed = daysSince(screeningBaseDate(p));
                        return (
                          <span className={`cursor-pointer hover:underline ${overdue ? 'text-red-600 font-bold' : 'text-gray-700'}`}
                                title="クリックで書類選考の詳細を記録">
                            あり{elapsed != null ? `(${elapsed}日)` : ''}
                          </span>
                        );
                      })() : p.document_screening === 'not_required' ? 'なし' : '-'}
                    </td>
                    {docScreening === 'required' && (
                      <>
                        <td className="table-cell text-gray-500 whitespace-nowrap">
                          {p.recruitment_start_date ? new Date(p.recruitment_start_date).toLocaleDateString('ja-JP') : '-'}
                        </td>
                        <td className="table-cell text-gray-500 whitespace-nowrap">
                          {p.resume_sent_date ? new Date(p.resume_sent_date).toLocaleDateString('ja-JP') : '-'}
                        </td>
                      </>
                    )}
                    <td className="table-cell whitespace-nowrap">
                      {p.interview_type === 'online' ? 'オンライン' : p.interview_type === 'in_person' ? '対面' : '-'}
                    </td>
                    {['mail_sent', 'mail_replied', 'phone_confirmed'].map(field => {
                      const val = p[field] ? p[field].slice(0, 10) : '';
                      const display = val ? `${parseInt(val.slice(5,7))}/${parseInt(val.slice(8,10))}` : '未';
                      const inputId = `date_${p.id}_${field}`;
                      return (
                        <td key={field} className={`table-cell text-center cursor-pointer hover:bg-blue-50 ${!val && urgent ? 'bg-red-50' : ''}`}
                          onClick={e => { e.stopPropagation(); document.getElementById(inputId)?.showPicker?.(); }}
                          style={{width:'55px',padding:'2px 4px'}}>
                          <span className={`text-xs ${val ? 'text-emerald-600 font-medium' : 'text-gray-400'}`}>{display}</span>
                          <input id={inputId} type="date" value={val}
                            onChange={async (e) => {
                              try {
                                await api.put(`/api/projects/${p.id}`, { [field]: e.target.value || null });
                                fetchProjects();
                              } catch (err) { toast.error('更新に失敗しました'); }
                            }}
                            className="sr-only"
                          />
                        </td>
                      );
                    })}
                    <td className="table-cell text-gray-600 whitespace-nowrap text-xs">{formatPhone(p.phone_number)}</td>
                    <td className="table-cell text-center">
                      <button
                        onClick={e => openCallLogs(e, p)}
                        className="px-2 py-1 text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded font-medium transition-colors"
                      >
                        表示
                      </button>
                    </td>
                    <td className="table-cell text-center" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={!!p.log_confirmed}
                        onChange={e => handleCheckboxToggle(p.id, 'log_confirmed', e.target.checked)}
                        className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded cursor-pointer" />
                    </td>
                    <td className="table-cell text-center" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={!!p.job_posted}
                        onChange={e => handleCheckboxToggle(p.id, 'job_posted', e.target.checked)}
                        className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded cursor-pointer" />
                    </td>
                    <td className="table-cell text-center" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={!!p.pre_confirmed}
                        onChange={e => handleCheckboxToggle(p.id, 'pre_confirmed', e.target.checked)}
                        className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded cursor-pointer" />
                    </td>
                    {user?.role === 'admin' && (
                      <td className="table-cell text-center" onClick={e => e.stopPropagation()}>
                        <button onClick={async () => {
                          if (!confirm(`「${p.company_name || p.legacy_company_name}」を削除しますか？この操作は元に戻せません。`)) return;
                          try {
                            await api.delete(`/api/projects/${p.id}`);
                            toast.success('案件を削除しました');
                            fetchProjects();
                          } catch (err) { toast.error('削除に失敗しました'); }
                        }} className="text-xs text-red-400 hover:text-red-600 transition-colors" title="削除">
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {projects.length === 0 && (
          <div className="text-center py-8 text-gray-400">案件がありません</div>
        )}
      </div>

      {pagination.totalPages > 1 && (() => {
        const tp = pagination.totalPages;
        const pages = [];
        const show = new Set([1, 2, tp - 1, tp, page - 1, page, page + 1]);
        for (let i = 1; i <= tp; i++) { if (show.has(i)) pages.push(i); }
        const items = [];
        let prev = 0;
        for (const p of pages) {
          if (p - prev > 1) items.push({ type: 'ellipsis', key: `e${p}` });
          items.push({ type: 'page', value: p, key: p });
          prev = p;
        }
        return (
          <div className="flex items-center justify-center gap-1 mt-4">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
              className="px-2 py-1 rounded text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-30">&lt;</button>
            {items.map(item => item.type === 'ellipsis' ? (
              <span key={item.key} className="px-1 text-gray-400 text-sm">...</span>
            ) : (
              <button key={item.key} onClick={() => setPage(item.value)}
                className={`min-w-[32px] px-2 py-1 rounded text-sm ${item.value === page ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{item.value}</button>
            ))}
            <button onClick={() => setPage(Math.min(tp, page + 1))} disabled={page === tp}
              className="px-2 py-1 rounded text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-30">&gt;</button>
            <span className="text-[10px] text-gray-400 ml-2">{page}/{tp}ページ ({pagination.total}件)</span>
          </div>
        );
      })()}

      {/* 通話ログモーダル */}
      {callLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCallLogModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-900">通話ログ</h2>
                <p className="text-sm text-gray-500 mt-0.5">{callLogModal.companyName}</p>
              </div>
              <button onClick={() => setCallLogModal(null)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {callLogsLoading ? (
                <div className="text-center py-12">
                  <svg className="animate-spin w-6 h-6 text-gray-400 mx-auto" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              ) : callLogs.length === 0 ? (
                <div className="text-center py-12 text-gray-400">通話ログがありません</div>
              ) : (
                <div className="space-y-3">
                  {callLogs.map((log) => {
                    const badge = RESULT_BADGES[log.result_code] || { bg: 'bg-gray-100', text: 'text-gray-500', label: log.result_code || '-' };
                    const isExpanded = expandedTranscript === log.id;
                    return (
                      <div key={log.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium text-gray-700">
                              {new Date(log.call_started_at).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
                              {badge.label}
                            </span>
                            <span className="text-xs text-gray-400">
                              {calcDuration(log.call_started_at, log.call_ended_at)}
                            </span>
                          </div>
                          <span className="text-xs text-gray-500">OP: {log.operator_name || '-'}</span>
                        </div>
                        {log.memo && (
                          <p className="text-sm text-gray-600 mb-2">
                            <span className="text-gray-400 text-xs mr-1">メモ:</span>{log.memo}
                          </p>
                        )}
                        {log.transcript && (
                          <div>
                            <button
                              onClick={() => setExpandedTranscript(isExpanded ? null : log.id)}
                              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
                            >
                              <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
                              </svg>
                              文字起こし{isExpanded ? 'を閉じる' : 'を表示'}
                            </button>
                            {isExpanded && (
                              <div className="mt-2 p-3 bg-gray-50 rounded-lg text-xs text-gray-700 whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
                                {log.transcript}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-gray-200 text-right">
              <span className="text-xs text-gray-400 mr-3">{callLogs.length}件の通話記録</span>
              <button onClick={() => setCallLogModal(null)}
                className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200 transition-colors">
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 内定者情報モーダル */}
      {hireModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setHireModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-blue-50 rounded-t-xl">
              <div className="flex items-center gap-2">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">内定者情報の入力</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{hireModal.companyName}</p>
                </div>
              </div>
              <button onClick={() => setHireModal(null)} className="p-2 hover:bg-white/60 rounded-lg transition-colors">
                <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="grid grid-cols-3 gap-3 bg-blue-50 p-3 rounded-lg border border-blue-200">
                <div>
                  <label className="text-xs text-blue-600 font-medium">内定日</label>
                  <input type="date" value={modalNaiteiDate} onChange={e => setModalNaiteiDate(e.target.value)} className="input text-sm mt-0.5" />
                </div>
                <div>
                  <label className="text-xs text-blue-600 font-medium">面接人数</label>
                  <input type="number" min="0" value={modalAttendees} onChange={e => setModalAttendees(e.target.value)} className="input text-sm mt-0.5" placeholder="人数" />
                </div>
                <div>
                  <label className="text-xs text-blue-600 font-medium">内定人数</label>
                  <select value={hireCount} onChange={(e) => handleHireCountChange(e.target.value)} className="input text-sm mt-0.5">
                    {[0,1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}名</option>)}
                  </select>
                </div>
              </div>
              {hires.map((hire, idx) => (
                <div key={idx} className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">{idx + 1}</span>
                    <span className="text-sm font-bold text-gray-800">内定者 {idx + 1}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-xs text-gray-500 font-medium">登録番号</label><input type="text" value={hire.registration_number || ''} onChange={(e) => updateHire(idx, 'registration_number', e.target.value)} className="input text-sm mt-0.5" placeholder="例: AB1234" /></div>
                    <div><label className="text-xs text-gray-500 font-medium">コース</label><select value={hire.course || '国内'} onChange={(e) => updateHire(idx, 'course', e.target.value)} className="input text-sm mt-0.5"><option value="国内">国内</option><option value="転職">転職</option><option value="海外">海外</option></select></div>
                    <div><label className="text-xs text-gray-500 font-medium">初回入金 (円)</label><input type="text" inputMode="numeric" value={hire.initial_payment || ''} onChange={(e) => updateHire(idx, 'initial_payment', e.target.value)} className="input text-sm mt-0.5" placeholder="200000" /></div>
                    <div><label className="text-xs text-gray-500 font-medium">見込売上 (円)</label><input type="text" inputMode="numeric" value={hire.expected_revenue || ''} onChange={(e) => updateHire(idx, 'expected_revenue', e.target.value)} className="input text-sm mt-0.5" placeholder="1000000" /></div>
                  </div>
                </div>
              ))}
              {hireCount === 0 && <div className="text-center py-8 text-gray-400"><p className="text-sm">内定人数を選択してください</p></div>}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              {hires.length > 0 && (
                <div className="text-xs text-gray-500 space-x-4">
                  <span>入金合計: <span className="font-bold text-gray-800">¥{hires.reduce((s, h) => s + (Number(h.initial_payment) || 0), 0).toLocaleString()}</span></span>
                  <span>売上合計: <span className="font-bold text-blue-700">¥{hires.reduce((s, h) => s + (Number(h.expected_revenue) || 0), 0).toLocaleString()}</span></span>
                </div>
              )}
              <div className="flex gap-2 ml-auto">
                <button onClick={() => setHireModal(null)} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">キャンセル</button>
                <button onClick={handleSaveHires} disabled={hireSaving || hireCount === 0} className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">{hireSaving ? '保存中...' : '保存する'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* 書類選考あり 詳細モーダル */}
      {screeningModal && (() => {
        const base = [screeningForm.recruitment_start_date, screeningForm.resume_sent_date].filter(Boolean).sort().slice(-1)[0] || null;
        const elapsed = daysSince(base);
        // 面接日が入っていれば経過アラートは出さない
        const overdue = elapsed != null && elapsed >= 4 && !screeningForm.interview_date;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setScreeningModal(null)}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-blue-50 rounded-t-xl">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">書類選考あり 詳細</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{screeningModal.companyName}</p>
                </div>
                <button onClick={() => setScreeningModal(null)} className="p-2 hover:bg-white/60 rounded-lg transition-colors">
                  <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="px-6 py-5 space-y-4">
                {/* 経過日（①または②の直近から） */}
                <div className={`rounded-lg p-3 text-center border ${overdue ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                  {elapsed != null ? (
                    <div>
                      <span className="text-xs text-gray-500">①募集開始 / ②履歴書送付 の直近から</span>
                      <div className={`text-2xl font-bold ${overdue ? 'text-red-600' : 'text-gray-800'}`}>{elapsed}日経過</div>
                      {overdue && <span className="text-xs text-red-600 font-medium">4日以上経過しています</span>}
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400">①または②の日付を入力すると経過日を表示します</span>
                  )}
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">① 募集開始日</label>
                  <input type="date" value={screeningForm.recruitment_start_date}
                    onChange={e => setScreeningForm(f => ({ ...f, recruitment_start_date: e.target.value }))}
                    className="input text-sm mt-0.5" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">② 企業に履歴書送付日</label>
                  <input type="date" value={screeningForm.resume_sent_date}
                    onChange={e => setScreeningForm(f => ({ ...f, resume_sent_date: e.target.value }))}
                    className="input text-sm mt-0.5" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">③ 面接日</label>
                  <input type="date" value={screeningForm.interview_date}
                    onChange={e => setScreeningForm(f => ({ ...f, interview_date: e.target.value }))}
                    className="input text-sm mt-0.5" />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
                <button onClick={() => setScreeningModal(null)} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">キャンセル</button>
                <button onClick={handleSaveScreening} disabled={screeningSaving}
                  className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {screeningSaving ? '保存中...' : '保存する'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 不合格時の面接人数入力モーダル */}
      {fugokakuModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setFugokakuModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 bg-red-50 rounded-t-xl">
              <h2 className="text-lg font-bold text-gray-900">面接結果: 不合格</h2>
              <p className="text-xs text-gray-500 mt-0.5">{fugokakuModal.companyName}</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="text-xs text-gray-600 font-medium">面接人数 *</label>
                <input type="number" min="1" value={fugokakuAttendees}
                  onChange={e => setFugokakuAttendees(e.target.value)}
                  className="input text-sm mt-1" placeholder="面接した人数" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setFugokakuModal(null)}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">キャンセル</button>
              <button
                onClick={async () => {
                  try {
                    await api.put(`/api/projects/${fugokakuModal.projectId}`, {
                      interview_attendees: fugokakuAttendees ? Number(fugokakuAttendees) : null,
                    });
                    toast.success('面接結果を保存しました');
                    setFugokakuModal(null);
                    fetchProjects();
                  } catch { toast.error('保存に失敗しました'); }
                }}
                disabled={!fugokakuAttendees}
                className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40">
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 手動案件追加モーダル */}
      {showManualAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowManualAdd(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 bg-emerald-50 rounded-t-xl">
              <h2 className="text-lg font-bold text-gray-900">案件を手動追加</h2>
              <p className="text-xs text-gray-500 mt-0.5">折り返し電話等、架電画面を経由しない案件獲得</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-gray-600 font-medium">企業名 *</label>
                  <input type="text" value={manualForm.company_name} onChange={e => setManualForm(f => ({ ...f, company_name: e.target.value }))}
                    className="input text-sm mt-0.5" placeholder="株式会社○○" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-medium">電話番号</label>
                  <input type="text" value={manualForm.phone_number} onChange={e => setManualForm(f => ({ ...f, phone_number: e.target.value }))}
                    className="input text-sm mt-0.5" placeholder="0312345678" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-medium">求人番号</label>
                  <input type="text" value={manualForm.job_number} onChange={e => setManualForm(f => ({ ...f, job_number: e.target.value }))}
                    className="input text-sm mt-0.5" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-medium">ステータス</label>
                  <select value={manualForm.status} onChange={e => setManualForm(f => ({ ...f, status: e.target.value }))} className="input text-sm mt-0.5">
                    <option value="">未選択</option>
                    <option value="BOSHUCHU">募集中</option>
                    <option value="MENSETSU_KAKUTEI">面接確定</option>
                    <option value="KEKKA_MACHI">結果待ち</option>
                    <option value="NAITEI">内定</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-medium">案件獲得日</label>
                  <input type="date" value={manualForm.created_date || ''} onChange={e => setManualForm(f => ({ ...f, created_date: e.target.value }))}
                    className="input text-sm mt-0.5" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-medium">面接日</label>
                  <input type="datetime-local" value={manualForm.interview_date} onChange={e => setManualForm(f => ({ ...f, interview_date: e.target.value }))}
                    className="input text-sm mt-0.5" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-medium">面接形式</label>
                  <select value={manualForm.interview_type} onChange={e => setManualForm(f => ({ ...f, interview_type: e.target.value }))} className="input text-sm mt-0.5">
                    <option value="">未選択</option>
                    <option value="online">オンライン</option>
                    <option value="in_person">対面</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-medium">担当者</label>
                  <input type="text" value={manualForm.contact_person} onChange={e => setManualForm(f => ({ ...f, contact_person: e.target.value }))}
                    className="input text-sm mt-0.5" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-medium">連絡先</label>
                  <input type="text" value={manualForm.contact_info} onChange={e => setManualForm(f => ({ ...f, contact_info: e.target.value }))}
                    className="input text-sm mt-0.5" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-600 font-medium">メモ</label>
                <textarea value={manualForm.memo} onChange={e => setManualForm(f => ({ ...f, memo: e.target.value }))}
                  className="input text-sm mt-0.5" rows={3} placeholder="折り返し電話の経緯など" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setShowManualAdd(false)} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">キャンセル</button>
              <button
                onClick={async () => {
                  if (!manualForm.company_name.trim()) { toast.error('企業名は必須です'); return; }
                  setManualSaving(true);
                  try {
                    await api.post('/api/projects/manual', { ...manualForm, call_type: callType, created_date: manualForm.created_date || null });
                    toast.success('案件を追加しました');
                    setShowManualAdd(false);
                    fetchProjects();
                  } catch (err) { toast.error(err.response?.data?.message || '追加に失敗しました'); }
                  finally { setManualSaving(false); }
                }}
                disabled={manualSaving || !manualForm.company_name.trim()}
                className="px-6 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-40">
                {manualSaving ? '保存中...' : '追加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </Layout>
  );
}
