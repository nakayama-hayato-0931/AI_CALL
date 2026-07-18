/**
 * CPA / 案件質分析ページ
 * 全オペレーター比較テーブル表示
 * 週別は全週一覧表示
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import ProjectDetailContent from '../../components/projects/ProjectDetailContent';
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
  // URL クエリの ?work_category=specific_skill を全 API 呼び出しに伝播 (管理者の特定技能管理リンク用)
  const workCategoryQuery = typeof router.query.work_category === 'string' ? router.query.work_category : '';
  // params に work_category を挟むヘルパー
  const withWc = (p) => workCategoryQuery ? { ...p, work_category: workCategoryQuery } : p;

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
  // CPA集計の日付基準: 'acquisition'(案件獲得日, 既定) / 'naitei'(内定日)
  const [cpaBase, setCpaBase] = useState('acquisition');

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
  // 案件詳細モーダル (内訳テーブル内の企業名クリックで開く)
  const [detailProjectId, setDetailProjectId] = useState(null);
  const [expandedMonths, setExpandedMonths] = useState({}); // { ym: true } で展開
  const [qualityTargets, setQualityTargets] = useState({}); // 案件質向上 月別目標(%) 手入力(localStorage保存)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('quality_monthly_targets');
      if (saved) setQualityTargets(JSON.parse(saved));
    } catch (e) { /* ignore */ }
  }, []);

  const [loading, setLoading] = useState(true);

  // PDF
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  // 給与PDFインポート用の年月
  const [pdfYearMonth, setPdfYearMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  // 給与手動貼り付けモーダル
  const [payrollPasteOpen, setPayrollPasteOpen] = useState(false);
  const [payrollText, setPayrollText] = useState('');
  const [payrollUploading, setPayrollUploading] = useState(false);
  // 月次追加コスト（コンサル料など）モーダル
  const [extraCostsOpen, setExtraCostsOpen] = useState(false);
  const [extraCostsList, setExtraCostsList] = useState([]);
  const [extraCostsLoading, setExtraCostsLoading] = useState(false);
  const [newExtra, setNewExtra] = useState({ period_ym: '', category: 'コンサル料', amount: '', memo: '' });
  // CPA表示モード: 'v2' (デフォルト, fax-crm互換) / 'v1' (旧CPA)
  const [cpaMode, setCpaMode] = useState('v2');
  // 新CPA(v2) 内訳モーダル: { type:'offers'|'interviews'|'rejects', month, data, loading }
  const [v2Modal, setV2Modal] = useState(null);
  // 書類選考中 詳細モーダル: { title, data, loading }
  const [screeningModal, setScreeningModal] = useState(null);
  const [interviewSetModal, setInterviewSetModal] = useState(null);
  const [interviewDoneModal, setInterviewDoneModal] = useState(null);

  const openExtraCostsModal = async () => {
    setExtraCostsOpen(true);
    setExtraCostsLoading(true);
    const ym = (() => {
      const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    })();
    setNewExtra(prev => ({ ...prev, period_ym: prev.period_ym || ym }));
    try {
      const { data } = await api.get('/api/analytics/extra-costs');
      if (data.success) setExtraCostsList(data.data || []);
    } catch (err) {
      toast.error('追加コスト取得失敗');
    } finally {
      setExtraCostsLoading(false);
    }
  };
  const saveExtraCost = async () => {
    if (!/^\d{4}-\d{2}$/.test(newExtra.period_ym)) { toast.error('対象月を選択してください'); return; }
    if (!newExtra.amount) { toast.error('金額を入力してください'); return; }
    try {
      await api.post('/api/analytics/extra-costs', {
        period_ym: newExtra.period_ym,
        category: newExtra.category || 'その他',
        amount: parseInt(newExtra.amount, 10),
        memo: newExtra.memo || null,
      });
      toast.success('追加しました');
      setNewExtra({ period_ym: newExtra.period_ym, category: 'コンサル料', amount: '', memo: '' });
      const { data } = await api.get('/api/analytics/extra-costs');
      if (data.success) setExtraCostsList(data.data || []);
      fetchData();
    } catch (err) {
      toast.error('保存失敗');
    }
  };
  const deleteExtraCost = async (id) => {
    if (typeof window !== 'undefined' && !window.confirm('削除しますか？')) return;
    try {
      await api.delete(`/api/analytics/extra-costs/${id}`);
      toast.success('削除しました');
      setExtraCostsList(prev => prev.filter(r => r.id !== id));
      fetchData();
    } catch (err) {
      toast.error('削除失敗');
    }
  };

  const handlePayrollManualImport = async () => {
    if (!payrollText.trim()) { toast.error('データを貼り付けてください'); return; }
    if (!pdfYearMonth) { toast.error('対象月を選択してください'); return; }
    setPayrollUploading(true);
    try {
      const { data } = await api.post('/api/analytics/import-payroll-manual', {
        year_month: pdfYearMonth,
        text: payrollText,
      });
      const d = data.data || {};
      // eslint-disable-next-line no-console
      console.log('[payroll manual import]', d);
      if (d.imported > 0) {
        toast.success(`${d.imported}件インポート: ${(d.matched || []).map(m => m.name).join(', ')}`, { duration: 8000 });
        setPayrollPasteOpen(false);
        setPayrollText('');
      } else {
        toast.error(`0件。未マッチ: ${(d.unmatched || []).join(', ') || 'なし'}`, { duration: 10000 });
      }
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    } finally {
      setPayrollUploading(false);
    }
  };

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

  // cpaBase ('acquisition' | 'naitei') → v2 API の basis ('acquired' | 'offer')
  const v2Basis = () => (cpaBase === 'naitei' ? 'offer' : 'acquired');

  // 新CPA(v2) 月別データを取得して { 'YYYY-MM': row } のマップを返す。
  // 取得失敗時は空マップ (旧CPAにフォールバック)。
  const fetchV2Monthly = async () => {
    try {
      const { data } = await api.get('/api/cpa-v2/monthly', { params: { basis: v2Basis(), months: 36 } });
      if (!data?.success) return new Map();
      const map = new Map();
      for (const r of data.data?.rows || []) {
        const ym = String(r.month).slice(0, 7); // 'YYYY-MM'
        map.set(ym, r);
      }
      return map;
    } catch (e) { return new Map(); }
  };

  // v1のteam(または個人)行に v2 由来の「内定/入金/面接/不合格/バラシ/初回入金/見込売上」を被せる。
  // - cost / コール数 / 案件数 / 案件化率 etc は v1 のまま
  // - 派生指標 (案件CPA / 面接CPA / 面接実施率 / ROAS / actualRoas) は再計算
  // - 個人別行や週別は v2 由来データがないため未マージ (旧CPAのまま)
  const mergeV2Into = (cpaData, v2Map, ym) => {
    if (!cpaData || !v2Map || !ym) return cpaData;
    const v2 = v2Map.get(ym);
    if (!v2) return cpaData;
    const team = cpaData.team || {};
    const cost = Number(team.cost) || 0;
    const pc = Number(v2.offers) || 0;             // 内定社数 (v2)
    const ic = Number(v2.interviews) || 0;
    const ip = Number(v2.first_payment) || 0;
    const er = Number(v2.expected_revenue) || 0;
    const ap = Number(v2.payment_actual) || 0;
    const fugokaku = Number(v2.rejects) || 0;
    // 案件数とバラシ/失注は v1 のまま (取得方法は既存通り)
    const projectsForCpa = Number(team.projectCount) || 0;
    const newTeam = {
      ...team,
      // v2 由来で上書き (内定/面接/不合格/初回入金/見込売上/入金実績)
      naiteiCount: pc,
      interviewCount: ic,
      fugokakuCount: fugokaku,
      // barashiLostCount は v1 のまま (上書きしない)
      initialPayment: ip,
      expectedRevenue: er,
      actualPayment: ap,
      // 派生指標 再計算 (案件数=v1のまま、面接数=v2)
      interviewCpa:  ic > 0 ? Math.round(cost / ic) : 0,
      interviewRate: projectsForCpa > 0 ? Math.round(ic / projectsForCpa * 10000) / 100 : 0,
      roas:          cost > 0 ? Math.round(ip / cost * 10000) / 100 : 0,
      actualRoas:    cost > 0 ? Math.round(ap / cost * 10000) / 100 : 0,
      _v2Merged: true,
    };
    return { ...cpaData, team: newTeam };
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 新CPAモード時は v2 月別データを並行取得 (失敗時は空 → 旧CPAにフォールバック)
      const v2Map = cpaMode === 'v2' ? await fetchV2Monthly() : new Map();
      if (periodMode === 'compare') {
        // 比較モード: 直近Nヶ月 + 各月の週
        const now = new Date();
        const rows = [];
        const monthList = [];
        // 表示は新→旧の降順 (例: 6月→5月→4月...)
        for (let i = 0; i < compareMonths; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          monthList.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
        }
        // 全月を並列取得（従来は月ループが直列で、6ヶ月分を順番待ちしていた）
        const monthBlocks = await Promise.all(monthList.map(async (ym) => {
          const m = Number(ym.split('-')[1]);
          const monthParams = { period: 'monthly', date: `${ym}-15` };
          const weeks = getWeeksInMonth(ym);
          // 月合計(cpa,quality) + 各週(cpa,quality) を一括並列
          const responses = await Promise.all([
            api.get('/api/analytics/cpa-all', { params: withWc({ ...monthParams, date_base: cpaBase }) }),
            api.get('/api/analytics/quality-all', { params: withWc(monthParams) }),
            ...weeks.flatMap(w => {
              const p = { period: 'custom', date_from: w.dateFrom, date_to: w.dateTo, include_extra: 0 };
              return [
                api.get('/api/analytics/cpa-all', { params: withWc({ ...p, date_base: cpaBase }) }),
                api.get('/api/analytics/quality-all', { params: withWc(p) }),
              ];
            }),
          ]);
          const [cM, qM, ...weekPairs] = responses;
          // 月行: v2 由来の指標を上書き (v1全体行を v2 で merge)
          const mergedMonthCpa = mergeV2Into(cM.data.data, v2Map, ym);
          const block = [{ label: `${m}月`, isMonth: true, ym, cpa: mergedMonthCpa, qual: qM.data.data }];
          weeks.forEach((w, wi) => {
            const c = weekPairs[wi * 2];
            const q = weekPairs[wi * 2 + 1];
            // 週行: v2 は月単位のためマージ無し(旧CPAのまま)
            block.push({ label: w.label, isMonth: false, ym, cpa: c.data.data, qual: q.data.data });
          });
          return block;
        }));
        monthBlocks.forEach(block => rows.push(...block));
        setCompareData(rows);
        setCpaData(null);
        setQualData(null);
        setWeeklyData([]);
      } else if (periodMode === 'weekly') {
        // 全週分を一括取得（個別失敗を許容）
        const weeks = getWeeksInMonth(selectedMonth);
        const settled = await Promise.allSettled(
          weeks.map(async (w) => {
            const params = { period: 'custom', date_from: w.dateFrom, date_to: w.dateTo, include_extra: 0 };
            const [cpaRes, qualRes] = await Promise.all([
              api.get('/api/analytics/cpa-all', { params: withWc({ ...params, date_base: cpaBase }) }),
              api.get('/api/analytics/quality-all', { params: withWc(params) }),
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
          api.get('/api/analytics/cpa-all', { params: withWc({ ...params, date_base: cpaBase }) }),
          api.get('/api/analytics/quality-all', { params: withWc(params) }),
        ]);
        // 単一月内に収まるなら v2 マージ可能
        const fromYM = customFrom?.slice(0, 7);
        const toYM = customTo?.slice(0, 7);
        const mergedCpa = (fromYM && fromYM === toYM) ? mergeV2Into(cpaRes.data.data, v2Map, fromYM) : cpaRes.data.data;
        setCpaData(mergedCpa);
        setQualData(qualRes.data.data);
        setWeeklyData([]);
      } else {
        // 月別・累計
        const params = periodMode === 'monthly'
          ? { period: 'monthly', date: `${selectedMonth}-15` }
          : { period: 'cumulative', date: new Date().toISOString().slice(0, 10) };
        const [cpaRes, qualRes] = await Promise.all([
          api.get('/api/analytics/cpa-all', { params: withWc({ ...params, date_base: cpaBase }) }),
          api.get('/api/analytics/quality-all', { params: withWc(params) }),
        ]);
        // monthly のみ v2 マージ (cumulative は複数月跨ぐためそのまま)
        const mergedCpa = periodMode === 'monthly'
          ? mergeV2Into(cpaRes.data.data, v2Map, selectedMonth)
          : cpaRes.data.data;
        setCpaData(mergedCpa);
        setQualData(qualRes.data.data);
        setWeeklyData([]);
      }
    } catch (err) {
      toast.error('データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [periodMode, selectedMonth, customFrom, customTo, compareMonths, cpaBase, cpaMode, workCategoryQuery]);

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
      if (pdfYearMonth) formData.append('year_month', pdfYearMonth);
      // ファイル拡張子で振り分け: .xlsx は Excel パーサー、それ以外は PDF パーサー
      const isXlsx = /\.xlsx?$/i.test(pdfFile.name);
      const endpoint = isXlsx ? '/api/analytics/import-payroll-xlsx' : '/api/analytics/import-cost-pdf';
      const { data } = await directApi.post(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const d = data.data || {};
      // eslint-disable-next-line no-console
      console.log('[PDF import result]', d);
      if (d.imported > 0) {
        const matchedNames = (d.matched || []).map(m => m.name).join(', ');
        toast.success(`${d.imported}件インポートしました${matchedNames ? `: ${matchedNames}` : ''}`, { duration: 8000 });
      } else {
        toast.error(
          `インポート件数0件。PDFから抽出した従業員数: ${d.totalParsed ?? 0}件。未マッチ: ${(d.unmatched || []).join(', ') || 'なし'}`,
          { duration: 12000 }
        );
      }
      if (d.errors?.length > 0) {
        toast.error(`${d.errors.length}件エラー: ${d.errors.slice(0, 3).join(' / ')}`);
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
    { key: 'interviewCount', label: '面接数', clickable: 'v2:interviews' },
    { key: 'interviewCpa', label: '面接CPA', format: 'yen' },
    { key: 'interviewRate', label: '面接実施率', format: 'pct' },
    { key: 'naiteiCount', label: '内定', clickable: 'industry:NAITEI' },
    { key: 'fugokakuCount', label: '不合格', clickable: 'v2:rejects' },
    { key: 'barashiLostCount', label: 'バラシ/失注', clickable: 'industry:BARASHI_LOST' },
    { key: 'initialPayment', label: '初回入金', format: 'yen', highlight: true },
    { key: 'expectedRevenue', label: '見込売上', format: 'yen' },
    { key: 'roas', label: 'ROAS', format: 'pct', highlight: true },
    { key: 'actualPayment', label: '入金実績', format: 'yen', highlight: true },
    { key: 'actualRoas', label: '実績ROAS', format: 'pct', highlight: true },
  ];

  // 案件質指標の列定義
  // clickable: 'waiting' = 連絡待ち / 'industry:STATUS' = 業種別内訳モーダル
  const qualColumns = [
    { key: 'total', label: '案件数', clickable: 'industry:ALL' },
    { key: 'lost', label: '失注', pctKey: 'lostPct', clickable: 'industry:LOST' },
    { key: 'waitingContact', label: '連絡待ち', pctKey: 'waitingContactPct', clickable: 'waiting' },
    { key: 'screeningInProgress', label: '書類選考中', pctKey: 'screeningInProgressPct', clickable: 'screening' },
    { key: 'interviewSet', label: '面接日確定', pctKey: 'interviewSetPct', clickable: 'interviewSet' },
    { key: 'interviewDone', label: '面接実施', pctKey: 'interviewDonePct', clickable: 'interviewDone' },
    { key: 'barashi', label: 'バラシ', pctKey: 'barashiPct', clickable: 'industry:BARASHI' },
    { key: 'screeningFailed', label: '書類選考落ち', pctKey: 'screeningFailedPct' },
    { key: 'otherStatus', label: 'その他', pctKey: 'otherStatusPct' },
    { key: 'onlineInterview', label: 'オンライン面接', pctKey: 'onlineInterviewPct' },
    { key: 'noScreening', label: '書類選考無し', pctKey: 'noScreeningPct' },
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
    // 新CPA(v2)モードで「全体」セル + 内定/面接系 → v2 由来モーダルを開く
    if (cpaMode === 'v2' && !userId && col.clickable.startsWith('industry:') && data?.dateFrom) {
      const status = col.clickable.split(':')[1];
      const ym = String(data.dateFrom).slice(0, 7) + '-01';
      // dateFrom と dateTo が同じ月内なら v2 モーダルを開く (それ以外は旧モーダル)
      if (data.dateTo && data.dateTo.slice(0, 7) === data.dateFrom.slice(0, 7)) {
        if (status === 'NAITEI') return openV2Offers(ym);
        if (status === 'LOST' || status === 'BARASHI') { /* v2 にない指標は従来通り */ }
      }
    }
    if (col.clickable === 'waiting') {
      openWaitingDetail(data, userId, name);
    } else if (col.clickable === 'screening') {
      openScreeningDetail(data, userId, name);
    } else if (col.clickable === 'interviewSet') {
      openInterviewSetDetail(data, userId, name);
    } else if (col.clickable === 'interviewDone') {
      openInterviewDoneDetail(data, userId, name);
    } else if (col.clickable === 'v2:interviews') {
      // v2 面接数モーダル (全体行のみ)
      if (cpaMode === 'v2' && !userId && data?.dateFrom) {
        const ym = String(data.dateFrom).slice(0, 7) + '-01';
        if (data.dateTo && data.dateTo.slice(0, 7) === data.dateFrom.slice(0, 7)) {
          return openV2Interviews(ym, 'all');
        }
      }
    } else if (col.clickable === 'v2:rejects') {
      if (cpaMode === 'v2' && !userId && data?.dateFrom) {
        const ym = String(data.dateFrom).slice(0, 7) + '-01';
        if (data.dateTo && data.dateTo.slice(0, 7) === data.dateFrom.slice(0, 7)) {
          return openV2Interviews(ym, 'rejects');
        }
      }
    } else if (col.clickable.startsWith('industry:')) {
      const status = col.clickable.split(':')[1];
      openIndustryDetail(data, userId, name, status);
    }
  };

  // ---- 新CPA(v2) 内訳モーダル開く (集計基準 cpaBase に従って basis を渡す) ----
  const openV2Offers = async (month) => {
    setV2Modal({ type: 'offers', month, data: null, loading: true });
    try {
      const { data } = await api.get('/api/cpa-v2/offers', { params: { month, basis: v2Basis() } });
      if (data.success) setV2Modal(prev => prev && prev.month === month ? { ...prev, data: data.data, loading: false } : prev);
      else { setV2Modal(null); toast.error('取得失敗'); }
    } catch (e) { setV2Modal(null); toast.error('取得失敗: ' + (e.response?.data?.message || e.message)); }
  };
  const openV2Interviews = async (month, kind = 'all') => {
    setV2Modal({ type: kind === 'rejects' ? 'rejects' : 'interviews', month, data: null, loading: true });
    try {
      const { data } = await api.get('/api/cpa-v2/interviews', { params: { month, basis: v2Basis(), kind } });
      if (data.success) setV2Modal(prev => prev ? { ...prev, data: data.data, loading: false } : prev);
      else { setV2Modal(null); toast.error('取得失敗'); }
    } catch (e) { setV2Modal(null); toast.error('取得失敗: ' + (e.response?.data?.message || e.message)); }
  };

  // 業種別内訳モーダル
  const openIndustryDetail = async (data, userId, name, status) => {
    if (!data) return;
    const dateFrom = data.dateFrom || (status === 'NAITEI' ? '2026-01-01' : '2026-04-01');
    const dateTo = data.dateTo || new Date().toISOString().slice(0, 10);
    const labelMap = { LOST: '失注', BARASHI: 'バラシ', NAITEI: '内定', BARASHI_LOST: 'バラシ/失注', ALL: '全案件' };
    setIndustryModal({
      title: `${name} - ${labelMap[status] || status} 業種別内訳`,
      status, userId, dateFrom, dateTo,
      data: null, loading: true,
    });
    try {
      const params = new URLSearchParams({ status, date_from: dateFrom, date_to: dateTo });
      if (userId) params.append('user_id', userId);
      // CPAの内定ドリルダウンは一覧と同じ日付基準に合わせる（acquisition→created / naitei→naitei）
      if (status === 'NAITEI') params.append('date_base', cpaBase === 'naitei' ? 'naitei' : 'created');
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

  // 書類選考中 明細モーダル: document_screening='required' AND status='BOSHUCHU'
  const openScreeningDetail = async (data, userId, name) => {
    if (!data) return;
    const dateFrom = data.dateFrom || '2026-04-01';
    const dateTo = data.dateTo || new Date().toISOString().slice(0, 10);
    setScreeningModal({
      title: `${name || '全体'}の書類選考中 明細`, userId, dateFrom, dateTo,
      data: null, loading: true,
    });
    try {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      if (userId) params.append('user_id', userId);
      const { data: res } = await api.get(`/api/analytics/screening-in-progress?${params}`);
      if (res.success) setScreeningModal(prev => prev ? { ...prev, data: res.data, loading: false } : null);
      else { setScreeningModal(null); toast.error('取得失敗'); }
    } catch (err) {
      toast.error('明細の取得に失敗しました'); setScreeningModal(null);
    }
  };

  // 面接日確定 明細モーダル: interview_date IS NOT NULL かつ中間外/結果系
  const openInterviewSetDetail = async (data, userId, name) => {
    if (!data) return;
    const dateFrom = data.dateFrom || '2026-04-01';
    const dateTo = data.dateTo || new Date().toISOString().slice(0, 10);
    setInterviewSetModal({
      title: `${name || '全体'}の面接日確定 明細`, userId, dateFrom, dateTo,
      data: null, loading: true,
    });
    try {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      if (userId) params.append('user_id', userId);
      const { data: res } = await api.get(`/api/analytics/interview-set-detail?${params}`);
      if (res.success) setInterviewSetModal(prev => prev ? { ...prev, data: res.data, loading: false } : null);
      else { setInterviewSetModal(null); toast.error('取得失敗'); }
    } catch (err) {
      toast.error('明細の取得に失敗しました'); setInterviewSetModal(null);
    }
  };

  // 面接実施 明細モーダル: status IN ('KEKKA_MACHI','NAITEI','NAITEI_TORIKESHI','FUGOKAKU')
  const openInterviewDoneDetail = async (data, userId, name) => {
    if (!data) return;
    const dateFrom = data.dateFrom || '2026-04-01';
    const dateTo = data.dateTo || new Date().toISOString().slice(0, 10);
    setInterviewDoneModal({
      title: `${name || '全体'}の面接実施 明細`, userId, dateFrom, dateTo,
      data: null, loading: true,
    });
    try {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      if (userId) params.append('user_id', userId);
      const { data: res } = await api.get(`/api/analytics/interview-done-detail?${params}`);
      if (res.success) setInterviewDoneModal(prev => prev ? { ...prev, data: res.data, loading: false } : null);
      else { setInterviewDoneModal(null); toast.error('取得失敗'); }
    } catch (err) {
      toast.error('明細の取得に失敗しました'); setInterviewDoneModal(null);
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

  // 案件質向上: 月別目標(%)を手入力で更新し、localStorageに保存
  const updateQualityTarget = (ym, colKey, value) => {
    setQualityTargets(prev => {
      const next = { ...prev, [ym]: { ...(prev[ym] || {}), [colKey]: value } };
      try { localStorage.setItem('quality_monthly_targets', JSON.stringify(next)); } catch (e) { /* ignore */ }
      return next;
    });
  };

  // 実績(%)と目標(%)の差分を計算（マイナス=未達→青↓、プラス=超過→赤↑）
  const getQualityDiff = (ym, colKey, actualPct) => {
    if (actualPct === undefined || actualPct === null) return null;
    const monthTargets = qualityTargets[ym];
    if (!monthTargets) return null;
    const raw = monthTargets[colKey];
    if (raw === undefined || raw === null || raw === '') return null;
    const target = Number(raw);
    if (isNaN(target)) return null;
    return Math.round((Number(actualPct) - target) * 10) / 10;
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
                    {/* 案件質の場合: 目標の行（月のみ・手入力可） */}
{tab === 'quality' && row.isMonth && (
  <tr className={"border-b border-gray-100 " + pctRowBg}>
    <td className={"py-1.5 px-4 sticky left-0 z-10 text-gray-400 text-xs " + pctRowBg}>
      <span className="pl-4">目標</span>
    </td>
    {cols.map(col => (
      <td key={col.key} className="py-1.5 px-4 text-right text-xs">
        {col.pctKey ? (
          <input
            type="number"
            inputMode="decimal"
            value={qualityTargets[row.ym]?.[col.key] ?? ''}
            onChange={(e) => updateQualityTarget(row.ym, col.key, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="-"
            className="w-14 text-right text-xs border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
          />
        ) : '-'}
      </td>
    ))}
  </tr>
)}
{/* 案件質の場合: 割合の行 */}
                    {tab === 'quality' && (
                      <tr className={`border-b border-gray-100 ${pctRowBg}`}>
                        <td className={`py-2 px-4 sticky left-0 z-10 ${pctRowBg} text-gray-400 text-xs`}>
                          <span className={row.isMonth ? 'pl-4' : 'pl-5'}>割合</span>
                        </td>
                        {cols.map(col => (
                          <td key={col.key} className={`py-2 px-4 text-right text-xs ${row.isMonth ? 'text-purple-600 font-semibold' : 'text-gray-500'}`}>
                            {col.pctKey ? (
            <React.Fragment>
              {fmtPct(r[col.pctKey])}
              {getQualityDiff(row.ym, col.key, r[col.pctKey]) !== null && (
                <span className={getQualityDiff(row.ym, col.key, r[col.pctKey]) < 0 ? 'ml-1 font-semibold text-blue-500' : (getQualityDiff(row.ym, col.key, r[col.pctKey]) > 0 ? 'ml-1 font-semibold text-red-500' : 'ml-1 font-semibold text-gray-400')}>
                  ({getQualityDiff(row.ym, col.key, r[col.pctKey]) > 0 ? '+' : ''}{getQualityDiff(row.ym, col.key, r[col.pctKey])}%{getQualityDiff(row.ym, col.key, r[col.pctKey]) < 0 ? '↓' : (getQualityDiff(row.ym, col.key, r[col.pctKey]) > 0 ? '↑' : '')})
                </span>
              )}
            </React.Fragment>
          ) : '-'}
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
    <Layout wide>
      <div className="mb-5 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">
            CPA / 案件質分析
            {workCategoryQuery === 'specific_skill' && (
              <span className="ml-2 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md align-middle">特定技能</span>
            )}
            {workCategoryQuery === 'all' && (
              <span className="ml-2 text-[11px] font-semibold text-gray-600 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-md align-middle">全体集計</span>
            )}
            {!workCategoryQuery && (
              <span className="ml-2 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md align-middle">技人国</span>
            )}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            全オペレーター比較 - コスト・案件化率・面接・売上の分析
            {cpaMode === 'v2' && <span className="ml-2 text-emerald-600">(新CPA: 内定/入金/面接/不合格/バラシ/初回入金/見込売上 は fax-crm 互換ロジックで上書き)</span>}
            {cpaMode === 'v1' && <span className="ml-2 text-gray-400">(旧)</span>}
          </p>
        </div>
        <div className="flex items-end gap-2">
          {/* 業務カテゴリ切替 (技人国 / 特定技能 / 全体) */}
          <div>
            <label className="input-label">業務カテゴリ</label>
            <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => {
                  const { work_category, ...rest } = router.query;
                  router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: false });
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${!workCategoryQuery ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                技人国
              </button>
              <button
                onClick={() => router.replace({ pathname: router.pathname, query: { ...router.query, work_category: 'specific_skill' } }, undefined, { shallow: false })}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${workCategoryQuery === 'specific_skill' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                特定技能
              </button>
              <button
                onClick={() => router.replace({ pathname: router.pathname, query: { ...router.query, work_category: 'all' } }, undefined, { shallow: false })}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${workCategoryQuery === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                全体
              </button>
            </div>
          </div>
          {/* 旧CPA / 新CPA 切替トグル (デフォルト: 新CPA) */}
          <div>
            <label className="input-label">表示モード</label>
            <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
              <button onClick={() => setCpaMode('v2')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${cpaMode === 'v2' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                新CPA
              </button>
              <button onClick={() => setCpaMode('v1')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${cpaMode === 'v1' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                旧CPA
              </button>
            </div>
          </div>
          {/* 新CPA モード時のみ: Sheets 同期 */}
          {cpaMode === 'v2' && (
            <button
              onClick={async () => {
                if (!window.confirm('Google Sheets 同期を実行します (10〜90秒)。続行?')) return;
                try {
                  const { data } = await api.post('/api/cpa-v2/sync');
                  if (data.success) { toast.success('同期完了'); fetchData(); }
                  else toast.error('同期失敗');
                } catch (e) { toast.error('同期失敗: ' + (e.response?.data?.message || e.message)); }
              }}
              className="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded shadow-sm whitespace-nowrap">
              Sheets同期
            </button>
          )}
        </div>
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

          {/* CPA 集計の日付基準（CPA指標タブのみ） */}
          {tab === 'cpa' && (
            <div>
              <label className="input-label">集計基準</label>
              <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
                {[
                  { value: 'acquisition', label: '案件獲得日' },
                  { value: 'naitei', label: '内定日' },
                ].map(b => (
                  <button key={b.value}
                    onClick={() => setCpaBase(b.value)}
                    title={b.value === 'naitei'
                      ? 'コスト/コール/案件数は獲得日、面接数は面接実施日、内定/不合格/バラシ失注/入金/売上は内定日で集計'
                      : 'すべて案件獲得日で集計'}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      cpaBase === b.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}>{b.label}</button>
                ))}
              </div>
            </div>
          )}

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

          {/* 入金実績診断ボタン */}
          <div>
            <label className="input-label">&nbsp;</label>
            <button
              onClick={async () => {
                const from = window.prompt('開始日 YYYY-MM-DD', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
                if (!from) return;
                const to = window.prompt('終了日 YYYY-MM-DD', new Date().toISOString().slice(0, 10));
                if (!to) return;
                try {
                  const { data } = await api.get('/api/admin/diagnose-visa-payment', { params: { date_from: from, date_to: to } });
                  if (!data.success) { toast.error(data.message || '取得失敗'); return; }
                  const d = data.data;
                  const win = window.open('', '_blank', 'width=1100,height=700');
                  if (!win) { toast.error('ポップアップがブロックされました'); return; }
                  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
                  const hiresHtml = (d.hires || []).map(h => `
                    <tr ${!h.matched ? 'style="background:#fee2e2"' : ''}>
                      <td>${esc(h.name)}</td>
                      <td style="font-family:monospace">${esc(h.reg)}</td>
                      <td>${(h.tokens || []).map(t => `<span style="display:inline-block;padding:1px 4px;margin:1px;border-radius:3px;background:${t.yen > 0 ? '#d1fae5' : '#fee2e2'};font-family:monospace;font-size:11px">${esc(t.token)}=¥${t.yen.toLocaleString()}</span>`).join('')}</td>
                      <td style="text-align:right">¥${h.totalYen.toLocaleString()}</td>
                      <td style="text-align:right">¥${h.dbInitialPayment.toLocaleString()}</td>
                      <td style="text-align:center">${h.matched ? '<span style="color:#059669">OK</span>' : '<span style="color:#dc2626">未マッチ</span>'}</td>
                    </tr>`).join('');
                  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>入金実績診断</title>
                    <style>
                      body{font-family:sans-serif;font-size:13px;padding:16px;color:#1f2937}
                      h1{font-size:18px;margin:0 0 8px}
                      .box{background:#f3f4f6;padding:10px 14px;border-radius:6px;margin-bottom:10px}
                      .ok{color:#059669;font-weight:bold} .ng{color:#dc2626;font-weight:bold}
                      .hint{background:#fef3c7;padding:10px 14px;border-radius:6px;border:1px solid #fbbf24;margin-bottom:10px}
                      table{border-collapse:collapse;width:100%;margin-top:8px}
                      th,td{border:1px solid #e5e7eb;padding:6px 8px}
                      th{background:#f9fafb;text-align:left;font-size:12px}
                    </style></head><body>
                    <h1>CPA入金実績 診断</h1>
                    <div class="hint"><b>診断結果:</b> ${esc(d.hint)}</div>
                    <div class="box">
                      <div>① シート読み取り: <span class="${d.sheet.ok ? 'ok' : 'ng'}">${d.sheet.ok ? 'OK' : 'FAILED'}</span>
                        ${d.sheet.ok ? `(全${d.sheet.totalRows}行 / 登録番号あり ${d.sheet.withReg}行 / CC数値あり ${d.sheet.withCcNumber}行)` : `エラー: ${esc(d.sheet.error)}`}</div>
                      <div>② サービスアカウント: <code>${esc(d.sheet.serviceAccountEmail || '(未設定)')}</code> ← このアカウントにシートを「閲覧者」で共有が必要</div>
                      <div>③ シートID: <code>${esc(d.sheet.sheetId)}</code></div>
                      <div>④ 登録番号 → 入金実績マップ: ${d.mapSize}件</div>
                    </div>
                    ${d.sheet.ok ? `<div class="box"><b>シート先頭サンプル (登録番号 → CC列の生値):</b><br>${(d.sampleSheetRegs || []).map((r, i) => `<code>${esc(r)}=${esc(d.sheet.sample[i]?.ccRaw)}</code>`).join(' ／ ') || '(なし)'}</div>` : ''}
                    <div class="box">
                      <b>対象期間の内定者:</b> ${d.summary.targetHires}件 / マッチ ${d.summary.matched}件 / 未マッチ ${d.summary.unmatched}件 / マッチ合計 ¥${d.summary.totalMatchedYen.toLocaleString()}
                    </div>
                    <table>
                      <thead><tr><th>担当OP</th><th>DB登録番号</th><th>分割トークン×マッチ額</th><th>合計入金実績</th><th>DB初回入金</th><th>状態</th></tr></thead>
                      <tbody>${hiresHtml}</tbody>
                    </table>
                    <p style="color:#9ca3af;font-size:11px;margin-top:12px">※ 赤い行は未マッチ。サンプルシート登録番号とDBの登録番号を比較し、表記ゆれや余分な空白がないか確認してください。</p>
                    </body></html>`);
                  win.document.close();
                } catch (err) {
                  toast.error(err.response?.data?.message || '診断に失敗しました');
                }
              }}
              title="入金実績がCPAに反映されない原因を切り分け（ビザシート読み取り+登録番号マッチ結果）"
              className="px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-purple-500 to-fuchsia-600 hover:from-purple-600 hover:to-fuchsia-700 rounded-md shadow-sm whitespace-nowrap"
            >
              入金実績診断
            </button>
          </div>

          {/* === dead code: 旧 popup 実装 (ブラウザのポップアップブロックで使えなかった) === */}
          {false && (<button onClick={async () => {
                const basis = 'acquired';
                let syncRes = null;
                if (false) {
                  try {
                    const { data: s } = await api.post('/api/cpa-v2/sync');
                    if (!s.success) { toast.error(s.message || '同期失敗'); return; }
                    syncRes = s.data;
                    toast.success('同期完了');
                  } catch (e) { toast.error('同期失敗: ' + (e.response?.data?.message || e.message)); return; }
                }
                try {
                  // sync を走らせた直後は Sheets API レート制限に当たるので probe をスキップ
                  // (sync の結果に kept/skipped が含まれている)
                  const monthlyRes = await api.get('/api/cpa-v2/monthly', { params: { basis, months: 12 } });
                  let probe = null;
                  if (!syncRes) {
                    try {
                      const probeRes = await api.get('/api/cpa-v2/probe');
                      probe = probeRes.data.success ? probeRes.data.data : null;
                    } catch (e) { /* probe失敗は許容 */ }
                  }
                  if (!monthlyRes.data.success) { toast.error('月次取得失敗'); return; }
                  const rows = monthlyRes.data.data.rows || [];
                  const win = window.open('', '_blank', 'width=1280,height=800');
                  if (!win) { toast.error('ポップアップがブロックされました'); return; }
                  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
                  const yen = (n) => '¥' + (Number(n) || 0).toLocaleString();
                  const tr = rows.map(r => `
                    <tr>
                      <td>${esc(r.month)}</td>
                      <td style="text-align:right">${r.projects}</td>
                      <td style="text-align:right">${r.cancels}</td>
                      <td style="text-align:right">${r.interviews}</td>
                      <td style="text-align:right">${r.rejects}</td>
                      <td style="text-align:right"><b>${r.offers}</b></td>
                      <td style="text-align:right">${r.offer_rate}%</td>
                      <td style="text-align:right">${r.interview_rate}%</td>
                      <td style="text-align:right">${yen(r.first_payment)}</td>
                      <td style="text-align:right">${yen(r.expected_revenue)}</td>
                      <td style="text-align:right;color:#dc2626;font-weight:bold">${yen(r.payment_actual)}</td>
                    </tr>`).join('');
                  const kindHtml = (label, p) => {
                    if (!p?.ok) return `<div style="color:#dc2626"><b>${esc(label)}</b>: 失敗 ${esc(p?.error || '')}</div>`;
                    const entries = Object.entries(p.byKindValue || {}).sort((a,b)=>b[1]-a[1]);
                    const dot = entries.map(([k,v]) => `<span style="display:inline-block;padding:2px 6px;margin:2px;border-radius:4px;background:${k==='架電バイト'?'#bbf7d0':k==='FAX受電'?'#fef3c7':'#f3f4f6'}"><code>${esc(k)}</code>: ${v}件</span>`).join('');
                    return `<div style="margin:6px 0"><b>${esc(label)}</b> (全${p.totalDataRows}行): ${dot || '(空)'}</div>`;
                  };
                  const syncHtml = syncRes ? `<div class="box"><b>シート同期結果:</b><pre style="margin:4px 0 0;font-size:11px;background:#fff;padding:8px;border:1px solid #e5e7eb;max-height:200px;overflow:auto">${esc(JSON.stringify(syncRes, null, 2))}</pre></div>` : '';
                  const probeHtml = probe ? `<div class="box"><b>シート診断 (期待値: <code style="background:#bbf7d0;padding:1px 4px">架電バイト</code>):</b>${kindHtml('売上シート (BE列)', probe.projects)}${kindHtml('求人情報 (H列)', probe.jobs)}${kindHtml('面接内訳 (NR列)', probe.interviews)}</div>` : '';
                  const emptyMsg = rows.length === 0 ? '<div style="padding:16px;background:#fee2e2;border-radius:6px;color:#dc2626;margin:10px 0">集計結果0行。シート診断で「架電バイト」列の件数を確認してください。0件ならシートに該当データ無し、件数があれば同期エラーの可能性。</div>' : '';
                  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>新CPA(β)</title>
                    <style>body{font-family:sans-serif;font-size:13px;padding:16px;color:#1f2937}
                    h1{font-size:18px;margin:0 0 6px}
                    .box{background:#f9fafb;padding:10px 14px;border-radius:6px;margin:10px 0;border:1px solid #e5e7eb}
                    table{border-collapse:collapse;width:100%}
                    th,td{border:1px solid #e5e7eb;padding:6px 8px}
                    th{background:#f9fafb;font-size:12px}</style></head><body>
                    <h1>新CPA(β) — source_kind='架電バイト' / basis=${esc(basis)}</h1>
                    <p style="color:#666;margin:0">fax-crm と同一ロジック (集計コアのみ、コスト系は Phase 2)。</p>
                    ${syncHtml}
                    ${probeHtml}
                    <h2 style="font-size:16px;margin:14px 0 4px">月別集計</h2>
                    ${emptyMsg}
                    <table>
                      <thead><tr>
                        <th>月</th><th>案件数</th><th>バラシ</th><th>面接数</th><th>不合格</th>
                        <th>内定社数</th><th>内定率</th><th>面接実施率</th>
                        <th>初回入金</th><th>見込売上</th><th>入金実績</th>
                      </tr></thead>
                      <tbody>${tr}</tbody>
                    </table></body></html>`);
                  win.document.close();
                } catch (e) {
                  toast.error('取得失敗: ' + (e.response?.data?.message || e.message));
                }
              }}
              title="dead"
              className="hidden"
            >
              旧
            </button>)}
        </div>

        {/* データ取り込み */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-500 font-medium">コストPDF取込:</span>
          <div className="flex items-center gap-2">
            <input type="month" value={pdfYearMonth} onChange={e => setPdfYearMonth(e.target.value)}
              className="text-xs border border-gray-200 rounded px-2 py-1" title="対象年月" />
            <input type="file" accept=".pdf,.xlsx,.xls" onChange={e => setPdfFile(e.target.files?.[0] || null)}
              className="text-xs text-gray-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100 w-56"
              title="PDF または Excel (xlsx) を選択。Excelの方が確実です。" />
            <button onClick={handlePdfUpload} disabled={!pdfFile || pdfUploading || !pdfYearMonth}
              className="px-3 py-1 text-xs font-medium bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-40 transition-colors whitespace-nowrap">
              {pdfUploading ? '処理中...' : '取込'}
            </button>
            <button onClick={openExtraCostsModal}
              className="px-3 py-1 text-xs font-medium bg-pink-600 text-white rounded hover:bg-pink-700 transition-colors whitespace-nowrap"
              title="コンサル料など、特定オペレーターに紐付かない月次コストを追加">
              追加コスト
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

      {/* 追加コスト一覧 (集計範囲内のもの) */}
      {!loading && tab === 'cpa' && (() => {
        // 表示中のデータから extraCostBreakdown を集約
        const breakdown = [];
        const seen = new Set();
        const collect = (data) => {
          if (!data?.team?.extraCostBreakdown) return;
          for (const r of data.team.extraCostBreakdown) {
            const key = `${r.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            breakdown.push(r);
          }
        };
        if (periodMode === 'compare') {
          for (const row of compareData) if (row.isMonth) collect(row.cpa);
        } else if (periodMode === 'weekly') {
          // 週別表示でも月内分は表示しておく（合計には含まれないため別枠で説明）
          for (const w of weeklyData) collect(w.cpa);
        } else {
          collect(cpaData);
        }
        if (breakdown.length === 0) return null;
        const total = breakdown.reduce((s, r) => s + Number(r.amount || 0), 0);
        return (
          <div className="card mt-5 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-amber-50 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-amber-900">追加コスト（コンサル料等）</h2>
                <p className="text-[11px] text-amber-700 mt-0.5">
                  月別/累計の「全体」コストにのみ加算されます。週・任意期間の行には加算されません。
                </p>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-amber-700">合計</div>
                <div className="text-base font-bold text-amber-900">¥{total.toLocaleString()}</div>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs">
                <tr>
                  <th className="text-left py-2 px-4 font-semibold text-gray-700">対象月</th>
                  <th className="text-left py-2 px-4 font-semibold text-gray-700">区分</th>
                  <th className="text-right py-2 px-4 font-semibold text-gray-700">金額</th>
                  <th className="text-left py-2 px-4 font-semibold text-gray-700">メモ</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map(r => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="py-2 px-4 text-gray-700">{r.period_ym}</td>
                    <td className="py-2 px-4 text-gray-700">{r.category || '-'}</td>
                    <td className="py-2 px-4 text-right font-medium text-gray-900">¥{Number(r.amount || 0).toLocaleString()}</td>
                    <td className="py-2 px-4 text-gray-500 text-xs">{r.memo || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* ===== 指標の算出方法 備忘録 ===== */}
      <details className="card mt-5 overflow-hidden">
        <summary className="px-5 py-3 border-b border-gray-100 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors">
          <span className="text-sm font-bold text-slate-800">指標の算出方法 (備忘録)</span>
          <span className="text-[11px] text-slate-500 ml-2">クリックで展開 / 各項目がどのデータから計算されているか</span>
        </summary>
        <div className="px-5 py-4 grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs text-gray-700">
          {/* CPA 指標 */}
          <div>
            <h3 className="font-bold text-gray-900 mb-2 pb-1 border-b border-gray-200">CPA 指標</h3>
            <dl className="space-y-1.5">
              <div><dt className="inline font-semibold text-blue-700">コスト</dt><dd className="inline text-gray-600"> : 給与 (payroll_monthly) + 追加コスト (extra_costs)。 期間内に該当する月の按分。</dd></div>
              <div><dt className="inline font-semibold text-blue-700">労働時間</dt><dd className="inline text-gray-600"> : work_hours テーブルの合計 (Excel 取込・打刻同期)。</dd></div>
              <div><dt className="inline font-semibold text-blue-700">稼働率</dt><dd className="inline text-gray-600"> : 通話実時間 (calls.actual_duration_sec) ÷ 労働時間。</dd></div>
              <div><dt className="inline font-semibold text-blue-700">架電数 / 有効 / 案件化</dt><dd className="inline text-gray-600"> : calls テーブルから集計。 有効 = NG/INTERESTED/PROJECT/RECALL。 案件化 = result_code='PROJECT'。</dd></div>
              <div><dt className="inline font-semibold text-blue-700">面接CPA</dt><dd className="inline text-gray-600"> : コスト ÷ 面接実施数 (status IN ('KEKKA_MACHI','NAITEI','NAITEI_TORIKESHI','FUGOKAKU'))。</dd></div>
              <div><dt className="inline font-semibold text-blue-700">面接実施率</dt><dd className="inline text-gray-600"> : 面接実施数 ÷ 案件総数 × 100%。</dd></div>
              <div><dt className="inline font-semibold text-blue-700">内定</dt><dd className="inline text-gray-600"> : projects.status = 'NAITEI' の件数 (期間内 created_at)。</dd></div>
              <div><dt className="inline font-semibold text-blue-700">不合格</dt><dd className="inline text-gray-600"> : projects.status = 'FUGOKAKU' の件数。</dd></div>
              <div><dt className="inline font-semibold text-blue-700">バラシ/失注</dt><dd className="inline text-gray-600"> : projects.status IN ('BARASHI', 'LOST') の件数。</dd></div>
              <div><dt className="inline font-semibold text-blue-700">初回入金</dt><dd className="inline text-gray-600"> : project_hires.initial_payment 合計 (status='NAITEI' かつ未取消)。</dd></div>
              <div><dt className="inline font-semibold text-blue-700">見込売上</dt><dd className="inline text-gray-600"> : project_hires.expected_revenue 合計。</dd></div>
              <div><dt className="inline font-semibold text-blue-700">ROAS</dt><dd className="inline text-gray-600"> : 見込売上 ÷ コスト × 100%。</dd></div>
              <div><dt className="inline font-semibold text-blue-700">入金実績</dt><dd className="inline text-gray-600"> : project_hires.payment_actual 合計 (CPA v2: 月別 sales_projects_v2 集計)。</dd></div>
              <div><dt className="inline font-semibold text-blue-700">実績ROAS</dt><dd className="inline text-gray-600"> : 入金実績 ÷ コスト × 100%。</dd></div>
            </dl>
          </div>
          {/* 案件質 指標 */}
          <div>
            <h3 className="font-bold text-gray-900 mb-2 pb-1 border-b border-gray-200">案件質 指標</h3>
            <dl className="space-y-1.5">
              <div><dt className="inline font-semibold text-emerald-700">案件数</dt><dd className="inline text-gray-600"> : projects テーブル、 期間内に created_at の全件 (is_legacy=0, is_prospect=0)。</dd></div>
              <div><dt className="inline font-semibold text-emerald-700">失注</dt><dd className="inline text-gray-600"> : status = 'LOST' の件数。</dd></div>
              <div><dt className="inline font-semibold text-emerald-700">連絡待ち</dt><dd className="inline text-gray-600"> : status = 'BOSHUCHU' かつ mail_sent / mail_replied / phone_confirmed の少なくとも 1 つが未入力。</dd></div>
              <div><dt className="inline font-semibold text-emerald-700">書類選考中</dt><dd className="inline text-gray-600"> : document_screening = 'required' かつ status = 'BOSHUCHU'。</dd></div>
              <div><dt className="inline font-semibold text-emerald-700">面接日確定</dt><dd className="inline text-gray-600"> : interview_date IS NOT NULL かつ status が中間外 (LOST/BARASHI/HORYU/MODOSHI/SHORUI_CHU/SHORUI_OCHI でない) かつ (面接日が未来 OR 結果系ステータス)。</dd></div>
              <div><dt className="inline font-semibold text-emerald-700">面接実施</dt><dd className="inline text-gray-600"> : status IN ('KEKKA_MACHI', 'NAITEI', 'NAITEI_TORIKESHI', 'FUGOKAKU') の件数。</dd></div>
              <div><dt className="inline font-semibold text-emerald-700">バラシ</dt><dd className="inline text-gray-600"> : status = 'BARASHI' の件数。</dd></div>
              <div><dt className="inline font-semibold text-emerald-700">オンライン面接</dt><dd className="inline text-gray-600"> : interview_type = 'online' の件数 (面接日確定済みのうち)。</dd></div>
              <div><dt className="inline font-semibold text-emerald-700">書類選考無し</dt><dd className="inline text-gray-600"> : document_screening = 'not_required' の件数。</dd></div>
              <div><dt className="inline font-semibold text-emerald-700">書類選考落ち</dt><dd className="inline text-gray-600"> : status = 'SHORUI_OCHI' の件数。</dd></div>
              <div><dt className="inline font-semibold text-emerald-700">割合 (Pct)</dt><dd className="inline text-gray-600"> : 各項目の件数 ÷ 案件総数 × 100% (テーブルの下段に表示)。</dd></div>
            </dl>
          </div>
          {/* 補足 */}
          <div className="lg:col-span-2 mt-2 p-3 bg-amber-50/50 border border-amber-100 rounded">
            <h4 className="font-bold text-amber-900 text-[11px] mb-1">補足</h4>
            <ul className="text-[11px] text-amber-800 space-y-0.5 list-disc list-inside">
              <li>過去案件 (移行前データ): past_quality_data / past_cpa_data テーブルから合算。 移行後 (2026-03 以降) は projects から計算。</li>
              <li>業務カテゴリ (技人国/特定技能) で絞り込み時は projects.work_category でフィルタ。</li>
              <li>「全体」 行のコストには追加コスト (コンサル料等) が加算される。 各オペレーター行には加算されない。</li>
              <li>テーブルの数値セル (青色下線) はクリックで業種別 / 案件詳細モーダル表示。</li>
              <li>CPA モード切替: 旧 (projects 由来) ↔ 新 v2 (sales_projects_v2 / interview_records_v2 由来)。 v2 は月単位で精度の高い数値を算出。</li>
            </ul>
          </div>
        </div>
      </details>

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
                    <option value="q_other_status">その他</option>
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
                                {p.projectId ? (
                                  <button
                                    type="button"
                                    onClick={() => setDetailProjectId(p.projectId)}
                                    className="text-blue-600 hover:underline"
                                  >
                                    {p.companyName || '-'}
                                  </button>
                                ) : (
                                  <span>{p.companyName || '-'}</span>
                                )}
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
                                {p.projectId ? (
                                  <button
                                    type="button"
                                    onClick={() => setDetailProjectId(p.projectId)}
                                    className="text-blue-600 hover:underline"
                                  >
                                    {p.companyName || '-'}
                                  </button>
                                ) : (
                                  <span>{p.companyName || '-'}</span>
                                )}
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
                      {(() => {
                        const isNaitei = industryModal.status === 'NAITEI';
                        const isBarashiLost = ['BARASHI', 'LOST', 'BARASHI_LOST'].includes(industryModal.status);
                        const fmtScreen = (v) => v === 'required' ? 'あり' : (v === 'not_required' ? 'なし' : '-');
                        const fmtMethod = (v) => v === 'online' ? 'オンライン' : (v === 'onsite' ? '対面' : (v === 'document' ? '書類' : '-'));
                        return (
                      <table className="w-full text-xs border">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="text-left px-2 py-1.5">求人番号</th>
                            <th className="text-left px-2 py-1.5">企業名</th>
                            <th className="text-left px-2 py-1.5">業種</th>
                            <th className="text-left px-2 py-1.5">担当OP</th>
                            <th className="text-left px-2 py-1.5">担当営業</th>
                            <th className="text-left px-2 py-1.5">案件獲得日</th>
                            {isNaitei && (<th className="text-left px-2 py-1.5">内定日</th>)}
                            {isNaitei && (<th className="text-left px-2 py-1.5">登録番号</th>)}
                            {isBarashiLost ? (
                              <>
                                <th className="text-center px-2 py-1.5">書類選考</th>
                                <th className="text-center px-2 py-1.5">面接方法</th>
                                <th className="text-left px-2 py-1.5">面接日</th>
                              </>
                            ) : (
                              <>
                                <th className="text-right px-2 py-1.5">内定人数</th>
                                <th className="text-right px-2 py-1.5">初回入金</th>
                                <th className="text-right px-2 py-1.5">見込売上</th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {industryModal.data.projects.map(p => (
                            <tr key={p.id} className="border-t hover:bg-gray-50">
                              <td className="px-2 py-1">{p.job_number || '-'}</td>
                              <td className="px-2 py-1">
                                {p.id ? (
                                  <button
                                    type="button"
                                    onClick={() => setDetailProjectId(p.id)}
                                    className="text-blue-600 hover:underline"
                                  >
                                    {p.company_name || '-'}
                                  </button>
                                ) : (
                                  <span>{p.company_name || '-'}</span>
                                )}
                              </td>
                              <td className="px-2 py-1">{p.industry || '-'}</td>
                              <td className="px-2 py-1">{p.owner_name || '-'}</td>
                              <td className="px-2 py-1">{p.sales_name || '-'}</td>
                              <td className="px-2 py-1">{p.created_at ? new Date(p.created_at).toLocaleDateString('ja-JP') : '-'}</td>
                              {isNaitei && (
                                <td className="px-2 py-1 font-semibold text-emerald-700">
                                  {p.naitei_date ? new Date(p.naitei_date).toLocaleDateString('ja-JP') : '-'}
                                </td>
                              )}
                              {isNaitei && (
                                <td className="px-2 py-1 font-mono text-gray-700">{p.registration_numbers || '-'}</td>
                              )}
                              {isBarashiLost ? (
                                <>
                                  <td className="px-2 py-1 text-center">{fmtScreen(p.document_screening)}</td>
                                  <td className="px-2 py-1 text-center">{fmtMethod(p.interview_type)}</td>
                                  <td className="px-2 py-1">{p.interview_date ? new Date(p.interview_date).toLocaleDateString('ja-JP') : '-'}</td>
                                </>
                              ) : (
                                <>
                                  <td className="px-2 py-1 text-right">{Number(p.hires_count) > 0 ? `${p.hires_count}名` : '-'}</td>
                                  <td className="px-2 py-1 text-right text-emerald-700">{Number(p.initial_payment) > 0 ? `¥${Number(p.initial_payment).toLocaleString()}` : '-'}</td>
                                  <td className="px-2 py-1 text-right text-blue-700">{Number(p.expected_revenue) > 0 ? `¥${Number(p.expected_revenue).toLocaleString()}` : '-'}</td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                        {industryModal.data.totals && (
                          <tfoot className="bg-gray-50 border-t-2 border-gray-300 font-semibold">
                            <tr>
                              {isBarashiLost ? (
                                <td colSpan={isNaitei ? 11 : 9} className="px-2 py-1.5 text-right text-gray-700">
                                  合計 ({industryModal.data.total}件)
                                </td>
                              ) : (
                                <>
                                  <td colSpan={isNaitei ? 8 : 6} className="px-2 py-1.5 text-right text-gray-700">
                                    合計 ({industryModal.data.total}件)
                                  </td>
                                  <td className="px-2 py-1.5 text-right">{Number(industryModal.data.totals.hires) || 0}名</td>
                                  <td className="px-2 py-1.5 text-right text-emerald-700">¥{Number(industryModal.data.totals.initial || 0).toLocaleString()}</td>
                                  <td className="px-2 py-1.5 text-right text-blue-700">¥{Number(industryModal.data.totals.expected || 0).toLocaleString()}</td>
                                </>
                              )}
                            </tr>
                          </tfoot>
                        )}
                      </table>
                        );
                      })()}
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 打刻ログ重複確認モーダル */}
      {/* 追加コスト管理モーダル */}
      {false && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCpaV2Open(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-[1100px] max-w-[95vw] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* ヘッダ */}
            <div className="px-5 py-3 border-b border-gray-200 bg-teal-50 rounded-t-xl flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900">新CPA(β) — source_kind='架電バイト'</h2>
                <p className="text-[11px] text-gray-500 mt-0.5">fax-crm と同一ロジック (集計コア)。3シート (ビザ申請 進捗/求人情報/2024_面接内訳)</p>
              </div>
              <button onClick={() => setCpaV2Open(false)} className="text-gray-400 hover:text-gray-700 p-1">×</button>
            </div>
            {/* 操作バー */}
            <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3 bg-gray-50">
              <div className="flex gap-0.5 bg-gray-100 rounded-md p-0.5">
                {[{v:'acquired',l:'案件獲得日'},{v:'offer',l:'内定日'}].map(b => (
                  <button key={b.v} onClick={() => setCpaV2Basis(b.v)}
                    className={`px-3 py-1 text-xs font-medium rounded ${cpaV2Basis === b.v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{b.l}</button>
                ))}
              </div>
              <button disabled={cpaV2Loading}
                onClick={async () => {
                  setCpaV2Loading(true);
                  try {
                    const monthlyRes = await api.get('/api/cpa-v2/monthly', { params: { basis: cpaV2Basis, months: 12 } });
                    let probe = null;
                    try { const p = await api.get('/api/cpa-v2/probe'); probe = p.data.success ? p.data.data : null; } catch {}
                    setCpaV2Data({
                      rows: monthlyRes.data.data?.rows || [],
                      probe,
                      syncRes: null,
                    });
                  } catch (e) { toast.error('取得失敗: ' + (e.response?.data?.message || e.message)); }
                  finally { setCpaV2Loading(false); }
                }}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50">
                {cpaV2Loading ? '取得中...' : '集計を取得'}
              </button>
              <button disabled={cpaV2Loading}
                onClick={async () => {
                  if (!window.confirm('Google Sheets 同期を実行します (10〜90秒)。続行?')) return;
                  setCpaV2Loading(true);
                  try {
                    const s = await api.post('/api/cpa-v2/sync');
                    if (!s.data.success) { toast.error('同期失敗'); setCpaV2Loading(false); return; }
                    const syncRes = s.data.data;
                    const monthlyRes = await api.get('/api/cpa-v2/monthly', { params: { basis: cpaV2Basis, months: 12 } });
                    setCpaV2Data({
                      rows: monthlyRes.data.data?.rows || [],
                      probe: null,
                      syncRes,
                    });
                    toast.success('同期完了');
                  } catch (e) { toast.error('同期失敗: ' + (e.response?.data?.message || e.message)); }
                  finally { setCpaV2Loading(false); }
                }}
                className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded disabled:opacity-50">
                シート同期+集計
              </button>
              {cpaV2Data?.rows?.length > 0 && (
                <span className="text-[11px] text-gray-500 ml-auto">{cpaV2Data.rows.length}ヶ月分</span>
              )}
            </div>
            {/* 本体 */}
            <div className="flex-1 overflow-auto px-5 py-3">
              {!cpaV2Data && !cpaV2Loading && (
                <div className="text-center text-gray-400 text-sm py-10">「集計を取得」を押してください<br/>(初回はシート未同期なら「シート同期+集計」を)</div>
              )}
              {cpaV2Loading && (<div className="text-center text-gray-500 text-sm py-10">処理中... (最大90秒)</div>)}
              {cpaV2Data && (
                <div className="space-y-3">
                  {cpaV2Data.syncRes && (
                    <details open className="bg-gray-50 border border-gray-200 rounded p-2">
                      <summary className="text-xs font-bold cursor-pointer">シート同期結果</summary>
                      <pre className="text-[10px] mt-2 bg-white border p-2 overflow-auto max-h-40">{JSON.stringify(cpaV2Data.syncRes, null, 2)}</pre>
                    </details>
                  )}
                  {cpaV2Data.probe && (
                    <details open className="bg-gray-50 border border-gray-200 rounded p-2">
                      <summary className="text-xs font-bold cursor-pointer">シート診断 (期待値: <span className="bg-emerald-100 px-1 rounded">架電バイト</span>)</summary>
                      {cpaV2Data.probe.serviceAccountEmail && (
                        <div className="mt-2 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800">
                          <b>失敗シートはこのサービスアカウントに「閲覧者」で共有してください:</b><br/>
                          <code className="text-[10px] bg-white px-1.5 py-0.5 rounded border border-amber-300 mt-0.5 inline-block select-all">{cpaV2Data.probe.serviceAccountEmail}</code>
                        </div>
                      )}
                      <div className="mt-2 space-y-1">
                        {[
                          ['売上シート (BE列)', cpaV2Data.probe.projects, cpaV2Data.probe.spreadsheetIds?.projects],
                          ['求人情報 (H列)',     cpaV2Data.probe.jobs,     cpaV2Data.probe.spreadsheetIds?.jobs],
                          ['面接内訳 (NR列)',    cpaV2Data.probe.interviews, cpaV2Data.probe.spreadsheetIds?.interviews],
                        ].map(([label, p, sid]) => (
                          <div key={label} className="text-xs">
                            <b>{label}</b>{sid && (<a href={`https://docs.google.com/spreadsheets/d/${sid}/edit`} target="_blank" rel="noopener noreferrer" className="ml-1 text-[10px] text-blue-500 hover:underline">[開く]</a>)}: {!p?.ok ? <span className="text-red-600">失敗 {p?.error}</span> : (
                              <span className="ml-1">
                                (全{p.totalDataRows}行)
                                {Object.entries(p.byKindValue || {}).sort((a,b)=>b[1]-a[1]).map(([k, v]) => (
                                  <span key={k} className={`inline-block px-1.5 py-0.5 mx-0.5 rounded text-[10px] ${k==='架電バイト'?'bg-emerald-100':k==='FAX受電'?'bg-amber-100':'bg-gray-100'}`}>
                                    <code>{k}</code>:{v}
                                  </span>
                                ))}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {cpaV2Data.rows.length === 0 ? (
                    <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
                      集計結果0行。シート診断で「架電バイト」列の件数を確認してください。0件ならシートに該当データなし、件数があれば同期エラーの可能性。
                    </div>
                  ) : (
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-gray-50">
                        <tr>
                          {['月','案件数','バラシ','面接数','不合格','内定社数','内定率','面接実施率','初回入金','見込売上','入金実績'].map(h => (
                            <th key={h} className="border px-2 py-1.5 text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cpaV2Data.rows.map(r => (
                          <tr key={r.month} className="hover:bg-gray-50">
                            <td className="border px-2 py-1">{r.month}</td>
                            <td className="border px-2 py-1 text-right">{r.projects}</td>
                            <td className="border px-2 py-1 text-right">{r.cancels}</td>
                            <td className="border px-2 py-1 text-right">{r.interviews}</td>
                            <td className="border px-2 py-1 text-right">{r.rejects}</td>
                            <td className="border px-2 py-1 text-right font-bold">{r.offers}</td>
                            <td className="border px-2 py-1 text-right">{r.offer_rate}%</td>
                            <td className="border px-2 py-1 text-right">{r.interview_rate}%</td>
                            <td className="border px-2 py-1 text-right">¥{Number(r.first_payment).toLocaleString()}</td>
                            <td className="border px-2 py-1 text-right">¥{Number(r.expected_revenue).toLocaleString()}</td>
                            <td className="border px-2 py-1 text-right text-red-600 font-bold">¥{Number(r.payment_actual).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {extraCostsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setExtraCostsOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 bg-pink-50 rounded-t-xl flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">追加コスト管理</h2>
                <p className="text-xs text-gray-500 mt-1">コンサル料など、月次でチームコストに加算する費用を登録</p>
              </div>
              <button onClick={() => setExtraCostsOpen(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-auto flex-1">
              {/* 新規登録フォーム */}
              <div className="border rounded p-3 bg-gray-50">
                <h3 className="text-sm font-bold mb-2">新規登録</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
                  <div>
                    <label className="text-xs text-gray-500">対象月</label>
                    <input type="month" value={newExtra.period_ym} onChange={e => setNewExtra({ ...newExtra, period_ym: e.target.value })}
                      className="w-full border rounded px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">カテゴリ</label>
                    <input type="text" value={newExtra.category} onChange={e => setNewExtra({ ...newExtra, category: e.target.value })}
                      className="w-full border rounded px-2 py-1 text-sm" placeholder="コンサル料" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">金額（円）</label>
                    <input type="number" value={newExtra.amount} onChange={e => setNewExtra({ ...newExtra, amount: e.target.value })}
                      className="w-full border rounded px-2 py-1 text-sm text-right" placeholder="100000" />
                  </div>
                  <div className="md:col-span-1">
                    <label className="text-xs text-gray-500">メモ</label>
                    <input type="text" value={newExtra.memo} onChange={e => setNewExtra({ ...newExtra, memo: e.target.value })}
                      className="w-full border rounded px-2 py-1 text-sm" placeholder="任意" />
                  </div>
                  <button onClick={saveExtraCost} className="px-3 py-1.5 bg-pink-600 text-white rounded text-sm hover:bg-pink-700">追加</button>
                </div>
              </div>

              {/* 一覧 */}
              <div>
                <h3 className="text-sm font-bold mb-2">登録済み</h3>
                {extraCostsLoading ? (
                  <p className="text-center py-4 text-gray-400 text-sm">読み込み中...</p>
                ) : extraCostsList.length === 0 ? (
                  <p className="text-center py-4 text-gray-400 text-sm">登録されていません</p>
                ) : (
                  <table className="w-full text-sm border">
                    <thead className="bg-gray-100 text-xs">
                      <tr>
                        <th className="px-2 py-1.5 text-left">対象月</th>
                        <th className="px-2 py-1.5 text-left">カテゴリ</th>
                        <th className="px-2 py-1.5 text-right">金額</th>
                        <th className="px-2 py-1.5 text-left">メモ</th>
                        <th className="px-2 py-1.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {extraCostsList.map(r => (
                        <tr key={r.id} className="border-t hover:bg-gray-50">
                          <td className="px-2 py-1.5">{r.period_ym}</td>
                          <td className="px-2 py-1.5">{r.category}</td>
                          <td className="px-2 py-1.5 text-right font-semibold">¥{Number(r.amount).toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-gray-500 text-xs">{r.memo || '-'}</td>
                          <td className="px-2 py-1.5 text-center">
                            <button onClick={() => deleteExtraCost(r.id)} className="text-xs text-red-600 hover:underline">削除</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 給与貼り付けモーダル */}
      {payrollPasteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPayrollPasteOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 bg-purple-50 rounded-t-xl flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">給与データ貼り付け取込</h2>
                <p className="text-xs text-gray-500 mt-1">対象月: {pdfYearMonth}</p>
              </div>
              <button onClick={() => setPayrollPasteOpen(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm text-gray-700">
                1行=1人 で以下のフォーマットで貼り付けてください（タブ、カンマ、複数空白で区切り）:
              </p>
              <pre className="bg-gray-50 border rounded p-2 text-xs leading-relaxed">名前  支給合計額  健康保険料  介護保険料  厚生年金保険料  雇用保険料{'\n'}中田倫哉  224020  10080  0  18300  1120{'\n'}吉田拓矢  300000  18000  0  28000  1500</pre>
              <p className="text-[11px] text-gray-500">※ コスト = 支給合計額 + (健康 + 介護 + 厚生年金 + 雇用) で自動計算します。介護保険料が無い場合は 0 を入れるか省略してください。</p>
              <textarea
                value={payrollText}
                onChange={e => setPayrollText(e.target.value)}
                rows={12}
                placeholder="名前  支給合計額  健康保険料  介護保険料  厚生年金保険料  雇用保険料"
                className="w-full border rounded p-2 text-sm font-mono"
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setPayrollPasteOpen(false)} className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200">キャンセル</button>
              <button onClick={handlePayrollManualImport} disabled={payrollUploading || !payrollText.trim()}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-40">
                {payrollUploading ? '処理中...' : '取込実行'}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* ===== 書類選考中 明細モーダル ===== */}
      {screeningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setScreeningModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-[1200px] max-w-[96vw] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-gray-200 bg-blue-50 rounded-t-xl flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900">{screeningModal.title}</h2>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  書類選考あり + ステータス=募集中 / 期間: {screeningModal.dateFrom} 〜 {screeningModal.dateTo}
                  {screeningModal.data && <span className="ml-3 font-bold">{screeningModal.data.total} 件</span>}
                </p>
              </div>
              <button onClick={() => setScreeningModal(null)} className="text-gray-400 hover:text-gray-700 p-1 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-auto px-5 py-3">
              {screeningModal.loading && <div className="text-center py-10 text-gray-400 text-sm">読み込み中...</div>}
              {!screeningModal.loading && screeningModal.data && (screeningModal.data.rows || []).length === 0 && (
                <div className="text-center py-10 text-gray-400 text-sm">該当する案件はありません</div>
              )}
              {!screeningModal.loading && screeningModal.data && (screeningModal.data.rows || []).length > 0 && (
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="border px-2 py-1.5 text-left">案件獲得日</th>
                      <th className="border px-2 py-1.5 text-left">求人番号</th>
                      <th className="border px-2 py-1.5 text-left">企業名</th>
                      <th className="border px-2 py-1.5 text-left">業種</th>
                      <th className="border px-2 py-1.5 text-left">都道府県</th>
                      <th className="border px-2 py-1.5 text-left">担当営業</th>
                      <th className="border px-2 py-1.5 text-left bg-amber-50">架電担当</th>
                      <th className="border px-2 py-1.5 text-left">募集開始日</th>
                      <th className="border px-2 py-1.5 text-left">履歴書送付日</th>
                      <th className="border px-2 py-1.5 text-left">面接日</th>
                      <th className="border px-2 py-1.5 text-center">募集あり</th>
                    </tr>
                  </thead>
                  <tbody>
                    {screeningModal.data.rows.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="border px-2 py-1">{r.acquiredDate ? new Date(r.acquiredDate).toLocaleDateString('ja-JP') : '-'}</td>
                        <td className="border px-2 py-1 font-mono text-[11px]">{r.jobNumber || '-'}</td>
                        <td className="border px-2 py-1">
                          {r.id ? (
                            <button type="button" onClick={() => setDetailProjectId(r.id)} className="text-blue-600 hover:underline">
                              {r.companyName || '-'}
                            </button>
                          ) : (
                            <span>{r.companyName || '-'}</span>
                          )}
                        </td>
                        <td className="border px-2 py-1">{r.industry || '-'}</td>
                        <td className="border px-2 py-1">{r.prefecture || '-'}</td>
                        <td className="border px-2 py-1">{r.salesName || '-'}</td>
                        <td className="border px-2 py-1 bg-amber-50/30">{r.callerName || '-'}</td>
                        <td className="border px-2 py-1">{r.recruitmentStartDate ? new Date(r.recruitmentStartDate).toLocaleDateString('ja-JP') : <span className="text-gray-300">未入力</span>}</td>
                        <td className="border px-2 py-1">{r.resumeSentDate ? new Date(r.resumeSentDate).toLocaleDateString('ja-JP') : <span className="text-gray-300">未入力</span>}</td>
                        <td className="border px-2 py-1">{r.interviewDate ? new Date(r.interviewDate).toLocaleDateString('ja-JP') : <span className="text-gray-300">未入力</span>}</td>
                        <td className="border px-2 py-1 text-center">
                          <input type="checkbox" defaultChecked={false} className="cursor-pointer" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== 面接日確定 明細モーダル ===== */}
      {interviewSetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setInterviewSetModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-[1280px] max-w-[96vw] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-gray-200 bg-indigo-50 rounded-t-xl flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900">{interviewSetModal.title}</h2>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  面接日入力済み + ステータス=中間外/結果系 / 期間: {interviewSetModal.dateFrom} 〜 {interviewSetModal.dateTo}
                  {interviewSetModal.data && <span className="ml-3 font-bold">{interviewSetModal.data.total} 件</span>}
                </p>
                {interviewSetModal.data && interviewSetModal.data.statusCounts && Object.keys(interviewSetModal.data.statusCounts).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {Object.entries(interviewSetModal.data.statusCounts).map(([s, c]) => (
                      <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded bg-white border border-indigo-200 text-indigo-700">
                        {s}: <span className="font-bold">{c}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => setInterviewSetModal(null)} className="text-gray-400 hover:text-gray-700 p-1 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-auto px-5 py-3">
              {interviewSetModal.loading && <div className="text-center py-10 text-gray-400 text-sm">読み込み中...</div>}
              {!interviewSetModal.loading && interviewSetModal.data && (interviewSetModal.data.rows || []).length === 0 && (
                <div className="text-center py-10 text-gray-400 text-sm">該当する案件はありません</div>
              )}
              {!interviewSetModal.loading && interviewSetModal.data && (interviewSetModal.data.rows || []).length > 0 && (
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="border px-2 py-1.5 text-left">案件獲得日</th>
                      <th className="border px-2 py-1.5 text-left">求人番号</th>
                      <th className="border px-2 py-1.5 text-left">企業名</th>
                      <th className="border px-2 py-1.5 text-left">担当営業</th>
                      <th className="border px-2 py-1.5 text-left bg-amber-50">架電担当</th>
                      <th className="border px-2 py-1.5 text-left">募集開始日</th>
                      <th className="border px-2 py-1.5 text-left">履歴書送付日</th>
                      <th className="border px-2 py-1.5 text-left bg-indigo-50">面接日</th>
                      <th className="border px-2 py-1.5 text-left">ステータス</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interviewSetModal.data.rows.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="border px-2 py-1">{r.acquiredDate ? new Date(r.acquiredDate).toLocaleDateString('ja-JP') : '-'}</td>
                        <td className="border px-2 py-1 font-mono text-[11px]">{r.jobNumber || '-'}</td>
                        <td className="border px-2 py-1">
                          {r.id ? (
                            <button type="button" onClick={() => setDetailProjectId(r.id)} className="text-blue-600 hover:underline">
                              {r.companyName || '-'}
                            </button>
                          ) : (
                            <span>{r.companyName || '-'}</span>
                          )}
                        </td>
                        <td className="border px-2 py-1">{r.salesName || '-'}</td>
                        <td className="border px-2 py-1 bg-amber-50/30">{r.callerName || '-'}</td>
                        <td className="border px-2 py-1">{r.recruitmentStartDate ? new Date(r.recruitmentStartDate).toLocaleDateString('ja-JP') : <span className="text-gray-300">未入力</span>}</td>
                        <td className="border px-2 py-1">{r.resumeSentDate ? new Date(r.resumeSentDate).toLocaleDateString('ja-JP') : <span className="text-gray-300">未入力</span>}</td>
                        <td className="border px-2 py-1 bg-indigo-50/30 font-medium">{r.interviewDate ? new Date(r.interviewDate).toLocaleDateString('ja-JP') : <span className="text-gray-300">未入力</span>}</td>
                        <td className="border px-2 py-1">{r.status || <span className="text-gray-400">面接実施待ち</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== 面接実施 明細モーダル ===== */}
      {interviewDoneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setInterviewDoneModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-[1320px] max-w-[96vw] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-gray-200 bg-violet-50 rounded-t-xl flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900">{interviewDoneModal.title}</h2>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  ステータス=KEKKA_MACHI/NAITEI/NAITEI_TORIKESHI/FUGOKAKU / 期間: {interviewDoneModal.dateFrom} 〜 {interviewDoneModal.dateTo}
                  {interviewDoneModal.data && <span className="ml-3 font-bold">{interviewDoneModal.data.total} 件</span>}
                </p>
                {interviewDoneModal.data && interviewDoneModal.data.statusCounts && Object.keys(interviewDoneModal.data.statusCounts).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {Object.entries(interviewDoneModal.data.statusCounts).map(([s, c]) => (
                      <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded bg-white border border-violet-200 text-violet-700">
                        {s}: <span className="font-bold">{c}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => setInterviewDoneModal(null)} className="text-gray-400 hover:text-gray-700 p-1 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-auto px-5 py-3">
              {interviewDoneModal.loading && <div className="text-center py-10 text-gray-400 text-sm">読み込み中...</div>}
              {!interviewDoneModal.loading && interviewDoneModal.data && (interviewDoneModal.data.rows || []).length === 0 && (
                <div className="text-center py-10 text-gray-400 text-sm">該当する案件はありません</div>
              )}
              {!interviewDoneModal.loading && interviewDoneModal.data && (interviewDoneModal.data.rows || []).length > 0 && (
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="border px-2 py-1.5 text-left">案件獲得日</th>
                      <th className="border px-2 py-1.5 text-left">求人番号</th>
                      <th className="border px-2 py-1.5 text-left">企業名</th>
                      <th className="border px-2 py-1.5 text-left">担当営業</th>
                      <th className="border px-2 py-1.5 text-left bg-amber-50">架電担当</th>
                      <th className="border px-2 py-1.5 text-left">面接日</th>
                      <th className="border px-2 py-1.5 text-left">内定日</th>
                      <th className="border px-2 py-1.5 text-left bg-violet-50">ステータス</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interviewDoneModal.data.rows.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="border px-2 py-1">{r.acquiredDate ? new Date(r.acquiredDate).toLocaleDateString('ja-JP') : '-'}</td>
                        <td className="border px-2 py-1 font-mono text-[11px]">{r.jobNumber || '-'}</td>
                        <td className="border px-2 py-1">
                          {r.id ? (
                            <button type="button" onClick={() => setDetailProjectId(r.id)} className="text-blue-600 hover:underline">
                              {r.companyName || '-'}
                            </button>
                          ) : (
                            <span>{r.companyName || '-'}</span>
                          )}
                        </td>
                        <td className="border px-2 py-1">{r.salesName || '-'}</td>
                        <td className="border px-2 py-1 bg-amber-50/30">{r.callerName || '-'}</td>
                        <td className="border px-2 py-1">{r.interviewDate ? new Date(r.interviewDate).toLocaleDateString('ja-JP') : <span className="text-gray-300">未入力</span>}</td>
                        <td className="border px-2 py-1">{r.naiteiDate ? new Date(r.naiteiDate).toLocaleDateString('ja-JP') : <span className="text-gray-300">-</span>}</td>
                        <td className="border px-2 py-1 bg-violet-50/30 font-medium">{r.status || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== 新CPA(v2) 内訳モーダル ===== */}
      {v2Modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setV2Modal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-[1280px] max-w-[96vw] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-gray-200 bg-emerald-50 rounded-t-xl flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900">
                  {v2Modal.type === 'offers' ? '内定社内訳' : v2Modal.type === 'rejects' ? '不合格内訳' : '面接内訳'} — {String(v2Modal.month).slice(0, 7).replace('-', '年')}月
                </h2>
                <p className="text-[11px] text-gray-500 mt-0.5">basis=acquired / source_kind='架電バイト'</p>
              </div>
              <button onClick={() => setV2Modal(null)} className="text-gray-400 hover:text-gray-700 p-1 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-auto px-5 py-3">
              {v2Modal.loading && <div className="text-center py-10 text-gray-400 text-sm">読み込み中...</div>}
              {!v2Modal.loading && v2Modal.type === 'offers' && <V2OffersTable rows={v2Modal.data?.rows || []} />}
              {!v2Modal.loading && (v2Modal.type === 'interviews' || v2Modal.type === 'rejects') && (
                <V2InterviewsTable rows={v2Modal.data?.rows || []} offerOnly={v2Modal.data?.offerOnly || []} kind={v2Modal.type} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* 案件詳細モーダル (内訳テーブル内の企業名クリックで開く) */}
      {detailProjectId && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 overflow-y-auto py-6 px-4"
          onClick={() => setDetailProjectId(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-6xl my-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white rounded-t-xl z-10">
              <h2 className="text-base font-bold text-gray-900">案件詳細</h2>
              <button
                onClick={() => setDetailProjectId(null)}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="閉じる"
              >
                <svg className="w-5 h-5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-5">
              <ProjectDetailContent
                id={detailProjectId}
                embedded
                onSaved={() => setDetailProjectId(null)}
                onClose={() => setDetailProjectId(null)}
              />
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

// ===== 新CPA(v2) 内定社内訳テーブル =====
function V2OffersTable({ rows }) {
  const fmtDate = (s) => s ? new Date(s).toLocaleDateString('ja-JP') : '-';
  const yen = (n) => '¥' + (Number(n) || 0).toLocaleString();
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
            <th className="border px-2 py-1.5 text-left">内定日</th>
            <th className="border px-2 py-1.5 text-left">案件取得日</th>
            <th className="border px-2 py-1.5 text-left">求人番号</th>
            <th className="border px-2 py-1.5 text-left">会社名</th>
            <th className="border px-2 py-1.5 text-right">合格人数</th>
            <th className="border px-2 py-1.5 text-left">登録番号</th>
            <th className="border px-2 py-1.5 text-left">営業担当</th>
            <th className="border px-2 py-1.5 text-left bg-amber-50">架電担当</th>
            <th className="border px-2 py-1.5 text-left">業種</th>
            <th className="border px-2 py-1.5 text-right">初回入金</th>
            <th className="border px-2 py-1.5 text-right">見込売上</th>
            <th className="border px-2 py-1.5 text-right">入金実績</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const k = (r.job_number && r.job_number.trim()) || r.company_name || '?';
            const isFirst = k !== lastKey; lastKey = k;
            const label = r.is_cancelled ? '取消' : r.is_declined ? '辞退' : '通常';
            const labelCls = r.is_cancelled ? 'bg-red-100 text-red-700' : r.is_declined ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700';
            return (
              <tr key={r.id || idx} className="hover:bg-gray-50">
                <td className="border px-2 py-1"><span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${labelCls}`}>{label}</span></td>
                <td className="border px-2 py-1">{fmtDate(r.offer_date)}</td>
                <td className="border px-2 py-1">{fmtDate(r.acquired_date)}</td>
                <td className="border px-2 py-1 font-mono text-[11px]">{isFirst ? r.job_number : <span className="text-gray-300">〃</span>}</td>
                <td className="border px-2 py-1">{isFirst ? (r.company_name || '-') : <span className="text-gray-300">〃</span>}</td>
                <td className="border px-2 py-1 text-right">{isFirst ? `${countByKey[k]}名` : ''}</td>
                <td className="border px-2 py-1 font-mono text-[11px]">{r.candidate_registration_no || '-'}</td>
                <td className="border px-2 py-1">{r.sales_owner || '-'}</td>
                <td className="border px-2 py-1 bg-amber-50/30">{r.caller_name || '-'}</td>
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
            <td colSpan={5} className="border px-2 py-2 text-right">内定 {uniqueOfferCompanies} 社 / 合格者 {totals.hires} 名 (取消 {cancelCount} / 辞退 {declineCount})</td>
            <td className="border px-2 py-2 text-right">{totals.hires}名</td>
            <td colSpan={4} className="border"></td>
            <td className="border px-2 py-2 text-right text-emerald-700">{yen(totals.initial)}</td>
            <td className="border px-2 py-2 text-right text-blue-700">{yen(totals.expected)}</td>
            <td className="border px-2 py-2 text-right text-red-600">{yen(totals.actual)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ===== 新CPA(v2) 面接/不合格内訳テーブル =====
function V2InterviewsTable({ rows, offerOnly, kind }) {
  const fmtDate = (s) => s ? new Date(s).toLocaleDateString('ja-JP') : '-';
  const totalCompanies = new Set(rows.map(r => (r.job_number && r.job_number.trim()) || r.company_name)).size;
  const offerOnlyCount = offerOnly?.length || 0;
  const resultCls = (l) => l === '合格' ? 'bg-emerald-100 text-emerald-700'
                          : l === '不合格' ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-600';
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
            <th className="border px-2 py-1.5 text-center">面接結果</th>
            <th className="border px-2 py-1.5 text-left">営業担当</th>
            <th className="border px-2 py-1.5 text-left bg-amber-50">架電担当</th>
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
              <td className="border px-2 py-1 text-center">
                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${resultCls(r.result_label)}`}>{r.result_label || '-'}</span>
              </td>
              <td className="border px-2 py-1">{r.sales_owner || '-'}</td>
              <td className="border px-2 py-1 bg-amber-50/30">{r.caller_name || '-'}</td>
              <td className="border px-2 py-1">{r.industry || '-'}</td>
            </tr>
          ))}
          {offerOnly && offerOnly.length > 0 && (
            <>
              <tr><td colSpan={10} className="border-t-2 border-gray-300 px-2 py-1.5 bg-amber-50 text-xs text-gray-600">
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
                  <td className="border px-2 py-1 text-center"><span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700">合格(内定)</span></td>
                  <td className="border px-2 py-1">{r.sales_owner || '-'}</td>
                  <td className="border px-2 py-1 bg-amber-50/30">{r.caller_name || '-'}</td>
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
