/**
 * 期間→日付範囲 変換ユーティリティ
 * daily / weekly / monthly / cumulative を dateFrom, dateTo に変換
 */

const getDateRange = (period, refDate) => {
  const date = refDate || new Date().toISOString().slice(0, 10);

  switch (period) {
    case 'daily':
      return { dateFrom: date, dateTo: date };

    case 'weekly': {
      const d = new Date(date);
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return {
        dateFrom: monday.toISOString().slice(0, 10),
        dateTo: sunday.toISOString().slice(0, 10),
      };
    }

    case 'monthly': {
      const d2 = new Date(date);
      const year = d2.getFullYear();
      const month = String(d2.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(year, d2.getMonth() + 1, 0).getDate();
      return {
        dateFrom: `${year}-${month}-01`,
        dateTo: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
      };
    }

    case 'cumulative':
      return { dateFrom: '2000-01-01', dateTo: '2099-12-31' };

    default:
      return null;
  }
};

module.exports = { getDateRange };
