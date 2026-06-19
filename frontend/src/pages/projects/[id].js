/**
 * 案件詳細ページ (URL 直リンク用ラッパー)
 * 中身は components/projects/ProjectDetailContent に切り出し。
 * 一覧画面 (pages/projects/index.js) でも同じコンポーネントをモーダル内で表示する。
 */
import { useRouter } from 'next/router';
import Layout from '../../components/common/Layout';
import ProjectDetailContent from '../../components/projects/ProjectDetailContent';

export default function ProjectDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  if (!id) return <Layout><div /></Layout>;
  return (
    <Layout>
      <ProjectDetailContent id={id} />
    </Layout>
  );
}
