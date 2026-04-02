import { h } from 'https://esm.sh/preact@10.25.4';
import { useEffect, useState } from 'https://esm.sh/preact@10.25.4/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { Pagination } from '../components/pagination.js';

const html = htm.bind(h);

function formatDate(dateStr) {
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

function BundleLinks({ fight, apiFetch }) {
  if (!fight.has_debug_bundle || !fight.bundles?.length) {
    return html`<span class="badge badge-none">-</span>`;
  }

  return html`
    <div>
      ${fight.bundles.map(
        (b) => html`
          <a
            class="bundle-link"
            href="/api/admin/debug-bundle?fightId=${fight.id}&slot=${b.slot}&round=${b.round}"
            target="_blank"
            title="P${b.slot + 1} R${b.round === 0 ? 'Final' : b.round}"
          >
            P${b.slot + 1}${b.round === 0 ? ' Final' : ` R${b.round}`}
          </a>${' '}
        `,
      )}
    </div>
  `;
}

export function FightsPage({ apiFetch }) {
  const [fights, setFights] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [hasDebug, setHasDebug] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadFights();
  }, [page, hasDebug]);

  async function loadFights() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (hasDebug) params.set('hasDebug', 'true');

      const data = await apiFetch(`/admin/fights?${params}`);
      setFights(data.fights);
      setTotal(data.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const totalPages = Math.ceil(total / limit);

  if (loading && fights.length === 0) {
    return html`<div class="loading">Cargando peleas...</div>`;
  }

  return html`
    <div>
      <div class="filters">
        <label>
          <input
            type="checkbox"
            checked=${hasDebug}
            onChange=${(e) => {
              setHasDebug(e.target.checked);
              setPage(1);
            }}
          />
          ${' '}Solo con debug bundle
        </label>
        <span style="color: #888; font-size: 12px">${total} peleas</span>
      </div>

      ${error && html`<div class="error">${error}</div>`}

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
          ${fights.map(
            (fight) => html`
              <tr>
                <td>${formatDate(fight.started_at)}</td>
                <td>
                  ${fight.p1_nickname || 'Anónimo'}
                  <span style="color: #888; font-size: 11px"> (${fight.p1_fighter})</span>
                </td>
                <td>
                  ${fight.p2_nickname || 'Anónimo'}
                  <span style="color: #888; font-size: 11px"> (${fight.p2_fighter})</span>
                </td>
                <td>${fight.stage_id}</td>
                <td>
                  ${fight.winner_slot != null
                    ? fight.winner_slot === 0
                      ? fight.p1_nickname || 'P1'
                      : fight.p2_nickname || 'P2'
                    : '-'}
                </td>
                <td>${fight.rounds_p1} - ${fight.rounds_p2}</td>
                <td>
                  <${BundleLinks} fight=${fight} apiFetch=${apiFetch} />
                </td>
              </tr>
            `,
          )}
          ${fights.length === 0 &&
          html`
            <tr>
              <td colspan="7" style="text-align: center; color: #888; padding: 40px">
                No se encontraron peleas
              </td>
            </tr>
          `}
        </tbody>
      </table>

      ${totalPages > 1 &&
      html`<${Pagination}
        page=${page}
        totalPages=${totalPages}
        onPageChange=${setPage}
      />`}
    </div>
  `;
}
