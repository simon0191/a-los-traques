import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPost, listPosts } from '@/lib/blog';

export async function generateStaticParams() {
  const posts = await listPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  return {
    title: post ? `${post.frontmatter.title} — Blog` : 'Blog',
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  // Minimal "rendering": Markdown as preformatted text keeps Phase 2's blog
  // intentionally tiny. Replace with a proper MDX pipeline when there's more
  // than a handful of posts.
  return (
    <main
      style={{
        maxWidth: '40rem',
        margin: '0 auto',
        padding: '3rem 1.5rem',
        lineHeight: 1.65,
      }}
    >
      <p>
        <Link href="/blog">← Blog</Link>
      </p>
      <h1>{post.frontmatter.title}</h1>
      <div style={{ opacity: 0.7, fontSize: '0.9rem', marginBottom: '1.5rem' }}>
        {post.frontmatter.date}
      </div>
      <article style={{ whiteSpace: 'pre-wrap' }}>{post.content}</article>
    </main>
  );
}
