/**
 * CPA / 案件質分析ページ
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
  // 月曜始まり
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

export default function AnalyticsPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [periodMode, setPeriodMode] = useState('monthly'); // monthly | weekly | cumulative
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedWeekDate, setSelectedWeekDate] = useState('');
  const [scope, setScope] = useState('team');
  const [targetUserId, setTargetUserId] = useState('');
  const [operators, setOperators] = useState([]);

  const [cpa, setCpa] = useState(null);
  const [quality, setQuality] = useState(null);
  const [teamCpa, setTeamCpa] = useState(null);
  const [teamQuality, setTeamQuality] = useState(null);
  const [loading, setLoading] = useState(true);

  // CSV
  const [csvFile, setCsvFile] = useState(null);
  const [csvUploading, setCsvUploading] = useState(false);

  useEffect(() => {
    if (user && user.role !== 'admin' && user.role !== 'manager') {
      router.push('/');
    }
  }, [user]);

  useEffect(() => {
    const fetchOps = async () => {
      try {
        const { data } = await api.get('/api/analytics/operators');
        setOperators(data.data || []);
      } catch {}
    };
    fetchOps();
  }, []);

  // 週の初期選択
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
      const { period, date } = getApiParams();
      const baseParams = { period, date };

      // 個人データ
      const scopeParams = scope === 'operator' && targetUserId
        ? { ...baseParams, scope: 'operator', target_user_id: targetUserId }
        : { ...baseParams, scope: 'team' };

      const [cpaRes, qualRes] = await Promise.all([
        api.get('/api/analytics/cpa', { params: scopeParams }),
        api.get('/api/analytics/quality', { params: scopeParams }),
      ]);
      setCpa(cpaRes.data.data);
      setQuality(qualRes.data.data);

      // 個人選択時はチーム平均も取得
      if (scope === 'operator' && targetUserId) {
        const [teamCpaRes, teamQualRes] = await Promise.all([
          api.get('/api/analytics/cpa', { params: { ...baseParams, scope: 'team' } }),
          api.get('/api/analytics/quality', { params: { ...baseParams, scope: 'team' } }),
        ]);
        setTeamCpa(teamCpaRes.data.data);
        setTeamQuality(teamQualRes.data.data);
      } else {
        setTeamCpa(null);
        setTeamQuality(null);
      }
    } catch (err) {
      toast.error('データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [getApiParams, scope, targetUserId]);

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

  const CpaRow = ({ label, value, teamValue, format = 'number', highlight }) => {
    const formatted = format === 'yen' ? `¥${fmt(value)}` : format === 'pct' ? fmtPct(value) : fmt(value);
    const teamFormatted = teamValue != null
      ? (format === 'yen' ? `¥${fmt(teamValue)}` : format === 'pct' ? fmtPct(teamValue) : fmt(teamValue))
      : null;
    return (
      <div className={`flex items-center justify-between py-2.5 px-3 rounded-lg ${highlight ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
        <span className="text-sm text-gray-600">{label}</span>
        <div className="flex items-center gap-4">
          {teamFormatted != null && (
            <span className="text-xs text-gray-400" title="チーム全体">({teamFormatted})</span>
          )}
          <span className={`text-sm font-bold ${highlight ? 'text-blue-700' : 'text-gray-900'}`}>{formatted}</span>
        </div>
      </div>
    );
  };

  const QualityRow = ({ label, count, pct, teamCount, teamPct }) => (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-gray-50">
      <span className="text-sm text-gray-600">{label}</span>
      <div className="flex items-center gap-4">
        {teamCount != null && (
          <span className="text-xs text-gray-400" title="チーム全体">({fmt(teamCount)} / {fmtPct(teamPct)})</span>
        )}
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-900">{fmt(count)}</span>
          {pct != null && (
            <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{fmtPct(pct)}</span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <Layout>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">CPA / 案件質分析</h1>
        <p className="text-sm text-gray-400 mt-0.5">コスト・案件化率・面接・売上の分析</p>
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

          {/* スコープ */}
          <div>
            <label className="input-label">対象</label>
            <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => { setScope('team'); setTargetUserId(''); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  scope === 'team' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>全体</button>
              <button
                onClick={() => setScope('operator')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  scope === 'operator' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>個人</button>
            </div>
          </div>

          {scope === 'operator' && (
            <div>
              <label className="input-label">オペレーター</label>
              <select className="input text-sm" value={targetUserId}
                onChange={e => setTargetUserId(e.target.value)}>
                <option value="">選択してください</option>
                {operators.map(op => <option key={op.id} value={op.id}>{op.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* コストCSVインポート */}
        <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-500">コストデータ:</span>
          <input type="file" accept=".csv" onChange={e => setCsvFile(e.target.files?.[0] || null)}
            className="text-xs text-gray-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200" />
          <button onClick={handleCsvUpload} disabled={!csvFile || csvUploading}
            className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 transition-colors">
            {csvUploading ? 'アップロード中...' : 'CSV取込'}
          </button>
          <span className="text-[10px] text-gray-400">形式: 日付,名前,開始,終了,休憩(分)</span>
        </div>
      </div>

      {loading ? (
        <div className="card p-12 text-center">
          <svg className="animate-spin w-6 h-6 text-gray-400 mx-auto" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* CPA */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">📊</span>
              <h2 className="text-sm font-bold text-gray-800">CPA指標</h2>
              {cpa && <span className="text-[10px] text-gray-400 ml-auto">{cpa.dateFrom} 〜 {cpa.dateTo}</span>}
            </div>
            {cpa && (
              <div className="space-y-0.5">
                <CpaRow label="コスト" value={cpa.cost} teamValue={teamCpa?.cost} format="yen" />
                <CpaRow label="コール数" value={cpa.callCount} teamValue={teamCpa?.callCount} />
                <CpaRow label="コール/案件化率" value={cpa.projectRate} teamValue={teamCpa?.projectRate} format="pct" />
                <CpaRow label="獲得案件数" value={cpa.projectCount} teamValue={teamCpa?.projectCount} highlight />
                <CpaRow label="案件CPA" value={cpa.projectCpa} teamValue={teamCpa?.projectCpa} format="yen" />
                <CpaRow label="面接数" value={cpa.interviewCount} teamValue={teamCpa?.interviewCount} />
                <CpaRow label="面接CPA" value={cpa.interviewCpa} teamValue={teamCpa?.interviewCpa} format="yen" />
                <CpaRow label="内定" value={cpa.naiteiCount} teamValue={teamCpa?.naiteiCount} />
                <CpaRow label="不合格" value={cpa.fugokakuCount} teamValue={teamCpa?.fugokakuCount} />
                <CpaRow label="バラシ・失注" value={cpa.barashiLostCount} teamValue={teamCpa?.barashiLostCount} />
                <CpaRow label="初回入金" value={cpa.initialPayment} teamValue={teamCpa?.initialPayment} format="yen" highlight />
                <CpaRow label="見込売上" value={cpa.expectedRevenue} teamValue={teamCpa?.expectedRevenue} format="yen" />
                <CpaRow label="ROAS" value={cpa.roas} teamValue={teamCpa?.roas} format="pct" highlight />
              </div>
            )}
          </div>

          {/* 案件質向上 */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">📈</span>
              <h2 className="text-sm font-bold text-gray-800">案件質向上</h2>
              {quality && <span className="text-[10px] text-gray-400 ml-auto">{quality.dateFrom} 〜 {quality.dateTo}</span>}
            </div>
            {quality && (
              <div className="space-y-0.5">
                <QualityRow label="案件数" count={quality.total} />
                <QualityRow label="失注" count={quality.lost} pct={quality.lostPct}
                  teamCount={teamQuality?.lost} teamPct={teamQuality?.lostPct} />
                <QualityRow label="連絡待ち" count={quality.waitingContact} pct={quality.waitingContactPct}
                  teamCount={teamQuality?.waitingContact} teamPct={teamQuality?.waitingContactPct} />
                <QualityRow label="面接日確定" count={quality.interviewSet} pct={quality.interviewSetPct}
                  teamCount={teamQuality?.interviewSet} teamPct={teamQuality?.interviewSetPct} />
                <QualityRow label="面接実施" count={quality.interviewDone} pct={quality.interviewDonePct}
                  teamCount={teamQuality?.interviewDone} teamPct={teamQuality?.interviewDonePct} />
                <QualityRow label="バラシ" count={quality.barashi} pct={quality.barashiPct}
                  teamCount={teamQuality?.barashi} teamPct={teamQuality?.barashiPct} />
                <QualityRow label="オンライン面接" count={quality.onlineInterview} pct={quality.onlineInterviewPct}
                  teamCount={teamQuality?.onlineInterview} teamPct={teamQuality?.onlineInterviewPct} />
                <QualityRow label="書類選考無し" count={quality.noScreening} pct={quality.noScreeningPct}
                  teamCount={teamQuality?.noScreening} teamPct={teamQuality?.noScreeningPct} />
                <QualityRow label="書類選考落ち" count={quality.screeningFailed} pct={quality.screeningFailedPct}
                  teamCount={teamQuality?.screeningFailed} teamPct={teamQuality?.screeningFailedPct} />
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
