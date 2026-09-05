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

/** Edita UM balão específico dentro de um grupo (pilha de balões, estilo
 *  Typebot) — `node` é o grupo inteiro (dono do título e das ligações
 *  externas), `step` é o balão selecionado dentro dele. */
export default function NodePanel({ node, step, isLastStep, edges, nodes, onChangeGroupTitle, onChangeStep, onSetOptionTarget, onDeleteStep, onDeleteGroup, onClose }) {
  const isStartEntry = node.id === 'start' && node.data.steps[0]?.id === step.id;
  const kind = step.kind || 'text';
  const meta = KIND_META[kind] || KIND_META.text;
  const isInput = meta.group === 'input';
  const isHandoff = meta.group === 'handoff';
  const isMedia = MEDIA_KINDS.has(kind);
  const outgoing = edges.filter((edge) => edge.source === node.id);
  const options = !isInput && !isHandoff && Array.isArray(step.options) ? step.options : [];
  // Conexões que já saem de um botão nomeado deste balão aparecem e se
  // editam ali mesmo (no quadro) — aqui só ficam as "soltas" (sem botão),
  // que representam a saída natural do GRUPO inteiro (só existem de
  // verdade quando este é o último balão da pilha).
  const freeOutgoing = outgoing.filter((edge) => !edge.sourceHandle);

  const nodeLabel = (targetId) => nodes.find((n) => n.id === targetId)?.data?.title || targetId;

  const textareaRef = useCallback((el) => autoResize(el), [step.id]);

  const handleKindChange = (newKind) => {
    const newMeta = KIND_META[newKind];
    const patch = { kind: newKind };
    if (newMeta?.group === 'input' && !step.variable) {
      patch.variable = newMeta.defaultVariable;
    }
    if (newMeta?.group !== 'bubble') {
      // Perguntas e o nó de atendente não usam botões — descarta os que
      // porventura existiam, senão eles reapareceriam do nada se o tipo
      // fosse trocado de volta para um balão mais tarde.
      patch.options = [];
    }
    onChangeStep(patch);
  };

  return (
    <aside className="node-panel">
      <div className="node-panel-head">
        <h3>
          {isStartEntry
            ? 'Mensagem inicial'
            : `Editar ${meta.label.toLowerCase()}${isInput ? ' (pergunta)' : isHandoff ? ' (transferência)' : ''}`}
        </h3>
        <button type="button" className="icon-btn" onClick={onClose} title="Fechar">
          ✕
        </button>
      </div>

      <label className="field">
        <span>Nome do grupo</span>
        <input
          type="text"
          value={node.data.title || ''}
          onChange={(event) => onChangeGroupTitle(event.target.value)}
          placeholder={node.id === 'start' ? 'Início' : 'Ex: Produtos e serviços'}
        />
        <span className="field-hint field-hint-left">
          É o nome deste cartão inteiro (a pilha de balões) — só pra você se organizar, não aparece
          pro cliente.
        </span>
      </label>

      <label className="field">
        <span>Tipo deste balão</span>
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
        {isStartEntry && (
          <span className="field-hint field-hint-left">
            Pode trocar até o primeiro balão do Início — ex.: virar uma Pergunta para já capturar o
            nome na primeira mensagem, como no Typebot.
          </span>
        )}
      </label>

      {isMedia && (
        <label className="field">
          <span>URL da {meta.label.toLowerCase()}</span>
          <input
            type="text"
            value={step.mediaUrl || ''}
            onChange={(event) => onChangeStep({ mediaUrl: event.target.value })}
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
            value={step.variable || ''}
            onChange={(event) => onChangeStep({ variable: event.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
            placeholder={meta.defaultVariable}
          />
          <span className="field-hint field-hint-left">
            O que o cliente responder aqui fica disponível em qualquer mensagem seguinte como{' '}
            <code>{`{{${step.variable?.trim() || meta.defaultVariable}}}`}</code>.
          </span>
        </label>
      )}

      {isStartEntry && isInput && (
        <label className="field">
          <span>Mensagem para quem já falou antes (opcional)</span>
          <textarea
            rows={3}
            value={step.mensagemRetorno || ''}
            onChange={(event) => onChangeStep({ mensagemRetorno: event.target.value })}
            placeholder={`Ex: Oi de novo, {{${step.variable?.trim() || meta.defaultVariable}}}! Que bom te ver por aqui outra vez.`}
          />
          <span className="field-hint field-hint-left">
            Se o cliente já respondeu essa pergunta antes e sumir por um tempo (6h) antes de
            mandar mensagem de novo, o bot pula a pergunta — já sabe a resposta — e manda esse
            texto no lugar, seguido do resto da pilha a partir daqui. Deixe em branco para sempre
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
          value={step.mensagem || ''}
          onChange={(event) => {
            onChangeStep({ mensagem: event.target.value });
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
          {(step.mensagem || '').length} caracteres · use <code>{'{{variavel}}'}</code> para inserir uma resposta
          salva anteriormente
        </span>
      </label>

      {!isInput && !isHandoff && (
        <p className="node-panel-note">
          💡 Use "+ Adicionar botão" no próprio balão para criar opções numeradas — cada uma vira uma
          linha na mensagem e ganha seu próprio conector, podendo ligar pra qualquer grupo do fluxo.
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
            Também dá pra ligar arrastando o conector verde do botão até outro grupo no quadro — os
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
      ) : !isLastStep ? (
        <div className="field">
          <span>Depois deste balão, segue para</span>
          <p className="input-next-hint">
            {options.length > 0
              ? 'O cliente escolhe um dos botões acima — não há continuação automática por baixo deles.'
              : '→ o próximo balão desta mesma pilha, automaticamente, sem o cliente precisar digitar nada.'}
          </p>
        </div>
      ) : isInput ? (
        <div className="field">
          <span>Depois de responder, segue para</span>
          <p className="input-next-hint">
            {outgoing.find((e) => !e.sourceHandle)
              ? `→ ${nodeLabel(outgoing.find((e) => !e.sourceHandle).target)}`
              : 'Conecte este grupo a outro pela borda inferior.'}
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

      <div className="node-panel-actions">
        {!isStartEntry && (
          <button type="button" className="btn btn-danger btn-block" onClick={onDeleteStep}>
            🗑 Excluir este balão
          </button>
        )}
        {node.id !== 'start' && (
          <button type="button" className="btn btn-outline-danger btn-block" onClick={onDeleteGroup}>
            🗑 Excluir grupo inteiro
          </button>
        )}
      </div>
    </aside>
  );
}
