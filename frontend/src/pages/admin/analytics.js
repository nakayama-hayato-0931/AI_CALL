/**
 * CPA / 案件質分析ページ
 * 全オペレーター比較テーブル表示
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
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

const getWeeksInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const firstDay = new Date(y, m - 1, 1);
  const lastDay = new Date(y, m, 0);
  const weeks = [];
  let start = new Date(firstDay);
  while (start <= lastDay) {
    const end = new Date(start);
    end.setDate(start.getDate() + (6 - ((start.getDay() + 6) % 7)));
    if (end > lastDay) end.setTime(lastDay.getTime());
    weeks.push({
      label: `${start.getMonth() + 1}/${start.getDate()}〜${end.getMonth() + 1}/${end.getDate()}`,
      date: start.toISOString().slice(0, 10),
    });
    const next = new Date(end);
    next.setDate(end.getDate() + 1);
    start = next;
  }
  return weeks;
};

const fmt = (n) => n != null ? Number(n).toLocaleString() : '-';
const fmtPct = (n) => n != null ? `${n}%` : '-';
const fmtYen = (n) => n != null ? `¥${Number(n).toLocaleString()}` : '-';

export default function AnalyticsPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [periodMode, setPeriodMode] = useState('monthly');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedWeekDate, setSelectedWeekDate] = useState('');
  const [tab, setTab] = useState('cpa'); // cpa | quality

  const [cpaData, setCpaData] = useState(null);   // { team, operators[] }
  const [qualData, setQualData] = useState(null);  // { team, operators[] }
  const [loading, setLoading] = useState(true);

  // CSV
  const [csvFile, setCsvFile] = useState(null);
  const [csvUploading, setCsvUploading] = useState(false);

  // PDF
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfUploading, setPdfUploading] = useState(false);

  useEffect(() => {
    if (user && user.role !== 'admin' && user.role !== 'manager') {
      router.push('/');
    }
  }, [user]);

  useEffect(() => {
    if (periodMode === 'weekly') {
      const weeks = getWeeksInMonth(selectedMonth);
      if (weeks.length > 0 && !selectedWeekDate) {
        setSelectedWeekDate(weeks[0].date);
      }
    }
  }, [periodMode, selectedMonth]);

  const getApiParams = useCallback(() => {
    let period, date;
    if (periodMode === 'monthly') {
      period = 'monthly';
      date = `${selectedMonth}-15`;
    } else if (periodMode === 'weekly') {
      period = 'weekly';
      date = selectedWeekDate || `${selectedMonth}-01`;
    } else {
      period = 'cumulative';
      date = new Date().toISOString().slice(0, 10);
    }
    return { period, date };
  }, [periodMode, selectedMonth, selectedWeekDate]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = getApiParams();
      const [cpaRes, qualRes] = await Promise.all([
        api.get('/api/analytics/cpa-all', { params }),
        api.get('/api/analytics/quality-all', { params }),
      ]);
      setCpaData(cpaRes.data.data);
      setQualData(qualRes.data.data);
    } catch (err) {
      toast.error('データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [getApiParams]);

  useEffect(() => {
    if (user && (user.role === 'admin' || user.role === 'manager')) {
      fetchData();
    }
  }, [fetchData, user]);

  const handleCsvUpload = async () => {
    if (!csvFile) return;
    setCsvUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', csvFile);
      const { data } = await api.post('/api/analytics/import-cost-csv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(`${data.data.imported}件インポートしました`);
      if (data.data.errors?.length > 0) {
        toast.error(`${data.data.errors.length}件エラー`);
      }
      setCsvFile(null);
      fetchData();
    } catch (err) {
      toast.error('インポートに失敗しました');
    } finally {
      setCsvUploading(false);
    }
  };

  const handlePdfUpload = async () => {
    if (!pdfFile) return;
    setPdfUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', pdfFile);
      const { data } = await api.post('/api/analytics/import-cost-pdf', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(`${data.data.imported}件インポートしました`);
      if (data.data.errors?.length > 0) {
        toast.error(`${data.data.errors.length}件エラー`);
      }
      setPdfFile(null);
      fetchData();
    } catch (err) {
      toast.error('PDFインポートに失敗しました');
    } finally {
      setPdfUploading(false);
    }
  };

  // CPA指標の列定義
  const cpaColumns = [
    { key: 'cost', label: 'コスト', format: 'yen' },
    { key: 'callCount', label: 'コール数' },
    { key: 'projectRate', label: '案件化率', format: 'pct' },
    { key: 'projectCount', label: '案件数', highlight: true },
    { key: 'projectCpa', label: '案件CPA', format: 'yen' },
    { key: 'interviewCount', label: '面接数' },
    { key: 'interviewCpa', label: '面接CPA', format: 'yen' },
    { key: 'naiteiCount', label: '内定' },
    { key: 'fugokakuCount', label: '不合格' },
    { key: 'barashiLostCount', label: 'バラシ/失注' },
    { key: 'initialPayment', label: '初回入金', format: 'yen', highlight: true },
    { key: 'expectedRevenue', label: '見込売上', format: 'yen' },
    { key: 'roas', label: 'ROAS', format: 'pct', highlight: true },
  ];

  // 案件質指標の列定義
  const qualColumns = [
    { key: 'total', label: '案件数' },
    { key: 'lost', label: '失注', pctKey: 'lostPct' },
    { key: 'waitingContact', label: '連絡待ち', pctKey: 'waitingContactPct' },
    { key: 'interviewSet', label: '面接日確定', pctKey: 'interviewSetPct' },
    { key: 'interviewDone', label: '面接実施', pctKey: 'interviewDonePct' },
    { key: 'barashi', label: 'バラシ', pctKey: 'barashiPct' },
    { key: 'onlineInterview', label: 'オンライン面接', pctKey: 'onlineInterviewPct' },
    { key: 'noScreening', label: '書類選考無し', pctKey: 'noScreeningPct' },
    { key: 'screeningFailed', label: '書類選考落ち', pctKey: 'screeningFailedPct' },
  ];

  const formatCell = (value, format) => {
    if (format === 'yen') return fmtYen(value);
    if (format === 'pct') return fmtPct(value);
    return fmt(value);
  };

  return (
    <Layout>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">CPA / 案件質分析</h1>
        <p className="text-sm text-gray-400 mt-0.5">全オペレーター比較 - コスト・案件化率・面接・売上の分析</p>
      </div>

      {/* コントロール */}
      <div className="card p-4 mb-5 space-y-3">
        <div className="flex flex-wrap items-end gap-4">
          {/* 期間モード */}
          <div>
            <label className="input-label">表示期間</label>
            <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
              {[
                { value: 'monthly', label: '月別' },
                { value: 'weekly', label: '週別' },
                { value: 'cumulative', label: '累計' },
              ].map(m => (
                <button key={m.value}
                  onClick={() => setPeriodMode(m.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    periodMode === m.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>{m.label}</button>
              ))}
            </div>
          </div>

          {/* 月選択 */}
          {periodMode !== 'cumulative' && (
            <div>
              <label className="input-label">月</label>
              <select className="input text-sm" value={selectedMonth}
                onChange={e => { setSelectedMonth(e.target.value); setSelectedWeekDate(''); }}>
                {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          )}

          {/* 週選択 */}
          {periodMode === 'weekly' && (
            <div>
              <label className="input-label">週</label>
              <select className="input text-sm" value={selectedWeekDate}
                onChange={e => setSelectedWeekDate(e.target.value)}>
                {getWeeksInMonth(selectedMonth).map((w, i) => (
                  <option key={i} value={w.date}>第{i + 1}週 ({w.label})</option>
                ))}
              </select>
            </div>
          )}

          {/* タブ切替 */}
          <div>
            <label className="input-label">指標</label>
            <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setTab('cpa')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  tab === 'cpa' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>CPA指標</button>
              <button
                onClick={() => setTab('quality')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  tab === 'quality' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>案件質向上</button>
            </div>
          </div>
        </div>

        {/* コストデータインポート */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-500 font-medium">コストデータ取込:</span>
          {/* CSV */}
          <div className="flex items-center gap-2">
            <input type="file" accept=".csv" onChange={e => setCsvFile(e.target.files?.[0] || null)}
              className="text-xs text-gray-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 w-48" />
            <button onClick={handleCsvUpload} disabled={!csvFile || csvUploading}
              className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap">
              {csvUploading ? '処理中...' : 'CSV取込'}
            </button>
          </div>
          <span className="text-[10px] text-gray-400">CSV形式: 日付,名前,開始,終了,休憩(分)</span>
          {/* PDF */}
          <div className="flex items-center gap-2 ml-4">
            <input type="file" accept=".pdf" onChange={e => setPdfFile(e.target.files?.[0] || null)}
              className="text-xs text-gray-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100 w-48" />
            <button onClick={handlePdfUpload} disabled={!pdfFile || pdfUploading}
              className="px-3 py-1 text-xs font-medium bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-40 transition-colors whitespace-nowrap">
              {pdfUploading ? '処理中...' : 'PDF取込'}
            </button>
          </div>
          <span className="text-[10px] text-gray-400">PDF: 出勤表PDF（日付・名前・開始・終了・休憩を自動抽出）</span>
        </div>
      </div>

      {loading ? (
        <div className="card p-12 text-center">
          <svg className="animate-spin w-6 h-6 text-gray-400 mx-auto" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : tab === 'cpa' ? (
        /* ========== CPA比較テーブル ========== */
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
            <h2 className="text-sm font-bold text-gray-800">CPA指標 - 全員比較</h2>
            {cpaData && <span className="text-[10px] text-gray-400 ml-auto">{cpaData.dateFrom} 〜 {cpaData.dateTo}</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-2.5 px-3 font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10 min-w-[100px]">指標</th>
                  {cpaData && (
                    <>
                      <th className="text-right py-2.5 px-3 font-bold text-blue-700 bg-blue-50 min-w-[90px]">全体</th>
                      {cpaData.operators.map(op => (
                        <th key={op.userId} className="text-right py-2.5 px-3 font-semibold text-gray-700 min-w-[90px]">{op.name}</th>
                      ))}
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {cpaData && cpaColumns.map((col, i) => (
                  <tr key={col.key} className={`border-b border-gray-50 ${col.highlight ? 'bg-blue-50/30' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                    <td className={`py-2 px-3 font-medium sticky left-0 z-10 ${col.highlight ? 'text-blue-700 bg-blue-50/30' : 'text-gray-600 ' + (i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30')}`}>
                      {col.label}
                    </td>
                    <td className={`py-2 px-3 text-right font-bold ${col.highlight ? 'text-blue-700 bg-blue-50/50' : 'text-gray-900 bg-blue-50/20'}`}>
                      {formatCell(cpaData.team[col.key], col.format)}
                    </td>
                    {cpaData.operators.map(op => (
                      <td key={op.userId} className="py-2 px-3 text-right text-gray-800">
                        {formatCell(op[col.key], col.format)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ========== 案件質比較テーブル ========== */
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
            <h2 className="text-sm font-bold text-gray-800">案件質向上 - 全員比較</h2>
            {qualData && <span className="text-[10px] text-gray-400 ml-auto">{qualData.dateFrom} 〜 {qualData.dateTo}</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-2.5 px-3 font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10 min-w-[120px]">指標</th>
                  {qualData && (
                    <>
                      <th className="text-right py-2.5 px-3 font-bold text-blue-700 bg-blue-50 min-w-[100px]">全体</th>
                      {qualData.operators.map(op => (
                        <th key={op.userId} className="text-right py-2.5 px-3 font-semibold text-gray-700 min-w-[100px]">{op.name}</th>
                      ))}
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {qualData && qualColumns.map((col, i) => (
                  <tr key={col.key} className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                    <td className={`py-2 px-3 font-medium text-gray-600 sticky left-0 z-10 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                      {col.label}
                    </td>
                    {/* 全体 */}
                    <td className="py-2 px-3 text-right font-bold text-gray-900 bg-blue-50/20">
                      <span>{fmt(qualData.team[col.key])}</span>
                      {col.pctKey && (
                        <span className="ml-1 text-[10px] text-gray-400">({fmtPct(qualData.team[col.pctKey])})</span>
                      )}
                    </td>
                    {/* 各オペレーター */}
                    {qualData.operators.map(op => (
                      <td key={op.userId} className="py-2 px-3 text-right text-gray-800">
                        <span>{fmt(op[col.key])}</span>
                        {col.pctKey && (
                          <span className="ml-1 text-[10px] text-gray-400">({fmtPct(op[col.pctKey])})</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Layout>
  );
}
