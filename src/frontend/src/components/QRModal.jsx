import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * Três estados possíveis:
 *  - 'connected'          → conectado, com botão "Desconectar"
 *  - 'idle'                → desconectado por decisão do usuário, parado de
 *                            propósito, com botão "Conectar" (gera QR novo)
 *  - qualquer outro         → conectando/aguardando QR, com botão para
 *    ('connecting'/'qr'/      forçar um QR novo caso fique travado
 *     'disconnected')
 */
export default function QRModal({ open, onClose, status }) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && status.status === 'connected') {
      const timer = setTimeout(onClose, 1800);
      return () => clearTimeout(timer);
    }
  }, [open, status.status, onClose]);

  if (!open) return null;

  const runAction = async (action) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const isConnected = status.status === 'connected';
  const isIdle = status.status === 'idle';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3>Conexão com o WhatsApp</h3>
          <button type="button" className="icon-btn" onClick={onClose} title="Fechar">
            ✕
          </button>
        </div>

        {isConnected && (
          <div className="qr-connected">
            <div className="qr-connected-icon">✅</div>
            <p>Conectado com sucesso!</p>
            {status.phone && <span className="qr-phone">+{status.phone}</span>}
            <button
              type="button"
              className="btn btn-outline-danger btn-block"
              onClick={() => runAction(api.logoutSession)}
              disabled={busy}
            >
              🔌 Desconectar
            </button>
          </div>
        )}

        {isIdle && (
          <div className="qr-connected">
            <div className="qr-connected-icon">🔌</div>
            <p>Desconectado</p>
            <span className="qr-phone">Você pediu para desconectar — conecte quando quiser.</span>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => runAction(api.connectSession)}
              disabled={busy}
            >
              {busy ? 'Conectando…' : '🔌 Conectar'}
            </button>
          </div>
        )}

        {!isConnected && !isIdle && (
          <div className="qr-body">
            {status.qr ? (
              <img src={status.qr} alt="QR Code do WhatsApp" className="qr-image" />
            ) : (
              <div className="qr-placeholder">Gerando QR Code…</div>
            )}
            <ol className="qr-steps">
              <li>Abra o WhatsApp no seu celular</li>
              <li>
                Toque em <strong>Mais opções ⋮</strong> → <strong>Aparelhos conectados</strong>
              </li>
              <li>
                Toque em <strong>Conectar um aparelho</strong> e aponte a câmera para o QR Code
              </li>
            </ol>
            <button
              type="button"
              className="btn btn-ghost btn-block"
              onClick={() => runAction(api.restartSession)}
              disabled={busy}
            >
              🔄 Gerar novo QR Code
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
