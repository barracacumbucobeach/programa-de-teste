'use strict';

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
    this.status = 'connecting'; // connecting | qr | connected | disconnected
    this.phone = null;
    this.qrDataUrl = null;
    this.stats = { received: 0, sent: 0 };
    this.DisconnectReason = null;
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
      qrcodeTerminal.generate(qr, { small: true });
      logger.info('📌 QR Code atualizado — escaneie pelo app ou pelo terminal.');
      this.emitStatus();
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== this.DisconnectReason?.loggedOut;

      this.status = 'disconnected';
      this.phone = null;
      this.emitStatus();
      logger.warn(`Conexão encerrada (código ${statusCode ?? '?'}). Reconectar automaticamente: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(() => this.start(), 2000);
      }
    } else if (connection === 'open') {
      this.status = 'connected';
      this.qrDataUrl = null;
      this.phone = this.sock?.user?.id?.split(':')[0] || null;
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

      const text = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        ''
      ).trim();

      this.stats.received += 1;
      const incomingLog = { direction: 'in', jid, kind: 'text', text, at: Date.now() };
      this.conversationLog?.append(incomingLog);
      this.emit('message-log', incomingLog);

      let result;
      try {
        result = this.flowEngine.resolveNextNode(jid, text);
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
          jid,
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

  async logout() {
    if (this.sock) {
      await this.sock.logout().catch(() => {});
    }
    this.status = 'disconnected';
    this.phone = null;
    this.qrDataUrl = null;
    this.emitStatus();
  }

  async restart() {
    try {
      this.sock?.end?.(undefined);
    } catch {
      /* conexão já pode estar encerrada */
    }
    this.status = 'connecting';
    this.emitStatus();
    await this.start();
  }
}

module.exports = WhatsAppConnection;
