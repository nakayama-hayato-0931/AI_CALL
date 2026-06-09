/**
 * 新CPA (fax-crm 互換, source_kind='架電バイト') ビュー
 *   - Layout は呼び出し元 (analytics.js) が持つ
 *   - analytics.js のトグルで旧CPAと切り替えて表示
 */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const yen = (n) => '¥' + (Number(n) || 0).toLocaleString();
const fmtDate = (s) => s ? new Date(s).toLocaleDateString('ja-JP') : '-';

export default function CpaV2View() {
  const [basis, setBasis] = useState('acquired');
  const [months, setMonths] = useState(12);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncRes, setLastSyncRes] = useState(null);
  const [modal, setModal] = useState(null); // { type, month, data, loading }

  const fetchMonthly = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/cpa-v2/monthly', { params: { basis, months } });
      if (data.success) setRows(data.data.rows || []);
      else toast.error(data.message || '取得失敗');
    } catch (e) {
      toast.error('取得失敗: ' + (e.response?.data?.message || e.message));
    } finally { setLoading(false); }
  }, [basis, months]);

  useEffect(() => { fetchMonthly(); }, [fetchMonthly]);

  const handleSync = async () => {
    if (!window.confirm('Google Sheets 同期を実行します (10〜90秒)。続行?')) return;
    setSyncing(true);
    try {
      const { data } = await api.post('/api/cpa-v2/sync');
      if (data.success) {
        setLastSyncRes(data.data);
        toast.success('同期完了');
        await fetchMonthly();
      } else toast.error('同期失敗');
    } catch (e) { toast.error('同期失敗: ' + (e.response?.data?.message || e.message)); }
    finally { setSyncing(false); }
  };

  const openOffers = async (month) => {
    setModal({ type: 'offers', month, data: null, loading: true });
    try {
      const { data } = await api.get('/api/cpa-v2/offers', { params: { month, basis } });
      if (data.success) setModal(prev => prev && prev.month === month ? { ...prev, data: data.data, loading: false } : prev);
      else { setModal(null); toast.error('取得失敗'); }
    } catch (e) { setModal(null); toast.error('取得失敗'); }
  };
  const openInterviews = async (month, kind = 'all') => {
    setModal({ type: kind === 'rejects' ? 'rejects' : 'interviews', month, data: null, loading: true });
    try {
      const { data } = await api.get('/api/cpa-v2/interviews', { params: { month, basis, kind } });
      if (data.success) setModal(prev => prev ? { ...prev, data: data.data, loading: false } : prev);
      else { setModal(null); toast.error('取得失敗'); }
    } catch (e) { setModal(null); toast.error('取得失敗'); }
  };

  return (
    <div>
      {/* 操作バー */}
      <div className="card p-4 mb-5">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label className="input-label">集計基準</label>
            <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
              {[{v:'acquired',l:'案件獲得日'},{v:'offer',l:'内定日'}].map(b => (
                <button key={b.v} onClick={() => setBasis(b.v)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    basis === b.v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>{b.l}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="input-label">月数</label>
            <select value={months} onChange={e => setMonths(Number(e.target.value))} className="input text-sm">
              {[3, 6, 12, 24, 36].map(n => <option key={n} value={n}>{n}ヶ月</option>)}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={fetchMonthly} disabled={loading}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50">
              {loading ? '取得中...' : '再取得'}
            </button>
            <button onClick={handleSync} disabled={syncing}
              className="px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 rounded disabled:opacity-50">
              {syncing ? '同期中...(最大90秒)' : 'Google Sheets 同期'}
            </button>
          </div>
        </div>
        {lastSyncRes && (
          <details className="mt-3 text-[11px] text-gray-500">
            <summary className="cursor-pointer">最新の同期結果</summary>
            <pre className="bg-gray-50 p-2 mt-1 rounded border border-gray-200 max-h-40 overflow-auto">{JSON.stringify(lastSyncRes, null, 2)}</pre>
          </details>
        )}
      </div>

      {/* 月別表 */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50/80 border-b border-gray-200">
            <tr>
              <th className="table-header text-left">月</th>
              <th className="table-header text-right">案件数</th>
              <th className="table-header text-right">バラシ</th>
              <th className="table-header text-right">面接数</th>
              <th className="table-header text-right">不合格</th>
              <th className="table-header text-right">内定社数</th>
              <th className="table-header text-right">内定率</th>
              <th className="table-header text-right">面接実施率</th>
              <th className="table-header text-right">初回入金</th>
              <th className="table-header text-right">見込売上</th>
              <th className="table-header text-right">入金実績</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.month} className="border-b border-gray-100 hover:bg-blue-50/30">
                <td className="table-cell font-medium">{String(r.month).slice(0, 7)}</td>
                <td className="table-cell text-right">{r.projects}</td>
                <td className="table-cell text-right">{r.cancels}</td>
                <td className="table-cell text-right">
                  <button onClick={() => openInterviews(String(r.month).slice(0,10), 'all')}
                    className="text-blue-600 hover:underline">{r.interviews}</button>
                </td>
                <td className="table-cell text-right">
                  <button onClick={() => openInterviews(String(r.month).slice(0,10), 'rejects')}
                    className="text-blue-600 hover:underline">{r.rejects}</button>
                </td>
                <td className="table-cell text-right font-bold">
                  <button onClick={() => openOffers(String(r.month).slice(0,10))}
                    className="text-emerald-700 hover:underline">{r.offers}</button>
                </td>
                <td className="table-cell text-right">{r.offer_rate}%</td>
                <td className="table-cell text-right">{r.interview_rate}%</td>
                <td className="table-cell text-right text-emerald-700">{yen(r.first_payment)}</td>
                <td className="table-cell text-right text-blue-700">{yen(r.expected_revenue)}</td>
                <td className="table-cell text-right text-red-600 font-bold">{yen(r.payment_actual)}</td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={11} className="text-center py-10 text-gray-400">データなし。「Google Sheets 同期」を実行してください。</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-[1200px] max-w-[96vw] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-gray-200 bg-emerald-50 rounded-t-xl flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900">
                  {modal.type === 'offers' ? '内定社内訳' : modal.type === 'rejects' ? '不合格内訳' : '面接内訳'} — {String(modal.month).slice(0, 7).replace('-', '年')}月
                </h2>
                <p className="text-[11px] text-gray-500 mt-0.5">basis={basis} / source_kind='架電バイト'</p>
              </div>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-700 p-1 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-auto px-5 py-3">
              {modal.loading && <div className="text-center py-10 text-gray-400 text-sm">読み込み中...</div>}
              {!modal.loading && modal.type === 'offers' && (
                <OffersTable rows={modal.data?.rows || []} />
              )}
              {!modal.loading && (modal.type === 'interviews' || modal.type === 'rejects') && (
                <InterviewsTable rows={modal.data?.rows || []} offerOnly={modal.data?.offerOnly || []} kind={modal.type} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OffersTable({ rows }) {
  let lastKey = null;
  const countByKey = {};
  for (const r of rows) {
    const k = (r.job_number && r.job_number.trim()) || r.company_name || '?';
    countByKey[k] = (countByKey[k] || 0) + 1;
  }
  const totals = rows.reduce((s, r) => ({
    hires: s.hires + 1,
    initial: s.initial + (Number(r.first_payment) || 0),
    expected: s.expected + (Number(r.expected_revenue) || 0),
    actual: s.actual + (Number(r.payment_actual) || 0),
  }), { hires: 0, initial: 0, expected: 0, actual: 0 });
  const cancelCount = rows.filter(r => r.is_cancelled).length;
  const declineCount = rows.filter(r => r.is_declined).length;
  const uniqueOfferCompanies = Object.keys(countByKey).length;
  return (
    <div>
      <div className="text-xs text-gray-600 mb-2">
        案件シート(『ビザ申請 進捗』)より / 取消・辞退も含む全件 (売上は0で記録)
        <span className="ml-3 font-bold">内定 {uniqueOfferCompanies} 社</span>
        <span className="ml-2">/ 合格者 {totals.hires} 名</span>
        <span className="ml-2 text-gray-400">(取消 {cancelCount} / 辞退 {declineCount})</span>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            <th className="border px-2 py-1.5 text-left">状態</th>
            <th className="border px-2 py-1.5 text-left">内定日<br/><span className="font-normal text-[10px] text-gray-400">A列</span></th>
            <th className="border px-2 py-1.5 text-left">案件取得日<br/><span className="font-normal text-[10px] text-gray-400">BK列</span></th>
            <th className="border px-2 py-1.5 text-left">求人番号<br/><span className="font-normal text-[10px] text-gray-400">B列</span></th>
            <th className="border px-2 py-1.5 text-left">会社名<br/><span className="font-normal text-[10px] text-gray-400">BD列</span></th>
            <th className="border px-2 py-1.5 text-right">合格人数<br/><span className="font-normal text-[10px] text-gray-400">同求人番号 行数</span></th>
            <th className="border px-2 py-1.5 text-left">登録番号<br/><span className="font-normal text-[10px] text-gray-400">G列</span></th>
            <th className="border px-2 py-1.5 text-left">営業担当<br/><span className="font-normal text-[10px] text-gray-400">E列</span></th>
            <th className="border px-2 py-1.5 text-left">業種<br/><span className="font-normal text-[10px] text-gray-400">CF列</span></th>
            <th className="border px-2 py-1.5 text-right">初回入金<br/><span className="font-normal text-[10px] text-gray-400">BI列</span></th>
            <th className="border px-2 py-1.5 text-right">見込売上<br/><span className="font-normal text-[10px] text-gray-400">BJ列</span></th>
            <th className="border px-2 py-1.5 text-right">入金実績<br/><span className="font-normal text-[10px] text-gray-400">CC列</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const k = (r.job_number && r.job_number.trim()) || r.company_name || '?';
            const isFirstOfGroup = k !== lastKey;
            lastKey = k;
            const label = r.is_cancelled ? '取消' : r.is_declined ? '辞退' : '通常';
            const labelCls = r.is_cancelled ? 'bg-red-100 text-red-700' : r.is_declined ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700';
            return (
              <tr key={r.id || idx} className="hover:bg-gray-50">
                <td className="border px-2 py-1"><span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${labelCls}`}>{label}</span></td>
                <td className="border px-2 py-1">{fmtDate(r.offer_date)}</td>
                <td className="border px-2 py-1">{fmtDate(r.acquired_date)}</td>
                <td className="border px-2 py-1 font-mono text-[11px]">{isFirstOfGroup ? r.job_number : <span className="text-gray-300">〃</span>}</td>
                <td className="border px-2 py-1">{isFirstOfGroup ? (r.company_name || '-') : <span className="text-gray-300">〃</span>}</td>
                <td className="border px-2 py-1 text-right">{isFirstOfGroup ? `${countByKey[k]}名` : ''}</td>
                <td className="border px-2 py-1 font-mono text-[11px]">{r.candidate_registration_no || '-'}</td>
                <td className="border px-2 py-1">{r.sales_owner || '-'}</td>
                <td className="border px-2 py-1">{r.industry || '-'}</td>
                <td className="border px-2 py-1 text-right text-emerald-700">{r.first_payment > 0 ? yen(r.first_payment) : '¥0'}</td>
                <td className="border px-2 py-1 text-right text-blue-700">{r.expected_revenue > 0 ? yen(r.expected_revenue) : '¥0'}</td>
                <td className="border px-2 py-1 text-right text-red-600 font-bold">{r.payment_actual > 0 ? yen(r.payment_actual) : '¥0'}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-gray-50 border-t-2 border-gray-300">
          <tr className="font-bold">
            <td colSpan={5} className="border px-2 py-2 text-right">
              内定 {uniqueOfferCompanies} 社 / 合格者 {totals.hires} 名 (取消 {cancelCount} / 辞退 {declineCount})
            </td>
            <td className="border px-2 py-2 text-right">{totals.hires}名</td>
            <td colSpan={3} className="border"></td>
            <td className="border px-2 py-2 text-right text-emerald-700">{yen(totals.initial)}</td>
            <td className="border px-2 py-2 text-right text-blue-700">{yen(totals.expected)}</td>
            <td className="border px-2 py-2 text-right text-red-600">{yen(totals.actual)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function InterviewsTable({ rows, offerOnly, kind }) {
  const totalCompanies = new Set(rows.map(r => (r.job_number && r.job_number.trim()) || r.company_name)).size;
  const offerOnlyCount = offerOnly?.length || 0;
  return (
    <div>
      <div className="text-xs text-gray-600 mb-2">
        面接シート(『2024_面接内訳』)より / 同一求人は1社カウント
        <span className="ml-3 font-bold">{totalCompanies + offerOnlyCount} 社 ({kind === 'rejects' ? '不合格' : '面接実施'})</span>
        {offerOnlyCount > 0 && <span className="ml-2 text-gray-400">(うち {offerOnlyCount} 社は内定のみ加算分)</span>}
      </div>
      <table className="w-full text-xs border-collapse">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            <th className="border px-2 py-1.5 text-left">面接日</th>
            <th className="border px-2 py-1.5 text-left">案件取得日</th>
            <th className="border px-2 py-1.5 text-left">求人番号</th>
            <th className="border px-2 py-1.5 text-left">会社名</th>
            <th className="border px-2 py-1.5 text-right">面接人数</th>
            <th className="border px-2 py-1.5 text-right">合格者数</th>
            <th className="border px-2 py-1.5 text-left">営業担当</th>
            <th className="border px-2 py-1.5 text-left">業種</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.id || idx} className="hover:bg-gray-50">
              <td className="border px-2 py-1">{fmtDate(r.interview_date)}</td>
              <td className="border px-2 py-1">{fmtDate(r.acquired_date)}</td>
              <td className="border px-2 py-1 font-mono text-[11px]">{r.job_number || '-'}</td>
              <td className="border px-2 py-1">{r.company_name || '-'}</td>
              <td className="border px-2 py-1 text-right">{r.interview_count}</td>
              <td className="border px-2 py-1 text-right">{r.pass_count == null ? '(空)' : r.pass_count}</td>
              <td className="border px-2 py-1">{r.sales_owner || '-'}</td>
              <td className="border px-2 py-1">{r.industry || '-'}</td>
            </tr>
          ))}
          {offerOnly && offerOnly.length > 0 && (
            <>
              <tr><td colSpan={8} className="border-t-2 border-gray-300 px-2 py-1.5 bg-amber-50 text-xs text-gray-600">
                ↓ 内定はあるが面接記録に無い企業（UNION 加算分）
              </td></tr>
              {offerOnly.map((r, idx) => (
                <tr key={`o-${r.id || idx}`} className="bg-amber-50/30 hover:bg-amber-50">
                  <td className="border px-2 py-1 text-gray-400">-</td>
                  <td className="border px-2 py-1">{fmtDate(r.acquired_date)}</td>
                  <td className="border px-2 py-1 font-mono text-[11px]">{r.job_number || '-'}</td>
                  <td className="border px-2 py-1">{r.company_name || '-'}</td>
                  <td className="border px-2 py-1 text-right text-gray-400">-</td>
                  <td className="border px-2 py-1 text-right text-gray-400">-</td>
                  <td className="border px-2 py-1">{r.sales_owner || '-'}</td>
                  <td className="border px-2 py-1">{r.industry || '-'}</td>
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
