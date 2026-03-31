/**
 * API通信ユーティリティ
 * axiosインスタンスにJWTトークンを自動付与
 */
import axios from 'axios';

const api = axios.create({
  baseURL: '',  // Next.js rewriteでバックエンドにプロキシ
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// リクエストインターセプター: JWTトークン付与
api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// レスポンスインターセプター: 401時にログアウト
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// AI系API用: バックエンドに直接リクエスト（Next.js rewriteプロキシのタイムアウト回避）
export const directApi = axios.create({
  baseURL: process.env.NEXT_PUBLIC_BACKEND_URL || '',
  timeout: 180000, // 3分
  headers: { 'Content-Type': 'application/json' },
});

directApi.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

directApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
