'use strict';

const EventEmitter = require('events');
const store = require('./store');

/** Palavras-chave que qualquer cliente pode digitar a qualquer momento para voltar ao início. */
const RESET_KEYWORDS = new Set(['menu', '0', 'inicio', 'início', 'voltar']);

/**
 * Depois de ficar tanto tempo sem mandar mensagem, um cliente que volta a
 * falar é tratado como "recomeçando" (não continua de onde parou) — só que,
 * como já conhecemos o nome/telefone dele, a pergunta inicial pode ser
 * pulada (ver "mensagemRetorno" no nó inicial). Ajustável se preferir outro
 * prazo — 6h cobre bem "sumiu de manhã, voltou à tarde" sem tratar uma
 * resposta demorada da mesma conversa como se fosse gente nova.
 */
const SESSION_TIMEOUT_MS = 6 * 60 * 60 * 1000;

const INPUT_VALIDATORS = {
  input_text: () => true,
  input_number: (text) => /^-?\d+([.,]\d+)?$/.test(text.trim()),
  input_email: (text) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim()),
  input_phone: (text) => /^[\d()+\-.\s]{8,20}$/.test(text.trim()),
};

const INVALID_MESSAGES = {
  input_number: '❌ Não entendi. Digite apenas números (ex: 25).',
  input_email: '❌ Esse e-mail não parece válido. Digite no formato nome@exemplo.com.',
  input_phone: '❌ Esse telefone não parece válido. Digite com DDD (ex: 11999998888).',
};

/** Substitui {{variavel}} pelo valor salvo do cliente (ou vazio, se ainda não respondida). */
function renderTemplate(text, variables = {}) {
  if (!text) return text;
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => variables[name] ?? '');
}

/**
 * Motor de estados da conversa: decide, para cada mensagem recebida,
 * qual é o próximo nó do fluxo, mantém em memória (persistindo em disco)
 * em que etapa cada cliente está, e — quando o nó atual é uma "Pergunta" —
 * valida e salva a resposta como variável do cliente (customerStore).
 */
class FlowEngine extends EventEmitter {
  constructor(customerStore) {
    super();
    this.customerStore = customerStore;
    this.flow = store.loadFlow() || {};
    this.clientStates = store.loadClientState();
  }

  reload() {
    this.flow = store.loadFlow() || {};
    this.emit('reloaded', this.flow);
  }

  setState(jid, key) {
    this.clientStates[jid] = { key, at: Date.now() };
    store.saveClientStateDebounced(this.clientStates);
  }

  /** Lê o estado salvo de um cliente, aceitando o formato antigo (só a
   *  chave do nó, sem horário) salvo por versões anteriores do app. */
  _getState(jid) {
    const raw = this.clientStates[jid];
    if (!raw) return null;
    return typeof raw === 'string' ? { key: raw, at: 0 } : raw;
  }

  _withVariables(node, jid) {
    const variables = this.customerStore?.getVariables(jid) || {};
    return { ...node, mensagem: renderTemplate(node.mensagem, variables) };
  }

  _render(key, jid) {
    const node = this.flow[key];
    if (!node) return { key, node: null, isWelcome: true };

    if (node.kind === 'handoff') {
      // Pausa o bot para este cliente e avisa quem estiver com o app aberto
      // (toast, notificação do sistema e o painel "Atendimentos").
      const handoff = this.customerStore?.requestHandoff(jid, { nodeTitle: node.title || key });
      this.emit('handoff', {
        jid,
        phone: jid.split('@')[0],
        nodeKey: key,
        nodeTitle: node.title || key,
        at: handoff?.requestedAt || Date.now(),
      });
    }

    return { key, node: this._withVariables(node, jid), isWelcome: true };
  }

  /** Atendente marcou como resolvido: bot volta a responder e o cliente reinicia no início. */
  releaseHandoff(jid) {
    this.customerStore?.resolveHandoff(jid);
    this.setState(jid, 'start');
  }

  /**
   * Cliente conhecido que sumiu por um tempo e voltou a falar: reinicia a
   * conversa do zero (não continua de onde parou) — mas, se o nó inicial é
   * uma Pergunta cuja resposta já está salva e tem uma "mensagem de
   * retorno" configurada, pula a pergunta (já sabe a resposta) e manda essa
   * mensagem no lugar, direto seguida das opções do próximo passo.
   */
  _renderReturning(jid) {
    const startNode = this.flow.start;
    const variables = this.customerStore?.getVariables(jid) || {};
    const target = startNode?.next ? this.flow[startNode.next] : null;

    const canSkipQuestion = startNode?.variable && variables[startNode.variable] && startNode.mensagemRetorno && target;

    if (!canSkipQuestion) {
      this.setState(jid, 'start');
      return this._render('start', jid);
    }

    const greeting = renderTemplate(startNode.mensagemRetorno, variables);
    const mensagem = target.opcoesTexto ? `${greeting}\n\n${target.opcoesTexto}` : greeting;

    this.setState(jid, startNode.next);

    if (target.kind === 'handoff') {
      const handoff = this.customerStore?.requestHandoff(jid, { nodeTitle: target.title || startNode.next });
      this.emit('handoff', {
        jid,
        phone: jid.split('@')[0],
        nodeKey: startNode.next,
        nodeTitle: target.title || startNode.next,
        at: handoff?.requestedAt || Date.now(),
      });
    }

    return { key: startNode.next, node: { ...target, mensagem }, isWelcome: true };
  }

  /**
   * @returns {{ key: string, node: object|null, isWelcome: boolean, unmatched?: boolean, paused?: boolean }}
   */
  resolveNextNode(jid, rawText) {
    const text = (rawText || '').trim();
    const normalized = text.toLowerCase();
    const state = this._getState(jid);
    const isNewClient = !state;
    const isPaused = !isNewClient && this.customerStore?.isHandoffPending(jid);

    if (isPaused) {
      if (RESET_KEYWORDS.has(normalized)) {
        this.customerStore?.resolveHandoff(jid);
        this.setState(jid, 'start');
        return this._render('start', jid);
      }
      // Um atendente humano está cuidando desta conversa — o bot fica em
      // silêncio (a mensagem ainda é registrada no histórico, só não gera
      // resposta automática) até ser marcada como resolvida.
      return { key: state.key, node: null, isWelcome: false, paused: true };
    }

    if (isNewClient) {
      this.setState(jid, 'start');
      return this._render('start', jid);
    }

    if (RESET_KEYWORDS.has(normalized)) {
      // Pedido explícito de voltar ao início: sempre mostra o começo de
      // verdade (pergunta incluída), mesmo que o cliente já seja conhecido.
      this.setState(jid, 'start');
      return this._render('start', jid);
    }

    // Cliente conhecido que ficou tempo demais sem mandar mensagem: prefere
    // recomeçar do início a continuar de onde parou (ver SESSION_TIMEOUT_MS).
    if (Date.now() - state.at > SESSION_TIMEOUT_MS) {
      return this._renderReturning(jid);
    }

    const currentKey = state.key;
    const currentNode = this.flow[currentKey];

    if (!currentNode) {
      // O fluxo foi alterado e o nó em que o cliente estava não existe mais.
      this.setState(jid, 'start');
      return this._render('start', jid);
    }

    // Nó de "Pergunta": a mensagem do cliente é a resposta, não uma opção de menu.
    if (currentNode.variable) {
      const validator = INPUT_VALIDATORS[currentNode.kind] || (() => true);

      if (!validator(text)) {
        this.setState(jid, currentKey); // continua no mesmo passo, mas atualiza "última vez que falou"
        const invalidMessage = INVALID_MESSAGES[currentNode.kind] || 'Não entendi, pode tentar de novo?';
        return { key: currentKey, node: { ...currentNode, mensagem: invalidMessage }, isWelcome: false, unmatched: true };
      }

      this.customerStore?.setVariable(jid, currentNode.variable, text);

      const nextKey = currentNode.next;
      if (!nextKey || !this.flow[nextKey]) {
        return { key: currentKey, node: null, isWelcome: false };
      }

      this.setState(jid, nextKey);
      return this._render(nextKey, jid);
    }

    const opcoes = currentNode.opcoes || {};
    const matchKey = Object.keys(opcoes).find((k) => k.trim().toLowerCase() === normalized);

    if (matchKey) {
      const nextKey = opcoes[matchKey];
      this.setState(jid, nextKey);
      return this._render(nextKey, jid);
    }

    // Gatilho curinga "*": segue por ali quando nenhuma opção numerada bate —
    // útil para uma mensagem inicial que já pergunta algo em vez de listar
    // opções (ex.: "como posso te chamar?" seguido de uma única conexão com
    // gatilho "*", em vez de exigir uma resposta exata como "1").
    const wildcardKey = Object.keys(opcoes).find((k) => k.trim() === '*');
    if (wildcardKey) {
      const nextKey = opcoes[wildcardKey];
      this.setState(jid, nextKey);
      return this._render(nextKey, jid);
    }

    // Nenhuma opção reconhecida: repete a mensagem atual (o cliente permanece na mesma etapa,
    // mas ainda está "presente" — atualiza a hora, pra não ser tratado como sumido depois).
    this.setState(jid, currentKey);
    return { key: currentKey, node: this._withVariables(currentNode, jid), isWelcome: false, unmatched: true };
  }
}

module.exports = FlowEngine;
