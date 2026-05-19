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

  const [periodMode, setPeriodMode] = useState('compare');
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
  const [compareMonths, setCompareMonths] = useState(6); // 過去Nヶ月分
  const [operatorsList, setOperatorsList] = useState([]);
  const [kpiModal, setKpiModal] = useState(null); // { date, userId, field, value }
  const [waitingModal, setWaitingModal] = useState(null); // { title, userId, dateFrom, dateTo, data, loading }
  const [industryModal, setIndustryModal] = useState(null); // { title, status, userId, dateFrom, dateTo, data, loading }
  const [expandedMonths, setExpandedMonths] = useState({}); // { ym: true } で展開

  const [loading, setLoading] = useState(true);

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
        // 全週分を一括取得（個別失敗を許容）
        const weeks = getWeeksInMonth(selectedMonth);
        const settled = await Promise.allSettled(
          weeks.map(async (w) => {
            const params = { period: 'custom', date_from: w.dateFrom, date_to: w.dateTo };
            const [cpaRes, qualRes] = await Promise.all([
              api.get('/api/analytics/cpa-all', { params }),
              api.get('/api/analytics/quality-all', { params }),
            ]);
            return { weekLabel: w.label, cpa: cpaRes.data.data, qual: qualRes.data.data };
          })
        );
        const results = [];
        let failed = 0;
        settled.forEach((r, idx) => {
          if (r.status === 'fulfilled') {
            results.push(r.value);
          } else {
            failed++;
            // データなしのプレースホルダで残す
            const w = weeks[idx];
            const empty = { team: {}, operators: [], dateFrom: w.dateFrom, dateTo: w.dateTo };
            results.push({ weekLabel: w.label, cpa: empty, qual: empty });
            // eslint-disable-next-line no-console
            console.error('[weekly fetch failed]', w.label, r.reason);
          }
        });
        if (failed > 0) {
          toast.error(`${failed}週分のデータ取得に失敗しました`);
        }
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
      const msg = err.response?.data?.message || err.message;
      toast.error(`PDFインポート失敗: ${msg}`, { duration: 10000 });
      // eslint-disable-next-line no-console
      console.error('[PDF import error]', err.response?.data || err);
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
    { key: 'naiteiCount', label: '内定', clickable: 'industry:NAITEI' },
    { key: 'fugokakuCount', label: '不合格' },
    { key: 'barashiLostCount', label: 'バラシ/失注' },
    { key: 'initialPayment', label: '初回入金', format: 'yen', highlight: true },
    { key: 'expectedRevenue', label: '見込売上', format: 'yen' },
    { key: 'roas', label: 'ROAS', format: 'pct', highlight: true },
  ];

  // 案件質指標の列定義
  // clickable: 'waiting' = 連絡待ち / 'industry:STATUS' = 業種別内訳モーダル
  const qualColumns = [
    { key: 'total', label: '案件数' },
    { key: 'lost', label: '失注', pctKey: 'lostPct', clickable: 'industry:LOST' },
    { key: 'waitingContact', label: '連絡待ち', pctKey: 'waitingContactPct', clickable: 'waiting' },
    { key: 'screeningInProgress', label: '書類選考中', pctKey: 'screeningInProgressPct' },
    { key: 'interviewSet', label: '面接日確定', pctKey: 'interviewSetPct' },
    { key: 'interviewDone', label: '面接実施', pctKey: 'interviewDonePct' },
    { key: 'barashi', label: 'バラシ', pctKey: 'barashiPct', clickable: 'industry:BARASHI' },
    { key: 'onlineInterview', label: 'オンライン面接', pctKey: 'onlineInterviewPct' },
    { key: 'noScreening', label: '書類選考無し', pctKey: 'noScreeningPct' },
    { key: 'screeningFailed', label: '書類選考落ち', pctKey: 'screeningFailedPct' },
  ];

  const formatCell = (value, format) => {
    if (format === 'yen') return fmtYen(value);
    if (format === 'pct') return fmtPct(value);
    return fmt(value);
  };

  // 全列の値が0/null/undefinedならtrue（空オペレーターを非表示にするため）
  const isAllZero = (op, columns) => {
    for (const col of columns) {
      const v = op?.[col.key];
      if (v != null && Number(v) !== 0) return false;
    }
    return true;
  };

  // CPA テーブル描画（再利用）
  const renderCpaTable = (data, title, subtitle) => (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
        <h2 className="text-sm font-bold text-gray-800">{title}</h2>
        {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
      </div>
      <div className="overflow-auto max-h-[calc(100vh-260px)]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-30">
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left py-2.5 px-3 font-semibold text-gray-600 sticky left-0 bg-gray-50 z-40 min-w-[100px]">名前</th>
              {cpaColumns.map(col => (
                <th key={col.key} className={`text-right py-2.5 px-3 font-semibold whitespace-nowrap ${col.highlight ? 'bg-blue-50/50 text-blue-700' : 'bg-gray-50 text-gray-600'}`}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* 全体行 */}
            <tr className="bg-blue-50/40 border-b-2 border-blue-200">
              <td className="py-2.5 px-3 font-bold text-blue-700 sticky left-0 z-10 bg-blue-50/40">全体</td>
              {cpaColumns.map(col => {
                const v = data.team[col.key];
                const canClick = col.clickable && Number(v) > 0;
                return (
                  <td key={col.key} className={`py-2.5 px-3 text-right font-bold text-blue-700 ${col.highlight ? 'bg-blue-50/60' : ''}`}>
                    {canClick ? (
                      <button onClick={() => dispatchCellClick(col, data, null, '全体')} className="hover:underline cursor-pointer">
                        {formatCell(v, col.format)}
                      </button>
                    ) : (
                      <span>{formatCell(v, col.format)}</span>
                    )}
                    {col.key === 'cost' && data.team.workHours > 0 && (
                      <span className="text-[10px] text-blue-400 font-normal ml-1">{data.team.workHours}h</span>
                    )}
                  </td>
                );
              })}
            </tr>
            {/* 各オペレーター行（全0は非表示） */}
            {[...data.operators]
              .filter(op => !isAllZero(op, cpaColumns))
              .sort((a, b) => (a.role === 'intern') - (b.role === 'intern')).map((op, i) => {
              const rowBg = op.role === 'intern' ? 'bg-purple-50/60' : (i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30');
              return (
              <tr key={op.userId} className={`border-b border-gray-50 ${rowBg}`}>
                <td className={`py-2 px-3 font-medium text-gray-800 sticky left-0 z-10 ${rowBg}`}>
                  {op.name}{op.role === 'intern' && <span className="ml-1 text-[9px] text-purple-600 font-bold">[インターン]</span>}
                </td>
                {cpaColumns.map(col => {
                  const v = op[col.key];
                  const canClick = col.clickable && Number(v) > 0;
                  return (
                    <td key={col.key} className={`py-2 px-3 text-right text-gray-800 ${col.highlight ? 'font-semibold' : ''}`}>
                      {canClick ? (
                        <button onClick={() => dispatchCellClick(col, data, op.userId, op.name)} className="text-blue-600 hover:underline cursor-pointer">
                          {formatCell(v, col.format)}
                        </button>
                      ) : (
                        <span>{formatCell(v, col.format)}</span>
                      )}
                      {col.key === 'cost' && op.workHours > 0 && (
                        <span className="text-[10px] text-gray-400 ml-1">{op.workHours}h</span>
                      )}
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ディスパッチ: col.clickable に応じて適切なモーダルを開く
  const dispatchCellClick = (col, data, userId, name) => {
    if (!col.clickable) return;
    if (col.clickable === 'waiting') {
      openWaitingDetail(data, userId, name);
    } else if (col.clickable.startsWith('industry:')) {
      const status = col.clickable.split(':')[1];
      openIndustryDetail(data, userId, name, status);
    }
  };

  // 業種別内訳モーダル
  const openIndustryDetail = async (data, userId, name, status) => {
    if (!data) return;
    const dateFrom = data.dateFrom || (status === 'NAITEI' ? '2026-01-01' : '2026-04-01');
    const dateTo = data.dateTo || new Date().toISOString().slice(0, 10);
    const labelMap = { LOST: '失注', BARASHI: 'バラシ', NAITEI: '内定' };
    setIndustryModal({
      title: `${name} - ${labelMap[status] || status} 業種別内訳`,
      status, userId, dateFrom, dateTo,
      data: null, loading: true,
    });
    try {
      const params = new URLSearchParams({ status, date_from: dateFrom, date_to: dateTo });
      if (userId) params.append('user_id', userId);
      const { data: res } = await api.get(`/api/analytics/quality-industry-detail?${params}`);
      if (res.success) {
        setIndustryModal(prev => prev ? { ...prev, data: res.data, loading: false } : null);
      }
    } catch (err) {
      toast.error('明細の取得に失敗しました');
      setIndustryModal(null);
    }
  };

  // 連絡待ち明細を開く
  const openWaitingDetail = async (data, userId, name) => {
    if (!data) return;
    const dateFrom = data.dateFrom || '2026-04-01';
    const dateTo = data.dateTo || new Date().toISOString().slice(0, 10);
    setWaitingModal({
      title: `${name}の連絡待ち明細`, userId, dateFrom, dateTo,
      data: null, loading: true,
    });
    try {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      if (userId) params.append('user_id', userId);
      const { data: res } = await api.get(`/api/analytics/waiting-contact-detail?${params}`);
      if (res.success) {
        setWaitingModal(prev => prev ? { ...prev, data: res.data, loading: false } : null);
      }
    } catch (err) {
      toast.error('明細の取得に失敗しました');
      setWaitingModal(null);
    }
  };

  // 案件質テーブル描画（再利用）
  const renderQualTable = (data, title, subtitle) => (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
        <h2 className="text-sm font-bold text-gray-800">{title}</h2>
        {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
      </div>
      <div className="overflow-auto max-h-[calc(100vh-260px)]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-30">
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left py-2.5 px-3 font-semibold text-gray-600 sticky left-0 bg-gray-50 z-40 min-w-[100px]">名前</th>
              {qualColumns.map(col => (
                <th key={col.key} className="text-right py-2.5 px-3 font-semibold text-gray-600 whitespace-nowrap bg-gray-50">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* 全体行 */}
            <tr className="bg-blue-50/40 border-b-2 border-blue-200">
              <td className="py-2.5 px-3 font-bold text-blue-700 sticky left-0 z-10 bg-blue-50/40">全体</td>
              {qualColumns.map(col => {
                const v = data.team[col.key];
                const canClick = col.clickable && Number(v) > 0;
                return (
                  <td key={col.key} className="py-2.5 px-3 text-right font-bold text-blue-700">
                    {canClick ? (
                      <button onClick={() => dispatchCellClick(col, data, null, '全体')} className="hover:underline cursor-pointer">
                        {fmt(v)}
                      </button>
                    ) : (
                      <span>{fmt(v)}</span>
                    )}
                    {col.pctKey && (
                      <span className="ml-1 text-[10px] text-blue-400">({fmtPct(data.team[col.pctKey])})</span>
                    )}
                  </td>
                );
              })}
            </tr>
            {/* 各オペレーター行（全0は非表示） */}
            {[...data.operators]
              .filter(op => !isAllZero(op, qualColumns))
              .sort((a, b) => (a.role === 'intern') - (b.role === 'intern')).map((op, i) => {
              const rowBg = op.role === 'intern' ? 'bg-purple-50/60' : (i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30');
              return (
              <tr key={op.userId} className={`border-b border-gray-50 ${rowBg}`}>
                <td className={`py-2 px-3 font-medium text-gray-800 sticky left-0 z-10 ${rowBg}`}>
                  {op.name}{op.role === 'intern' && <span className="ml-1 text-[9px] text-purple-600 font-bold">[インターン]</span>}
                </td>
                {qualColumns.map(col => {
                  const v = op[col.key];
                  const canClick = col.clickable && Number(v) > 0;
                  return (
                    <td key={col.key} className="py-2 px-3 text-right text-gray-800">
                      {canClick ? (
                        <button onClick={() => dispatchCellClick(col, data, op.userId, op.name)} className="text-blue-600 hover:underline cursor-pointer">
                          {fmt(v)}
                        </button>
                      ) : (
                        <span>{fmt(v)}</span>
                      )}
                      {col.pctKey && (
                        <span className="ml-1 text-[10px] text-gray-400">({fmtPct(op[col.pctKey])})</span>
                      )}
                    </td>
                  );
                })}
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
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-30">
              <tr className="bg-indigo-50 border-b-2 border-indigo-200">
                <th className="text-left py-3 px-4 font-bold text-indigo-900 sticky left-0 bg-indigo-50 z-40 min-w-[120px]">期間</th>
                {cols.map(col => (
                  <th key={col.key} className={`text-right py-3 px-4 font-bold whitespace-nowrap ${col.highlight ? 'bg-blue-100 text-blue-800' : 'bg-indigo-50 text-indigo-900'}`}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, ri) => {
                const d = tab === 'cpa' ? row.cpa : row.qual;
                const r = pickRow(d);
                const isExpanded = expandedMonths[row.ym];
                // 月行: 濃い紫 / 週行: 交互の薄い色
                const rowBg = row.isMonth
                  ? 'bg-purple-100 font-bold'
                  : (ri % 2 === 0 ? 'bg-white' : 'bg-blue-50/40');
                const pctRowBg = row.isMonth
                  ? 'bg-purple-50'
                  : (ri % 2 === 0 ? 'bg-white' : 'bg-blue-50/20');
                return (
                  <React.Fragment key={ri}>
                    {/* 値の行 */}
                    <tr
                      className={`border-b ${row.isMonth ? 'border-purple-200' : 'border-gray-100'} ${rowBg} ${row.isMonth ? 'cursor-pointer hover:bg-purple-200 transition-colors' : ''}`}
                      onClick={row.isMonth ? () => toggleMonth(row.ym) : undefined}
                    >
                      <td className={`py-3 px-4 sticky left-0 z-10 ${rowBg} ${row.isMonth ? 'text-purple-900 text-base' : 'text-gray-700'}`}>
                        {row.isMonth ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-purple-600 text-xs">{isExpanded ? '▼' : '▶'}</span>
                            <span className="font-bold">{row.label}</span>
                          </span>
                        ) : (
                          <span className="pl-5 text-gray-600">{row.label}</span>
                        )}
                      </td>
                      {cols.map(col => {
                        const v = r[col.key];
                        const dateFromForClick = d?.dateFrom || (row.ym ? `${row.ym}-01` : null);
                        const dateToForClick = d?.dateTo || (row.ym ? (() => {
                          const [yy, mm] = row.ym.split('-').map(Number);
                          const last = new Date(yy, mm, 0).getDate();
                          return `${row.ym}-${String(last).padStart(2, '0')}`;
                        })() : null);
                        const canClick = col.clickable && Number(v) > 0 && dateFromForClick;
                        const userIdForClick = compareScope === 'team' ? null : Number(compareUserId);
                        const userNameForClick = compareScope === 'team'
                          ? '全体'
                          : (operatorsList.find(o => o.id === Number(compareUserId))?.name || '個人');
                        const handleCellClick = (e) => {
                          e.stopPropagation();
                          dispatchCellClick(
                            col,
                            { dateFrom: dateFromForClick, dateTo: dateToForClick },
                            userIdForClick,
                            `${userNameForClick} - ${row.label}`
                          );
                        };
                        return (
                          <td
                            key={col.key}
                            className={`py-3 px-4 text-right ${canClick ? '!text-blue-700 underline decoration-dotted underline-offset-4 cursor-pointer hover:bg-blue-50' : (row.isMonth ? 'text-purple-900 font-bold' : 'text-gray-800')} ${col.highlight ? 'font-bold' : ''}`}
                            onClick={canClick ? handleCellClick : undefined}
                            title={canClick ? '内訳を表示' : undefined}
                          >
                            {formatCell(v, col.format)}
                          </td>
                        );
                      })}
                    </tr>
                    {/* 案件質の場合: 割合の行 */}
                    {tab === 'quality' && (
                      <tr className={`border-b border-gray-100 ${pctRowBg}`}>
                        <td className={`py-2 px-4 sticky left-0 z-10 ${pctRowBg} text-gray-400 text-xs`}>
                          <span className={row.isMonth ? 'pl-4' : 'pl-5'}>割合</span>
                        </td>
                        {cols.map(col => (
                          <td key={col.key} className={`py-2 px-4 text-right text-xs ${row.isMonth ? 'text-purple-600 font-semibold' : 'text-gray-500'}`}>
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

          {/* 手動補正ボタン */}
          <div>
            <label className="input-label">&nbsp;</label>
            <button
              onClick={() => setKpiModal({ date: new Date().toISOString().slice(0, 10), userId: '', field: 'q_interview_set', value: 0 })}
              className="px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 rounded-md shadow-sm whitespace-nowrap"
            >
              手動補正
            </button>
          </div>
        </div>

        {/* データ取り込み */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-500 font-medium">コストPDF取込:</span>
          <div className="flex items-center gap-2">
            <input type="file" accept=".pdf" onChange={e => setPdfFile(e.target.files?.[0] || null)}
              className="text-xs text-gray-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100 w-48" />
            <button onClick={handlePdfUpload} disabled={!pdfFile || pdfUploading}
              className="px-3 py-1 text-xs font-medium bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-40 transition-colors whitespace-nowrap">
              {pdfUploading ? '処理中...' : 'PDF取込'}
            </button>
          </div>
          <span className="text-xs text-gray-500 font-medium ml-2">打刻ログ取込:</span>
          <div className="flex items-center gap-2">
            <input type="file" accept=".csv" onChange={e => setStampFile(e.target.files?.[0] || null)}
              className="text-xs text-gray-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 w-48" />
            <button onClick={handleStampUpload} disabled={!stampFile || stampUploading}
              className="px-3 py-1 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-40 transition-colors whitespace-nowrap">
              {stampUploading ? '処理中...' : '打刻ログ取込'}
            </button>
          </div>
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

      {/* 手動補正モーダル */}
      {kpiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setKpiModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 bg-amber-50 rounded-t-xl">
              <h2 className="text-lg font-bold text-gray-900">KPI手動補正</h2>
              <p className="text-xs text-gray-500 mt-1">指定日・対象者・項目の値を強制的に上書きします</p>
            </div>
            <div className="px-6 py-5 space-y-3">
              <div>
                <label className="input-label">対象日</label>
                <input type="date" className="input text-sm" value={kpiModal.date}
                  onChange={e => setKpiModal({...kpiModal, date: e.target.value})} />
              </div>
              <div>
                <label className="input-label">対象オペレーター</label>
                <select className="input text-sm" value={kpiModal.userId}
                  onChange={e => setKpiModal({...kpiModal, userId: e.target.value})}>
                  <option value="">選択してください</option>
                  {operatorsList.map(op => (
                    <option key={op.id} value={op.id}>{op.name}{op.role === 'intern' ? '[インターン]' : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="input-label">項目</label>
                <select className="input text-sm" value={kpiModal.field}
                  onChange={e => setKpiModal({...kpiModal, field: e.target.value})}>
                  <optgroup label="CPA指標">
                    <option value="project_count">案件数</option>
                    <option value="call_count">コール数</option>
                  </optgroup>
                  <optgroup label="案件質向上">
                    <option value="q_lost">失注</option>
                    <option value="q_waiting_contact">連絡待ち</option>
                    <option value="q_screening_in_progress">書類選考中</option>
                    <option value="q_interview_set">面接日確定</option>
                    <option value="q_interview_done">面接実施</option>
                    <option value="q_barashi">バラシ</option>
                    <option value="q_online_interview">オンライン面接</option>
                    <option value="q_no_screening">書類選考無し</option>
                    <option value="q_screening_failed">書類選考落ち</option>
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="input-label">補正後の値（その日の合計値）</label>
                <input type="number" className="input text-sm" value={kpiModal.value}
                  onChange={e => setKpiModal({...kpiModal, value: e.target.value})} />
                <p className="text-[10px] text-gray-400 mt-1">※実データとの差分が補正として記録されます</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex gap-2">
              <button
                onClick={async () => {
                  if (!kpiModal.userId || !kpiModal.date || !kpiModal.field) {
                    toast.error('全項目を入力してください'); return;
                  }
                  try {
                    await api.put('/api/admin/kpi-adjustment', {
                      user_id: Number(kpiModal.userId),
                      date: kpiModal.date,
                      field: kpiModal.field,
                      value: Number(kpiModal.value) || 0,
                    });
                    toast.success('補正を保存しました');
                    setKpiModal(null);
                    fetchData();
                  } catch (err) {
                    toast.error(err.response?.data?.message || '保存に失敗しました');
                  }
                }}
                className="flex-1 btn-primary"
              >保存</button>
              <button onClick={() => setKpiModal(null)} className="flex-1 btn-secondary">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* 連絡待ち明細モーダル */}
      {waitingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setWaitingModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] mx-4 overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{waitingModal.title}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{waitingModal.dateFrom} 〜 {waitingModal.dateTo}（2026/4以降の案件のみ）</p>
              </div>
              <button onClick={() => setWaitingModal(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <div className="overflow-auto p-5 space-y-5 flex-1">
              {waitingModal.loading ? (
                <p className="text-center py-8 text-gray-400 text-sm">読み込み中...</p>
              ) : !waitingModal.data ? (
                <p className="text-center py-8 text-gray-400 text-sm">データなし</p>
              ) : (
                <>
                  {/* 面接日が決まっている */}
                  <section>
                    <h3 className="font-bold text-sm text-amber-700 mb-2 flex items-center gap-2">
                      <span className="inline-block px-2 py-0.5 rounded bg-amber-100">面接日確定済み</span>
                      <span className="text-gray-700">{waitingModal.data.withInterview.length}件</span>
                    </h3>
                    {waitingModal.data.withInterview.length === 0 ? (
                      <p className="text-xs text-gray-400 px-2">該当なし</p>
                    ) : (
                      <table className="w-full text-xs border">
                        <thead className="bg-amber-50">
                          <tr>
                            <th className="text-left px-2 py-1.5">企業名</th>
                            <th className="text-left px-2 py-1.5">求人番号</th>
                            <th className="text-left px-2 py-1.5">担当OP</th>
                            <th className="text-left px-2 py-1.5">担当営業</th>
                            <th className="text-left px-2 py-1.5">案件獲得日</th>
                            <th className="text-left px-2 py-1.5">面接日</th>
                          </tr>
                        </thead>
                        <tbody>
                          {waitingModal.data.withInterview.map(p => (
                            <tr key={p.projectId} className="border-t hover:bg-gray-50">
                              <td className="px-2 py-1">
                                <a href={`/admin/projects?focus=${p.projectId}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                  {p.companyName || '-'}
                                </a>
                              </td>
                              <td className="px-2 py-1">{p.jobNumber || '-'}</td>
                              <td className="px-2 py-1">{p.ownerName || '-'}</td>
                              <td className="px-2 py-1">{p.salesName || '-'}</td>
                              <td className="px-2 py-1">{p.createdAt ? new Date(p.createdAt).toLocaleDateString('ja-JP') : '-'}</td>
                              <td className="px-2 py-1 font-semibold text-amber-700">{p.interviewDate ? new Date(p.interviewDate).toLocaleDateString('ja-JP') : '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </section>

                  {/* 面接日未確定 */}
                  <section>
                    <h3 className="font-bold text-sm text-rose-700 mb-2 flex items-center gap-2">
                      <span className="inline-block px-2 py-0.5 rounded bg-rose-100">面接日未確定</span>
                      <span className="text-gray-700">{waitingModal.data.withoutInterview.length}件</span>
                    </h3>
                    {waitingModal.data.withoutInterview.length === 0 ? (
                      <p className="text-xs text-gray-400 px-2">該当なし</p>
                    ) : (
                      <table className="w-full text-xs border">
                        <thead className="bg-rose-50">
                          <tr>
                            <th className="text-left px-2 py-1.5">企業名</th>
                            <th className="text-left px-2 py-1.5">求人番号</th>
                            <th className="text-left px-2 py-1.5">担当OP</th>
                            <th className="text-left px-2 py-1.5">担当営業</th>
                            <th className="text-left px-2 py-1.5">案件獲得日</th>
                            <th className="text-left px-2 py-1.5">メモ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {waitingModal.data.withoutInterview.map(p => (
                            <tr key={p.projectId} className="border-t hover:bg-gray-50">
                              <td className="px-2 py-1">
                                <a href={`/admin/projects?focus=${p.projectId}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                  {p.companyName || '-'}
                                </a>
                              </td>
                              <td className="px-2 py-1">{p.jobNumber || '-'}</td>
                              <td className="px-2 py-1">{p.ownerName || '-'}</td>
                              <td className="px-2 py-1">{p.salesName || '-'}</td>
                              <td className="px-2 py-1">{p.createdAt ? new Date(p.createdAt).toLocaleDateString('ja-JP') : '-'}</td>
                              <td className="px-2 py-1 text-gray-500 max-w-[200px] truncate">{p.memo || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 業種別内訳モーダル（失注/バラシ/内定） */}
      {industryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setIndustryModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] mx-4 overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{industryModal.title}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{industryModal.dateFrom} 〜 {industryModal.dateTo}</p>
              </div>
              <button onClick={() => setIndustryModal(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <div className="overflow-auto p-5 space-y-5 flex-1">
              {industryModal.loading ? (
                <p className="text-center py-8 text-gray-400 text-sm">読み込み中...</p>
              ) : !industryModal.data || industryModal.data.total === 0 ? (
                <p className="text-center py-8 text-gray-400 text-sm">該当案件はありません</p>
              ) : (
                <>
                  {/* 業種別件数（サマリ） */}
                  <section>
                    <h3 className="font-bold text-sm text-gray-700 mb-2">業種別内訳（合計 {industryModal.data.total}件）</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {industryModal.data.industries.map(ind => {
                        const pct = industryModal.data.total > 0 ? Math.round(ind.count / industryModal.data.total * 1000) / 10 : 0;
                        return (
                          <div key={ind.industry} className="flex items-center justify-between border rounded px-3 py-2 bg-gray-50">
                            <span className="text-sm font-medium">{ind.industry}</span>
                            <span className="text-sm text-blue-700 font-bold">
                              {ind.count}件 <span className="text-xs text-gray-500 font-normal">({pct}%)</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* 案件明細 */}
                  <section>
                    <h3 className="font-bold text-sm text-gray-700 mb-2">案件明細</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="text-left px-2 py-1.5">求人番号</th>
                            <th className="text-left px-2 py-1.5">企業名</th>
                            <th className="text-left px-2 py-1.5">業種</th>
                            <th className="text-left px-2 py-1.5">担当OP</th>
                            <th className="text-left px-2 py-1.5">担当営業</th>
                            <th className="text-left px-2 py-1.5">案件獲得日</th>
                            {industryModal.status === 'NAITEI' && (
                              <th className="text-left px-2 py-1.5">内定日</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {industryModal.data.projects.map(p => (
                            <tr key={p.id} className="border-t hover:bg-gray-50">
                              <td className="px-2 py-1">{p.job_number || '-'}</td>
                              <td className="px-2 py-1">
                                <a href={`/admin/projects?focus=${p.id}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                  {p.company_name || '-'}
                                </a>
                              </td>
                              <td className="px-2 py-1">{p.industry || '-'}</td>
                              <td className="px-2 py-1">{p.owner_name || '-'}</td>
                              <td className="px-2 py-1">{p.sales_name || '-'}</td>
                              <td className="px-2 py-1">{p.created_at ? new Date(p.created_at).toLocaleDateString('ja-JP') : '-'}</td>
                              {industryModal.status === 'NAITEI' && (
                                <td className="px-2 py-1 font-semibold text-emerald-700">
                                  {p.naitei_date ? new Date(p.naitei_date).toLocaleDateString('ja-JP') : '-'}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
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
