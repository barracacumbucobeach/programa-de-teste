import React, { useLayoutEffect, useRef } from 'react';
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

/** Um balão dentro da pilha do grupo — igual ao balão único de antes, só que
 *  agora é uma entre várias linhas empilhadas no mesmo cartão. */
function StepRow({ step, isFirstOfStart, isLastStep, isSelected, onSelect, data }) {
  const kind = step.kind || 'text';
  const meta = KIND_META[kind] || KIND_META.text;
  const isInput = meta.group === 'input';
  const isHandoff = meta.group === 'handoff';
  // Balões (texto/imagem/vídeo/áudio) podem ter botões nomeados, cada um com
  // seu próprio conector — como no Typebot, isso vale pra QUALQUER balão da
  // pilha, não só o último. Perguntas e o nó de atendente continuam com um
  // único caminho de saída (fazem sentido sem múltiplas opções).
  const supportsOptions = !isInput && !isHandoff;
  const options = supportsOptions && Array.isArray(step.options) ? step.options : [];
  const hasMedia = Boolean(step.mediaUrl?.trim());

  // O quadro (React Flow) re-renderiza o nó a cada letra digitada — como o
  // balão fica dentro de um canvas com zoom/posição próprios, o navegador
  // às vezes "perde" o cursor nesse meio-tempo e joga ele pro fim do texto.
  // Guarda a posição logo depois de cada tecla e restaura assim que o React
  // termina de atualizar a tela, então o cursor nunca sai de onde a pessoa
  // estava digitando.
  const textareaElRef = useRef(null);
  const caretRef = useRef(null);

  useLayoutEffect(() => {
    const el = textareaElRef.current;
    if (el && caretRef.current && document.activeElement === el) {
      el.setSelectionRange(caretRef.current.start, caretRef.current.end);
    }
  }, [step.mensagem]);

  const handleMensagemChange = (event) => {
    const el = event.target;
    caretRef.current = { start: el.selectionStart, end: el.selectionEnd };
    data.onStepMensagemChange?.(step.id, el.value);
    autoResize(el);
  };

  return (
    <div
      className={`flow-step kind-${kind} ${isSelected ? 'is-selected' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <div className="flow-step-head">
        <span className={`flow-node-badge ${isFirstOfStart ? 'badge-start' : `badge-${kind}`}`}>
          {isFirstOfStart ? '🚀 Início' : `${meta.icon} ${isInput ? `Pergunta: ${meta.label}` : meta.label}`}
        </span>
        {!isFirstOfStart && (
          <button
            type="button"
            className="flow-node-delete"
            title="Excluir este balão"
            onClick={(event) => {
              event.stopPropagation();
              data.onDeleteStep?.(step.id);
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
              <img src={step.mediaUrl} alt="" className="flow-node-media-preview" />
            ) : (
              <span className="flow-node-media-icon">{meta.icon}</span>
            )
          ) : (
            <span>Sem mídia definida</span>
          )}
        </div>
      )}

      <textarea
        ref={(el) => {
          textareaElRef.current = el;
          autoResize(el);
        }}
        className="flow-node-inline-textarea nodrag nowheel"
        rows={2}
        value={step.mensagem || ''}
        onChange={handleMensagemChange}
        placeholder={
          isHandoff
            ? 'Mensagem enviada ao transferir (opcional)…'
            : kind === 'text' || isInput
              ? 'Digite a mensagem aqui…'
              : 'Legenda (opcional)…'
        }
      />

      {isInput && <div className="flow-node-variable">💾 salva em: {step.variable?.trim() || meta.defaultVariable}</div>}
      {isHandoff && <div className="flow-node-handoff-hint">🙋 Pausa o bot e avisa a loja</div>}

      {supportsOptions && options.length > 0 && (
        <div className="flow-node-options">
          {options.map((option, index) => (
            <div key={option.id} className="flow-node-option-row">
              <span className="flow-node-option-index">{index + 1}</span>
              <input
                className="flow-node-option-input nodrag"
                value={option.label}
                onChange={(event) => data.onUpdateStepOption?.(step.id, option.id, event.target.value)}
                placeholder="Nome do botão"
              />
              <button
                type="button"
                className="flow-node-option-remove nodrag"
                title="Remover botão"
                onClick={(event) => {
                  event.stopPropagation();
                  data.onRemoveStepOption?.(step.id, option.id);
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
            data.onAddStepOption?.(step.id);
          }}
        >
          + Adicionar botão
        </button>
      )}
    </div>
  );
}

/**
 * Um "grupo" (estilo Typebot): vários balões empilhados dentro do mesmo
 * cartão. A entrada é sempre pelo primeiro balão da pilha; a saída natural
 * (sem botão) só existe no ÚLTIMO balão — os de cima seguem sozinhos pro
 * próximo da mesma pilha assim que o motor processa a resposta. Um botão
 * nomeado em QUALQUER balão da pilha também pode ligar pra outro grupo.
 */
export default function MessageNode({ id, data }) {
  const isStart = id === 'start';
  const steps = Array.isArray(data.steps) ? data.steps : [];
  const lastStep = steps[steps.length - 1];
  // Só o último balão da pilha tem opções — se tiver, ele já ganha seus
  // próprios conectores por botão, e o conector genérico de baixo não faz
  // mais sentido (evita ligação solta disputando gatilho com um botão).
  const lastStepHasOptions = Boolean(lastStep) && Array.isArray(lastStep.options) && lastStep.options.length > 0;

  return (
    <div className={`flow-node flow-group ${data.selected ? 'is-selected' : ''} ${isStart ? 'is-start' : ''}`}>
      {!isStart && <Handle type="target" position={Position.Top} className="flow-handle" />}

      <div
        className="flow-group-head"
        onClick={(event) => {
          event.stopPropagation();
          data.onSelectStep?.(steps[0]?.id);
        }}
      >
        <input
          className="flow-group-title-input nodrag"
          value={data.title || ''}
          onChange={(event) => data.onChangeGroupTitle?.(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          placeholder={isStart ? 'Início' : 'Nome do grupo (opcional)'}
        />
        {!isStart && (
          <button
            type="button"
            className="flow-node-delete"
            title="Excluir grupo inteiro"
            onClick={(event) => {
              event.stopPropagation();
              data.onDeleteGroup?.();
            }}
          >
            ✕
          </button>
        )}
      </div>

      <div className="flow-group-steps">
        {steps.map((step, index) => (
          <StepRow
            key={step.id}
            step={step}
            isFirstOfStart={isStart && index === 0}
            isLastStep={index === steps.length - 1}
            isSelected={data.selectedStepId === step.id}
            onSelect={() => data.onSelectStep?.(step.id)}
            data={data}
          />
        ))}
      </div>

      <button
        type="button"
        className="flow-node-add flow-group-add-step"
        onClick={(event) => {
          event.stopPropagation();
          data.onAddStep?.('text');
        }}
      >
        + Adicionar balão
      </button>

      {/* O conector genérico embaixo do grupo só existe quando o ÚLTIMO
          balão da pilha não tem botões nomeados — com botões, cada um já
          tem seu próprio conector, e manter os dois ao mesmo tempo deixava
          fácil ligar sem querer pelo de baixo, criando uma ligação "solta"
          que podia disputar (e até vencer) o gatilho de um botão. */}
      {!lastStepHasOptions && <Handle type="source" position={Position.Bottom} className="flow-handle" />}
    </div>
  );
}
