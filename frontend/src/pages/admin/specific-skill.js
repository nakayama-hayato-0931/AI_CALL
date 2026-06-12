/**
 * 特定技能管理
 * 特定技能 (work_category='specific_skill') で稼働したオペレーターの集計サマリーと
 * 既存ページへの絞込リンクを提供する。
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Layout from '../../components/common/Layout';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import useAuth from '../../hooks/useAuth';

export default function SpecificSkillAdmin() {
  const { user } = useAuth();
  const isManager = ['admin', 'manager', 'consultant'].includes(user?.role);
  const isAdmin = user?.role === 'admin';
  const [loading, setLoading] = useState(true);
  const [operators, setOperators] = useState([]);
  const [period, setPeriod] = useState('monthly');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  // 業務カテゴリ振替ツール
  const today = new Date().toISOString().slice(0, 10);
  const [allOperators, setAllOperators] = useState([]);
  const [swapForm, setSwapForm] = useState({ user_id: '', date_from: today, date_to: today, from: 'general', to: 'specific_skill' });
  const [swapPreview, setSwapPreview] = useState(null);
  const [swapBusy, setSwapBusy] = useState(false);
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const { data } = await api.get('/api/auth/operators');
        if (data?.success) setAllOperators(data.data || []);
      } catch (_e) { /* ignore */ }
    })();
  }, [isAdmin]);
  const runSwapPreview = async () => {
    if (!swapForm.user_id) { toast.error('オペレーターを選択してください'); return; }
    if (swapForm.from === swapForm.to) { toast.error('振替元と振替先が同じです'); return; }
    setSwapBusy(true);
    try {
      const { data } = await api.post('/api/admin/work-category-swap', { ...swapForm, dry_run: true });
      if (data?.success) {
        setSwapPreview(data.data);
        toast.success(`プレビュー: ${data.data.totalAffected}件が対象`);
      } else {
        toast.error(data?.message || 'プレビューに失敗しました');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'プレビューに失敗しました');
    } finally { setSwapBusy(false); }
  };
  const runSwapExecute = async () => {
    if (!swapPreview || swapPreview.totalAffected === 0) { toast.error('先にプレビューで対象を確認してください'); return; }
    const msg = `${swapPreview.userName} さんの ${swapPreview.dateFrom}〜${swapPreview.dateTo} のデータを\n${swapPreview.from === 'general' ? '技人国' : '特定技能'} → ${swapPreview.to === 'general' ? '技人国' : '特定技能'}\nに振り替えます。\n\ncalls: ${swapPreview.counts.calls}件 / projects: ${swapPreview.counts.projects}件 / work_hours: ${swapPreview.counts.work_hours}件 (計 ${swapPreview.totalAffected}件)\n\n実行しますか? (この操作は元に戻せません)`;
    if (!window.confirm(msg)) return;
    setSwapBusy(true);
    try {
      const { data } = await api.post('/api/admin/work-category-swap', { ...swapForm, dry_run: false });
      if (data?.success) {
        toast.success(`${data.data.totalUpdated}件のレコードを振替えました`);
        setSwapPreview(null);
      } else {
        toast.error(data?.message || '振替に失敗しました');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || '振替に失敗しました');
    } finally { setSwapBusy(false); }
  };

  useEffect(() => {
    if (!isManager) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/api/admin/performance', {
          params: { period, date, call_type: 'operator', work_category: 'specific_skill' },
        });
        if (cancelled) return;
        const list = data?.data?.operators || [];
        // 特定技能で1件でも稼働 (total_calls > 0 or projects > 0) したオペレーターのみ
        const filtered = list.filter(op =>
          Number(op.total_calls) > 0 || Number(op.projects) > 0 || Number(op.work_minutes) > 0
        );
        setOperators(filtered);
      } catch (err) {
        toast.error('特定技能データの取得に失敗しました');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [period, date, isManager]);

  if (!isManager) {
    return (
      <Layout>
        <div className="text-sm text-gray-500">管理者権限が必要です</div>
      </Layout>
    );
  }

  const linkParams = `?work_category=specific_skill`;
  const fmtH = (m) => m > 0 ? `${(m / 60).toFixed(1)}h` : '-';

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">特定技能管理</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          特定技能で稼働したオペレーターの集計
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {[
            { value: 'daily', label: '日次' },
            { value: 'weekly', label: '週次' },
            { value: 'monthly', label: '月次' },
          ].map(p => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                period === p.value ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>{p.label}</button>
          ))}
        </div>
        {period !== 'weekly' && (
          <input type={period === 'monthly' ? 'month' : 'date'} value={period === 'monthly' ? date.slice(0, 7) : date}
            onChange={e => setDate(period === 'monthly' ? `${e.target.value}-01` : e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-3 py-1.5" />
        )}
      </div>

      {/* 既存ページへの特定技能絞込リンク */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { href: `/${linkParams}`, label: 'ダッシュボード' },
          { href: `/admin/analytics${linkParams}`, label: 'CPA/案件質分析' },
          { href: `/admin/projects${linkParams}`, label: '獲得案件' },
          { href: `/admin/call-logs${linkParams}`, label: '架電履歴' },
        ].map(l => (
          <Link key={l.href} href={l.href}
            className="card p-3 hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors">
            <div className="text-xs text-gray-400">特定技能で絞り込み</div>
            <div className="text-sm font-semibold text-gray-800 mt-0.5">{l.label}</div>
          </Link>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="px-3 py-2 bg-emerald-50/50 border-b border-emerald-200 text-xs font-semibold text-emerald-700">
          特定技能稼働オペレーター一覧 ({operators.length}名)
        </div>
        {loading ? (
          <div className="text-center py-8 text-gray-400 text-xs">読み込み中...</div>
        ) : operators.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-xs">この期間の特定技能稼働はありません</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">オペレーター</th>
                  <th className="px-3 py-2 text-right">稼働</th>
                  <th className="px-3 py-2 text-right">コール</th>
                  <th className="px-3 py-2 text-right">有効接続</th>
                  <th className="px-3 py-2 text-right">担当接続</th>
                  <th className="px-3 py-2 text-right">案件</th>
                  <th className="px-3 py-2 text-right">リコール獲得</th>
                  <th className="px-3 py-2 text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {operators.map(op => (
                  <tr key={op.user_id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{op.name}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmtH(Number(op.work_minutes) || 0)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{Number(op.total_calls) || 0}</td>
                    <td className="px-3 py-2 text-right">{Number(op.effective_connections) || 0}</td>
                    <td className="px-3 py-2 text-right">{Number(op.person_connections) || 0}</td>
                    <td className="px-3 py-2 text-right text-blue-600 font-semibold">{Number(op.projects) || 0}</td>
                    <td className="px-3 py-2 text-right">{Number(op.recall_gained) || 0}</td>
                    <td className="px-3 py-2 text-center">
                      <Link href={`/?work_category=specific_skill&scope=operator&target_user_id=${op.user_id}`}
                        className="text-[11px] text-blue-600 hover:underline">詳細</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===== 業務カテゴリ振替ツール (admin専用) ===== */}
      {isAdmin && (
        <div className="card overflow-hidden mt-6">
          <div className="px-3 py-2 bg-rose-50/60 border-b border-rose-200 text-xs font-semibold text-rose-700 flex items-center justify-between">
            <span>業務カテゴリ振替 (技人国 ↔ 特定技能)</span>
            <span className="text-[10px] text-rose-500 font-normal">誤入力のリカバリ用 / admin のみ</span>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-[11px] text-gray-500">
              指定オペレーターの指定期間内の架電記録 (calls)・案件 (projects)・労働時間 (work_hours) の業務カテゴリを一括変更します。
              まず「プレビュー」 で件数を確認してから「実行」 してください。 操作は元に戻せません。
            </p>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-xs">
              <div>
                <label className="block text-[10px] font-medium text-gray-500 mb-1">オペレーター</label>
                <select value={swapForm.user_id}
                  onChange={e => { setSwapForm({ ...swapForm, user_id: e.target.value }); setSwapPreview(null); }}
                  className="w-full border border-gray-200 rounded px-2 py-1.5 bg-white">
                  <option value="">選択してください</option>
                  {allOperators.map(op => (
                    <option key={op.id} value={op.id}>{op.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-500 mb-1">期間 (開始)</label>
                <input type="date" value={swapForm.date_from}
                  onChange={e => { setSwapForm({ ...swapForm, date_from: e.target.value }); setSwapPreview(null); }}
                  className="w-full border border-gray-200 rounded px-2 py-1.5 bg-white" />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-500 mb-1">期間 (終了)</label>
                <input type="date" value={swapForm.date_to}
                  onChange={e => { setSwapForm({ ...swapForm, date_to: e.target.value }); setSwapPreview(null); }}
                  className="w-full border border-gray-200 rounded px-2 py-1.5 bg-white" />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-500 mb-1">振替元</label>
                <select value={swapForm.from}
                  onChange={e => { setSwapForm({ ...swapForm, from: e.target.value }); setSwapPreview(null); }}
                  className="w-full border border-gray-200 rounded px-2 py-1.5 bg-white">
                  <option value="general">技人国</option>
                  <option value="specific_skill">特定技能</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-500 mb-1">振替先</label>
                <select value={swapForm.to}
                  onChange={e => { setSwapForm({ ...swapForm, to: e.target.value }); setSwapPreview(null); }}
                  className="w-full border border-gray-200 rounded px-2 py-1.5 bg-white">
                  <option value="general">技人国</option>
                  <option value="specific_skill">特定技能</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={runSwapPreview} disabled={swapBusy}
                className="px-4 py-1.5 text-xs font-medium rounded bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50">
                プレビュー (件数のみ取得)
              </button>
              <button onClick={runSwapExecute} disabled={swapBusy || !swapPreview || swapPreview.totalAffected === 0}
                className="px-4 py-1.5 text-xs font-medium rounded bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed">
                実行 (UPDATE)
              </button>
              {swapPreview && (
                <span className="text-[11px] text-gray-600 ml-2">
                  対象: <span className="font-bold text-rose-700">{swapPreview.totalAffected}件</span>
                  <span className="ml-2 text-gray-400">
                    (calls:{swapPreview.counts.calls} / projects:{swapPreview.counts.projects} / work_hours:{swapPreview.counts.work_hours})
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
