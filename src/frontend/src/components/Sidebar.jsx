import React from 'react';
import { KIND_META } from './nodes/MessageNode.jsx';

const STATUS_LABEL = {
  connected: 'Conectado',
  qr: 'Aguardando leitura',
  connecting: 'Conectando…',
  disconnected: 'Desconectado',
};

const BUBBLE_PALETTE = [
  { kind: 'text', ...KIND_META.text },
  { kind: 'image', ...KIND_META.image },
  { kind: 'video', ...KIND_META.video },
  { kind: 'audio', ...KIND_META.audio },
];

const INPUT_PALETTE = [
  { kind: 'input_text', ...KIND_META.input_text },
  { kind: 'input_number', ...KIND_META.input_number },
  { kind: 'input_email', ...KIND_META.input_email },
  { kind: 'input_phone', ...KIND_META.input_phone },
];

export const DRAG_MIME = 'application/autoflow-node';

function PaletteGrid({ items, onAddNode }) {
  return (
    <div className="palette-grid">
      {items.map((item) => (
        <button
          key={item.kind}
          type="button"
          className={`palette-item palette-${item.kind}`}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(DRAG_MIME, item.kind);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onClick={() => onAddNode(item.kind)}
          title={`Arraste para o quadro ou clique para adicionar: ${item.label}`}
        >
          <span className="palette-icon">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

export default function Sidebar({ nodes, edges, status, onAddNode, onOpenQr, onOpenConversations, onOpenCustomers }) {
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

      <div className="sidebar-section">
        <h3>Balões</h3>
        <p className="palette-hint">Arraste para o quadro (ou clique) para criar um nó, depois conecte pelas bordas.</p>
        <PaletteGrid items={BUBBLE_PALETTE} onAddNode={onAddNode} />
      </div>

      <div className="sidebar-section">
        <h3>Perguntas</h3>
        <p className="palette-hint">Coletam uma resposta do cliente e salvam numa variável para usar depois.</p>
        <PaletteGrid items={INPUT_PALETTE} onAddNode={onAddNode} />
      </div>

      <div className="sidebar-quick-actions">
        <button type="button" className="btn btn-block btn-ghost" onClick={onOpenConversations}>
          💬 Conversas
        </button>
        <button type="button" className="btn btn-block btn-ghost" onClick={onOpenCustomers}>
          🗂️ Clientes
        </button>
      </div>

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
          Conecte os nós arrastando das bordas (os pontos verdes maiores). O texto de cada conexão
          é o que o cliente precisa digitar no WhatsApp para seguir por aquele caminho.
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
