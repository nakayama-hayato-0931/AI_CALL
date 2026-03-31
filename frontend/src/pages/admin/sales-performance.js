/**
 * 営業売上一覧ページ
 * 営業別の内定・面接・売上パフォーマンス
 */
import { useState, useEffect } from 'react';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const MONTHS = [];
for (let y = 2025; y <= 2027; y++) {
  for (let m = 1; m <= 12; m++) {
    MONTHS.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: `${y}年${m}月` });
  }
}

export default function SalesPerformancePage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [periodMode, setPeriodMode] = useState('monthly');
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [selectedWeekDate, setSelectedWeekDate] = useState(new Date().toISOString().slice(0, 10));
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  useEffect(() => {
    if (user && !['admin', 'manager', 'consultant', 'sales'].includes(user.role)) return;
    fetchData();
  }, [user, periodMode, selectedMonth, selectedWeekDate, customFrom, customTo]);

  const fetchData = async () => {
    setLoading(true);
    try {
      let dateFrom, dateTo;
      if (periodMode === 'monthly') {
        const [y, m] = selectedMonth.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        dateFrom = `${selectedMonth}-01`;
        dateTo = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
      } else if (periodMode === 'weekly') {
        const d = new Date(selectedWeekDate);
        const day = d.getDay();
        const mon = new Date(d);
        mon.setDate(d.getDate() - ((day + 6) % 7));
        const sun = new Date(mon);
        sun.setDate(mon.getDate() + 6);
        dateFrom = mon.toISOString().slice(0, 10);
        dateTo = sun.toISOString().slice(0, 10);
      } else if (periodMode === 'cumulative') {
        dateFrom = '2000-01-01';
        dateTo = '2099-12-31';
      } else {
        dateFrom = customFrom;
        dateTo = customTo;
        if (!dateFrom || !dateTo) { setLoading(false); return; }
      }
      const { data: res } = await api.get(`/api/analytics/sales-performance?date_from=${dateFrom}&date_to=${dateTo}`);
      if (res.success) setData(res.data);
    } catch (err) {
      toast.error('データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // 明細モーダル
  const [detailModal, setDetailModal] = useState(null); // { title, items }
  const [detailLoading, setDetailLoading] = useState(false);

  const openDetail = async (salesUserId, salesName, type, typeLabel) => {
    if (!data) return;
    setDetailLoading(true);
    setDetailModal({ title: `${salesName || '全体'} - ${typeLabel}`, items: [] });
    try {
      const params = new URLSearchParams({ type, date_from: data.dateFrom, date_to: data.dateTo });
      if (salesUserId) params.append('sales_user_id', salesUserId);
      const { data: res } = await api.get(`/api/analytics/sales-detail?${params}`);
      if (res.success) setDetailModal(prev => ({ ...prev, items: res.data }));
    } catch (err) {
      toast.error('明細の取得に失敗しました');
    } finally {
      setDetailLoading(false);
    }
  };

  if (!user || !['admin', 'manager', 'consultant', 'sales'].includes(user.role)) return null;

  const fmt = (v) => v != null ? v.toLocaleString() : '0';
  const fmtYen = (v) => v ? `¥${v.toLocaleString()}` : '¥0';

  // クリック可能なセル
  const ClickCell = ({ value, display, salesUserId, salesName, type, typeLabel, className = '' }) => (
    <td className={`py-2 px-3 text-right cursor-pointer hover:bg-blue-50 transition-colors ${className}`}
      onClick={() => value > 0 && openDetail(salesUserId, salesName, type, typeLabel)}>
      <span className={value > 0 ? 'text-blue-600 underline decoration-dotted' : ''}>{display || value}</span>
    </td>
  );

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">営業売上一覧</h1>
        <p className="text-sm text-gray-400 mt-0.5">営業別の内定・面接・売上パフォーマンス</p>
      </div>

      {/* 期間切替 */}
      <div className="card p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {[
              { value: 'monthly', label: '月別' },
              { value: 'weekly', label: '週別' },
              { value: 'cumulative', label: '累計' },
              { value: 'custom', label: '任意' },
            ].map(p => (
              <button key={p.value} onClick={() => setPeriodMode(p.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  periodMode === p.value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>{p.label}</button>
            ))}
          </div>
          {periodMode === 'monthly' && (
            <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="input text-xs">
              {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          )}
          {periodMode === 'weekly' && (
            <input type="date" value={selectedWeekDate} onChange={e => setSelectedWeekDate(e.target.value)}
              className="input text-xs" />
          )}
          {periodMode === 'custom' && (
            <>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="input text-xs" />
              <span className="text-gray-400">〜</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="input text-xs" />
            </>
          )}
          {data && (
            <span className="text-[10px] text-gray-400 ml-auto">{data.dateFrom} 〜 {data.dateTo}</span>
          )}
        </div>
      </div>

      {/* テーブル */}
      {loading ? (
        <div className="card p-8 text-center text-gray-400">読み込み中...</div>
      ) : !data || data.sales.length === 0 ? (
        <div className="card p-8 text-center text-gray-400">営業ユーザーがいません</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-2.5 px-3 font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10 min-w-[100px]">名前</th>
                  <th className="text-right py-2.5 px-3 font-semibold text-gray-600 whitespace-nowrap">内定企業数</th>
                  <th className="text-right py-2.5 px-3 font-semibold text-gray-600 whitespace-nowrap">合計内定数</th>
                  <th className="text-right py-2.5 px-3 font-semibold text-gray-600 whitespace-nowrap">国内内定数</th>
                  <th className="text-right py-2.5 px-3 font-semibold text-gray-600 whitespace-nowrap">海外内定数</th>
                  <th className="text-right py-2.5 px-3 font-semibold text-gray-600 whitespace-nowrap">転職内定数</th>
                  <th className="text-right py-2.5 px-3 font-semibold text-gray-600 whitespace-nowrap">面接数</th>
                  <th className="text-right py-2.5 px-3 font-semibold text-gray-600 whitespace-nowrap">面接者数</th>
                  <th className="text-right py-2.5 px-3 font-semibold text-gray-600 whitespace-nowrap bg-blue-50/50 text-blue-700">合格率</th>
                  <th className="text-right py-2.5 px-3 font-semibold text-gray-600 whitespace-nowrap">合格人数/面接</th>
                  <th className="text-right py-2.5 px-3 font-semibold text-gray-600 whitespace-nowrap">バラシ</th>
                  <th className="text-right py-2.5 px-3 font-semibold text-blue-700 whitespace-nowrap bg-blue-50/50">初回売上</th>
                  <th className="text-right py-2.5 px-3 font-semibold text-blue-700 whitespace-nowrap bg-blue-50/50">見込売上</th>
                </tr>
              </thead>
              <tbody>
                {/* 合計行 */}
                <tr className="bg-blue-50/40 border-b-2 border-blue-200">
                  <td className="py-2.5 px-3 font-bold text-blue-700 sticky left-0 z-10 bg-blue-50/40">合計</td>
                  <ClickCell value={data.team.naiteiCompanies} salesUserId={null} salesName="全体" type="naitei" typeLabel="内定企業" className="font-bold text-blue-700" />
                  <td className="py-2.5 px-3 text-right font-bold text-blue-700">{data.team.totalHires}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-blue-700">{data.team.domesticHires}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-blue-700">{data.team.overseasHires}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-blue-700">{data.team.tenshokuHires}</td>
                  <ClickCell value={data.team.interviewCount} salesUserId={null} salesName="全体" type="interview" typeLabel="面接" className="font-bold text-blue-700" />
                  <td className="py-2.5 px-3 text-right font-bold text-blue-700">{data.team.totalAttendees}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-blue-700 bg-blue-50/60">{data.team.passRate}%</td>
                  <td className="py-2.5 px-3 text-right font-bold text-blue-700">{data.team.hiresPerInterview}</td>
                  <ClickCell value={data.team.barashiCount} salesUserId={null} salesName="全体" type="barashi" typeLabel="バラシ" className="font-bold text-red-600" />
                  <td className="py-2.5 px-3 text-right font-bold text-blue-700 bg-blue-50/60">{fmtYen(data.team.initialPayment)}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-blue-700 bg-blue-50/60">{fmtYen(data.team.expectedRevenue)}</td>
                </tr>
                {/* 各営業行 */}
                {data.sales.map((s, i) => (
                  <tr key={s.userId} className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                    <td className={`py-2 px-3 font-medium text-gray-800 sticky left-0 z-10 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>{s.name}</td>
                    <ClickCell value={s.naiteiCompanies} salesUserId={s.userId} salesName={s.name} type="naitei" typeLabel="内定企業" />
                    <td className="py-2 px-3 text-right font-semibold">{s.totalHires}</td>
                    <td className="py-2 px-3 text-right">{s.domesticHires}</td>
                    <td className="py-2 px-3 text-right">{s.overseasHires}</td>
                    <td className="py-2 px-3 text-right">{s.tenshokuHires}</td>
                    <ClickCell value={s.interviewCount} salesUserId={s.userId} salesName={s.name} type="interview" typeLabel="面接" />
                    <td className="py-2 px-3 text-right">{s.totalAttendees}</td>
                    <td className="py-2 px-3 text-right font-semibold bg-blue-50/30">{s.passRate}%</td>
                    <td className="py-2 px-3 text-right">{s.hiresPerInterview}</td>
                    <ClickCell value={s.barashiCount} salesUserId={s.userId} salesName={s.name} type="barashi" typeLabel="バラシ" className="text-red-500" />
                    <td className="py-2 px-3 text-right font-semibold bg-blue-50/30">{fmtYen(s.initialPayment)}</td>
                    <td className="py-2 px-3 text-right font-semibold bg-blue-50/30">{fmtYen(s.expectedRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 明細モーダル */}
      {detailModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setDetailModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-800">{detailModal.title}</h3>
              <button onClick={() => setDetailModal(null)} className="text-gray-400 hover:text-gray-600">&times;</button>
            </div>
            <div className="overflow-auto max-h-[60vh]">
              {detailLoading ? (
                <p className="text-center py-8 text-gray-400 text-sm">読み込み中...</p>
              ) : detailModal.items.length === 0 ? (
                <p className="text-center py-8 text-gray-400 text-sm">データなし</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">求人番号</th>
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">企業名</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-600">内定人数</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-600">面接人数</th>
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">内定日</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-600">初回売上</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-600">見込売上</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailModal.items.map((item, i) => (
                      <tr key={item.id} className={`border-b border-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/30'}`}>
                        <td className="py-2 px-3 text-gray-500">{item.job_number || '-'}</td>
                        <td className="py-2 px-3 font-medium">{item.company_name}</td>
                        <td className="py-2 px-3 text-right font-semibold text-blue-600">{item.hire_count}</td>
                        <td className="py-2 px-3 text-right">{item.interview_attendees || '-'}</td>
                        <td className="py-2 px-3 text-gray-500">{item.naitei_date ? new Date(item.naitei_date).toLocaleDateString('ja-JP') : '-'}</td>
                        <td className="py-2 px-3 text-right">{item.initial_payment ? `¥${Number(item.initial_payment).toLocaleString()}` : '¥0'}</td>
                        <td className="py-2 px-3 text-right">{item.expected_revenue ? `¥${Number(item.expected_revenue).toLocaleString()}` : '¥0'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
