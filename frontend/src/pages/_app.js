/**
 * Next.js カスタムApp
 * グローバルスタイルとToasterを適用
 */
import '../styles/globals.css';
import { Toaster } from 'react-hot-toast';

export default function App({ Component, pageProps }) {
  return (
    <>
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
