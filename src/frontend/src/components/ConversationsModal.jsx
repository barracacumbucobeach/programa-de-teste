import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

function formatPhone(phone) {
  return phone ? `+${phone}` : '—';
}

function formatTime(at) {
  if (!at) return '';
  const date = new Date(at);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

const KIND_LABEL = { text: '', image: '🖼️ Imagem', video: '🎬 Vídeo', audio: '🎙️ Áudio' };

/**
 * Painel de conversas: lista os contatos que já falaram com o bot e mostra
 * o histórico de mensagens trocadas com o contato selecionado. Atualiza ao
 * vivo conforme novas mensagens chegam via WebSocket (prop `liveMessage`).
 */
export default function ConversationsModal({ open, onClose, liveMessage }) {
  const [contacts, setContacts] = useState([]);
  const [selectedJid, setSelectedJid] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.getConversations().then(setContacts).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!selectedJid) return;
    setLoading(true);
    api
      .getConversationMessages(selectedJid)
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [selectedJid]);

  // Atualização ao vivo: nova mensagem chega pelo WebSocket enquanto o painel está aberto.
  useEffect(() => {
    if (!open || !liveMessage) return;

    setContacts((prev) => {
      const existing = prev.find((c) => c.jid === liveMessage.jid);
      const updated = {
        jid: liveMessage.jid,
        phone: existing?.phone || liveMessage.jid.split('@')[0],
        count: (existing?.count || 0) + 1,
        lastAt: liveMessage.at,
        lastDirection: liveMessage.direction,
        lastKind: liveMessage.kind,
        lastText: liveMessage.text,
      };
      const rest = prev.filter((c) => c.jid !== liveMessage.jid);
      return [updated, ...rest];
    });

    if (liveMessage.jid === selectedJid) {
      setMessages((prev) => [...prev, liveMessage]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMessage, open]);

  const selectedContact = useMemo(() => contacts.find((c) => c.jid === selectedJid), [contacts, selectedJid]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3>Conversas com clientes</h3>
          <button type="button" className="icon-btn" onClick={onClose} title="Fechar">
            ✕
          </button>
        </div>

        <div className="conversations-layout">
          <div className="conversations-list">
            {contacts.length === 0 && <p className="conversations-empty">Nenhuma conversa registrada ainda.</p>}
            {contacts.map((contact) => (
              <button
                type="button"
                key={contact.jid}
                className={`conversation-row ${contact.jid === selectedJid ? 'is-active' : ''}`}
                onClick={() => setSelectedJid(contact.jid)}
              >
                <div className="conversation-row-top">
                  <span className="conversation-phone">{formatPhone(contact.phone)}</span>
                  <span className="conversation-time">{formatTime(contact.lastAt)}</span>
                </div>
                <p className="conversation-preview">
                  {contact.lastDirection === 'out' ? 'Você: ' : ''}
                  {KIND_LABEL[contact.lastKind] || contact.lastText || '(sem texto)'}
                </p>
                <span className="conversation-count">{contact.count} mensagens</span>
              </button>
            ))}
          </div>

          <div className="conversations-thread">
            {!selectedJid && <div className="conversations-placeholder">Selecione um contato para ver o histórico</div>}

            {selectedJid && (
              <>
                <div className="conversations-thread-head">{formatPhone(selectedContact?.phone)}</div>
                <div className="conversations-thread-body">
                  {loading && <p className="conversations-empty">Carregando…</p>}
                  {!loading &&
                    messages.map((msg, index) => (
                      <div key={index} className={`chat-bubble chat-${msg.direction}`}>
                        {KIND_LABEL[msg.kind] && <div className="chat-bubble-kind">{KIND_LABEL[msg.kind]}</div>}
                        {msg.text && <div className="chat-bubble-text">{msg.text}</div>}
                        <div className="chat-bubble-time">{formatTime(msg.at)}</div>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
