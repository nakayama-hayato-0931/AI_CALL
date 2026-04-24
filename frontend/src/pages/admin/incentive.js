/**
 * インセンティブ管理ページ
 * 各オペレーターが獲得した内定を、内定日ベースで月別に集計して表示。
 * 各行はトグルで展開でき、内定した企業情報の一覧が見られる。
 */
import { Fragment, useState, useEffect } from 'react';
import Layout from '../../components/common/Layout';
import useAuth from '../../hooks/useAuth';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

function formatMoney(n) {
  if (n == null) return '-';
  const num = Number(n);
  if (!isFinite(num)) return '-';
  return num.toLocaleString('ja-JP') + '円';
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

export default function IncentivePage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [expanded, setExpanded] = useState({}); // { userId: true }
  const [monthFilter, setMonthFilter] = useState({}); // { userId: monthIndex|null }

  const years = [];
  for (let y = currentYear + 1; y >= 2024; y--) years.push(y);

  useEffect(() => {
    if (user && !['admin', 'manager', 'consultant'].includes(user.role)) return;
    fetchData();
  }, [user, year]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get(`/api/admin/incentive?year=${year}`);
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

  const onMonthCellClick = (userId, monthIdx) => {
    setExpanded((prev) => ({ ...prev, [userId]: true }));
    setMonthFilter((prev) => ({
      ...prev,
      [userId]: prev[userId] === monthIdx ? null : monthIdx,
    }));
  };

  if (user && !['admin', 'manager', 'consultant'].includes(user.role)) {
    return (
      <Layout>
        <div className="p-6">権限がありません</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">インセンティブ管理</h1>
          <div className="flex items-center gap-2">
            <label className="text-sm">対象年:</label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="border rounded px-2 py-1 text-sm"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}年</option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          内定日ベースで集計しています。行をクリックすると、内定した企業情報の一覧が表示されます。
          月のセルをクリックすると、その月の案件のみ絞り込みできます。
        </p>

        {loading ? (
          <div className="text-center py-12 text-gray-500">読み込み中...</div>
        ) : !data ? (
          <div className="text-center py-12 text-gray-500">データがありません</div>
        ) : (
          <div className="overflow-x-auto bg-white rounded-lg shadow">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left sticky left-0 bg-gray-100 z-10">オペレーター</th>
                  {MONTH_LABELS.map((m) => (
                    <th key={m} className="px-2 py-2 text-center whitespace-nowrap">{m}</th>
                  ))}
                  <th className="px-3 py-2 text-center bg-blue-50">年間合計</th>
                </tr>
              </thead>
              <tbody>
                {data.operators.length === 0 && (
                  <tr>
                    <td colSpan={14} className="text-center py-8 text-gray-500">
                      対象オペレーターがいません
                    </td>
                  </tr>
                )}
                {data.operators.map((op) => {
                  const isOpen = !!expanded[op.userId];
                  const activeMonth = monthFilter[op.userId];
                  const filteredProjects =
                    activeMonth != null
                      ? op.projects.filter((p) => {
                          if (!p.naiteiDate) return false;
                          return new Date(p.naiteiDate).getMonth() === activeMonth;
                        })
                      : op.projects;
                  return (
                    <Fragment key={op.userId}>
                      <tr
                        key={`row-${op.userId}`}
                        className="border-t hover:bg-gray-50 cursor-pointer"
                        onClick={() => toggle(op.userId)}
                      >
                        <td className="px-3 py-2 sticky left-0 bg-white z-10">
                          <span className="mr-1">{isOpen ? '▼' : '▶'}</span>
                          {op.name}
                          {!op.isActive && (
                            <span className="ml-2 text-xs text-gray-400">(無効)</span>
                          )}
                          {op.role === 'intern' && (
                            <span className="ml-2 text-xs text-purple-600">[インターン]</span>
                          )}
                        </td>
                        {op.monthlyCounts.map((c, idx) => (
                          <td
                            key={idx}
                            className={`px-2 py-2 text-center ${c > 0 ? 'font-semibold text-blue-700' : 'text-gray-300'} ${
                              activeMonth === idx ? 'bg-blue-100' : ''
                            } hover:bg-blue-50`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (c > 0) onMonthCellClick(op.userId, idx);
                            }}
                          >
                            {c || '-'}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-center font-bold bg-blue-50">
                          {op.yearTotal}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`detail-${op.userId}`} className="bg-gray-50">
                          <td colSpan={14} className="p-0">
                            <div className="p-4">
                              {activeMonth != null && (
                                <div className="mb-2 text-sm">
                                  <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 rounded">
                                    {MONTH_LABELS[activeMonth]}で絞り込み中
                                  </span>
                                  <button
                                    className="ml-2 text-xs text-blue-600 hover:underline"
                                    onClick={() =>
                                      setMonthFilter((prev) => ({ ...prev, [op.userId]: null }))
                                    }
                                  >
                                    クリア
                                  </button>
                                </div>
                              )}
                              {filteredProjects.length === 0 ? (
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
                                      {filteredProjects.map((p) => (
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
                                      <tr className="border-t bg-blue-50 font-semibold">
                                        <td colSpan={4} className="px-2 py-1 text-right">合計</td>
                                        <td className="px-2 py-1 text-right">
                                          {filteredProjects.reduce((s, p) => s + (Number(p.hireCount) || 0), 0)}人
                                        </td>
                                        <td className="px-2 py-1 text-right">
                                          {formatMoney(filteredProjects.reduce((s, p) => s + (Number(p.initialPayment) || 0), 0))}
                                        </td>
                                        <td className="px-2 py-1 text-right">
                                          {formatMoney(filteredProjects.reduce((s, p) => s + (Number(p.expectedRevenue) || 0), 0))}
                                        </td>
                                      </tr>
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
                {data.team && (
                  <tr className="border-t bg-yellow-50 font-bold">
                    <td className="px-3 py-2 sticky left-0 bg-yellow-50 z-10">チーム合計</td>
                    {data.team.monthlyCounts.map((c, idx) => (
                      <td key={idx} className="px-2 py-2 text-center">
                        {c || '-'}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center bg-yellow-100">{data.team.yearTotal}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
