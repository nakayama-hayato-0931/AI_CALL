/**
 * Next.js カスタムApp
 * グローバルスタイルとToasterを適用
 */
import '../styles/globals.css';
import Head from 'next/head';
import { Toaster } from 'react-hot-toast';

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>Hitokiwa AI CallCenter</title>
      </Head>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: { fontSize: '14px' },
        }}
      />
      <Component {...pageProps} />
    </>
  );
}
