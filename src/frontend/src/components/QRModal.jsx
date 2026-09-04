import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function QRModal({ open, onClose, status }) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && status.status === 'connected') {
      const timer = setTimeout(onClose, 1800);
      return () => clearTimeout(timer);
    }
  }, [open, status.status, onClose]);

  if (!open) return null;

  const handleRestart = async () => {
    setBusy(true);
    try {
      await api.restartSession();
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      await api.logoutSession();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3>Conexão com o WhatsApp</h3>
          <button type="button" className="icon-btn" onClick={onClose} title="Fechar">
            ✕
          </button>
        </div>

        {status.status === 'connected' ? (
          <div className="qr-connected">
            <div className="qr-connected-icon">✅</div>
            <p>Conectado com sucesso!</p>
            {status.phone && <span className="qr-phone">+{status.phone}</span>}
            <button type="button" className="btn btn-outline-danger btn-block" onClick={handleLogout} disabled={busy}>
              Encerrar sessão
            </button>
          </div>
        ) : (
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
            <button type="button" className="btn btn-ghost btn-block" onClick={handleRestart} disabled={busy}>
              🔄 Gerar novo QR Code
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
