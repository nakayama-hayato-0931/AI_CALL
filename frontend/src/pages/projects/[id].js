/**
 * 案件詳細ページ
 * 企業情報・案件化日時・面接情報・ステータス更新
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const STATUS_OPTIONS = [
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

export default function ProjectDetailPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { id } = router.query;
  const isSales = user?.role === 'sales';
  const isOperator = user?.role === 'operator';
  const isAdmin = ['admin', 'manager', 'consultant'].includes(user?.role);
  const listUrl = isSales ? '/sales/projects' : (isAdmin ? '/admin/projects' : '/projects');
  const [project, setProject] = useState(null);
  const [callHistory, setCallHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    status: '', interview_date: '', interview_type: '', interview_attendees: '', naitei_date: '',
    document_screening: '', mail_sent: '', mail_replied: '', phone_confirmed: '', job_number: '', memo: '',
    contact_person: '', contact_phone: '', contact_email: '', dashboard_checked: false,
  });
  const [companyForm, setCompanyForm] = useState({
    company_name: '', industry: '', address: '',
  });
  const [companyEditing, setCompanyEditing] = useState(false);
  const [expandedTranscript, setExpandedTranscript] = useState(null);

  // 内定者情報
  const [hires, setHires] = useState([]);
  const [hireCount, setHireCount] = useState(0);
  const [hireEditing, setHireEditing] = useState(false);
  const [hireSaving, setHireSaving] = useState(false);
  const [showHireModal, setShowHireModal] = useState(false);
  const [showFugokakuModal, setShowFugokakuModal] = useState(false);

  useEffect(() => {
    if (id) {
      fetchProject();
      fetchHires();
    }
  }, [id]);

  const fetchHires = async () => {
    try {
      const { data } = await api.get(`/api/projects/${id}/hires`);
      const hiresData = data.data || [];
      setHires(hiresData);
      setHireCount(hiresData.length);
    } catch (err) {
      // サイレント
    }
  };

  const handleSaveHires = async () => {
    setHireSaving(true);
    try {
      await api.put(`/api/projects/${id}/hires`, { hires });
      // 内定日・面接人数も同時に保存
      await api.put(`/api/projects/${id}`, {
        naitei_date: form.naitei_date || null,
        interview_attendees: form.interview_attendees ? Number(form.interview_attendees) : null,
      });
      toast.success('内定者情報を保存しました');
      setHireEditing(false);
      setShowHireModal(false);
      fetchHires();
      fetchProject();
    } catch (err) {
      toast.error('内定者情報の保存に失敗しました');
    } finally {
      setHireSaving(false);
    }
  };

  const updateHire = (index, field, value) => {
    // 金額フィールドは半角数字のみ許可
    if (field === 'initial_payment' || field === 'expected_revenue') {
      value = value.replace(/[^0-9]/g, '');
    }
    // 取消チェック時に金額を0に
    if (field === 'is_cancelled' && value) {
      setHires(prev => prev.map((h, i) => i === index ? { ...h, is_cancelled: true, initial_payment: '0', expected_revenue: '0' } : h));
      return;
    }
    setHires(prev => prev.map((h, i) => i === index ? { ...h, [field]: value } : h));
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

  const openHireModal = () => {
    if (hires.length === 0) {
      setHireCount(1);
      setHires([{ registration_number: '', course: '国内', initial_payment: '', expected_revenue: '' }]);
    }
    setHireEditing(true);
    setShowHireModal(true);
  };

  const fetchProject = async () => {
    try {
      const { data } = await api.get(`/api/projects/${id}`);
      const p = data.data.project;
      setProject(p);
      setCallHistory(data.data.callHistory || []);
      setForm({
        status: p.status || '',
        interview_date: p.interview_date ? p.interview_date.slice(0, 16) : '',
        interview_type: p.interview_type || '',
        interview_attendees: p.interview_attendees || '',
        naitei_date: p.naitei_date ? p.naitei_date.slice(0, 10) : '',
        document_screening: p.document_screening || '',
        mail_sent: p.mail_sent ? p.mail_sent.slice(0, 10) : '',
        mail_replied: p.mail_replied ? p.mail_replied.slice(0, 10) : '',
        phone_confirmed: p.phone_confirmed ? p.phone_confirmed.slice(0, 10) : '',
        job_number: p.job_number || '',
        memo: p.memo || '',
        contact_person: p.contact_person || '',
        contact_phone: p.contact_phone || '',
        contact_email: p.contact_email || '',
        dashboard_checked: !!p.dashboard_checked,
      });
      setCompanyForm({
        company_name: p.company_name || '',
        industry: p.industry || '',
        address: p.address || '',
      });
    } catch (err) {
      toast.error('案件の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    try {
      await api.put(`/api/projects/${id}`, {
        ...form,
        interview_date: form.interview_date || null,
        interview_type: form.interview_type || null,
        interview_attendees: form.interview_attendees ? Number(form.interview_attendees) : null,
        naitei_date: form.naitei_date || null,
        document_screening: form.document_screening || null,
        job_number: form.job_number || null,
        mail_sent: form.mail_sent || null,
        mail_replied: form.mail_replied || null,
        phone_confirmed: form.phone_confirmed || null,
      });
      toast.success('案件を更新しました');
      router.push(listUrl);
    } catch (err) {
      toast.error('更新に失敗しました');
    }
  };

  const handleCompanyUpdate = async () => {
    try {
      await api.put(`/api/projects/${id}`, {
        company_name: companyForm.company_name || null,
        industry: companyForm.industry || null,
        address: companyForm.address || null,
      });
      toast.success('企業情報を更新しました');
      setCompanyEditing(false);
      fetchProject();
    } catch (err) {
      toast.error('更新に失敗しました');
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3 text-gray-400">
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm">読み込み中...</span>
          </div>
        </div>
      </Layout>
    );
  }

  if (!project) {
    return (
      <Layout>
        <div className="card p-12 text-center">
          <p className="text-red-500">案件が見つかりません</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">案件詳細</h1>
          <p className="text-sm text-gray-400 mt-0.5">{project.company_name}</p>
        </div>
        <button
          onClick={() => router.push(listUrl)}
          className="btn-secondary !py-2 flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          一覧に戻る
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 左: 企業情報 & 案件編集 */}
        <div className="space-y-5">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-gray-800">企業情報</h2>
              {!isSales && !companyEditing && (
                <button onClick={() => setCompanyEditing(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                  編集
                </button>
              )}
            </div>
            {companyEditing ? (
              <div className="space-y-3">
                <div>
                  <label className="input-label">企業名</label>
                  <input type="text" value={companyForm.company_name}
                    onChange={e => setCompanyForm({...companyForm, company_name: e.target.value})}
                    className="input" />
                </div>
                <div className="text-sm">
                  <span className="text-xs text-gray-400">電話番号</span>
                  <p className="font-medium text-gray-800 mt-0.5">{project.phone_number || '-'}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="input-label">業種</label>
                    <input type="text" value={companyForm.industry}
                      onChange={e => setCompanyForm({...companyForm, industry: e.target.value})}
                      className="input" />
                  </div>
                  <div>
                    <label className="input-label">住所</label>
                    <input type="text" value={companyForm.address}
                      onChange={e => setCompanyForm({...companyForm, address: e.target.value})}
                      className="input" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <div className="text-sm">
                    <span className="text-xs text-gray-400">担当OP</span>
                    <p className="font-medium text-gray-800 mt-0.5">{project.owner_name || '-'}</p>
                  </div>
                  <div className="text-sm">
                    <span className="text-xs text-gray-400">担当営業</span>
                    <p className="font-medium text-gray-800 mt-0.5">{project.sales_name || '-'}</p>
                  </div>
                </div>
                <div className="text-sm">
                  <span className="text-xs text-gray-400">案件化日時</span>
                  <p className="font-medium text-gray-800 mt-0.5">
                    {new Date(project.created_at).toLocaleString('ja-JP')}
                  </p>
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={handleCompanyUpdate} className="btn-primary text-sm !py-1.5 flex-1">保存</button>
                  <button onClick={() => { setCompanyEditing(false); setCompanyForm({ company_name: project.company_name || '', industry: project.industry || '', address: project.address || '' }); }}
                    className="btn-secondary text-sm !py-1.5 flex-1">キャンセル</button>
                </div>
              </div>
            ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {[
                { label: '企業名', value: project.company_name },
                { label: '電話番号', value: project.phone_number },
                { label: '業種', value: project.industry },
                { label: '住所', value: project.address || project.region },
                { label: '担当OP', value: project.owner_name },
                { label: '担当営業', value: project.sales_name },
              ].map((item) => (
                <div key={item.label} className="text-sm">
                  <span className="text-xs text-gray-400">{item.label}</span>
                  <p className="font-medium text-gray-800 mt-0.5">{item.value || '-'}</p>
                </div>
              ))}
              <div className="text-sm col-span-2">
                <span className="text-xs text-gray-400">案件化日時</span>
                <p className="font-medium text-gray-800 mt-0.5">
                  {new Date(project.created_at).toLocaleString('ja-JP')}
                </p>
              </div>
            </div>
            )}
          </div>

          <div className="card p-5">
              <h2 className="text-sm font-bold text-gray-800 mb-4">案件編集</h2>
              <div className="space-y-4">
                <div>
                  <label className="input-label">ステータス</label>
                  <select
                    value={form.status || ''}
                    onChange={(e) => {
                      const newStatus = e.target.value;
                      setForm({ ...form, status: newStatus });
                      // 内定選択時にモーダルを自動表示（オペレーター以外、2026年3月以降の案件のみ）
                      if (newStatus === 'NAITEI' && !isOperator && project?.created_at && new Date(project.created_at) >= new Date('2026-03-01')) {
                        setTimeout(() => openHireModal(), 100);
                      }
                      // 不合格選択時に面接人数モーダルを自動表示
                      if (newStatus === 'FUGOKAKU') {
                        setTimeout(() => setShowFugokakuModal(true), 100);
                      }
                    }}
                    className="input"
                  >
                    <option value="">未選択</option>
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="input-label">求人番号</label>
                  <input
                    type="text"
                    value={form.job_number}
                    onChange={(e) => setForm({ ...form, job_number: e.target.value })}
                    className="input"
                    placeholder="求人番号を入力"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="input-label">企業担当者</label>
                    <input type="text" value={form.contact_person}
                      onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                      className="input" placeholder="担当者名" />
                  </div>
                  <div>
                    <label className="input-label">担当者電話番号</label>
                    <input type="text" value={form.contact_phone}
                      onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                      className="input" placeholder="090-xxxx-xxxx" />
                  </div>
                  <div>
                    <label className="input-label">担当者メール</label>
                    <input type="email" value={form.contact_email}
                      onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                      className="input" placeholder="email@example.com" />
                  </div>
                </div>

                <div className="flex items-center gap-2 py-2">
                  <input
                    type="checkbox"
                    id="dashboard_checked"
                    checked={form.dashboard_checked}
                    onChange={(e) => setForm({ ...form, dashboard_checked: e.target.checked })}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded cursor-pointer"
                  />
                  <label htmlFor="dashboard_checked" className="text-sm text-gray-700 cursor-pointer">ダッシュボード記入済</label>
                </div>

                <div>
                  <label className="input-label">面接日時</label>
                  <input
                    type="datetime-local"
                    value={form.interview_date}
                    onChange={(e) => setForm({ ...form, interview_date: e.target.value })}
                    className="input"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="input-label">面接形式</label>
                    <select
                      value={form.interview_type}
                      onChange={(e) => setForm({ ...form, interview_type: e.target.value })}
                      className="input"
                    >
                      <option value="">未選択</option>
                      <option value="online">オンライン</option>
                      <option value="in_person">対面</option>
                    </select>
                  </div>
                  <div>
                    <label className="input-label">面接人数</label>
                    <input
                      type="number" min="0"
                      value={form.interview_attendees}
                      onChange={(e) => setForm({ ...form, interview_attendees: e.target.value })}
                      className="input"
                      placeholder="人数"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="input-label">内定日</label>
                    <input
                      type="date"
                      value={form.naitei_date}
                      onChange={(e) => setForm({ ...form, naitei_date: e.target.value })}
                      className="input"
                    />
                  </div>
                  <div></div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="input-label">書類選考</label>
                    <select
                      value={form.document_screening}
                      onChange={(e) => setForm({ ...form, document_screening: e.target.value })}
                      className="input"
                    >
                      <option value="">未選択</option>
                      <option value="required">あり</option>
                      <option value="not_required">なし</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="input-label">メール送信日</label>
                    <input type="date" value={form.mail_sent || ''} onChange={(e) => setForm({ ...form, mail_sent: e.target.value || null })} className="input" />
                  </div>
                  <div>
                    <label className="input-label">メール返信日</label>
                    <input type="date" value={form.mail_replied || ''} onChange={(e) => setForm({ ...form, mail_replied: e.target.value || null })} className="input" />
                  </div>
                  <div>
                    <label className="input-label">電話確認日</label>
                    <input type="date" value={form.phone_confirmed || ''} onChange={(e) => setForm({ ...form, phone_confirmed: e.target.value || null })} className="input" />
                  </div>
                </div>

                <div>
                  <label className="input-label">メモ</label>
                  <textarea
                    value={form.memo}
                    onChange={(e) => setForm({ ...form, memo: e.target.value })}
                    rows={3}
                    className="input resize-none"
                  />
                </div>

                <button onClick={handleUpdate} className="btn-primary w-full">
                  更新する
                </button>
              </div>
            </div>

          {/* 内定者情報サマリー（オペレーター以外に表示） */}
          {!isOperator && (
            <div className={`card p-5 ${form.status === 'NAITEI' ? 'ring-2 ring-blue-400 bg-blue-50/30' : ''}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-gray-800">内定者情報</h2>
                  {hires.length > 0 && (
                    <span className="text-xs font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">{hires.length}名</span>
                  )}
                </div>
                <button
                  onClick={openHireModal}
                  className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  {hires.length > 0 ? '編集' : '入力'}
                </button>
              </div>

              {hires.length > 0 ? (
                <div className="space-y-2">
                  {hires.map((hire, idx) => (
                    <div key={idx} className={`bg-white rounded-lg p-2.5 border flex items-center justify-between text-xs ${hire.is_cancelled ? 'border-red-200 bg-red-50/50 opacity-60' : 'border-gray-100'}`}>
                      <div className="flex items-center gap-3">
                        <span className={`font-bold ${hire.is_cancelled ? 'text-red-400' : 'text-blue-600'}`}>#{idx + 1}</span>
                        <span className={`font-medium ${hire.is_cancelled ? 'text-red-400 line-through' : 'text-gray-700'}`}>{hire.registration_number || '-'}</span>
                        <span className="text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{hire.course}</span>
                        {hire.is_cancelled ? <span className="text-[10px] font-bold text-red-500 bg-red-100 px-1.5 py-0.5 rounded">取消</span> : null}
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-gray-500">入金 <span className={`font-bold ${hire.is_cancelled ? 'text-red-400' : 'text-gray-800'}`}>{hire.initial_payment != null ? `¥${Number(hire.initial_payment).toLocaleString()}` : '-'}</span></span>
                        <span className="text-gray-500">売上 <span className={`font-bold ${hire.is_cancelled ? 'text-red-400' : 'text-blue-700'}`}>{hire.expected_revenue != null ? `¥${Number(hire.expected_revenue).toLocaleString()}` : '-'}</span></span>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-end gap-6 pt-1 text-xs">
                    <span className="text-gray-500">入金合計 <span className="font-bold text-gray-900">¥{hires.filter(h => !h.is_cancelled).reduce((s, h) => s + (Number(h.initial_payment) || 0), 0).toLocaleString()}</span></span>
                    <span className="text-gray-500">売上合計 <span className="font-bold text-blue-700">¥{hires.filter(h => !h.is_cancelled).reduce((s, h) => s + (Number(h.expected_revenue) || 0), 0).toLocaleString()}</span></span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400 text-center py-3">内定者情報が未入力です。「入力」ボタンから登録してください。</p>
              )}
            </div>
          )}
        </div>

        {/* 右: 通話履歴 */}
        <div className="card p-5">
          <h2 className="text-sm font-bold text-gray-800 mb-4">通話履歴</h2>
          <div className="space-y-2.5 max-h-[640px] overflow-y-auto">
            {callHistory.length === 0 ? (
              <div className="py-8 text-center">
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-2">
                  <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-400">通話履歴なし</p>
              </div>
            ) : (
              callHistory.map((call) => (
                <div key={call.id} className="bg-gray-50/80 rounded-lg p-3.5">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs text-gray-400">
                      {new Date(call.call_started_at).toLocaleString('ja-JP')}
                    </span>
                    <span className="text-xs font-bold text-gray-700 bg-white px-2 py-0.5 rounded">
                      {call.result_code || '-'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">担当: {call.operator_name || '-'}</p>
                  {call.memo && (
                    <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">{call.memo}</p>
                  )}
                  {call.transcript && (
                    <div className="mt-2">
                      <button
                        onClick={() => setExpandedTranscript(expandedTranscript === call.id ? null : call.id)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                        {expandedTranscript === call.id ? '通話ログを閉じる' : '通話ログを表示'}
                      </button>
                      {expandedTranscript === call.id && (
                        <div className="mt-2 bg-white border border-gray-200 rounded-lg p-3 max-h-80 overflow-y-auto">
                          <pre className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">{call.transcript}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      {/* 内定者情報入力モーダル */}
      {showHireModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setShowHireModal(false); fetchHires(); }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-blue-50 rounded-t-xl">
              <div className="flex items-center gap-2">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">内定者情報の入力</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{project?.company_name}</p>
                </div>
              </div>
              <button onClick={() => { setShowHireModal(false); fetchHires(); }} className="p-2 hover:bg-white/60 rounded-lg transition-colors">
                <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {/* 内定日・面接人数 */}
              <div className="grid grid-cols-3 gap-3 bg-blue-50 p-3 rounded-lg border border-blue-200">
                <div>
                  <label className="text-xs text-blue-600 font-medium">内定日 *</label>
                  <input type="date" value={form.naitei_date}
                    onChange={(e) => setForm({ ...form, naitei_date: e.target.value })}
                    className="input text-sm mt-0.5" />
                </div>
                <div>
                  <label className="text-xs text-blue-600 font-medium">面接人数</label>
                  <input type="number" min="0" value={form.interview_attendees}
                    onChange={(e) => setForm({ ...form, interview_attendees: e.target.value })}
                    className="input text-sm mt-0.5" placeholder="人数" />
                </div>
                <div>
                  <label className="text-xs text-blue-600 font-medium">内定人数</label>
                  <select value={hireCount}
                    onChange={(e) => handleHireCountChange(e.target.value)}
                    className="input text-sm mt-0.5">
                    {[0,1,2,3,4,5,6,7,8,9,10].map(n => (
                      <option key={n} value={n}>{n}名</option>
                    ))}
                  </select>
                </div>
              </div>

              {hires.map((hire, idx) => (
                <div key={idx} className={`border rounded-xl p-4 space-y-3 ${hire.is_cancelled ? 'bg-red-50/50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${hire.is_cancelled ? 'bg-red-400' : 'bg-blue-600'}`}>{idx + 1}</span>
                      <span className={`text-sm font-bold ${hire.is_cancelled ? 'text-red-500 line-through' : 'text-gray-800'}`}>内定者 {idx + 1}</span>
                      {hire.is_cancelled && <span className="text-[10px] font-bold text-red-500 bg-red-100 px-1.5 py-0.5 rounded">取消</span>}
                    </div>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!!hire.is_cancelled}
                        onChange={(e) => updateHire(idx, 'is_cancelled', e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-red-500 focus:ring-red-400"
                      />
                      <span className="text-xs text-red-500 font-medium">取消/辞退</span>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 font-medium">登録番号</label>
                      <input
                        type="text"
                        value={hire.registration_number || ''}
                        onChange={(e) => updateHire(idx, 'registration_number', e.target.value)}
                        className="input text-sm mt-0.5"
                        placeholder="例: AB1234"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-medium">コース</label>
                      <select
                        value={hire.course || '国内'}
                        onChange={(e) => updateHire(idx, 'course', e.target.value)}
                        className="input text-sm mt-0.5"
                      >
                        <option value="国内">国内</option>
                        <option value="転職">転職</option>
                        <option value="海外">海外</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-medium">初回入金 (円)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={hire.initial_payment != null ? String(hire.initial_payment) : ''}
                        onChange={(e) => updateHire(idx, 'initial_payment', e.target.value)}
                        className="input text-sm mt-0.5"
                        placeholder="200000"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-medium">見込売上 (円)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={hire.expected_revenue != null ? String(hire.expected_revenue) : ''}
                        onChange={(e) => updateHire(idx, 'expected_revenue', e.target.value)}
                        className="input text-sm mt-0.5"
                        placeholder="1000000"
                      />
                    </div>
                  </div>
                </div>
              ))}

              {hireCount === 0 && (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-sm">内定人数を選択してください</p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              {hires.length > 0 && (
                <div className="text-xs text-gray-500 space-x-4">
                  <span>入金合計: <span className="font-bold text-gray-800">¥{hires.filter(h => !h.is_cancelled).reduce((s, h) => s + (Number(h.initial_payment) || 0), 0).toLocaleString()}</span></span>
                  <span>売上合計: <span className="font-bold text-blue-700">¥{hires.filter(h => !h.is_cancelled).reduce((s, h) => s + (Number(h.expected_revenue) || 0), 0).toLocaleString()}</span></span>
                </div>
              )}
              <div className="flex gap-2 ml-auto">
                <button
                  onClick={() => { setShowHireModal(false); fetchHires(); }}
                  className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >キャンセル</button>
                <button
                  onClick={handleSaveHires}
                  disabled={hireSaving || hireCount === 0}
                  className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {hireSaving ? '保存中...' : '保存する'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 不合格時の面接人数入力モーダル */}
      {showFugokakuModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowFugokakuModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 bg-red-50 rounded-t-xl">
              <h2 className="text-lg font-bold text-gray-900">面接結果: 不合格</h2>
              <p className="text-xs text-gray-500 mt-0.5">{project?.company_name}</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="text-xs text-gray-600 font-medium">面接人数 *</label>
                <input type="number" min="1" value={form.interview_attendees}
                  onChange={(e) => setForm({ ...form, interview_attendees: e.target.value })}
                  className="input text-sm mt-1" placeholder="面接した人数" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setShowFugokakuModal(false)}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">キャンセル</button>
              <button
                onClick={async () => {
                  try {
                    await api.put(`/api/projects/${id}`, {
                      status: 'FUGOKAKU',
                      interview_attendees: form.interview_attendees ? Number(form.interview_attendees) : null,
                    });
                    toast.success('面接結果を保存しました');
                    setShowFugokakuModal(false);
                    fetchProject();
                  } catch (err) { toast.error('保存に失敗しました'); }
                }}
                disabled={!form.interview_attendees}
                className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
