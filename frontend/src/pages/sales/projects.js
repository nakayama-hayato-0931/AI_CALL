import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const STATUS_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'NAITEI', label: '内定' },
  { value: 'KETTEI', label: '決定' },
  { value: 'LOST', label: '失注' },
  { value: 'BARASHI', label: 'バラシ' },
  { value: 'FUGOKAKU', label: '不合格' },
  { value: 'JUKEN', label: '受験' },
  { value: 'BOSHUCHU', label: '募集中' },
  { value: 'MENSETSU_KAKUTEI', label: '面接確定' },
  { value: 'KEKKA_MACHI', label: '結果待ち' },
  { value: 'MODOSHI', label: '戻し' },
  { value: 'MODORI', label: '戻り' },
  { value: 'KISON_NASHI', label: '既存対応なし' },
  { value: 'SHORUI_OCHI', label: '書類選考落ち' },
  { value: 'SHORUI_CHU', label: '書類選考中' },
  { value: 'NEW', label: '新規' },
  { value: 'HIRED', label: '成約' },
];

const STATUS_STYLES = {
  NAITEI:           'bg-blue-600 text-white',
  KETTEI:           'bg-blue-600 text-white',
  LOST:             'bg-gray-800 text-white',
  BARASHI:          'bg-gray-800 text-white',
  FUGOKAKU:         'bg-red-600 text-white',
  JUKEN:            'bg-orange-100 text-orange-700',
  BOSHUCHU:         'bg-teal-100 text-teal-700',
  MENSETSU_KAKUTEI: 'bg-pink-500 text-white',
  KEKKA_MACHI:      'bg-pink-500 text-white',
  MODOSHI:          'bg-yellow-400 text-yellow-900',
  MODORI:           'bg-emerald-500 text-white',
  KISON_NASHI:      'bg-gray-800 text-white',
  SHORUI_OCHI:      'bg-gray-800 text-white',
  SHORUI_CHU:       'bg-pink-200 text-pink-800',
  NEW:              'bg-blue-100 text-blue-700',
  HIRED:            'bg-emerald-100 text-emerald-700',
  MAIL_SENT:        'bg-cyan-100 text-cyan-700',
  INTERVIEW_SET:    'bg-purple-100 text-purple-700',
  INTERVIEW_DONE:   'bg-indigo-100 text-indigo-700',
  WAITING_RESULT:   'bg-amber-100 text-amber-700',
};

const getStatusLabel = (statusValue) => {
  const opt = STATUS_OPTIONS.find(s => s.value === statusValue);
  return opt ? opt.label : statusValue;
};

// 電話番号を半角数字のみに正規化
const formatPhone = (phone) => {
  if (!phone) return '-';
  return phone
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[ー－—―‐‑⁃₋−\-–\s　()（）.．+＋]/g, '');
};

export default function SalesProjects() {
  const { user } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [pagination, setPagination] = useState({});
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (user && user.role !== 'sales') { router.push('/'); return; }
  }, [user]);

  useEffect(() => {
    if (user) fetchProjects();
  }, [user, status, dateFrom, dateTo, sortBy, sortOrder, page]);

  const fetchProjects = async () => {
    try {
      const params = new URLSearchParams({ page, limit: 20, sort_by: sortBy, sort_order: sortOrder });
      if (status) params.append('status', status);
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
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
    return <span className="text-blue-600 ml-0.5">{sortOrder === 'asc' ? '▲' : '▼'}</span>;
  };

  if (!user || user.role !== 'sales') return null;

  return (
    <Layout>
      <h1 className="text-xl font-bold text-gray-900 mb-6">案件一覧</h1>

      {/* フィルター */}
      <div className="card p-4 mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="input-label">ステータス</label>
          <select className="input text-sm" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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
                <th className="table-header" style={{width:'100px'}}>ステータス</th>
                <th className="table-header cursor-pointer select-none" style={{width:'90px'}} onClick={() => handleSort('interview_date')}>
                  面接日<SortIcon col="interview_date" />
                </th>
                <th className="table-header" style={{width:'70px'}}>面接方法</th>
                <th className="table-header" style={{width:'60px'}}>メール送信</th>
                <th className="table-header" style={{width:'60px'}}>メール返信</th>
                <th className="table-header" style={{width:'60px'}}>電話確認</th>
                <th className="table-header" style={{width:'110px'}}>電話番号</th>
              </tr>
            </thead>
            <tbody>
              {projects.map(p => (
                <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50/50 cursor-pointer"
                  onClick={() => router.push(`/projects/${p.id}`)}>
                  <td className="table-cell text-gray-500 whitespace-nowrap">
                    {new Date(p.created_at).toLocaleDateString('ja-JP')}
                  </td>
                  <td className="table-cell truncate" title={p.owner_name}>{p.owner_name || '-'}</td>
                  <td className="table-cell text-gray-500 truncate" title={p.job_number || ''}>{p.job_number || '-'}</td>
                  <td className="table-cell font-medium truncate" title={p.company_name}>{p.company_name}</td>
                  <td className="table-cell">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_STYLES[p.status] || 'bg-gray-100 text-gray-500'}`}>
                      {getStatusLabel(p.status)}
                    </span>
                  </td>
                  <td className="table-cell text-gray-500 whitespace-nowrap">
                    {p.interview_date ? new Date(p.interview_date).toLocaleDateString('ja-JP') : '-'}
                  </td>
                  <td className="table-cell whitespace-nowrap">
                    {p.interview_type === 'online' ? 'オンライン' : p.interview_type === 'in_person' ? '対面' : '-'}
                  </td>
                  <td className="table-cell text-center">
                    <span className={p.mail_sent ? 'text-emerald-600 font-medium' : 'text-gray-400'}>
                      {p.mail_sent ? '済' : '未'}
                    </span>
                  </td>
                  <td className="table-cell text-center">
                    <span className={p.mail_replied ? 'text-emerald-600 font-medium' : 'text-gray-400'}>
                      {p.mail_replied ? '済' : '未'}
                    </span>
                  </td>
                  <td className="table-cell text-center">
                    <span className={p.phone_confirmed ? 'text-emerald-600 font-medium' : 'text-gray-400'}>
                      {p.phone_confirmed ? '済' : '未'}
                    </span>
                  </td>
                  <td className="table-cell text-gray-600 whitespace-nowrap text-xs">{formatPhone(p.phone_number)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {projects.length === 0 && (
          <div className="text-center py-8 text-gray-400">案件がありません</div>
        )}
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`px-3 py-1 rounded text-sm ${p === page ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>{p}</button>
          ))}
        </div>
      )}
    </Layout>
  );
}
