import React from 'react';
import { Handle, Position } from '@xyflow/react';

export default function MessageNode({ id, data }) {
  const isStart = id === 'start';
  const hasMessage = Boolean(data.mensagem?.trim());
  const preview = hasMessage ? data.mensagem : 'Clique para escrever a mensagem…';

  return (
    <div className={`flow-node ${data.selected ? 'is-selected' : ''} ${isStart ? 'is-start' : ''}`}>
      {!isStart && <Handle type="target" position={Position.Top} className="flow-handle" />}

      <div className="flow-node-head">
        <span className={`flow-node-badge ${isStart ? 'badge-start' : 'badge-message'}`}>
          {isStart ? '🚀 Início' : '💬 ' + (data.title || 'Resposta')}
        </span>
        {!isStart && (
          <button
            type="button"
            className="flow-node-delete"
            title="Excluir nó"
            onClick={(event) => {
              event.stopPropagation();
              data.onDelete?.();
            }}
          >
            ✕
          </button>
        )}
      </div>

      <p className={`flow-node-body ${hasMessage ? '' : 'is-empty'}`}>{preview}</p>

      <button
        type="button"
        className="flow-node-add"
        onClick={(event) => {
          event.stopPropagation();
          data.onAddOption?.();
        }}
      >
        + Nova opção
      </button>

      <Handle type="source" position={Position.Bottom} className="flow-handle" />
    </div>
  );
}
