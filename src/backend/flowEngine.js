'use strict';

const EventEmitter = require('events');
const store = require('./store');

/** Palavras-chave que qualquer cliente pode digitar a qualquer momento para voltar ao início. */
const RESET_KEYWORDS = new Set(['menu', '0', 'inicio', 'início', 'voltar']);

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
    this.clientStates[jid] = key;
    store.saveClientStateDebounced(this.clientStates);
  }

  _withVariables(node, jid) {
    const variables = this.customerStore?.getVariables(jid) || {};
    return { ...node, mensagem: renderTemplate(node.mensagem, variables) };
  }

  _render(key, jid) {
    const node = this.flow[key];
    if (!node) return { key, node: null, isWelcome: true };
    return { key, node: this._withVariables(node, jid), isWelcome: true };
  }

  /**
   * @returns {{ key: string, node: object|null, isWelcome: boolean, unmatched?: boolean }}
   */
  resolveNextNode(jid, rawText) {
    const text = (rawText || '').trim();
    const normalized = text.toLowerCase();
    const isNewClient = !(jid in this.clientStates);

    if (isNewClient || RESET_KEYWORDS.has(normalized)) {
      this.setState(jid, 'start');
      return this._render('start', jid);
    }

    const currentKey = this.clientStates[jid];
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

    // Nenhuma opção reconhecida: repete a mensagem atual (o cliente permanece na mesma etapa).
    return { key: currentKey, node: this._withVariables(currentNode, jid), isWelcome: false, unmatched: true };
  }
}

module.exports = FlowEngine;
