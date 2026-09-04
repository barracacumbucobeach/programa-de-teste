'use strict';

const { delay } = require('@whiskeysockets/baileys');

/**
 * MÓDULO HUMANIZADOR ANTI-BANIMENTO
 *
 * Antes de qualquer envio de mensagem, o motor deve:
 *  a) Sortear um tempo de espera aleatório (padrão 3–7s);
 *  b) Ativar o estado "digitando…" na conversa;
 *  c) Manter o estado digitando por um tempo proporcional ao tamanho
 *     do texto (mínimo 2s, máximo 6s);
 *  d) Remover o estado e só então enviar a mensagem.
 */

function randomDelay(minSeconds = 3, maxSeconds = 7) {
  const min = Math.min(minSeconds, maxSeconds);
  const max = Math.max(minSeconds, maxSeconds);
  return Math.floor(Math.random() * (max - min + 1) + min) * 1000;
}

function typingDuration(text = '', { minMs = 2000, maxMs = 6000, msPerChar = 50 } = {}) {
  return Math.min(Math.max(text.length * msPerChar, minMs), maxMs);
}

/**
 * Simula comportamento humano antes de uma mensagem ser enviada.
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {string} jid
 * @param {string} text
 */
async function simulateHumanTyping(sock, jid, text, opts = {}) {
  const preDelayMs = randomDelay(opts.minDelaySeconds ?? 3, opts.maxDelaySeconds ?? 7);
  await delay(preDelayMs);

  await sock.sendPresenceUpdate('composing', jid);
  const typingMs = typingDuration(text, opts);
  await delay(typingMs);

  await sock.sendPresenceUpdate('paused', jid);

  return { preDelayMs, typingMs };
}

module.exports = { randomDelay, typingDuration, simulateHumanTyping };
