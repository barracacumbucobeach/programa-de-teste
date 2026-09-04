import React, { useCallback } from 'react';
import { KIND_META } from './nodes/MessageNode.jsx';

const MEDIA_KINDS = new Set(['image', 'video', 'audio']);

/** Cresce junto com o conteúdo (até um teto), para nunca passar a sensação
 *  de que existe um limite de caracteres na mensagem. */
function autoResize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 480)}px`;
}

export default function NodePanel({ node, edges, nodes, onChange, onEdgeTriggerChange, onDelete, onClose }) {
  const isStart = node.id === 'start';
  const kind = node.data.kind || 'text';
  const meta = KIND_META[kind] || KIND_META.text;
  const isInput = meta.group === 'input';
  const isMedia = MEDIA_KINDS.has(kind);
  const outgoing = edges.filter((edge) => edge.source === node.id);

  const nodeLabel = (targetId) => nodes.find((n) => n.id === targetId)?.data?.title || targetId;

  const textareaRef = useCallback((el) => autoResize(el), [node.id]);

  return (
    <aside className="node-panel">
      <div className="node-panel-head">
        <h3>{isStart ? 'Mensagem inicial' : `Editar ${meta.label.toLowerCase()}${isInput ? ' (pergunta)' : ''}`}</h3>
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

      {isMedia && (
        <label className="field">
          <span>URL da {meta.label.toLowerCase()}</span>
          <input
            type="text"
            value={node.data.mediaUrl || ''}
            onChange={(event) => onChange({ mediaUrl: event.target.value })}
            placeholder="https://exemplo.com/arquivo.jpg"
          />
          <span className="field-hint field-hint-left">
            Link direto e público para o arquivo — o motor baixa e reenvia pelo WhatsApp.
          </span>
        </label>
      )}

      {isInput && (
        <label className="field">
          <span>Salvar resposta na variável</span>
          <input
            type="text"
            value={node.data.variable || ''}
            onChange={(event) => onChange({ variable: event.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
            placeholder={meta.defaultVariable}
          />
          <span className="field-hint field-hint-left">
            O que o cliente responder aqui fica disponível em qualquer mensagem seguinte como{' '}
            <code>{`{{${node.data.variable?.trim() || meta.defaultVariable}}}`}</code>.
          </span>
        </label>
      )}

      <label className="field">
        <span>{isInput ? 'Pergunta enviada ao cliente' : kind === 'text' ? 'Mensagem enviada' : 'Legenda (opcional)'}</span>
        <textarea
          ref={textareaRef}
          rows={kind === 'text' || isInput ? 6 : 3}
          value={node.data.mensagem || ''}
          onChange={(event) => {
            onChange({ mensagem: event.target.value });
            autoResize(event.target);
          }}
          placeholder={
            isInput
              ? 'Ex: Qual é o seu nome?'
              : kind === 'text'
                ? 'Digite a mensagem que o bot enviará… (sem limite de tamanho)'
                : 'Texto que acompanha o arquivo…'
          }
        />
        <span className="field-hint field-hint-left">
          {(node.data.mensagem || '').length} caracteres · use <code>{'{{variavel}}'}</code> para inserir uma resposta
          salva anteriormente
        </span>
      </label>

      {isInput ? (
        <div className="field">
          <span>Depois de responder, segue para</span>
          <p className="input-next-hint">
            {outgoing[0] ? `→ ${nodeLabel(outgoing[0].target)}` : 'Conecte este nó a outro pela borda inferior.'}
          </p>
        </div>
      ) : (
        outgoing.length > 0 && (
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
        )
      )}

      {!isStart && (
        <button type="button" className="btn btn-danger btn-block" onClick={onDelete}>
          🗑 Excluir este nó
        </button>
      )}
    </aside>
  );
}
