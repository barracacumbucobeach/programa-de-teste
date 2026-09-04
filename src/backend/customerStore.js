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
      .map(([jid, data]) => ({ jid, phone: data.phone, variables: data.variables || {}, updatedAt: data.updatedAt }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  deleteCustomer(jid) {
    delete this.customers[jid];
    this._persist();
  }

  _persist() {
    store.saveCustomersDebounced(this.customers);
  }
}

module.exports = CustomerStore;
