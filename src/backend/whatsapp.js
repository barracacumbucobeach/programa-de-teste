'use strict';

const fs = require('fs');
const EventEmitter = require('events');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');

const store = require('./store');
const { createLogger } = require('./logger');
const { simulateHumanPresence } = require('./humanizer');

const logger = createLogger('whatsapp');

/** Monta o payload de envio do Baileys de acordo com o tipo de conteúdo do nó. */
function buildOutgoingPayload(node) {
  const caption = node.mensagem || undefined;

  switch (node.kind) {
    case 'image':
      return node.mediaUrl ? { image: { url: node.mediaUrl }, caption } : null;
    case 'video':
      return node.mediaUrl ? { video: { url: node.mediaUrl }, caption } : null;
    case 'audio':
      return node.mediaUrl ? { audio: { url: node.mediaUrl }, mimetype: 'audio/mpeg', ptt: true } : null;
    case 'text':
    default:
      return node.mensagem ? { text: node.mensagem } : null;
  }
}

// @whiskeysockets/baileys é distribuído como pacote ESM-only. O Node do
// sandbox de desenvolvimento suporta require(esm) nativamente, mas o Node
// embutido no Electron empacotado não — por isso o pacote é sempre
// carregado via import() dinâmico (compatível com os dois ambientes) e
// cacheado após o primeiro uso.
let baileysApiPromise = null;
function loadBaileys() {
  if (!baileysApiPromise) {
    baileysApiPromise = import('@whiskeysockets/baileys');
  }
  return baileysApiPromise;
}

/** Gerencia a conexão com o WhatsApp e a execução do fluxo para cada mensagem recebida. */
class WhatsAppConnection extends EventEmitter {
  constructor(flowEngine, conversationLog) {
    super();
    this.flowEngine = flowEngine;
    this.conversationLog = conversationLog;
    this.sock = null;
    this.status = 'connecting'; // idle | connecting | qr | connected | disconnected
    this.phone = null;
    this.qrDataUrl = null;
    this.stats = { received: 0, sent: 0 };
    this.DisconnectReason = null;
    // Detecta uma sessão local corrompida/inválida: se a conexão cai várias
    // vezes seguidas sem nunca chegar a exibir um QR Code ou conectar de
    // fato, as credenciais salvas em disco provavelmente estão quebradas —
    // nesse caso a sessão é limpa automaticamente para forçar um QR novo,
    // já que só reiniciar (com as mesmas credenciais ruins) nunca resolveria.
    this.consecutiveFailures = 0;
    this.hasAutoRecovered = false;
    // Só entra em ação se a conexão NUNCA chegou a autenticar de fato nesta
    // sessão do app — uma sessão que já provou funcionar não deve ser
    // apagada por causa de uma instabilidade de rede passageira depois.
    this.hasEverConnected = false;
    // true quando o próprio usuário pediu para desconectar (botão
    // "Desconectar"): nesse caso o motor NÃO tenta reconectar sozinho,
    // fica em repouso ('idle') até um "Conectar" explícito.
    this.manuallyDisconnected = false;
  }

  /** Apaga as credenciais locais salvas (data/auth_session) para forçar um QR Code novo. */
  async clearSession() {
    try {
      await fs.promises.rm(store.AUTH_DIR, { recursive: true, force: true });
      logger.warn('🗑️  Sessão local do WhatsApp apagada.');
    } catch (err) {
      logger.error('Falha ao apagar a sessão local:', err.message);
    }
  }

  async start() {
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
    } = await loadBaileys();

    this.DisconnectReason = DisconnectReason;

    const { state, saveCreds } = await useMultiFileAuthState(store.AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

    this.sock = makeWASocket({
      auth: state,
      version,
      logger,
      printQRInTerminal: false,
      browser: ['AutoFlow Desktop', 'Chrome', '1.0.0'],
      syncFullHistory: false,
    });

    this.sock.ev.on('creds.update', saveCreds);
    this.sock.ev.on('connection.update', (update) => this.handleConnectionUpdate(update));
    this.sock.ev.on('messages.upsert', (payload) => this.handleMessages(payload));
  }

  async handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        this.qrDataUrl = await qrcode.toDataURL(qr, { margin: 1, scale: 6 });
      } catch (err) {
        logger.error('Falha ao gerar imagem do QR Code:', err.message);
      }
      this.status = 'qr';
      this.consecutiveFailures = 0; // conseguiu chegar a um QR: a sessão local não é o problema
      qrcodeTerminal.generate(qr, { small: true });
      logger.info('📌 QR Code atualizado — escaneie pelo app ou pelo terminal.');
      this.emitStatus();
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === this.DisconnectReason?.loggedOut;

      if (this.manuallyDisconnected) {
        // Fomos nós que pedimos para desconectar (disconnect() já limpou a
        // sessão) — fica em repouso, sem tentar reconectar sozinho.
        this.status = 'idle';
        this.phone = null;
        this.qrDataUrl = null;
        this.emitStatus();
        return;
      }

      this.status = 'disconnected';
      this.phone = null;
      this.emitStatus();

      if (loggedOut) {
        // O próprio WhatsApp encerrou a sessão (ex.: removida pelo celular) —
        // começa do zero para não ficar preso tentando reconectar com
        // credenciais que o WhatsApp já invalidou.
        logger.warn('Sessão desconectada pelo WhatsApp. Gerando um QR Code novo…');
        await this.clearSession();
        this.consecutiveFailures = 0;
        setTimeout(() => this.start(), 1500);
        return;
      }

      this.consecutiveFailures += 1;
      logger.warn(`Conexão encerrada (código ${statusCode ?? '?'}). Tentativa de reconexão nº ${this.consecutiveFailures}…`);

      if (this.consecutiveFailures >= 3 && !this.hasAutoRecovered && !this.hasEverConnected) {
        // Várias quedas seguidas sem NUNCA ter chegado a conectar de fato: a
        // sessão local salva provavelmente está corrompida. Reiniciar
        // sozinho não resolveria (reusaria as mesmas credenciais quebradas),
        // então limpa a sessão automaticamente para forçar um QR Code novo.
        // Só age quando a conexão nunca funcionou nesta execução — uma
        // sessão que já esteve conectada não é apagada por instabilidade de
        // rede passageira depois.
        logger.warn('⚠️ Muitas falhas seguidas sem nunca conectar — limpando a sessão local automaticamente para gerar um QR novo.');
        this.hasAutoRecovered = true;
        await this.clearSession();
        this.consecutiveFailures = 0;
      }

      setTimeout(() => this.start(), 2000);
    } else if (connection === 'open') {
      this.status = 'connected';
      this.qrDataUrl = null;
      this.phone = this.sock?.user?.id?.split(':')[0] || null;
      this.consecutiveFailures = 0;
      this.hasAutoRecovered = false;
      this.hasEverConnected = true;
      this.emitStatus();
      logger.info('✅ AutoFlow Desktop conectado com sucesso ao WhatsApp!');
    }
  }

  async handleMessages({ messages, type }) {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;
      if (msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

      // Contas que o WhatsApp já migrou para o identificador "LID" chegam
      // com um remoteJid do tipo 182659855166@lid — um código interno de
      // privacidade, não o número de telefone do cliente. Nesse caso o
      // Baileys ainda informa o número real em key.senderPn; usamos ele
      // como identidade do cliente (estado da conversa, variáveis salvas,
      // telefone exibido no painel), senão a mesma pessoa pode virar dois
      // "clientes" diferentes conforme o WhatsApp alterna entre os dois
      // identificadores, e o telefone salvo fica um número sem sentido. O
      // envio da resposta continua sempre pelo jid original (é o que
      // realmente entrega a mensagem de volta para esse chat).
      const customerId = jid.endsWith('@lid') && msg.key.senderPn ? msg.key.senderPn : jid;

      const text = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        ''
      ).trim();

      this.stats.received += 1;
      const incomingLog = { direction: 'in', jid: customerId, kind: 'text', text, at: Date.now() };
      this.conversationLog?.append(incomingLog);
      this.emit('message-log', incomingLog);

      let result;
      try {
        result = this.flowEngine.resolveNextNode(customerId, text);
      } catch (err) {
        logger.error('Falha ao resolver o fluxo:', err.message);
        continue;
      }

      const node = result?.node;
      if (!node) continue;

      const payload = buildOutgoingPayload(node);
      if (!payload) continue; // nó de mídia sem URL configurada, ou texto vazio

      try {
        const presence = node.kind === 'audio' ? 'recording' : 'composing';
        await simulateHumanPresence(this.sock, jid, node.mensagem || '', { presence });
        await this.sock.sendMessage(jid, payload);

        this.stats.sent += 1;
        const outgoingLog = {
          direction: 'out',
          jid: customerId,
          kind: node.kind || 'text',
          text: node.mensagem || '',
          at: Date.now(),
        };
        this.conversationLog?.append(outgoingLog);
        this.emit('message-log', outgoingLog);
        this.emitStatus();
      } catch (err) {
        logger.error(`Falha ao enviar mensagem para ${jid}:`, err.message);
      }
    }
  }

  emitStatus() {
    this.emit('status', this.getSnapshot());
  }

  getSnapshot() {
    return {
      status: this.status,
      phone: this.phone,
      qr: this.qrDataUrl,
      stats: this.stats,
    };
  }

  /**
   * Desconecta por decisão do usuário: encerra a sessão no WhatsApp, apaga
   * as credenciais locais e FICA DESCONECTADO (não tenta reconectar
   * sozinho) até um "Conectar" explícito — exatamente para permitir
   * conectar/desconectar quando quiser, sem o motor brigando para voltar
   * a subir sozinho no meio do caminho.
   */
  async disconnect() {
    this.manuallyDisconnected = true;

    try {
      if (this.sock) {
        await this.sock.logout().catch(() => {});
        this.sock.end?.(undefined);
      }
    } finally {
      await this.clearSession();
    }

    this.sock = null;
    this.status = 'idle';
    this.phone = null;
    this.qrDataUrl = null;
    this.consecutiveFailures = 0;
    this.hasAutoRecovered = false;
    this.hasEverConnected = false;
    this.emitStatus();
  }

  /** Conecta (ou reconecta) por decisão do usuário — sempre gera um QR Code novo,
   *  já que a sessão só é preservada em disco entre uma queda e a reconexão
   *  automática, nunca depois de um disconnect() manual. */
  async connect() {
    this.manuallyDisconnected = false;
    this.status = 'connecting';
    this.emitStatus();
    await this.start();
  }

  /** Reset "forte": limpa a sessão local e reconecta na hora — usado pelo botão
   *  "Gerar novo QR Code" quando a conexão está travada sem nunca exibir um QR. */
  async restart() {
    try {
      this.sock?.end?.(undefined);
    } catch {
      /* conexão já pode estar encerrada */
    }
    await this.clearSession();
    this.manuallyDisconnected = false;
    this.consecutiveFailures = 0;
    this.hasAutoRecovered = false;
    this.hasEverConnected = false;
    this.status = 'connecting';
    this.emitStatus();
    await this.start();
  }
}

module.exports = WhatsAppConnection;
