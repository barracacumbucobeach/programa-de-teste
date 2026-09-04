'use strict';

const store = require('./store');

/**
 * Banco de clientes: guarda, por contato (jid), as variáveis coletadas pelo
 * fluxo (nome, e-mail, telefone, ou qualquer outro dado perguntado por um
 * nó de "Pergunta"). Persistido em data/clientes.json.
 *
 * { "<jid>": { phone, variables: { nome: "...", email: "..." }, updatedAt } }
 */
class CustomerStore {
  constructor() {
    this.customers = store.loadCustomersRaw();
  }

  reload() {
    this.customers = store.loadCustomersRaw();
  }

  getVariables(jid) {
    return this.customers[jid]?.variables || {};
  }

  /** Salva/atualiza uma variável de um contato (cria o registro se não existir). */
  setVariable(jid, name, value) {
    if (!name) return;
    const current = this.customers[jid] || { phone: jid.split('@')[0], variables: {} };
    current.variables = { ...current.variables, [name]: value };
    current.phone = current.phone || jid.split('@')[0];
    current.updatedAt = Date.now();
    this.customers[jid] = current;
    this._persist();
  }

  listCustomers() {
    return Object.entries(this.customers)
      .map(([jid, data]) => ({
        jid,
        phone: data.phone,
        variables: data.variables || {},
        updatedAt: data.updatedAt,
        handoff: data.handoff || null,
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  deleteCustomer(jid) {
    delete this.customers[jid];
    this._persist();
  }

  isHandoffPending(jid) {
    return Boolean(this.customers[jid]?.handoff?.pending);
  }

  /** Cliente chegou a um nó "Transferir para atendente": pausa as respostas
   *  automáticas do bot para ele até um atendente resolver ou ele digitar "menu". */
  requestHandoff(jid, { nodeTitle } = {}) {
    const current = this.customers[jid] || { phone: jid.split('@')[0], variables: {} };
    current.phone = current.phone || jid.split('@')[0];
    current.handoff = { pending: true, requestedAt: Date.now(), nodeTitle: nodeTitle || null };
    this.customers[jid] = current;
    this._persist();
    return current.handoff;
  }

  /** Atendente marcou como resolvido (ou o cliente digitou "menu"): bot volta a responder. */
  resolveHandoff(jid) {
    if (!this.customers[jid]?.handoff) return;
    this.customers[jid].handoff = { ...this.customers[jid].handoff, pending: false, resolvedAt: Date.now() };
    this._persist();
  }

  listPendingHandoffs() {
    return Object.entries(this.customers)
      .filter(([, data]) => data.handoff?.pending)
      .map(([jid, data]) => ({ jid, phone: data.phone, variables: data.variables || {}, handoff: data.handoff }))
      .sort((a, b) => (b.handoff.requestedAt || 0) - (a.handoff.requestedAt || 0));
  }

  _persist() {
    store.saveCustomersDebounced(this.customers);
  }
}

module.exports = CustomerStore;
