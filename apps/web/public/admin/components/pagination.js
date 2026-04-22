import htm from 'https://esm.sh/htm@3.1.1';
import { h } from 'https://esm.sh/preact@10.25.4';

const html = htm.bind(h);

export function Pagination({ page, totalPages, onPageChange }) {
  return html`
    <div class="pagination">
      <button
        disabled=${page <= 1}
        onClick=${() => onPageChange(page - 1)}
      >
        Anterior
      </button>
      <span style="font-size: 13px; color: #888">
        Página ${page} de ${totalPages}
      </span>
      <button
        disabled=${page >= totalPages}
        onClick=${() => onPageChange(page + 1)}
      >
        Siguiente
      </button>
    </div>
  `;
}
