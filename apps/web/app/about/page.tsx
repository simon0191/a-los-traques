import Link from 'next/link';

export const metadata = {
  title: 'Sobre A Los Traques',
};

export default function AboutPage() {
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
      <h1>Sobre el juego</h1>
      <p>
        <strong>A Los Traques</strong> es un juego de pelea estilo Street Fighter con 16 peleadores
        basados en amigos reales. El juego está diseñado para Safari en iPhone 15 en orientación
        horizontal, con controles táctiles y soporte para mandos Bluetooth.
      </p>
      <h2>Arquitectura</h2>
      <ul>
        <li>Motor: Phaser 3 con simulación pura determinista (resolución interna 480×270).</li>
        <li>
          Multijugador: WebRTC (rollback netcode estilo GGPO) con fallback a WebSocket mediante
          PartyKit + TURN de Cloudflare.
        </li>
        <li>
          Torneos locales de 1–8 jugadores humanos con llaves, más modo VS Local con dos jugadores
          en el mismo teclado.
        </li>
      </ul>
      <h2>Código</h2>
      <p>
        El código vive en un monorepo de <code>bun workspaces</code>: las apps (web, admin, party)
        son los componentes ejecutables y los paquetes (<code>@alostraques/sim</code>,{' '}
        <code>@alostraques/db</code>, <code>@alostraques/api-core</code>) son las piezas reusables.
      </p>
    </main>
  );
}
