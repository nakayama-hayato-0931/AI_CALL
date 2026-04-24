/**
 * 共通レイアウト
 * ダークサイドバー + セクション分け + コンテンツエリア
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useAuth from '../../hooks/useAuth';

/* SVGアイコンコンポーネント */
const icons = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="4" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="11" width="7" height="10" rx="1" />
    </svg>
  ),
  call: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  ),
  recall: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  project: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  ),
  log: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  ai: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
    </svg>
  ),
  csv: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  ),
  performance: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  request: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  ),
  list: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  script: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /><line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="13" x2="13" y2="13" />
    </svg>
  ),
  status: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 14l2 2 4-4" />
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

// ナビゲーション定義（セクション分け）
const getNavSections = (role, adminView) => {
  if (role === 'admin' || role === 'manager' || role === 'consultant') {
    // 管理者: オペレーター管理/営業管理で切替
    const isSalesView = adminView === 'sales';
    const sections = [
      {
        label: 'メイン',
        items: [
          { href: '/', label: 'ダッシュボード', icon: 'dashboard' },
        ],
      },
      {
        label: '分析',
        items: [
          ...(!isSalesView ? [{ href: '/admin/analytics', label: 'CPA/案件質分析', icon: 'performance' }] : []),
          ...(!isSalesView ? [{ href: '/admin/incentive', label: 'インセンティブ管理', icon: 'performance' }] : []),
          ...(isSalesView ? [{ href: '/admin/sales-performance', label: '営業売上一覧', icon: 'performance' }] : []),
          { href: '/admin/evaluations', label: 'AI評価一覧', icon: 'ai' },
          { href: '/admin/call-logs', label: '架電結果ログ', icon: 'log' },
          ...(!isSalesView ? [{ href: '/admin/status-sheets', label: 'ステータスシート', icon: 'status' }] : []),
        ],
      },
      {
        label: '管理',
        items: [
          { href: '/admin/projects', label: '案件管理', icon: 'project' },
          { href: '/admin/companies', label: '架電リスト管理', icon: 'list' },
          { href: '/csv-import', label: 'リストインポート', icon: 'csv' },
          { href: '/admin/special-list-progress', label: '特別リスト進捗', icon: 'status' },
          ...(!isSalesView ? [{ href: '/admin/scripts', label: 'スクリプト管理', icon: 'script' }] : []),
          ...(role === 'admin' ? [{ href: '/admin/users', label: 'ユーザー管理', icon: 'users' }] : []),
          ...(!isSalesView ? [{ href: '/admin/requests', label: 'メッセージ管理', icon: 'request' }] : []),
        ],
      },
    ];
    return sections;
  }
  if (role === 'sales') {
    return [
      {
        label: '業務',
        items: [
          { href: '/', label: 'ダッシュボード', icon: 'dashboard' },
          { href: '/call', label: '架電画面', icon: 'call' },
        ],
      },
      {
        label: '記録',
        items: [
          { href: '/logs', label: 'AI評価', icon: 'ai' },
          { href: '/call-results', label: '架電結果', icon: 'log' },
          { href: '/sales/projects', label: '案件管理', icon: 'project' },
          { href: '/admin/sales-performance', label: '営業売上一覧', icon: 'performance' },
          { href: '/csv-import', label: 'リストインポート', icon: 'csv' },
        ],
      },
    ];
  }
  // operator / intern（同じメニュー）
  return [
    {
      label: '業務',
      items: [
        { href: '/', label: 'ダッシュボード', icon: 'dashboard' },
        { href: '/call', label: '架電画面', icon: 'call' },
        { href: '/recalls', label: 'リコール管理', icon: 'recall' },
        { href: '/projects', label: '案件管理', icon: 'project' },
      ],
    },
    {
      label: '記録',
      items: [
        { href: '/logs', label: 'AI評価', icon: 'ai' },
        { href: '/call-results', label: '架電結果', icon: 'log' },
        { href: '/csv-import', label: '架電リスト', icon: 'csv' },
        { href: '/status-sheet', label: 'ステータスシート', icon: 'status' },
        { href: '/requests', label: 'メッセージ', icon: 'request' },
      ],
    },
  ];
};

const ROLE_LABELS = {
  admin: '管理者',
  manager: 'マネージャー',
  sales: '営業',
  operator: 'オペレーター',
};

const ROLE_COLORS = {
  admin: 'from-red-400 to-red-600',
  manager: 'from-purple-400 to-purple-600',
  sales: 'from-green-400 to-green-600',
  operator: 'from-blue-400 to-blue-600',
};

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const isAdminRole = ['admin', 'manager', 'consultant'].includes(user?.role);
  const [adminView, setAdminView] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('adminView') || 'operator';
    return 'operator';
  });
  const handleAdminViewChange = (view) => {
    setAdminView(view);
    if (typeof window !== 'undefined') localStorage.setItem('adminView', view);
  };

  if (!user) return null;

  const sections = getNavSections(user.role, adminView);

  return (
    <div className="flex h-screen bg-gray-50/80 overflow-hidden">
      {/* サイドバー（ダークテーマ） */}
      <aside
        className={`${
          sidebarOpen ? 'w-[232px]' : 'w-[68px]'
        } bg-gradient-to-b from-blue-600 via-blue-700 to-indigo-800 transition-all duration-300 ease-in-out flex flex-col`}
      >
        {/* ロゴエリア */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-white/[0.12]">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <img src="/logo-icon.png" alt="Hitokiwa" className="w-8 h-8 rounded-lg flex-shrink-0" />
            {sidebarOpen && (
              <div className="whitespace-nowrap">
                <span className="font-semibold text-sm text-white tracking-tight">Hitokiwa</span>
                <span className="block text-[10px] text-white/50 font-medium -mt-0.5">AI CallCenter</span>
              </div>
            )}
          </div>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 text-white/40 hover:text-white/80 hover:bg-white/10 rounded-md transition-colors flex-shrink-0"
          >
            {sidebarOpen ? icons.collapse : icons.expand}
          </button>
        </div>

        {/* 管理者: オペレーター/営業切替 */}
        {isAdminRole && sidebarOpen && (
          <div className="px-3 py-2 border-b border-white/[0.12]">
            <div className="flex bg-white/10 rounded-lg p-0.5">
              <button onClick={() => handleAdminViewChange('operator')}
                className={`flex-1 text-[10px] font-medium py-1.5 rounded-md transition-all ${
                  adminView === 'operator' ? 'bg-white/20 text-white shadow-sm' : 'text-white/50 hover:text-white/70'
                }`}>オペレーター</button>
              <button onClick={() => handleAdminViewChange('sales')}
                className={`flex-1 text-[10px] font-medium py-1.5 rounded-md transition-all ${
                  adminView === 'sales' ? 'bg-emerald-500/40 text-white shadow-sm' : 'text-white/50 hover:text-white/70'
                }`}>営業</button>
            </div>
          </div>
        )}

        {/* ナビゲーション（セクション分け） */}
        <nav className="flex-1 py-3 px-2.5 space-y-4 overflow-y-auto">
          {sections.map((section, si) => (
            <div key={si}>
              {sidebarOpen && section.label && (
                <div className="px-3 mb-1.5 text-[10px] font-semibold text-white/40 uppercase tracking-wider">
                  {section.label}
                </div>
              )}
              {!sidebarOpen && si > 0 && (
                <div className="mx-3 mb-2 border-t border-white/[0.12]" />
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = item.href === '/'
                    ? router.pathname === '/'
                    : router.pathname === item.href || router.pathname.startsWith(item.href + '/');
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-white/20 text-white border-l-[3px] border-white -ml-[1px]'
                          : 'text-white/60 hover:text-white/90 hover:bg-white/10'
                      }`}
                      title={!sidebarOpen ? item.label : undefined}
                    >
                      <span className={`flex-shrink-0 ${isActive ? 'text-white' : 'text-white/50'}`}>
                        {icons[item.icon]}
                      </span>
                      {sidebarOpen && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* ユーザー情報 */}
        <div className="border-t border-white/[0.12] p-3">
          <div className={`flex items-center gap-2.5 ${sidebarOpen ? '' : 'justify-center'}`}>
            <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${ROLE_COLORS[user.role] || 'from-gray-400 to-gray-600'} flex items-center justify-center flex-shrink-0 text-xs font-bold text-white`}>
              {user.name?.charAt(0)}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{user.name}</p>
                <p className="text-[10px] text-white/50">{ROLE_LABELS[user.role] || user.role}</p>
              </div>
            )}
            {sidebarOpen && (
              <button
                onClick={logout}
                className="p-1.5 text-white/40 hover:text-red-300 hover:bg-white/10 rounded-md transition-colors"
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
        {!!user.is_test_account && (
          <div className="bg-amber-400 text-amber-900 text-center py-1.5 text-xs font-bold tracking-wide">
            TEST MODE - データは記録されません
          </div>
        )}
        <div className="p-6 max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}
