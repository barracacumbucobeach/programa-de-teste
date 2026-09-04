'use strict';

const EventEmitter = require('events');
const store = require('./store');

/** Palavras-chave que qualquer cliente pode digitar a qualquer momento para voltar ao início. */
const RESET_KEYWORDS = new Set(['menu', '0', 'inicio', 'início', 'voltar']);

/**
 * Motor de estados da conversa: decide, para cada mensagem recebida,
 * qual é o próximo nó do fluxo e mantém em memória (persistindo em disco)
 * em que etapa cada cliente está.
 */
class FlowEngine extends EventEmitter {
  constructor() {
    super();
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

  /**
   * @returns {{ key: string, node: object|null, isWelcome: boolean, unmatched?: boolean }}
   */
  resolveNextNode(jid, rawText) {
    const text = (rawText || '').trim();
    const normalized = text.toLowerCase();
    const isNewClient = !(jid in this.clientStates);

    if (isNewClient || RESET_KEYWORDS.has(normalized)) {
      this.setState(jid, 'start');
      return { key: 'start', node: this.flow.start || null, isWelcome: true };
    }

    const currentKey = this.clientStates[jid];
    const currentNode = this.flow[currentKey];

    if (!currentNode) {
      // O fluxo foi alterado e o nó em que o cliente estava não existe mais.
      this.setState(jid, 'start');
      return { key: 'start', node: this.flow.start || null, isWelcome: true };
    }

    const opcoes = currentNode.opcoes || {};
    const matchKey = Object.keys(opcoes).find((k) => k.trim().toLowerCase() === normalized);

    if (matchKey) {
      const nextKey = opcoes[matchKey];
      this.setState(jid, nextKey);
      return { key: nextKey, node: this.flow[nextKey] || null, isWelcome: false };
    }

    // Nenhuma opção reconhecida: repete a mensagem atual (o cliente permanece na mesma etapa).
    return { key: currentKey, node: currentNode, isWelcome: false, unmatched: true };
  }
}

module.exports = FlowEngine;
