'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./store');

/**
 * Registro de conversas: cada mensagem (recebida ou enviada) é anexada como
 * uma linha JSON em data/conversas.jsonl (formato JSON Lines — cada `append`
 * é uma escrita rápida e segura, sem precisar reescrever o arquivo inteiro).
 *
 * Mantém em memória um índice por contato (última mensagem, contador) para
 * responder a listagem instantaneamente sem reler o arquivo inteiro a cada
 * chamada; a leitura de uma conversa específica lê o arquivo sob demanda.
 */
class ConversationLog {
  constructor() {
    this.filePath = store.CONVERSATIONS_FILE;
    this.contactsIndex = new Map(); // jid -> resumo
    this._loadIndex();
  }

  _loadIndex() {
    if (!fs.existsSync(this.filePath)) return;
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        this._updateIndex(JSON.parse(line));
      } catch {
        // linha corrompida/parcial (ex.: escrita interrompida) — ignora
      }
    }
  }

  _updateIndex(entry) {
    const current = this.contactsIndex.get(entry.jid) || { jid: entry.jid, phone: entry.phone, count: 0 };
    current.count += 1;
    current.lastAt = entry.at;
    current.lastDirection = entry.direction;
    current.lastKind = entry.kind;
    current.lastText = entry.text;
    this.contactsIndex.set(entry.jid, current);
  }

  /** Registra uma mensagem trocada com um contato. */
  append({ jid, direction, kind = 'text', text = '', at = Date.now() }) {
    const phone = String(jid || '').split('@')[0];
    const entry = { jid, phone, direction, kind, text, at };

    store.ensureDataDir();
    fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf-8');
    this._updateIndex(entry);

    return entry;
  }

  /** Lista os contatos com quem já houve conversa, mais recentes primeiro. */
  listContacts() {
    return [...this.contactsIndex.values()].sort((a, b) => b.lastAt - a.lastAt);
  }

  /** Apaga o histórico de conversa com um contato (reescreve o arquivo sem
   *  as linhas dele — é um arquivo "append only", não dá pra apagar uma
   *  linha específica sem reescrever o resto). */
  deleteContact(jid) {
    this.contactsIndex.delete(jid);
    if (!fs.existsSync(this.filePath)) return;

    const raw = fs.readFileSync(this.filePath, 'utf-8');
    const kept = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.jid !== jid) kept.push(line);
      } catch {
        // linha corrompida: não dá pra saber de quem era, descarta também
      }
    }
    fs.writeFileSync(this.filePath, kept.length ? kept.join('\n') + '\n' : '', 'utf-8');
  }

  /** Retorna as últimas `limit` mensagens trocadas com um contato específico. */
  getMessages(jid, { limit = 300 } = {}) {
    if (!fs.existsSync(this.filePath)) return [];

    const raw = fs.readFileSync(this.filePath, 'utf-8');
    const messages = [];

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.jid === jid) messages.push(entry);
      } catch {
        // ignora linha corrompida
      }
    }

    return messages.slice(-limit);
  }
}

module.exports = ConversationLog;
