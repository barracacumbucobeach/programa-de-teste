'use strict';

const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const store = require('./store');
const { createLogger } = require('./logger');

const logger = createLogger('server');

/**
 * Cria a API HTTP + WebSocket local usada pelo construtor visual (frontend)
 * para carregar/salvar o fluxo e acompanhar o status da conexão em tempo real.
 */
function createServer({ whatsapp, flowEngine, conversationLog, customerStore }) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  const logBuffer = [];

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  function broadcast(message) {
    const data = JSON.stringify(message);
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(data);
    });
  }

  function pushLog(entry) {
    logBuffer.push(entry);
    if (logBuffer.length > 100) logBuffer.shift();
    broadcast({ type: 'message-log', payload: entry });
  }

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.get('/api/builder', (req, res) => {
    res.json(store.loadBuilder());
  });

  app.post('/api/builder', (req, res) => {
    try {
      const compiled = store.saveBuilder(req.body);
      flowEngine.reload();
      broadcast({ type: 'flow-updated' });
      logger.info('💾 Fluxo salvo e ativado.');
      res.json({ ok: true, compiled });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/status', (req, res) => {
    res.json({ ...whatsapp.getSnapshot(), logs: logBuffer.slice(-30) });
  });

  app.post('/api/session/restart', (req, res) => {
    whatsapp.restart();
    res.json({ ok: true });
  });

  app.post('/api/session/connect', (req, res) => {
    whatsapp.connect();
    res.json({ ok: true });
  });

  app.post('/api/session/logout', async (req, res) => {
    await whatsapp.disconnect();
    res.json({ ok: true });
  });

  app.get('/api/conversations', (req, res) => {
    res.json(conversationLog.listContacts());
  });

  app.get('/api/conversations/:jid', (req, res) => {
    const jid = decodeURIComponent(req.params.jid);
    res.json(conversationLog.getMessages(jid));
  });

  app.delete('/api/conversations/:jid', (req, res) => {
    const jid = decodeURIComponent(req.params.jid);
    conversationLog.deleteContact(jid);
    res.json({ ok: true });
  });

  app.get('/api/customers', (req, res) => {
    res.json(customerStore.listCustomers());
  });

  app.delete('/api/customers/:jid', (req, res) => {
    const jid = decodeURIComponent(req.params.jid);
    customerStore.deleteCustomer(jid);
    res.json({ ok: true });
  });

  app.get('/api/config', (req, res) => {
    res.json(store.loadConfig());
  });

  app.post('/api/config', (req, res) => {
    // Só dígitos (o cliente pode digitar com +, espaço, parênteses etc.) —
    // vazio desliga a restrição e o bot volta a responder todo mundo.
    const restrictToPhone = String(req.body?.restrictToPhone ?? '').replace(/\D/g, '');
    const config = store.saveConfig({ restrictToPhone });
    whatsapp.reloadConfig?.();
    logger.info(
      restrictToPhone
        ? `🔒 Modo restrito ativado — só responde a +${restrictToPhone}.`
        : '🔓 Modo restrito desativado — respondendo a todos os contatos.'
    );
    res.json({ ok: true, config });
  });

  app.get('/api/handoffs', (req, res) => {
    res.json(customerStore.listPendingHandoffs());
  });

  app.post('/api/handoffs/:jid/resolve', (req, res) => {
    const jid = decodeURIComponent(req.params.jid);
    flowEngine.releaseHandoff(jid);
    broadcast({ type: 'handoff-resolved', payload: { jid } });
    res.json({ ok: true });
  });

  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'status', payload: whatsapp.getSnapshot() }));
  });

  whatsapp.on('status', (snapshot) => broadcast({ type: 'status', payload: snapshot }));
  whatsapp.on('message-log', pushLog);

  flowEngine.on('handoff', (payload) => {
    logger.info(`🙋 Cliente +${payload.phone} pediu atendimento humano (${payload.nodeTitle}).`);
    broadcast({ type: 'handoff', payload });
  });

  return { app, server, broadcast };
}

module.exports = { createServer };
