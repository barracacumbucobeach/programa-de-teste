import React from 'react';

export default function NodePanel({ node, edges, nodes, onChange, onEdgeTriggerChange, onDelete, onClose }) {
  const isStart = node.id === 'start';
  const outgoing = edges.filter((edge) => edge.source === node.id);

  const nodeLabel = (targetId) => nodes.find((n) => n.id === targetId)?.data?.title || targetId;

  return (
    <aside className="node-panel">
      <div className="node-panel-head">
        <h3>{isStart ? 'Mensagem inicial' : 'Editar resposta'}</h3>
        <button type="button" className="icon-btn" onClick={onClose} title="Fechar">
          ✕
        </button>
      </div>

      {!isStart && (
        <label className="field">
          <span>Título do nó</span>
          <input
            type="text"
            value={node.data.title || ''}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder="Ex: Enviar catálogo"
          />
        </label>
      )}

      <label className="field">
        <span>Mensagem enviada</span>
        <textarea
          rows={8}
          value={node.data.mensagem || ''}
          onChange={(event) => onChange({ mensagem: event.target.value })}
          placeholder="Digite a mensagem que o bot enviará…"
        />
        <span className="field-hint">{(node.data.mensagem || '').length} caracteres</span>
      </label>

      {outgoing.length > 0 && (
        <div className="field">
          <span>Opções de resposta</span>
          <ul className="option-list">
            {outgoing.map((edge) => (
              <li key={edge.id}>
                <input
                  className="option-trigger"
                  value={edge.data?.trigger ?? ''}
                  onChange={(event) => onEdgeTriggerChange(edge.id, event.target.value)}
                />
                <span className="option-arrow">→</span>
                <span className="option-target">{nodeLabel(edge.target)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isStart && (
        <button type="button" className="btn btn-danger btn-block" onClick={onDelete}>
          🗑 Excluir este nó
        </button>
      )}
    </aside>
  );
}
