import fs from 'node:fs/promises';
import path from 'node:path';

const BLOG_DIR = path.join(process.cwd(), 'content', 'blog');

export type BlogFrontmatter = {
  title: string;
  date: string;
  summary?: string;
};

export type BlogPost = {
  slug: string;
  frontmatter: BlogFrontmatter;
  content: string;
};

// Lightweight frontmatter parser — avoids pulling in a dependency for the first
// couple of posts. Supports string values and YAML-style `key: "value"` lines.
function parseFrontmatter(raw: string): { data: BlogFrontmatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return {
      data: { title: 'Sin título', date: '1970-01-01' },
      body: raw,
    };
  }
  const [, front, body] = match;
  const data: Record<string, string> = {};
  for (const line of front.split(/\r?\n/)) {
    const m = line.match(/^\s*([a-zA-Z0-9_]+)\s*:\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[m[1]] = value;
  }
  return {
    data: {
      title: data.title || 'Sin título',
      date: data.date || '1970-01-01',
      summary: data.summary,
    },
    body,
  };
}

async function readIfExists(): Promise<string[]> {
  try {
    const entries = await fs.readdir(BLOG_DIR);
    return entries.filter((f) => f.endsWith('.md') || f.endsWith('.mdx'));
  } catch {
    return [];
  }
}

export async function listPosts(): Promise<BlogPost[]> {
  const files = await readIfExists();
  const posts = await Promise.all(
    files.map(async (file) => {
      const slug = file.replace(/\.(md|mdx)$/, '');
      const raw = await fs.readFile(path.join(BLOG_DIR, file), 'utf-8');
      const { data, body } = parseFrontmatter(raw);
      return { slug, frontmatter: data, content: body };
    }),
  );
  posts.sort((a, b) => b.frontmatter.date.localeCompare(a.frontmatter.date));
  return posts;
}

export async function getPost(slug: string): Promise<BlogPost | null> {
  const safe = slug.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return null;
  for (const ext of ['md', 'mdx']) {
    try {
      const raw = await fs.readFile(path.join(BLOG_DIR, `${safe}.${ext}`), 'utf-8');
      const { data, body } = parseFrontmatter(raw);
      return { slug: safe, frontmatter: data, content: body };
    } catch {
      // try next extension
    }
  }
  return null;
}
