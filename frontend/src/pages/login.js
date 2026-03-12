/**
 * ログインページ
 * 洗練されたモダンデザイン
 */
import { useState } from 'react';
import useAuth from '../hooks/useAuth';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('メールアドレスとパスワードを入力してください');
      return;
    }

    setLoading(true);
    try {
      await login(email, password);
      toast.success('ログインしました');
    } catch (err) {
      const msg = err.response?.data?.message || 'ログインに失敗しました';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50/80">
      {/* 左パネル - ブランドエリア */}
      <div className="hidden lg:flex lg:w-[480px] bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full translate-y-1/3 -translate-x-1/3" />

        <div className="relative z-10">
          <div className="w-12 h-12 bg-white/10 backdrop-blur-sm rounded-xl flex items-center justify-center mb-8">
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-3 tracking-tight">AI CallCenter</h1>
          <p className="text-blue-100/80 text-sm leading-relaxed">
            法人営業の架電効率を最大化する<br />AIコールセンター管理システム
          </p>
        </div>

        <div className="relative z-10 space-y-4">
          {[
            { label: 'AI通話評価', desc: 'AIが通話品質を自動採点' },
            { label: 'スマート架電', desc: 'ゴールデンタイム自動判定' },
            { label: '案件一元管理', desc: '架電から採用まで一括管理' },
          ].map((item) => (
            <div key={item.label} className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-white">{item.label}</p>
                <p className="text-xs text-blue-200/60">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 右パネル - ログインフォーム */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-[380px]">
          <div className="lg:hidden mb-8 text-center">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20">
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900">AI CallCenter</h1>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">ログイン</h2>
            <p className="text-sm text-gray-500 mt-1">アカウント情報を入力してください</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="input-label">メールアドレス</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="admin@example.com"
                autoComplete="email"
              />
            </div>
            <div>
              <label className="input-label">パスワード</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="パスワードを入力"
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full !py-3"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  ログイン中...
                </span>
              ) : 'ログイン'}
            </button>
          </form>

          <p className="text-xs text-gray-400 text-center mt-8">AI CallCenter CRM v1.0</p>
        </div>
      </div>
    </div>
  );
}
