/**
 * インセンティブ管理ページ（月別）
 * サマリ: 内定社数合計 / 初回入金合計 / 見込入金合計 / コスト / ROAS
 * オペレーター別内訳（トグルで案件一覧を展開）
 */
import { Fragment, useState, useEffect } from 'react';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

function formatMoney(n) {
  if (n == null) return '-';
  const num = Number(n);
  if (!isFinite(num)) return '-';
  return '¥' + num.toLocaleString('ja-JP');
}

function formatDate(d) {
  if (!d) return '-';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '-';
    return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;
  } catch {
    return '-';
  }
}

// 月候補（2025-01 〜 翌年12月）
const MONTHS = (() => {
  const arr = [];
  const nextYear = new Date().getFullYear() + 1;
  for (let y = nextYear; y >= 2025; y--) {
    for (let m = 12; m >= 1; m--) {
      arr.push(`${y}-${String(m).padStart(2, '0')}`);
    }
  }
  return arr;
})();

function SummaryCard({ label, value, sub, color }) {
  return (
    <div className={`bg-white rounded-lg shadow p-4 border-l-4 ${color || 'border-blue-500'}`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function IncentivePage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const nowMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(nowMonth);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    if (user && !['admin', 'manager', 'consultant'].includes(user.role)) return;
    fetchData();
  }, [user, month]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get(`/api/admin/incentive?month=${month}`);
      if (res.success) setData(res.data);
      else toast.error('取得に失敗しました');
    } catch (err) {
      toast.error('データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (userId) => {
    setExpanded((prev) => ({ ...prev, [userId]: !prev[userId] }));
  };

  if (user && !['admin', 'manager', 'consultant'].includes(user.role)) {
    return (
      <Layout>
        <div className="p-6">権限がありません</div>
      </Layout>
    );
  }

  const s = data?.summary;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h1 className="text-2xl font-bold">インセンティブ管理</h1>
          <div className="flex items-center gap-2">
            <label className="text-sm">対象月:</label>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              {MONTHS.map((m) => {
                const [yy, mm] = m.split('-');
                return (
                  <option key={m} value={m}>{yy}年{Number(mm)}月</option>
                );
              })}
            </select>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          内定日ベースで集計しています。ROAS = 初回入金 ÷ コスト × 100%
        </p>

        {/* サマリカード */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <SummaryCard
            label="内定社数合計"
            value={loading || !s ? '-' : `${s.naiteiCount}社`}
            sub={s ? `計 ${s.hireTotal}人` : null}
            color="border-blue-500"
          />
          <SummaryCard
            label="初回入金合計"
            value={loading || !s ? '-' : formatMoney(s.initialPayment)}
            color="border-green-500"
          />
          <SummaryCard
            label="見込入金合計"
            value={loading || !s ? '-' : formatMoney(s.expectedRevenue)}
            color="border-teal-500"
          />
          <SummaryCard
            label="コスト合計"
            value={loading || !s ? '-' : formatMoney(s.cost)}
            color="border-orange-500"
          />
          <SummaryCard
            label="ROAS"
            value={loading || !s ? '-' : `${s.roas}%`}
            sub="初回入金 ÷ コスト"
            color={s && s.roas >= 100 ? 'border-green-600' : 'border-red-500'}
          />
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500">読み込み中...</div>
        ) : !data ? (
          <div className="text-center py-12 text-gray-500">データがありません</div>
        ) : (
          <div className="overflow-x-auto bg-white rounded-lg shadow">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left">オペレーター</th>
                  <th className="px-3 py-2 text-right">内定社数</th>
                  <th className="px-3 py-2 text-right">内定人数</th>
                  <th className="px-3 py-2 text-right">初回入金</th>
                  <th className="px-3 py-2 text-right">見込入金</th>
                  <th className="px-3 py-2 text-right">コスト</th>
                  <th className="px-3 py-2 text-right">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {data.operators.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-gray-500">
                      対象オペレーターがいません
                    </td>
                  </tr>
                )}
                {data.operators.map((op) => {
                  const isOpen = !!expanded[op.userId];
                  return (
                    <Fragment key={op.userId}>
                      <tr
                        className="border-t hover:bg-gray-50 cursor-pointer"
                        onClick={() => toggle(op.userId)}
                      >
                        <td className="px-3 py-2">
                          <span className="mr-1">{isOpen ? '▼' : '▶'}</span>
                          {op.name}
                          {!op.isActive && <span className="ml-2 text-xs text-gray-400">(無効)</span>}
                          {op.role === 'intern' && (
                            <span className="ml-2 text-xs text-purple-600">[インターン]</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {op.naiteiCount > 0 ? `${op.naiteiCount}社` : '-'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {op.hireTotal > 0 ? `${op.hireTotal}人` : '-'}
                        </td>
                        <td className="px-3 py-2 text-right">{op.initialPayment ? formatMoney(op.initialPayment) : '-'}</td>
                        <td className="px-3 py-2 text-right">{op.expectedRevenue ? formatMoney(op.expectedRevenue) : '-'}</td>
                        <td className="px-3 py-2 text-right">{op.cost ? formatMoney(op.cost) : '-'}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${op.roas >= 100 ? 'text-green-700' : op.roas > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                          {op.cost > 0 ? `${op.roas}%` : '-'}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-gray-50">
                          <td colSpan={7} className="p-0">
                            <div className="p-4">
                              {op.projects.length === 0 ? (
                                <div className="text-center py-4 text-gray-500 text-sm">
                                  内定案件はありません
                                </div>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-xs bg-white border">
                                    <thead className="bg-gray-100">
                                      <tr>
                                        <th className="px-2 py-1 text-left">求人番号</th>
                                        <th className="px-2 py-1 text-left">企業名</th>
                                        <th className="px-2 py-1 text-left">内定日</th>
                                        <th className="px-2 py-1 text-left">担当営業</th>
                                        <th className="px-2 py-1 text-right">内定人数</th>
                                        <th className="px-2 py-1 text-right">初回入金</th>
                                        <th className="px-2 py-1 text-right">見込入金</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {op.projects.map((p) => (
                                        <tr key={p.projectId} className="border-t hover:bg-gray-50">
                                          <td className="px-2 py-1">{p.jobNumber || '-'}</td>
                                          <td className="px-2 py-1">{p.companyName || '-'}</td>
                                          <td className="px-2 py-1">{formatDate(p.naiteiDate)}</td>
                                          <td className="px-2 py-1">{p.salesName || '-'}</td>
                                          <td className="px-2 py-1 text-right">{p.hireCount || 0}人</td>
                                          <td className="px-2 py-1 text-right">{formatMoney(p.initialPayment)}</td>
                                          <td className="px-2 py-1 text-right">{formatMoney(p.expectedRevenue)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              {data.operators.length > 0 && (
                <tfoot className="bg-yellow-50 font-bold">
                  <tr className="border-t">
                    <td className="px-3 py-2">合計</td>
                    <td className="px-3 py-2 text-right">{s.naiteiCount}社</td>
                    <td className="px-3 py-2 text-right">{s.hireTotal}人</td>
                    <td className="px-3 py-2 text-right">{formatMoney(s.initialPayment)}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(s.expectedRevenue)}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(s.cost)}</td>
                    <td className={`px-3 py-2 text-right ${s.roas >= 100 ? 'text-green-700' : 'text-red-600'}`}>
                      {s.cost > 0 ? `${s.roas}%` : '-'}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
