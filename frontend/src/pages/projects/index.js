/**
 * 案件管理ページ (一覧)
 * 管理者と同じ表示項目
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const RESULT_BADGES = {
  NO_ANSWER: { bg: 'bg-gray-100', text: 'text-gray-600', label: '不通' },
  NG: { bg: 'bg-red-50', text: 'text-red-600', label: 'NG' },
  RECALL: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'リコール' },
  INTERESTED: { bg: 'bg-blue-50', text: 'text-blue-700', label: '興味あり' },
  PROJECT: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: '案件化' },
  SKIP: { bg: 'bg-gray-50', text: 'text-gray-400', label: 'SKIP' },
};

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

const getStatusLabel = (statusValue) => {
  const opt = STATUS_OPTIONS.find(s => s.value === statusValue);
  return opt ? opt.label : (statusValue || '-');
};

const formatPhone = (phone) => {
  if (!phone) return '-';
  return phone
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[ー－—―‐‑⁃₋−\-–\s　()（）.．+＋]/g, '');
};

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [pagination, setPagination] = useState({});
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [myOnly, setMyOnly] = useState(false);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // 担当営業フィルタ
  const [salesUsers, setSalesUsers] = useState([]);
  const [selectedSalesUser, setSelectedSalesUser] = useState('');

  // 通話ログモーダル
  const [callLogModal, setCallLogModal] = useState(null);
  const [callLogs, setCallLogs] = useState([]);
  const [callLogsLoading, setCallLogsLoading] = useState(false);
  const [expandedTranscript, setExpandedTranscript] = useState(null);

  // 内定者情報モーダル
  const [hireModal, setHireModal] = useState(null); // { projectId, companyName }
  const [hires, setHires] = useState([]);
  const [hireCount, setHireCount] = useState(1);
  const [hireSaving, setHireSaving] = useState(false);

  useEffect(() => {
    fetchSalesUsers();
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [statusFilter, selectedSalesUser, myOnly, dateFrom, dateTo, sortBy, sortOrder, page]);

  const fetchSalesUsers = async () => {
    try {
      const { data } = await api.get('/api/projects/sales-users');
      if (data.success) setSalesUsers(data.data);
    } catch (err) { /* ignore */ }
  };

  const fetchProjects = async () => {
    try {
      const params = new URLSearchParams({ page, limit: 20, sort_by: sortBy, sort_order: sortOrder });
      if (statusFilter) params.append('status', statusFilter);
      if (selectedSalesUser) params.append('sales_user_id', selectedSalesUser);
      if (myOnly) params.append('my_only', '1');
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      const { data } = await api.get(`/api/projects?${params}`);
      if (data.success) {
        setProjects(data.data.projects);
        setPagination(data.data.pagination);
      }
    } catch (err) {
      toast.error('案件の取得に失敗しました');
    } finally {
      setLoading(false);
    }
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

  const handleInlineStatusChange = async (e, projectId) => {
    e.stopPropagation();
    const newStatus = e.target.value;
    try {
      await api.put(`/api/projects/${projectId}`, { status: newStatus });
      const proj = projects.find(p => p.id === projectId);
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: newStatus } : p));
      toast.success('ステータスを更新しました');
      // 内定に変更したらモーダル表示
      if (newStatus === 'NAITEI') {
        openHireModal(projectId, proj?.company_name || '');
      }
    } catch (err) {
      toast.error('ステータスの更新に失敗しました');
    }
  };

  const openHireModal = async (projectId, companyName) => {
    setHireModal({ projectId, companyName });
    try {
      const { data } = await api.get(`/api/projects/${projectId}/hires`);
      const existing = data.data || [];
      if (existing.length > 0) {
        setHires(existing);
        setHireCount(existing.length);
      } else {
        setHires([{ registration_number: '', course: '国内', initial_payment: '', expected_revenue: '' }]);
        setHireCount(1);
      }
    } catch {
      setHires([{ registration_number: '', course: '国内', initial_payment: '', expected_revenue: '' }]);
      setHireCount(1);
    }
  };

  const handleHireCountChange = (count) => {
    const n = Math.max(0, Math.min(20, parseInt(count, 10) || 0));
    setHireCount(n);
    setHires(prev => {
      if (n > prev.length) {
        return [...prev, ...Array(n - prev.length).fill(null).map(() => ({
          registration_number: '', course: '国内', initial_payment: '', expected_revenue: '',
        }))];
      }
      return prev.slice(0, n);
    });
  };

  const updateHire = (index, field, value) => {
    if (field === 'initial_payment' || field === 'expected_revenue') {
      value = value.replace(/[^0-9]/g, '');
    }
    setHires(prev => prev.map((h, i) => i === index ? { ...h, [field]: value } : h));
  };

  const handleSaveHires = async () => {
    if (!hireModal) return;
    setHireSaving(true);
    try {
      await api.put(`/api/projects/${hireModal.projectId}/hires`, { hires });
      toast.success('内定者情報を保存しました');
      setHireModal(null);
    } catch (err) {
      toast.error('内定者情報の保存に失敗しました');
    } finally {
      setHireSaving(false);
    }
  };

  const calcDuration = (start, end) => {
    if (!start || !end) return '-';
    const sec = Math.round((new Date(end) - new Date(start)) / 1000);
    if (sec < 60) return `${sec}秒`;
    return `${Math.floor(sec / 60)}分${sec % 60}秒`;
  };

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">案件管理</h1>
          <p className="text-sm text-gray-400 mt-0.5">案件の一覧と進捗管理</p>
        </div>
        <button onClick={() => { setMyOnly(!myOnly); setPage(1); }}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            myOnly ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}>
          {myOnly ? '自分の案件のみ' : '全員の案件'}
        </button>
      </div>

      {/* フィルター */}
      <div className="card p-4 mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="input-label">ステータス</label>
          <select className="input text-sm" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="input-label">担当営業</label>
          <select className="input text-sm" value={selectedSalesUser} onChange={e => { setSelectedSalesUser(e.target.value); setPage(1); }}>
            <option value="">全員</option>
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
      </div>

      {/* テーブル */}
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-header cursor-pointer select-none" style={{width:'90px'}} onClick={() => handleSort('created_at')}>
                      獲得日<SortIcon col="created_at" />
                    </th>
                    <th className="table-header" style={{width:'80px'}}>担当OP</th>
                    <th className="table-header" style={{width:'90px'}}>求人番号</th>
                    <th className="table-header" style={{width:'160px'}}>企業名</th>
                    <th className="table-header" style={{width:'80px'}}>担当営業</th>
                    <th className="table-header" style={{width:'100px'}}>ステータス</th>
                    <th className="table-header cursor-pointer select-none" style={{width:'90px'}} onClick={() => handleSort('interview_date')}>
                      面接日<SortIcon col="interview_date" />
                    </th>
                    <th className="table-header" style={{width:'60px'}}>書類選考</th>
                    <th className="table-header" style={{width:'70px'}}>面接方法</th>
                    <th className="table-header" style={{width:'60px'}}>メール送信</th>
                    <th className="table-header" style={{width:'60px'}}>メール返信</th>
                    <th className="table-header" style={{width:'60px'}}>電話確認</th>
                    <th className="table-header" style={{width:'110px'}}>電話番号</th>
                    <th className="table-header" style={{width:'70px'}}>通話ログ</th>
                    <th className="table-header text-center" style={{width:'35px'}}>ログ確認</th>
                    <th className="table-header text-center" style={{width:'35px'}}>求人済</th>
                    <th className="table-header text-center" style={{width:'35px'}}>事前確認</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map(p => {
                    const urgent = isUrgentUnconfirmed(p);
                    return (
                      <tr key={p.id} className="border-b border-gray-100 hover:bg-blue-50/30 transition-colors cursor-pointer"
                        onClick={() => router.push(`/projects/${p.id}`)}>
                        <td className="table-cell text-gray-500 whitespace-nowrap">
                          {new Date(p.created_at).toLocaleDateString('ja-JP')}
                        </td>
                        <td className="table-cell truncate" title={p.owner_name}>{p.owner_name || '-'}</td>
                        <td className="table-cell text-gray-500 truncate" title={p.job_number || ''}>{p.job_number || '-'}</td>
                        <td className="table-cell font-medium truncate" title={p.company_name}>{p.company_name}</td>
                        <td className="table-cell truncate" title={p.sales_name}>{p.sales_name || '-'}</td>
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
                        <td className="table-cell text-center whitespace-nowrap">
                          {p.document_screening === 'required' ? 'あり' : p.document_screening === 'not_required' ? 'なし' : '-'}
                        </td>
                        <td className="table-cell whitespace-nowrap">
                          {p.interview_type === 'online' ? 'オンライン' : p.interview_type === 'in_person' ? '対面' : '-'}
                        </td>
                        <td className="table-cell text-center">
                          <span className={p.mail_sent ? 'text-emerald-600 font-medium' : 'text-gray-400'}>
                            {p.mail_sent ? '済' : '未'}
                          </span>
                        </td>
                        <td className={`table-cell text-center ${urgent ? 'bg-red-50' : ''}`}>
                          <span className={p.mail_replied ? 'text-emerald-600 font-medium' : urgent ? 'text-red-600 font-bold animate-pulse' : 'text-gray-400'}>
                            {p.mail_replied ? '済' : '未'}
                          </span>
                        </td>
                        <td className={`table-cell text-center ${urgent ? 'bg-red-50' : ''}`}>
                          <span className={p.phone_confirmed ? 'text-emerald-600 font-medium' : urgent ? 'text-red-600 font-bold animate-pulse' : 'text-gray-400'}>
                            {p.phone_confirmed ? '済' : '未'}
                          </span>
                        </td>
                        <td className="table-cell text-gray-600 whitespace-nowrap text-xs">{formatPhone(p.phone_number)}</td>
                        <td className="table-cell text-center">
                          <button
                            onClick={e => openCallLogs(e, p)}
                            className="px-2 py-1 text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded font-medium transition-colors"
                          >
                            表示
                          </button>
                        </td>
                        <td className="table-cell text-center">
                          <input type="checkbox" checked={!!p.log_confirmed} disabled
                            className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded opacity-60" />
                        </td>
                        <td className="table-cell text-center">
                          <input type="checkbox" checked={!!p.job_posted} disabled
                            className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded opacity-60" />
                        </td>
                        <td className="table-cell text-center">
                          <input type="checkbox" checked={!!p.pre_confirmed} disabled
                            className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded opacity-60" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {pagination.totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-4 py-4 border-t border-gray-100">
                {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setPage(p)}
                    className={`px-3 py-1 rounded text-sm ${p === page ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>{p}</button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

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
                            <span className="text-xs text-gray-400">{calcDuration(log.call_started_at, log.call_ended_at)}</span>
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
                <span className="text-xl">🎉</span>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">内定者情報の入力</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{hireModal.companyName}</p>
                </div>
              </div>
              <button onClick={() => setHireModal(null)} className="p-2 hover:bg-white/60 rounded-lg transition-colors">
                <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700">内定人数</label>
                <select value={hireCount} onChange={(e) => handleHireCountChange(e.target.value)} className="input w-24 text-sm">
                  {[0,1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}名</option>)}
                </select>
              </div>
              {hires.map((hire, idx) => (
                <div key={idx} className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">{idx + 1}</span>
                    <span className="text-sm font-bold text-gray-800">内定者 {idx + 1}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 font-medium">登録番号</label>
                      <input type="text" value={hire.registration_number || ''} onChange={(e) => updateHire(idx, 'registration_number', e.target.value)} className="input text-sm mt-0.5" placeholder="例: AB1234" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-medium">コース</label>
                      <select value={hire.course || '国内'} onChange={(e) => updateHire(idx, 'course', e.target.value)} className="input text-sm mt-0.5">
                        <option value="国内">国内</option>
                        <option value="転職">転職</option>
                        <option value="海外">海外</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-medium">初回入金 (円)</label>
                      <input type="text" inputMode="numeric" value={hire.initial_payment || ''} onChange={(e) => updateHire(idx, 'initial_payment', e.target.value)} className="input text-sm mt-0.5" placeholder="200000" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-medium">見込売上 (円)</label>
                      <input type="text" inputMode="numeric" value={hire.expected_revenue || ''} onChange={(e) => updateHire(idx, 'expected_revenue', e.target.value)} className="input text-sm mt-0.5" placeholder="1000000" />
                    </div>
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
                <button onClick={handleSaveHires} disabled={hireSaving || hireCount === 0} className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {hireSaving ? '保存中...' : '保存する'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
