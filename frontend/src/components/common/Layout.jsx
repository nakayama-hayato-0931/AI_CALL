/**
 * 共通レイアウト
 * 洗練されたサイドナビ + コンテンツエリア
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useAuth from '../../hooks/useAuth';

/* SVGアイコンコンポーネント */
const icons = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="4" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="11" width="7" height="10" rx="1" />
    </svg>
  ),
  call: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  ),
  recall: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  project: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  ),
  log: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  ai: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
    </svg>
  ),
  csv: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  ),
  performance: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  request: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  ),
  list: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  script: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /><line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="13" x2="13" y2="13" />
    </svg>
  ),
  collapse: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" />
    </svg>
  ),
  expand: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" />
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
};

// 管理者メニュー（マスター定義）— ここに追加すればマネージャーにも自動反映
const ADMIN_NAV = [
  { href: '/', label: 'ダッシュボード', icon: 'dashboard' },
  { href: '/admin/analytics', label: 'CPA/案件質分析', icon: 'performance' },
  { href: '/admin/evaluations', label: 'AI評価一覧', icon: 'ai' },
  { href: '/admin/call-logs', label: '架電結果ログ', icon: 'log' },
  { href: '/admin/projects', label: '案件管理', icon: 'project' },
  { href: '/admin/status-sheets', label: 'ステータスシート', icon: 'ai' },
  { href: '/admin/companies', label: '架電リスト管理', icon: 'list' },
  { href: '/csv-import', label: 'リストインポート', icon: 'csv' },
  { href: '/admin/scripts', label: 'スクリプト管理', icon: 'script' },
  { href: '/admin/users', label: 'ユーザー管理', icon: 'users', adminOnly: true },
  { href: '/admin/requests', label: 'メッセージ管理', icon: 'request' },
];

const getNavItems = (role) => {
  if (role === 'admin') return ADMIN_NAV;
  if (role === 'manager') return ADMIN_NAV.filter(item => !item.adminOnly);
  if (role === 'sales') {
    return [
      { href: '/sales/projects', label: '案件管理', icon: 'project' },
    ];
  }
  // operator
  return [
    { href: '/', label: 'ダッシュボード', icon: 'dashboard' },
    { href: '/call', label: '架電画面', icon: 'call' },
    { href: '/recalls', label: 'リコール管理', icon: 'recall' },
    { href: '/projects', label: '案件管理', icon: 'project' },
    { href: '/logs', label: 'AI評価', icon: 'ai' },
    { href: '/call-results', label: '架電結果', icon: 'log' },
    { href: '/csv-import', label: '架電リスト', icon: 'csv' },
    { href: '/requests', label: 'メッセージ', icon: 'request' },
  ];
};

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  if (!user) return null;

  return (
    <div className="flex h-screen bg-gray-50/80">
      {/* サイドバー */}
      <aside
        className={`${
          sidebarOpen ? 'w-60' : 'w-[68px]'
        } bg-white border-r border-gray-200/80 transition-all duration-300 ease-in-out flex flex-col shadow-sm`}
      >
        {/* ロゴエリア */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
              <svg className="w-4.5 h-4.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
              </svg>
            </div>
            {sidebarOpen && (
              <div className="whitespace-nowrap">
                <span className="font-bold text-sm text-gray-900 tracking-tight">AI CallCenter</span>
                <span className="block text-[10px] text-gray-400 font-medium -mt-0.5">CRM System</span>
              </div>
            )}
          </div>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors flex-shrink-0"
          >
            {sidebarOpen ? icons.collapse : icons.expand}
          </button>
        </div>

        {/* ナビゲーション */}
        <nav className="flex-1 py-3 px-2.5 space-y-0.5">
          {getNavItems(user.role).map((item) => {
            const isActive = item.href === '/'
              ? router.pathname === '/'
              : router.pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                }`}
                title={!sidebarOpen ? item.label : undefined}
              >
                <span className={`flex-shrink-0 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
                  {icons[item.icon]}
                </span>
                {sidebarOpen && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* ユーザー情報 */}
        <div className="border-t border-gray-100 p-3">
          <div className={`flex items-center gap-2.5 ${sidebarOpen ? '' : 'justify-center'}`}>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center flex-shrink-0 text-xs font-bold text-gray-600">
              {user.name?.charAt(0)}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{user.name}</p>
                <p className="text-[11px] text-gray-400">{user.role === 'admin' ? '管理者' : user.role === 'manager' ? 'マネージャー' : user.role === 'sales' ? '営業' : 'オペレーター'}</p>
              </div>
            )}
            {sidebarOpen && (
              <button
                onClick={logout}
                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                title="ログアウト"
              >
                {icons.logout}
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* メインコンテンツ */}
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}
