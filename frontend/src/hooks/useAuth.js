/**
 * 認証フック
 * ログイン・ログアウト・認証状態管理
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import api from '../utils/api';

export default function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // 初期化: localStorageからユーザー情報復元
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (storedUser && token) {
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);
  }, []);

  // ログイン
  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/api/auth/login', { email, password });
    if (data.success) {
      localStorage.setItem('token', data.data.token);
      localStorage.setItem('user', JSON.stringify(data.data.user));
      setUser(data.data.user);
      // ロール別リダイレクト
      const role = data.data.user.role;
      if (role === 'sales') {
        router.push('/sales/projects');
      } else {
        router.push('/');
      }
    }
    return data;
  }, [router]);

  // ログアウト
  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    router.push('/login');
  }, [router]);

  // 認証必須ガード
  useEffect(() => {
    if (!loading && !user && router.pathname !== '/login') {
      router.push('/login');
    }
  }, [user, loading, router]);

  return { user, loading, login, logout };
}
