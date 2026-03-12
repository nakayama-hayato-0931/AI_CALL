/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Railway本番用: standaloneビルド
  output: 'standalone',
  // バックエンドAPIプロキシ
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
