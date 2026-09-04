import React from 'react';

const STATUS_LABEL = {
  connected: 'Conectado ao WhatsApp',
  qr: 'Aguardando leitura do QR Code',
  connecting: 'Conectando…',
  disconnected: 'Desconectado',
};

function formatTime(timestamp) {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function TopBar({ saving, dirty, lastSavedAt, status, onSave, onOpenQr }) {
  const subtitle = dirty
    ? 'Alterações não salvas'
    : lastSavedAt
      ? `Salvo às ${formatTime(lastSavedAt)}`
      : 'Edite seu fluxo de atendimento';

  return (
    <header className="topbar">
      <div>
        <h2>Construtor de Fluxos</h2>
        <p className={`topbar-subtitle ${dirty ? 'is-dirty' : ''}`}>{subtitle}</p>
      </div>

      <div className="topbar-actions">
        <button type="button" className={`status-chip status-${status.status}`} onClick={onOpenQr}>
          <span className="dot" />
          {STATUS_LABEL[status.status] || 'Desconectado'}
        </button>

        <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>
          {saving ? 'Salvando…' : '💾 Salvar e Ativar Fluxo'}
        </button>
      </div>
    </header>
  );
}
