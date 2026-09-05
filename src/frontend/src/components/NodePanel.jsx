import React, { useCallback } from 'react';
import { KIND_META } from './nodes/MessageNode.jsx';

const MEDIA_KINDS = new Set(['image', 'video', 'audio']);

const KIND_GROUPS = [
  { label: 'Balões', kinds: ['text', 'image', 'video', 'audio'] },
  { label: 'Perguntas', kinds: ['input_text', 'input_number', 'input_email', 'input_phone'] },
  { label: 'Atendimento humano', kinds: ['handoff'] },
];

/** Cresce junto com o conteúdo, sem nenhum teto — sem sensação de limite de tamanho
 *  (o painel inteiro rola se precisar). */
function autoResize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export default function NodePanel({ node, edges, nodes, onChange, onSetOptionTarget, onDelete, onClose }) {
  const isStart = node.id === 'start';
  const kind = node.data.kind || 'text';
  const meta = KIND_META[kind] || KIND_META.text;
  const isInput = meta.group === 'input';
  const isHandoff = meta.group === 'handoff';
  const isMedia = MEDIA_KINDS.has(kind);
  const outgoing = edges.filter((edge) => edge.source === node.id);
  const options = !isInput && !isHandoff && Array.isArray(node.data.options) ? node.data.options : [];
  // Conexões que já saem de um botão nomeado do balão aparecem e se editam
  // ali mesmo (no quadro) — aqui só ficam as "soltas" (sem botão), que usam
  // gatilho de texto livre (incluindo o curinga "*").
  const freeOutgoing = outgoing.filter((edge) => !edge.sourceHandle);

  const nodeLabel = (targetId) => nodes.find((n) => n.id === targetId)?.data?.title || targetId;

  const textareaRef = useCallback((el) => autoResize(el), [node.id]);

  const handleKindChange = (newKind) => {
    const newMeta = KIND_META[newKind];
    const patch = { kind: newKind };
    if (newMeta?.group === 'input' && !node.data.variable) {
      patch.variable = newMeta.defaultVariable;
    }
    if (newMeta?.group !== 'bubble') {
      // Perguntas e o nó de atendente não usam botões — descarta os que
      // porventura existiam, senão eles reapareceriam do nada se o tipo
      // fosse trocado de volta para um balão mais tarde.
      patch.options = [];
    }
    onChange(patch);
  };

  return (
    <aside className="node-panel">
      <div className="node-panel-head">
        <h3>
          {isStart
            ? 'Mensagem inicial'
            : `Editar ${meta.label.toLowerCase()}${isInput ? ' (pergunta)' : isHandoff ? ' (transferência)' : ''}`}
        </h3>
        <button type="button" className="icon-btn" onClick={onClose} title="Fechar">
          ✕
        </button>
      </div>

      <label className="field">
        <span>Tipo do nó</span>
        <select value={kind} onChange={(event) => handleKindChange(event.target.value)}>
          {KIND_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.kinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_META[k].icon} {KIND_META[k].label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {isStart && (
          <span className="field-hint field-hint-left">
            Pode trocar até o nó inicial — ex.: virar uma Pergunta para já capturar o nome na
            primeira mensagem, como no Typebot.
          </span>
        )}
      </label>

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
            Link direto e público para o arquivo — o motor baixa e reenvia pelo WhatsApp. Um link
            terminado em <code>.gif</code> é enviado como GIF animado de verdade (com loop),
            não como imagem parada.
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

      {isStart && isInput && (
        <label className="field">
          <span>Mensagem para quem já falou antes (opcional)</span>
          <textarea
            rows={3}
            value={node.data.mensagemRetorno || ''}
            onChange={(event) => onChange({ mensagemRetorno: event.target.value })}
            placeholder={`Ex: Oi de novo, {{${node.data.variable?.trim() || meta.defaultVariable}}}! Que bom te ver por aqui outra vez.`}
          />
          <span className="field-hint field-hint-left">
            Se o cliente já respondeu essa pergunta antes e sumir por um tempo (6h) antes de
            mandar mensagem de novo, o bot pula a pergunta — já sabe a resposta — e manda esse
            texto no lugar, seguido das opções do próximo passo. Deixe em branco para sempre
            perguntar de novo.
          </span>
        </label>
      )}

      <label className="field">
        <span>
          {isInput ? 'Pergunta enviada ao cliente' : isHandoff ? 'Mensagem antes de transferir (opcional)' : kind === 'text' ? 'Mensagem enviada' : 'Legenda (opcional)'}
        </span>
        <textarea
          ref={textareaRef}
          rows={kind === 'text' || isInput || isHandoff ? 6 : 3}
          value={node.data.mensagem || ''}
          onChange={(event) => {
            onChange({ mensagem: event.target.value });
            autoResize(event.target);
          }}
          placeholder={
            isInput
              ? 'Ex: Qual é o seu nome?'
              : isHandoff
                ? 'Ex: Já vou te encaminhar para um atendente, aguarde só um instante…'
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

      {!isInput && !isHandoff && (
        <p className="node-panel-note">
          💡 Use "+ Adicionar botão" no próprio balão para criar opções numeradas — cada uma vira uma
          linha na mensagem e ganha seu próprio conector.
        </p>
      )}

      {options.length > 0 && (
        <div className="field">
          <span>Botões deste balão</span>
          <ul className="option-list">
            {options.map((option, index) => {
              const edge = outgoing.find((e) => e.sourceHandle === option.id);
              return (
                <li key={option.id}>
                  <span className="option-trigger option-trigger-readonly">{index + 1}</span>
                  <span className="option-target-label" title={option.label}>
                    {option.label || 'Opção'}
                  </span>
                  <span className="option-arrow">→</span>
                  <select
                    className="option-target-select"
                    value={edge?.target || ''}
                    onChange={(event) => onSetOptionTarget(option.id, event.target.value)}
                  >
                    <option value="">Selecione o destino…</option>
                    {nodes
                      .filter((n) => n.id !== node.id)
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.data?.title || n.id}
                        </option>
                      ))}
                  </select>
                </li>
              );
            })}
          </ul>
          <span className="field-hint field-hint-left">
            Também dá pra ligar arrastando o conector verde do botão até outro balão no quadro — os
            dois jeitos fazem a mesma coisa.
          </span>
        </div>
      )}

      {isHandoff ? (
        <div className="field">
          <span>O que acontece aqui</span>
          <p className="input-next-hint">
            🙋 O bot pausa as respostas automáticas para este cliente e avisa você (toast, notificação do sistema e no
            painel <strong>"Atendimentos"</strong>) — até você marcar como atendido, ou o cliente digitar{' '}
            <code>menu</code> para voltar sozinho.
          </p>
        </div>
      ) : isInput ? (
        <div className="field">
          <span>Depois de responder, segue para</span>
          <p className="input-next-hint">
            {outgoing[0] ? `→ ${nodeLabel(outgoing[0].target)}` : 'Conecte este nó a outro pela borda inferior.'}
          </p>
        </div>
      ) : (
        freeOutgoing.length > 0 && (
          <div className="field">
            <span>Depois desta mensagem, segue para</span>
            <ul className="option-list">
              {freeOutgoing.map((edge) => (
                <li key={edge.id}>
                  <span className="option-target">→ {nodeLabel(edge.target)}</span>
                </li>
              ))}
            </ul>
            <span className="field-hint field-hint-left">
              Segue automaticamente, sem o cliente precisar digitar nada. Pra dar opções de
              escolha, use "+ Adicionar botão" no próprio balão em vez de ligar por aqui.
            </span>
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
