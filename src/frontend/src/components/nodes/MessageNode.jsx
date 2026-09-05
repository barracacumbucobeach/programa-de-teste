import React, { useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';

/** Cresce junto com o conteúdo, sem nenhum teto — sem sensação de limite de tamanho. */
function autoResize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export const KIND_META = {
  text: { label: 'Texto', icon: '💬', group: 'bubble' },
  image: { label: 'Imagem', icon: '🖼️', group: 'bubble' },
  video: { label: 'Vídeo', icon: '🎬', group: 'bubble' },
  audio: { label: 'Áudio', icon: '🎙️', group: 'bubble' },
  input_text: { label: 'Texto', icon: '📝', group: 'input', defaultVariable: 'resposta' },
  input_number: { label: 'Número', icon: '🔢', group: 'input', defaultVariable: 'numero' },
  input_email: { label: 'E-mail', icon: '✉️', group: 'input', defaultVariable: 'email' },
  input_phone: { label: 'Telefone', icon: '📞', group: 'input', defaultVariable: 'telefone' },
  handoff: { label: 'Atendente', icon: '🙋', group: 'handoff' },
};

const MEDIA_KINDS = new Set(['image', 'video', 'audio']);

export default function MessageNode({ id, data }) {
  const isStart = id === 'start';
  const kind = data.kind || 'text';
  const meta = KIND_META[kind] || KIND_META.text;
  const isInput = meta.group === 'input';
  const isHandoff = meta.group === 'handoff';
  // Balões (texto/imagem/vídeo/áudio) podem ter botões nomeados, cada um com
  // seu próprio conector — como no Typebot. Perguntas e o nó de atendente
  // continuam com um único caminho de saída (fazem sentido sem múltiplas opções).
  const supportsOptions = !isInput && !isHandoff;
  const options = supportsOptions && Array.isArray(data.options) ? data.options : [];
  const hasMedia = Boolean(data.mediaUrl?.trim());
  const textareaRef = useCallback((el) => autoResize(el), [data.mensagem]);

  return (
    <div className={`flow-node kind-${kind} ${data.selected ? 'is-selected' : ''} ${isStart ? 'is-start' : ''}`}>
      {!isStart && <Handle type="target" position={Position.Top} className="flow-handle" />}

      <div className="flow-node-head">
        <span className={`flow-node-badge ${isStart ? 'badge-start' : `badge-${kind}`}`}>
          {isStart ? '🚀 Início' : `${meta.icon} ${data.title || meta.label}`}
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

      {MEDIA_KINDS.has(kind) && (
        <div className={`flow-node-media ${hasMedia ? '' : 'is-empty'}`}>
          {hasMedia ? (
            kind === 'image' ? (
              <img src={data.mediaUrl} alt="" className="flow-node-media-preview" />
            ) : (
              <span className="flow-node-media-icon">{meta.icon}</span>
            )
          ) : (
            <span>Sem mídia definida</span>
          )}
        </div>
      )}

      <textarea
        ref={textareaRef}
        className="flow-node-inline-textarea nodrag nowheel"
        rows={2}
        value={data.mensagem || ''}
        onChange={(event) => {
          data.onMensagemChange?.(event.target.value);
          autoResize(event.target);
        }}
        placeholder={
          isHandoff
            ? 'Mensagem enviada ao transferir (opcional)…'
            : kind === 'text' || isInput
              ? 'Digite a mensagem aqui…'
              : 'Legenda (opcional)…'
        }
      />

      {isInput && <div className="flow-node-variable">💾 salva em: {data.variable?.trim() || meta.defaultVariable}</div>}
      {isHandoff && <div className="flow-node-handoff-hint">🙋 Pausa o bot e avisa a loja</div>}

      {supportsOptions && options.length > 0 && (
        <div className="flow-node-options">
          {options.map((option, index) => (
            <div key={option.id} className="flow-node-option-row">
              <span className="flow-node-option-index">{index + 1}</span>
              <input
                className="flow-node-option-input nodrag"
                value={option.label}
                onChange={(event) => data.onUpdateNodeOption?.(option.id, event.target.value)}
                onClick={(event) => event.stopPropagation()}
                placeholder="Nome do botão"
              />
              <button
                type="button"
                className="flow-node-option-remove nodrag"
                title="Remover botão"
                onClick={(event) => {
                  event.stopPropagation();
                  data.onRemoveNodeOption?.(option.id);
                }}
              >
                ✕
              </button>
              <Handle type="source" position={Position.Right} id={option.id} className="flow-handle flow-handle-option" />
            </div>
          ))}
        </div>
      )}

      {supportsOptions && (
        <button
          type="button"
          className="flow-node-add"
          onClick={(event) => {
            event.stopPropagation();
            data.onAddNodeOption?.();
          }}
        >
          + Adicionar botão
        </button>
      )}

      {/* O conector genérico embaixo só existe quando o balão NÃO tem botões
          nomeados — com botões, cada um já tem seu próprio conector à direita,
          e manter os dois ao mesmo tempo deixava fácil ligar sem querer pelo
          de baixo, criando uma ligação "solta" que podia disputar (e até
          vencer) o gatilho de um botão numerado na hora de compilar o fluxo. */}
      {options.length === 0 && <Handle type="source" position={Position.Bottom} className="flow-handle" />}
    </div>
  );
}
