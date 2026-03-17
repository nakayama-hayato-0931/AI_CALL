/**
 * 案件管理ページ (一覧)
 * 案件一覧・ステータスフィルター
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
  NAITEI: 'bg-emerald-50 text-emerald-700',
  FUGOKAKU: 'bg-red-50 text-red-600',
  KEKKA_MACHI: 'bg-orange-50 text-orange-700',
  MENSETSU_KAKUTEI: 'bg-violet-50 text-violet-700',
  BOSHUCHU: 'bg-blue-50 text-blue-700',
  SHORUI_CHU: 'bg-amber-50 text-amber-700',
  LOST: 'bg-gray-100 text-gray-500',
  BARASHI: 'bg-red-50 text-red-500',
  HORYU: 'bg-yellow-50 text-yellow-700',
  SHORUI_OCHI: 'bg-red-50 text-red-400',
  KISON_NASHI: 'bg-gray-50 text-gray-500',
  MODOSHI: 'bg-indigo-50 text-indigo-600',
  MODORI: 'bg-indigo-50 text-indigo-700',
};

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);

  // 通話ログモーダル
  const [callLogModal, setCallLogModal] = useState(null);
  const [callLogs, setCallLogs] = useState([]);
  const [callLogsLoading, setCallLogsLoading] = useState(false);
  const [expandedTranscript, setExpandedTranscript] = useState(null);

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

  const fetchProjects = async (page = 1) => {
    try {
      const params = { page, limit: 20 };
      if (statusFilter) params.status = statusFilter;
      const { data } = await api.get('/api/projects', { params });
      setProjects(data.data.projects);
      setPagination(data.data.pagination);
    } catch (err) {
      toast.error('案件の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [statusFilter]);

  return (
    <Layout>
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">案件管理</h1>
          <p className="text-sm text-gray-400 mt-0.5">案件の一覧と進捗管理</p>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input !w-auto min-w-[160px]"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="table-header">企業名</th>
                  <th className="table-header">電話番号</th>
                  <th className="table-header">担当OP</th>
                  <th className="table-header">担当営業</th>
                  <th className="table-header">面接日</th>
                  <th className="table-header">メール</th>
                  <th className="table-header">面接形式</th>
                  <th className="table-header">書類選考</th>
                  <th className="table-header">ステータス</th>
                  <th className="table-header text-center">通話ログ</th>
                  <th className="table-header text-center">詳細</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors cursor-pointer" onClick={() => router.push(`/projects/${p.id}`)}>
                    <td className="table-cell font-medium text-gray-900">{p.company_name}</td>
                    <td className="table-cell text-gray-600">{p.phone_number}</td>
                    <td className="table-cell text-gray-500">{p.owner_name || '-'}</td>
                    <td className="table-cell text-gray-500">{p.sales_name || '-'}</td>
                    <td className="table-cell text-gray-500">
                      {p.interview_date ? new Date(p.interview_date).toLocaleString('ja-JP') : '-'}
                    </td>
                    <td className="table-cell">
                      {p.mail_sent ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                          送信済
                        </span>
                      ) : (
                        <span className="text-gray-400">未送信</span>
                      )}
                    </td>
                    <td className="table-cell text-gray-500">
                      {p.interview_type === 'online' ? 'オンライン' : p.interview_type === 'in_person' ? '対面' : '-'}
                    </td>
                    <td className="table-cell text-gray-500">
                      {p.document_screening === 'required' ? 'あり' : p.document_screening === 'not_required' ? 'なし' : '-'}
                    </td>
                    <td className="table-cell">
                      <span className={`badge ${STATUS_STYLES[p.status] || 'bg-gray-100 text-gray-500'}`}>
                        {STATUS_OPTIONS.find((s) => s.value === p.status)?.label || p.status}
                      </span>
                    </td>
                    <td className="table-cell text-center">
                      <button
                        onClick={e => openCallLogs(e, p)}
                        className="px-2 py-1 text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded font-medium transition-colors"
                      >
                        表示
                      </button>
                    </td>
                    <td className="table-cell text-center">
                      <svg className="w-4 h-4 text-gray-400 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {pagination.totalPages > 1 && (
              <div className="flex justify-center gap-1.5 py-4 border-t border-gray-100">
                {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={(e) => { e.stopPropagation(); fetchProjects(page); }}
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
    </Layout>
  );
}
