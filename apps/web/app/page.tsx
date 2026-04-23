import Link from 'next/link';

export default function Home() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 'clamp(2.5rem, 8vw, 5rem)', margin: 0 }}>A Los Traques</h1>
      <p style={{ maxWidth: '40rem', fontSize: '1.125rem', opacity: 0.85 }}>
        Un juego de pelea estilo Street Fighter protagonizado por 16 amigos de la vida real.
        Diseñado para Safari en iPhone 15 horizontal.
      </p>
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          marginTop: '1rem',
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <Link
          href="/play"
          style={{
            padding: '0.75rem 1.5rem',
            background: '#ffd166',
            color: '#0c0c18',
            textDecoration: 'none',
            borderRadius: '0.5rem',
            fontWeight: 600,
          }}
        >
          Jugar
        </Link>
        <Link href="/about" style={{ padding: '0.75rem 1.5rem' }}>
          Sobre el juego
        </Link>
        <Link href="/blog" style={{ padding: '0.75rem 1.5rem' }}>
          Blog
        </Link>
      </div>
    </main>
  );
}
