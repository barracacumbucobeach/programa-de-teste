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

/** Teto de segurança para uma cadeia de balões automáticos numa única
 *  resposta — evita travar (ou virar spam) se o fluxo tiver um ciclo de
 *  balões "soltos" se ligando entre si sem nunca parar numa Pergunta,
 *  num balão com botões ou num atendente. */
const MAX_CHAIN_LENGTH = 25;

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
 * qual é o próximo nó (ou sequência de nós) do fluxo, mantém em memória
 * (persistindo em disco) em que etapa cada cliente está, e — quando o nó
 * atual é uma "Pergunta" — valida e salva a resposta como variável do
 * cliente (customerStore).
 *
 * Um balão comum (texto/imagem/vídeo/áudio) sem botões nomeados não pede
 * nada ao cliente — por isso, ao ser alcançado, o motor já encadeia
 * automaticamente para o próximo balão (e o próximo, e o próximo...) na
 * mesma resposta, como no Typebot. A cadeia só para numa Pergunta (precisa
 * da resposta do cliente para continuar), num balão com botões nomeados
 * (precisa que o cliente escolha), num atendente (pausa pra um humano), ou
 * num balão sem nenhuma ligação de saída (fim de papo).
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

  /** Dispara o pedido de atendimento humano (pausa o bot pra este cliente e
   *  avisa quem estiver com o app aberto: toast, notificação do sistema e
   *  o painel "Atendimentos"). */
  _triggerHandoff(node, key, jid) {
    const handoff = this.customerStore?.requestHandoff(jid, { nodeTitle: node.title || key });
    this.emit('handoff', {
      jid,
      phone: jid.split('@')[0],
      nodeKey: key,
      nodeTitle: node.title || key,
      at: handoff?.requestedAt || Date.now(),
    });
  }

  /**
   * Monta a sequência de balões a enviar a partir de `startKey`, encadeando
   * balões automáticos (sem Pergunta nem botões) até parar num que precisa
   * da participação do cliente (ou até acabar a ligação). `firstOverride`,
   * se passado, substitui só o texto do PRIMEIRO balão da cadeia (usado
   * pela mensagem de retorno de quem já é conhecido) — o resto da cadeia
   * segue com o texto normal de cada nó.
   *
   * @returns {Array<{ key: string, node: object }>}
   */
  _buildChain(startKey, jid, { firstOverride } = {}) {
    const chain = [];
    const visited = new Set();
    let key = startKey;
    let pendingOverride = firstOverride;

    while (key && this.flow[key] && !visited.has(key) && chain.length < MAX_CHAIN_LENGTH) {
      visited.add(key);
      const node = this.flow[key];

      const rendered =
        pendingOverride != null ? { ...node, mensagem: pendingOverride } : this._withVariables(node, jid);
      pendingOverride = null;

      if (node.kind === 'handoff') this._triggerHandoff(node, key, jid);

      chain.push({ key, node: rendered });

      // Pergunta (precisa da resposta), balão com botões nomeados (precisa
      // da escolha) ou atendente (pausa pra humano): a cadeia para aqui.
      const requiresCustomer = Boolean(node.variable) || Boolean(node.opcoesTexto) || node.kind === 'handoff';
      if (requiresCustomer) break;

      // Balão comum: só continua sozinho se tiver exatamente UM caminho
      // natural configurado (sem botões, sem gatilho — só o "*" implícito
      // de uma ligação simples). Sem isso, é um fim de papo mesmo.
      const opcoes = node.opcoes || {};
      const keys = Object.keys(opcoes);
      if (keys.length === 1 && keys[0] === '*') {
        key = opcoes['*'];
      } else {
        break;
      }
    }

    return chain;
  }

  /** Monta a cadeia a partir de `key` e já atualiza o estado do cliente
   *  para o ÚLTIMO nó dela (onde o bot fica esperando, se for o caso). */
  _advance(key, jid, opts) {
    const chain = this._buildChain(key, jid, opts);
    const lastKey = chain.length > 0 ? chain[chain.length - 1].key : key;
    this.setState(jid, lastKey);
    return { key: lastKey, nodes: chain.map((c) => c.node), isWelcome: true };
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
   * mensagem no lugar, encadeando dali em diante normalmente.
   */
  _renderReturning(jid) {
    const startNode = this.flow.start;
    const variables = this.customerStore?.getVariables(jid) || {};
    const target = startNode?.next ? this.flow[startNode.next] : null;

    const canSkipQuestion = startNode?.variable && variables[startNode.variable] && startNode.mensagemRetorno && target;

    if (!canSkipQuestion) return this._advance('start', jid);

    const greeting = renderTemplate(startNode.mensagemRetorno, variables);
    const firstOverride = target.opcoesTexto ? `${greeting}\n\n${target.opcoesTexto}` : greeting;

    return this._advance(startNode.next, jid, { firstOverride });
  }

  /**
   * @returns {{ key: string, nodes: object[], isWelcome: boolean, unmatched?: boolean, paused?: boolean }}
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
        return this._advance('start', jid);
      }
      // Um atendente humano está cuidando desta conversa — o bot fica em
      // silêncio (a mensagem ainda é registrada no histórico, só não gera
      // resposta automática) até ser marcada como resolvida.
      return { key: state.key, nodes: [], isWelcome: false, paused: true };
    }

    if (isNewClient) return this._advance('start', jid);

    // Cliente conhecido que ficou tempo demais sem mandar mensagem: prefere
    // recomeçar do início a continuar de onde parou (ver SESSION_TIMEOUT_MS).
    if (Date.now() - state.at > SESSION_TIMEOUT_MS) {
      return this._renderReturning(jid);
    }

    const currentKey = state.key;
    const currentNode = this.flow[currentKey];

    if (!currentNode) {
      // O fluxo foi alterado e o nó em que o cliente estava não existe mais.
      return this._advance('start', jid);
    }

    // Nó de "Pergunta": a mensagem do cliente é a resposta, não uma opção de
    // menu — aqui não tem botão nem ligação pra "vencer", então digitar uma
    // palavra de reset (menu/voltar/...) continua funcionando como saída de
    // emergência pra quem quiser desistir da pergunta.
    if (currentNode.variable) {
      if (RESET_KEYWORDS.has(normalized)) return this._advance('start', jid);

      const validator = INPUT_VALIDATORS[currentNode.kind] || (() => true);

      if (!validator(text)) {
        this.setState(jid, currentKey); // continua no mesmo passo, mas atualiza "última vez que falou"
        const invalidMessage = INVALID_MESSAGES[currentNode.kind] || 'Não entendi, pode tentar de novo?';
        return { key: currentKey, nodes: [{ ...currentNode, mensagem: invalidMessage }], isWelcome: false, unmatched: true };
      }

      this.customerStore?.setVariable(jid, currentNode.variable, text);

      const nextKey = currentNode.next;
      if (!nextKey || !this.flow[nextKey]) {
        return { key: currentKey, nodes: [], isWelcome: false };
      }

      return this._advance(nextKey, jid);
    }

    // Balão com botões e/ou ligação natural: o que o PRÓPRIO fluxo desenhou
    // sempre vence primeiro — inclusive um botão chamado "Voltar" (ou
    // "Menu") apontando pra onde o usuário escolheu, mesmo que o texto do
    // botão seja igual a uma das palavras de reset abaixo.
    const opcoes = currentNode.opcoes || {};
    const matchKey = Object.keys(opcoes).find((k) => k.trim().toLowerCase() === normalized);

    if (matchKey) return this._advance(opcoes[matchKey], jid);

    // Gatilho curinga "*": segue por ali quando nenhuma opção numerada bate —
    // só existe aqui quando o balão tem botões nomeados E também uma
    // ligação simples de "qualquer outra resposta" ao mesmo tempo.
    const wildcardKey = Object.keys(opcoes).find((k) => k.trim() === '*');
    if (wildcardKey) return this._advance(opcoes[wildcardKey], jid);

    // Só agora, com a mensagem não batendo com nada que o próprio fluxo
    // desenhou, a palavra de reset serve de último recurso pra quem estiver
    // perdido longe de qualquer botão assim configurado.
    if (RESET_KEYWORDS.has(normalized)) return this._advance('start', jid);

    // Nenhuma opção reconhecida: repete a mensagem atual (o cliente permanece na mesma etapa,
    // mas ainda está "presente" — atualiza a hora, pra não ser tratado como sumido depois).
    this.setState(jid, currentKey);
    return { key: currentKey, nodes: [this._withVariables(currentNode, jid)], isWelcome: false, unmatched: true };
  }
}

module.exports = FlowEngine;
