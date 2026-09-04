import React from 'react';

const STATUS_LABEL = {
  connected: 'Conectado',
  qr: 'Aguardando leitura',
  connecting: 'Conectando…',
  disconnected: 'Desconectado',
};

export default function Sidebar({ nodes, edges, status, onAddNode, onOpenQr }) {
  const startExists = nodes.some((node) => node.id === 'start');
  const orphanCount = nodes.filter(
    (node) => node.id !== 'start' && !edges.some((edge) => edge.target === node.id)
  ).length;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">⚡</div>
        <div className="brand-text">
          <h1>AutoFlow</h1>
          <span>Desktop</span>
        </div>
      </div>

      <button type="button" className="btn btn-block btn-ghost" onClick={onAddNode}>
        ＋ Novo nó de resposta
      </button>

      <div className="sidebar-section">
        <h3>Diagnóstico do fluxo</h3>
        <ul className="checklist">
          <li className={startExists ? 'ok' : 'fail'}>
            <span className="check-icon">{startExists ? '✓' : '!'}</span> Nó inicial definido
          </li>
          <li className={orphanCount === 0 ? 'ok' : 'warn'}>
            <span className="check-icon">{orphanCount === 0 ? '✓' : '!'}</span>
            {orphanCount === 0 ? 'Sem nós órfãos' : `${orphanCount} nó(s) sem conexão`}
          </li>
        </ul>
        <div className="sidebar-stats">
          <div className="stat-box">
            <strong>{nodes.length}</strong>
            <span>nós</span>
          </div>
          <div className="stat-box">
            <strong>{edges.length}</strong>
            <span>conexões</span>
          </div>
        </div>
      </div>

      <div className="sidebar-section sidebar-hint">
        <h3>Como funciona</h3>
        <p>
          Conecte os nós arrastando das bordas. O texto de cada conexão é o que o cliente precisa
          digitar no WhatsApp para seguir por aquele caminho.
        </p>
      </div>

      <div className="sidebar-spacer" />

      <button
        type="button"
        className={`connection-pill status-${status.status}`}
        onClick={onOpenQr}
      >
        <span className="dot" />
        {STATUS_LABEL[status.status] || 'Desconectado'}
      </button>
    </aside>
  );
}
