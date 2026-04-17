/**
 * CPA / 案件質分析ページ
 * 全オペレーター比較テーブル表示
 * 週別は全週一覧表示
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api, { directApi } from '../../utils/api';
import toast from 'react-hot-toast';

const MONTHS = [];
for (let y = 2025; y <= 2027; y++) {
  for (let m = 1; m <= 12; m++) {
    MONTHS.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: `${y}年${m}月` });
  }
}

// 土曜〜金曜を1週間とする
const pad2 = (n) => String(n).padStart(2, '0');
const toLocalDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const getWeeksInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const firstDay = new Date(y, m - 1, 1);
  const lastDay = new Date(y, m, 0);
  const weeks = [];
  let start = new Date(firstDay);
  while (start <= lastDay) {
    // 金曜(5)までの日数を計算（土曜開始→金曜終了）
    const dayOfWeek = start.getDay(); // 0=Sun,...,5=Fri,6=Sat
    let daysToFriday = (5 - dayOfWeek + 7) % 7;
    if (daysToFriday === 0 && dayOfWeek !== 5) daysToFriday = 7;
    if (dayOfWeek === 5) daysToFriday = 0;
    const end = new Date(start);
    end.setDate(start.getDate() + daysToFriday);
    if (end > lastDay) end.setTime(lastDay.getTime());
    weeks.push({
      label: `${start.getMonth() + 1}/${start.getDate()}〜${end.getMonth() + 1}/${end.getDate()}`,
      dateFrom: toLocalDate(start),
      dateTo: toLocalDate(end),
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
  // 任意期間
  const [customFrom, setCustomFrom] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [customTo, setCustomTo] = useState(() => {
    return new Date().toISOString().slice(0, 10);
  });
  const [tab, setTab] = useState('cpa'); // cpa | quality

  // 月別・累計用（単一データ）
  const [cpaData, setCpaData] = useState(null);
  const [qualData, setQualData] = useState(null);

  // 週別用（全週のデータ配列）
  const [weeklyData, setWeeklyData] = useState([]); // [{ weekLabel, cpa, qual }]

  // 比較モード
  const [compareData, setCompareData] = useState([]); // [{ label, isMonth, cpa, qual }]
  const [compareScope, setCompareScope] = useState('team'); // 'team' | 'individual'
  const [compareUserId, setCompareUserId] = useState(null); // 個人選択時のuserId
  const [compareMonths, setCompareMonths] = useState(3); // 過去Nヶ月分
  const [operatorsList, setOperatorsList] = useState([]);
  const [expandedMonths, setExpandedMonths] = useState({}); // { ym: true } で展開

  const [loading, setLoading] = useState(true);

  // CSV
  const [csvFile, setCsvFile] = useState(null);
  const [csvUploading, setCsvUploading] = useState(false);

  // PDF
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfUploading, setPdfUploading] = useState(false);

  // 打刻ログCSV
  const [stampFile, setStampFile] = useState(null);
  const [stampUploading, setStampUploading] = useState(false);
  const [stampDuplicateModal, setStampDuplicateModal] = useState(null); // { duplicateCount, formData }

  useEffect(() => {
    if (user && !['admin','manager','consultant'].includes(user.role)) {
      router.push('/');
    }
  }, [user]);

  useEffect(() => {
    if (user && ['admin','manager','consultant'].includes(user.role)) {
      api.get('/api/analytics/operators').then(res => {
        setOperatorsList(res.data.data || []);
      }).catch(() => {});
    }
  }, [user]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (periodMode === 'compare') {
        // 比較モード: 直近Nヶ月 + 各月の週
        const now = new Date();
        const rows = [];
        const monthList = [];
        for (let i = compareMonths - 1; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          monthList.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
        }
        for (const ym of monthList) {
          const [y, m] = ym.split('-').map(Number);
          // 月合計
          const monthParams = { period: 'monthly', date: `${ym}-15` };
          const [cM, qM] = await Promise.all([
            api.get('/api/analytics/cpa-all', { params: monthParams }),
            api.get('/api/analytics/quality-all', { params: monthParams }),
          ]);
          rows.push({ label: `${m}月`, isMonth: true, ym, cpa: cM.data.data, qual: qM.data.data });
          // 各週
          const weeks = getWeeksInMonth(ym);
          const weekResults = await Promise.all(weeks.map(async w => {
            const p = { period: 'custom', date_from: w.dateFrom, date_to: w.dateTo };
            const [c, q] = await Promise.all([
              api.get('/api/analytics/cpa-all', { params: p }),
              api.get('/api/analytics/quality-all', { params: p }),
            ]);
            return { label: w.label, isMonth: false, ym, cpa: c.data.data, qual: q.data.data };
          }));
          rows.push(...weekResults);
        }
        setCompareData(rows);
        setCpaData(null);
        setQualData(null);
        setWeeklyData([]);
      } else if (periodMode === 'weekly') {
        // 全週分を一括取得
        const weeks = getWeeksInMonth(selectedMonth);
        const results = await Promise.all(
          weeks.map(async (w) => {
            const params = { period: 'custom', date_from: w.dateFrom, date_to: w.dateTo };
            const [cpaRes, qualRes] = await Promise.all([
              api.get('/api/analytics/cpa-all', { params }),
              api.get('/api/analytics/quality-all', { params }),
            ]);
            return { weekLabel: w.label, cpa: cpaRes.data.data, qual: qualRes.data.data };
          })
        );
        setWeeklyData(results);
        setCpaData(null);
        setQualData(null);
      } else if (periodMode === 'custom') {
        // 任意期間
        if (!customFrom || !customTo) return;
        const params = { period: 'custom', date_from: customFrom, date_to: customTo };
        const [cpaRes, qualRes] = await Promise.all([
          api.get('/api/analytics/cpa-all', { params }),
          api.get('/api/analytics/quality-all', { params }),
        ]);
        setCpaData(cpaRes.data.data);
        setQualData(qualRes.data.data);
        setWeeklyData([]);
      } else {
        // 月別・累計
        const params = periodMode === 'monthly'
          ? { period: 'monthly', date: `${selectedMonth}-15` }
          : { period: 'cumulative', date: new Date().toISOString().slice(0, 10) };
        const [cpaRes, qualRes] = await Promise.all([
          api.get('/api/analytics/cpa-all', { params }),
          api.get('/api/analytics/quality-all', { params }),
        ]);
        setCpaData(cpaRes.data.data);
        setQualData(qualRes.data.data);
        setWeeklyData([]);
      }
    } catch (err) {
      toast.error('データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [periodMode, selectedMonth, customFrom, customTo, compareMonths]);

  useEffect(() => {
    if (user && (['admin','manager','consultant'].includes(user.role))) {
      fetchData();
    }
  }, [fetchData, user]);

  const handleCsvUpload = async () => {
    if (!csvFile) return;
    setCsvUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', csvFile);
      const { data } = await directApi.post('/api/analytics/import-cost-csv', formData, {
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
      const { data } = await directApi.post('/api/analytics/import-cost-pdf', formData, {
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

  const handleStampUpload = async () => {
    if (!stampFile) return;
    setStampUploading(true);
    try {
      // まずdry_runで重複チェック
      const formData = new FormData();
      formData.append('file', stampFile);
      formData.append('duplicate_mode', 'dry_run');
      const { data } = await directApi.post('/api/analytics/import-stamp-csv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const dupCount = data.data.duplicateCount || 0;
      if (dupCount > 0) {
        // 重複あり → ポップアップで選択
        const fd = new FormData();
        fd.append('file', stampFile);
        setStampDuplicateModal({ duplicateCount: dupCount, formData: fd, total: data.data.total || 0, duplicates: data.data.duplicates || [] });
        setStampUploading(false);
        return;
      }
      // 重複なし → そのまま上書きで実行
      await executeStampImport('overwrite');
    } catch (err) {
      toast.error(err.response?.data?.message || '打刻ログインポートに失敗しました');
      setStampUploading(false);
    }
  };

  const executeStampImport = async (mode) => {
    setStampUploading(true);
    setStampDuplicateModal(null);
    try {
      const formData = new FormData();
      formData.append('file', stampFile);
      formData.append('duplicate_mode', mode);
      const { data } = await directApi.post('/api/analytics/import-stamp-csv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const skipMsg = data.data.skipped ? `（${data.data.skipped}件スキップ）` : '';
      toast.success(`打刻ログ: ${data.data.imported}件インポートしました${skipMsg}`);
      if (data.data.errors?.length > 0) {
        data.data.errors.forEach(e => toast.error(e, { duration: 5000 }));
      }
      setStampFile(null);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || '打刻ログインポートに失敗しました');
    } finally {
      setStampUploading(false);
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
    { key: 'interviewRate', label: '面接実施率', format: 'pct' },
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

  // CPA テーブル描画（再利用）
  const renderCpaTable = (data, title, subtitle) => (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
        <h2 className="text-sm font-bold text-gray-800">{title}</h2>
        {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left py-2.5 px-3 font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10 min-w-[100px]">名前</th>
              {cpaColumns.map(col => (
                <th key={col.key} className={`text-right py-2.5 px-3 font-semibold text-gray-600 whitespace-nowrap ${col.highlight ? 'bg-blue-50/50 text-blue-700' : ''}`}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* 全体行 */}
            <tr className="bg-blue-50/40 border-b-2 border-blue-200">
              <td className="py-2.5 px-3 font-bold text-blue-700 sticky left-0 z-10 bg-blue-50/40">全体</td>
              {cpaColumns.map(col => (
                <td key={col.key} className={`py-2.5 px-3 text-right font-bold text-blue-700 ${col.highlight ? 'bg-blue-50/60' : ''}`}>
                  {formatCell(data.team[col.key], col.format)}
                  {col.key === 'cost' && data.team.workHours > 0 && (
                    <span className="text-[10px] text-blue-400 font-normal ml-1">{data.team.workHours}h</span>
                  )}
                </td>
              ))}
            </tr>
            {/* 各オペレーター行 */}
            {[...data.operators].sort((a, b) => (a.role === 'intern') - (b.role === 'intern')).map((op, i) => {
              const rowBg = op.role === 'intern' ? 'bg-purple-50/60' : (i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30');
              return (
              <tr key={op.userId} className={`border-b border-gray-50 ${rowBg}`}>
                <td className={`py-2 px-3 font-medium text-gray-800 sticky left-0 z-10 ${rowBg}`}>
                  {op.name}{op.role === 'intern' && <span className="ml-1 text-[9px] text-purple-600 font-bold">[インターン]</span>}
                </td>
                {cpaColumns.map(col => (
                  <td key={col.key} className={`py-2 px-3 text-right text-gray-800 ${col.highlight ? 'font-semibold' : ''}`}>
                    {formatCell(op[col.key], col.format)}
                    {col.key === 'cost' && op.workHours > 0 && (
                      <span className="text-[10px] text-gray-400 ml-1">{op.workHours}h</span>
                    )}
                  </td>
                ))}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // 案件質テーブル描画（再利用）
  const renderQualTable = (data, title, subtitle) => (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
        <h2 className="text-sm font-bold text-gray-800">{title}</h2>
        {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left py-2.5 px-3 font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10 min-w-[100px]">名前</th>
              {qualColumns.map(col => (
                <th key={col.key} className="text-right py-2.5 px-3 font-semibold text-gray-600 whitespace-nowrap">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* 全体行 */}
            <tr className="bg-blue-50/40 border-b-2 border-blue-200">
              <td className="py-2.5 px-3 font-bold text-blue-700 sticky left-0 z-10 bg-blue-50/40">全体</td>
              {qualColumns.map(col => (
                <td key={col.key} className="py-2.5 px-3 text-right font-bold text-blue-700">
                  <span>{fmt(data.team[col.key])}</span>
                  {col.pctKey && (
                    <span className="ml-1 text-[10px] text-blue-400">({fmtPct(data.team[col.pctKey])})</span>
                  )}
                </td>
              ))}
            </tr>
            {/* 各オペレーター行 */}
            {[...data.operators].sort((a, b) => (a.role === 'intern') - (b.role === 'intern')).map((op, i) => {
              const rowBg = op.role === 'intern' ? 'bg-purple-50/60' : (i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30');
              return (
              <tr key={op.userId} className={`border-b border-gray-50 ${rowBg}`}>
                <td className={`py-2 px-3 font-medium text-gray-800 sticky left-0 z-10 ${rowBg}`}>
                  {op.name}{op.role === 'intern' && <span className="ml-1 text-[9px] text-purple-600 font-bold">[インターン]</span>}
                </td>
                {qualColumns.map(col => (
                  <td key={col.key} className="py-2 px-3 text-right text-gray-800">
                    <span>{fmt(op[col.key])}</span>
                    {col.pctKey && (
                      <span className="ml-1 text-[10px] text-gray-400">({fmtPct(op[col.pctKey])})</span>
                    )}
                  </td>
                ))}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // 比較テーブル: 月別 + 週別を縦に並べ、指標列を横に並べる
  const pickRow = (periodData) => {
    if (!periodData) return {};
    if (compareScope === 'team') return periodData.team || {};
    return periodData.operators?.find(o => o.userId === Number(compareUserId)) || {};
  };

  const toggleMonth = (ym) => {
    setExpandedMonths(prev => ({ ...prev, [ym]: !prev[ym] }));
  };

  const renderCompareTable = () => {
    const cols = tab === 'cpa' ? cpaColumns : qualColumns;
    const title = tab === 'cpa' ? 'CPA指標 - 期間比較' : '案件質向上 - 期間比較';
    const scopeLabel = compareScope === 'team' ? '全体' :
      (operatorsList.find(o => o.id === Number(compareUserId))?.name || '個人');
    // 月が折りたたまれている場合、その月に属する週は表示しない
    const visibleRows = compareData.filter(row => row.isMonth || expandedMonths[row.ym]);
    return (
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <h2 className="text-sm font-bold text-gray-800">{title}</h2>
          <span className="text-xs text-gray-500">対象: {scopeLabel} / 直近{compareMonths}ヶ月</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-2.5 px-3 font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10 min-w-[100px]">期間</th>
                {cols.map(col => (
                  <th key={col.key} className={`text-right py-2.5 px-3 font-semibold text-gray-600 whitespace-nowrap ${col.highlight ? 'bg-blue-50/50 text-blue-700' : ''}`}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, ri) => {
                const d = tab === 'cpa' ? row.cpa : row.qual;
                const r = pickRow(d);
                const rowBg = row.isMonth ? 'bg-purple-50/60 font-bold' : (ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/30');
                const isExpanded = expandedMonths[row.ym];
                return (
                  <React.Fragment key={ri}>
                    {/* 値の行 */}
                    <tr
                      className={`border-b border-gray-50 ${rowBg} ${row.isMonth ? 'cursor-pointer hover:bg-purple-100/60' : ''}`}
                      onClick={row.isMonth ? () => toggleMonth(row.ym) : undefined}
                    >
                      <td className={`py-2 px-3 sticky left-0 z-10 ${rowBg} ${row.isMonth ? 'text-purple-800' : 'text-gray-700'}`}>
                        {row.isMonth && (
                          <span className="inline-block mr-1 text-purple-600 text-[10px]">{isExpanded ? '▼' : '▶'}</span>
                        )}
                        {row.label}
                      </td>
                      {cols.map(col => (
                        <td key={col.key} className={`py-2 px-3 text-right text-gray-800 ${col.highlight ? 'font-semibold' : ''}`}>
                          {formatCell(r[col.key], col.format)}
                        </td>
                      ))}
                    </tr>
                    {/* 案件質の場合: 割合の行 */}
                    {tab === 'quality' && (
                      <tr className={`border-b border-gray-100 ${row.isMonth ? 'bg-purple-50/40' : (ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/20')}`}>
                        <td className={`py-1.5 px-3 sticky left-0 z-10 ${row.isMonth ? 'bg-purple-50/40' : (ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/20')} text-gray-400 text-[10px]`}>
                          -
                        </td>
                        {cols.map(col => (
                          <td key={col.key} className="py-1.5 px-3 text-right text-gray-400 text-[10px]">
                            {col.pctKey ? fmtPct(r[col.pctKey]) : '-'}
                          </td>
                        ))}
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {visibleRows.length === 0 && (
                <tr><td colSpan={cols.length + 1} className="py-8 text-center text-gray-400">データがありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
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
                { value: 'compare', label: '比較' },
                { value: 'monthly', label: '月別' },
                { value: 'weekly', label: '週別' },
                { value: 'cumulative', label: '累計' },
                { value: 'custom', label: '任意' },
              ].map(m => (
                <button key={m.value}
                  onClick={() => setPeriodMode(m.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    periodMode === m.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>{m.label}</button>
              ))}
            </div>
          </div>

          {/* 月選択（月別・週別のみ） */}
          {(periodMode === 'monthly' || periodMode === 'weekly') && (
            <div>
              <label className="input-label">月</label>
              <select className="input text-sm" value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}>
                {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          )}

          {/* 比較モードのオプション */}
          {periodMode === 'compare' && (
            <>
              <div>
                <label className="input-label">対象</label>
                <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
                  <button
                    onClick={() => setCompareScope('team')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      compareScope === 'team' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}>全体</button>
                  <button
                    onClick={() => {
                      setCompareScope('individual');
                      if (!compareUserId && operatorsList.length > 0) setCompareUserId(operatorsList[0].id);
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      compareScope === 'individual' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}>個人</button>
                </div>
              </div>
              {compareScope === 'individual' && (
                <div>
                  <label className="input-label">オペレーター</label>
                  <select className="input text-sm" value={compareUserId || ''}
                    onChange={e => setCompareUserId(Number(e.target.value))}>
                    {operatorsList.map(op => (
                      <option key={op.id} value={op.id}>{op.name}{op.role === 'intern' ? '[インターン]' : ''}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="input-label">期間</label>
                <select className="input text-sm" value={compareMonths}
                  onChange={e => setCompareMonths(Number(e.target.value))}>
                  <option value={2}>直近2ヶ月</option>
                  <option value={3}>直近3ヶ月</option>
                  <option value={6}>直近6ヶ月</option>
                  <option value={12}>直近12ヶ月</option>
                </select>
              </div>
            </>
          )}

          {/* 任意期間の日付ピッカー */}
          {periodMode === 'custom' && (
            <div className="flex items-end gap-2">
              <div>
                <label className="input-label">開始日</label>
                <input type="date" className="input text-sm" value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)} />
              </div>
              <span className="pb-2 text-gray-400">〜</span>
              <div>
                <label className="input-label">終了日</label>
                <input type="date" className="input text-sm" value={customTo}
                  onChange={e => setCustomTo(e.target.value)} />
              </div>
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
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-500 font-medium">打刻ログ取込:</span>
          <div className="flex items-center gap-2">
            <input type="file" accept=".csv" onChange={e => setStampFile(e.target.files?.[0] || null)}
              className="text-xs text-gray-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 w-48" />
            <button onClick={handleStampUpload} disabled={!stampFile || stampUploading}
              className="px-3 py-1 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-40 transition-colors whitespace-nowrap">
              {stampUploading ? '処理中...' : '打刻ログ取込'}
            </button>
          </div>
          <span className="text-[10px] text-gray-400">勤怠打刻ログCSV（Shift-JIS対応・出勤/退勤/休憩から稼働時間を自動計算）</span>
        </div>
      </div>

      {loading ? (
        <div className="card p-12 text-center">
          <svg className="animate-spin w-6 h-6 text-gray-400 mx-auto" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : periodMode === 'compare' ? (
        /* ========== 比較モード ========== */
        renderCompareTable()
      ) : periodMode === 'weekly' ? (
        /* ========== 週別: 全週一覧表示 ========== */
        <div className="space-y-5">
          {weeklyData.map((w, wi) => (
            <div key={wi}>
              {tab === 'cpa'
                ? renderCpaTable(w.cpa, `第${wi + 1}週`, w.weekLabel)
                : renderQualTable(w.qual, `第${wi + 1}週`, w.weekLabel)
              }
            </div>
          ))}
          {weeklyData.length === 0 && (
            <div className="card p-8 text-center text-sm text-gray-400">データがありません</div>
          )}
        </div>
      ) : tab === 'cpa' ? (
        /* ========== 月別・累計: CPA ========== */
        cpaData && renderCpaTable(cpaData, 'CPA指標 - 全員比較', `${cpaData.dateFrom} 〜 ${cpaData.dateTo}`)
      ) : (
        /* ========== 月別・累計: 案件質 ========== */
        qualData && renderQualTable(qualData, '案件質向上 - 全員比較', `${qualData.dateFrom} 〜 ${qualData.dateTo}`)
      )}

      {/* 打刻ログ重複確認モーダル */}
      {stampDuplicateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setStampDuplicateModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 bg-amber-50 rounded-t-xl">
              <h2 className="text-lg font-bold text-gray-900">重複データがあります</h2>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-gray-700">
                {stampDuplicateModal.total}件中 <span className="font-bold text-amber-600">{stampDuplicateModal.duplicateCount}件</span> が既に登録済みです。
              </p>
              {stampDuplicateModal.duplicates?.length > 0 && (
                <div className="mt-3 max-h-40 overflow-y-auto bg-gray-50 rounded-lg p-2 space-y-1">
                  {stampDuplicateModal.duplicates.map((d, i) => (
                    <div key={i} className="text-xs text-gray-600 flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 w-4">{i + 1}</span>
                      <span className="font-medium">{d.name}</span>
                      <span>{d.date}</span>
                      <span className="text-gray-400">既存: {d.existing}</span>
                      <span className="text-blue-500">→ 新: {d.new}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-500 mt-3">既存データをどうしますか？</p>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex flex-col gap-2">
              <button onClick={() => executeStampImport('overwrite')}
                className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
                上書き保存（既存データを最新に更新）
              </button>
              <button onClick={() => executeStampImport('skip')}
                className="w-full px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                スキップ（既存データを保持）
              </button>
              <button onClick={() => { setStampDuplicateModal(null); setStampUploading(false); }}
                className="w-full px-4 py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
