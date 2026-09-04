import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function formatPhone(phone) {
  return phone ? `+${phone}` : '—';
}

function formatRelative(at) {
  if (!at) return '';
  const diffMs = Date.now() - at;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return new Date(at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/**
 * Painel "Atendimentos": lista os clientes que pediram para falar com um
 * humano (chegaram a um nó "Transferir para atendente") e ainda não foram
 * marcados como resolvidos. Atualiza ao vivo via WebSocket (prop `liveHandoff`).
 */
export default function HandoffsModal({ open, onClose, liveHandoff, liveHandoffResolved, pushToast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [resolvingJid, setResolvingJid] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .getHandoffs()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!liveHandoff) return;
    setItems((prev) => {
      const rest = prev.filter((item) => item.jid !== liveHandoff.jid);
      return [{ jid: liveHandoff.jid, phone: liveHandoff.phone, variables: {}, handoff: liveHandoff }, ...rest];
    });
  }, [liveHandoff]);

  useEffect(() => {
    if (!liveHandoffResolved) return;
    setItems((prev) => prev.filter((item) => item.jid !== liveHandoffResolved.jid));
  }, [liveHandoffResolved]);

  if (!open) return null;

  const handleResolve = async (jid) => {
    setResolvingJid(jid);
    try {
      await api.resolveHandoff(jid);
      setItems((prev) => prev.filter((item) => item.jid !== jid));
      pushToast?.('success', 'Marcado como atendido — o bot volta a responder esse cliente.');
    } catch (err) {
      pushToast?.('error', err.message);
    } finally {
      setResolvingJid(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3>Atendimentos pendentes</h3>
          <button type="button" className="icon-btn" onClick={onClose} title="Fechar">
            ✕
          </button>
        </div>

        <p className="customers-hint">
          Clientes que chegaram a um nó <strong>🙋 Atendente</strong> — o bot está pausado para eles até você marcar
          como atendido (ou eles digitarem <code>menu</code>).
        </p>

        {loading && <p className="conversations-empty">Carregando…</p>}
        {!loading && items.length === 0 && (
          <p className="conversations-empty">Nenhum atendimento pendente no momento. 🎉</p>
        )}

        {!loading && items.length > 0 && (
          <ul className="handoff-list">
            {items.map((item) => (
              <li key={item.jid} className="handoff-row">
                <div className="handoff-row-info">
                  <span className="handoff-phone">{formatPhone(item.phone)}</span>
                  <span className="handoff-meta">
                    pediu atendimento {formatRelative(item.handoff?.requestedAt)}
                    {item.handoff?.nodeTitle ? ` · nó "${item.handoff.nodeTitle}"` : ''}
                  </span>
                  {Object.keys(item.variables || {}).length > 0 && (
                    <div className="customers-vars">
                      {Object.entries(item.variables).map(([key, value]) => (
                        <span key={key} className="customers-var-tag">
                          <strong>{key}:</strong> {value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleResolve(item.jid)}
                  disabled={resolvingJid === item.jid}
                >
                  ✅ Marcar como atendido
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
