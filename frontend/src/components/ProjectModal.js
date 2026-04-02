import { useState } from 'react';
import api from '../utils/api';
import toast from 'react-hot-toast';

const STATUS_OPTIONS = [
  { value: '', label: '未選択' },
  { value: 'BOSHUCHU', label: '募集中' },
  { value: 'SHORUI_CHU', label: '書類選考中' },
  { value: 'MENSETSU_KAKUTEI', label: '面接確定' },
  { value: 'KEKKA_MACHI', label: '結果待ち' },
  { value: 'NAITEI', label: '内定' },
  { value: 'FUGOKAKU', label: '不合格' },
  { value: 'LOST', label: '失注' },
  { value: 'BARASHI', label: 'バラシ' },
  { value: 'HORYU', label: '保留' },
  { value: 'SHORUI_OCHI', label: '書類選考落ち' },
  { value: 'KISON_NASHI', label: '既存対応なし' },
  { value: 'MODOSHI', label: '戻し' },
  { value: 'MODORI', label: '戻し戻り' },
];

export default function ProjectModal({ projectId, onClose }) {
  const [form, setForm] = useState({
    status: '',
    job_number: '',
    interview_date: '',
    interview_type: '',
    mail_sent: '',
    mail_replied: '',
    phone_confirmed: '',
    memo: '',
    contact_person: '',
    contact_phone: '',
    contact_email: '',
    dashboard_checked: false,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await api.put(`/api/projects/${projectId}`, {
        ...form,
        interview_date: form.interview_date || null,
        interview_type: form.interview_type || null,
        mail_sent: form.mail_sent || null,
        mail_replied: form.mail_replied || null,
        phone_confirmed: form.phone_confirmed || null,
      });
      toast.success('案件情報を保存しました');
      onClose();
    } catch (err) {
      toast.error('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold text-gray-900">案件情報を入力</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">ステータス</label>
                <select value={form.status || ''} onChange={e => setForm({...form, status: e.target.value})} className="input">
                  <option value="">未選択</option>
                  {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="input-label">求人番号</label>
                <input type="text" value={form.job_number} onChange={e => setForm({...form, job_number: e.target.value})}
                  className="input" placeholder="例: JB-12345" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">面接日時</label>
                <input type="datetime-local" value={form.interview_date}
                  onChange={e => setForm({...form, interview_date: e.target.value})} className="input" />
              </div>
              <div>
                <label className="input-label">面接形式</label>
                <select value={form.interview_type} onChange={e => setForm({...form, interview_type: e.target.value})} className="input">
                  <option value="">未選択</option>
                  <option value="online">オンライン</option>
                  <option value="in_person">対面</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="input-label">メール送信日</label>
                <input type="date" value={form.mail_sent || ''} onChange={e => setForm({...form, mail_sent: e.target.value || null})} className="input" />
              </div>
              <div>
                <label className="input-label">メール返信日</label>
                <input type="date" value={form.mail_replied || ''} onChange={e => setForm({...form, mail_replied: e.target.value || null})} className="input" />
              </div>
              <div>
                <label className="input-label">電話確認日</label>
                <input type="date" value={form.phone_confirmed || ''} onChange={e => setForm({...form, phone_confirmed: e.target.value || null})} className="input" />
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer group">
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                  form.dashboard_checked ? 'bg-blue-600 border-blue-600' : 'border-gray-300 group-hover:border-blue-400'
                }`}>
                  {form.dashboard_checked && (
                    <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <input type="checkbox" checked={form.dashboard_checked}
                  onChange={e => setForm({...form, dashboard_checked: e.target.checked})} className="sr-only" />
                <span className="text-gray-700">ダッシュボード記入済</span>
              </label>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="input-label">企業担当者</label>
                <input type="text" value={form.contact_person}
                  onChange={e => setForm({...form, contact_person: e.target.value})}
                  className="input" placeholder="担当者名" />
              </div>
              <div>
                <label className="input-label">担当者電話番号</label>
                <input type="text" value={form.contact_phone}
                  onChange={e => setForm({...form, contact_phone: e.target.value})}
                  className="input" placeholder="090-xxxx-xxxx" />
              </div>
              <div>
                <label className="input-label">担当者メール</label>
                <input type="email" value={form.contact_email}
                  onChange={e => setForm({...form, contact_email: e.target.value})}
                  className="input" placeholder="email@example.com" />
              </div>
            </div>

            <div>
              <label className="input-label">メモ</label>
              <textarea value={form.memo} onChange={e => setForm({...form, memo: e.target.value})}
                rows={3} className="input resize-none" placeholder="案件に関するメモ..." />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button onClick={handleSubmit} disabled={saving}
              className="btn-primary flex-1 disabled:opacity-50">
              {saving ? '保存中...' : '保存'}
            </button>
            <button onClick={onClose}
              className="btn-secondary flex-1">
              スキップ
            </button>
          </div>
          <p className="text-xs text-gray-400 text-center mt-2">スキップしても案件管理から後で編集できます</p>
        </div>
      </div>
    </div>
  );
}
