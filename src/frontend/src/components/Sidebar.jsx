import React from 'react';
import { KIND_META } from './nodes/MessageNode.jsx';

const STATUS_LABEL = {
  connected: 'Conectado',
  qr: 'Aguardando leitura',
  connecting: 'Conectando…',
  disconnected: 'Reconectando…',
  idle: 'Desconectado',
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

const HANDOFF_PALETTE = [{ kind: 'handoff', ...KIND_META.handoff }];

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

export default function Sidebar({
  nodes,
  edges,
  status,
  onAddNode,
  onOpenQr,
  onOpenConversations,
  onOpenCustomers,
  onOpenHandoffs,
  pendingHandoffCount = 0,
}) {
  const startExists = nodes.some((node) => node.id === 'start');
  const orphanCount = nodes.filter(
    (node) => node.id !== 'start' && !edges.some((edge) => edge.target === node.id)
  ).length;

  // Nós de "Pergunta" só devem ter UMA conexão de saída (é o que decide para
  // onde o fluxo segue depois da resposta) — zero conexões deixa o bot
  // "mudo" depois da pergunta, e mais de uma é ambíguo (o motor sempre usa
  // a primeira criada, o que parece um bug de "loop" para quem editou).
  const questionNodes = nodes.filter((node) => node.data?.kind?.startsWith('input_'));
  const unwiredQuestions = questionNodes.filter(
    (node) => edges.filter((edge) => edge.source === node.id).length !== 1
  ).length;

  // Nó sem mensagem (nem mídia, quando é o caso) = o bot fica em silêncio
  // nesse ponto do fluxo — muito fácil de passar despercebido, já que o
  // WhatsApp simplesmente não recebe nada e parece que "travou".
  const emptyContentNodes = nodes.filter((node) => {
    const kind = node.data?.kind || 'text';
    const hasMessage = Boolean(node.data?.mensagem?.trim());
    const hasMedia = Boolean(node.data?.mediaUrl?.trim());
    if (kind === 'handoff') return false; // mensagem é opcional nesse tipo
    if (kind === 'image' || kind === 'video' || kind === 'audio') return !hasMessage && !hasMedia;
    return !hasMessage;
  }).length;

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

      <div className="sidebar-section">
        <h3>Atendimento humano</h3>
        <p className="palette-hint">Transfere a conversa: pausa o bot e avisa você (veja em "Atendimentos" abaixo).</p>
        <PaletteGrid items={HANDOFF_PALETTE} onAddNode={onAddNode} />
      </div>

      <div className="sidebar-quick-actions">
        <button type="button" className="btn btn-block btn-ghost btn-with-badge" onClick={onOpenHandoffs}>
          🙋 Atendimentos
          {pendingHandoffCount > 0 && <span className="badge-count">{pendingHandoffCount}</span>}
        </button>
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
          {questionNodes.length > 0 && (
            <li className={unwiredQuestions === 0 ? 'ok' : 'warn'}>
              <span className="check-icon">{unwiredQuestions === 0 ? '✓' : '!'}</span>
              {unwiredQuestions === 0
                ? 'Perguntas conectadas corretamente'
                : `${unwiredQuestions} pergunta(s) sem exatamente 1 conexão de saída`}
            </li>
          )}
          <li className={emptyContentNodes === 0 ? 'ok' : 'warn'}>
            <span className="check-icon">{emptyContentNodes === 0 ? '✓' : '!'}</span>
            {emptyContentNodes === 0
              ? 'Todos os nós têm mensagem'
              : `${emptyContentNodes} nó(s) sem mensagem (bot fica em silêncio ali)`}
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
