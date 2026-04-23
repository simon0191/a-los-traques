import Link from 'next/link';
import { listPosts } from '@/lib/blog';

export const metadata = {
  title: 'Blog — A Los Traques',
};

export default async function BlogIndex() {
  const posts = await listPosts();
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
        <Link href="/">← Volver al inicio</Link>
      </p>
      <h1>Blog</h1>
      {posts.length === 0 ? (
        <p>Todavía no hay posts.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {posts.map((post) => (
            <li key={post.slug} style={{ marginBottom: '1.5rem' }}>
              <Link href={`/blog/${post.slug}`}>
                <strong>{post.frontmatter.title}</strong>
              </Link>
              <div style={{ opacity: 0.7, fontSize: '0.9rem' }}>{post.frontmatter.date}</div>
              {post.frontmatter.summary && <p>{post.frontmatter.summary}</p>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
