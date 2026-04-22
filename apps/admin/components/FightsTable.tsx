'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/fetchAdmin';
import { Pagination } from './Pagination';

type Bundle = { slot: number; round: number; key: string };

type Fight = {
  id: string;
  started_at: string | null;
  p1_nickname: string | null;
  p2_nickname: string | null;
  p1_fighter: string;
  p2_fighter: string;
  stage_id: string;
  winner_slot: number | null;
  rounds_p1: number;
  rounds_p2: number;
  has_debug_bundle: boolean;
  bundles?: Bundle[];
};

type FightsResponse = {
  fights: Fight[];
  total: number;
  page: number;
  limit: number;
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-CL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function BundleLinks({ fight }: { fight: Fight }) {
  if (!fight.has_debug_bundle || !fight.bundles?.length) {
    return <span className="badge badge-none">-</span>;
  }
  return (
    <div>
      {fight.bundles.map((b) => (
        <span key={`${b.slot}-${b.round}`}>
          <a
            className="bundle-link"
            href={`/api/admin/debug-bundle?fightId=${fight.id}&slot=${b.slot}&round=${b.round}`}
            target="_blank"
            rel="noreferrer"
            title={`P${b.slot} R${b.round === 0 ? 'Final' : b.round}`}
          >
            P{b.slot}
            {b.round === 0 ? ' Final' : ` R${b.round}`}
          </a>{' '}
        </span>
      ))}
    </div>
  );
}

export function FightsTable() {
  const [fights, setFights] = useState<Fight[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasDebug, setHasDebug] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const limit = 20;

  const loadFights = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (hasDebug) params.set('hasDebug', 'true');
      const data = await adminFetch<FightsResponse>(`/admin/fights?${params}`);
      setFights(data.fights);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [page, hasDebug]);

  useEffect(() => {
    loadFights();
  }, [loadFights]);

  const totalPages = Math.ceil(total / limit);

  if (loading && fights.length === 0) {
    return <div className="loading">Cargando peleas…</div>;
  }

  return (
    <div>
      <div className="filters">
        <label>
          <input
            type="checkbox"
            checked={hasDebug}
            onChange={(e) => {
              setHasDebug(e.target.checked);
              setPage(1);
            }}
          />{' '}
          Solo con debug bundle
        </label>
        <span style={{ color: '#888', fontSize: 12 }}>{total} peleas</span>
      </div>

      {error && <div className="error">{error}</div>}

      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>P1</th>
            <th>P2</th>
            <th>Escenario</th>
            <th>Ganador</th>
            <th>Rounds</th>
            <th>Debug</th>
          </tr>
        </thead>
        <tbody>
          {fights.map((fight) => (
            <tr key={fight.id}>
              <td>{formatDate(fight.started_at)}</td>
              <td>
                {fight.p1_nickname || 'Anónimo'}{' '}
                <span style={{ color: '#888', fontSize: 11 }}>({fight.p1_fighter})</span>
              </td>
              <td>
                {fight.p2_nickname || 'Anónimo'}{' '}
                <span style={{ color: '#888', fontSize: 11 }}>({fight.p2_fighter})</span>
              </td>
              <td>{fight.stage_id}</td>
              <td>
                {fight.winner_slot !== null && fight.winner_slot !== undefined
                  ? fight.winner_slot === 0
                    ? fight.p1_nickname || 'P1'
                    : fight.p2_nickname || 'P2'
                  : '-'}
              </td>
              <td>
                {fight.rounds_p1} - {fight.rounds_p2}
              </td>
              <td>
                <BundleLinks fight={fight} />
              </td>
            </tr>
          ))}
          {fights.length === 0 && (
            <tr>
              <td colSpan={7} style={{ textAlign: 'center', color: '#888', padding: 40 }}>
                No se encontraron peleas
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />}
    </div>
  );
}
