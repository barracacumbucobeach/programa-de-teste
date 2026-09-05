import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

/** Formata um telefone só-dígitos pra exibição (ex: 5511999998888 -> +55 11 99999-8888). */
function formatPhone(digits) {
  if (!digits) return '';
  return `+${digits}`;
}

/** Configurações gerais do app — hoje só o "modo restrito": escolher um único
 *  contato pra o bot responder, ignorando todo o resto. Útil pra testar o
 *  fluxo sem incomodar clientes de verdade, ou deixar o bot de olho só numa
 *  conversa específica. */
export default function SettingsModal({ open, onClose, pushToast }) {
  const [phoneInput, setPhoneInput] = useState('');
  const [savedPhone, setSavedPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .getConfig()
      .then((config) => {
        const digits = config?.restrictToPhone || '';
        setSavedPhone(digits);
        setPhoneInput(digits);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const { config } = await api.saveConfig({ restrictToPhone: phoneInput });
      setSavedPhone(config.restrictToPhone || '');
      setPhoneInput(config.restrictToPhone || '');
      pushToast?.(
        'success',
        config.restrictToPhone
          ? `Modo restrito ativado — só responde a ${formatPhone(config.restrictToPhone)}.`
          : 'Modo restrito desativado — o bot volta a responder todo mundo.'
      );
    } catch (err) {
      pushToast?.('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => setPhoneInput('');

  const isDirty = phoneInput.replace(/\D/g, '') !== savedPhone;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3>⚙️ Configurações</h3>
          <button type="button" className="icon-btn" onClick={onClose} title="Fechar">
            ✕
          </button>
        </div>

        <div className="field">
          <span>Responder somente a este número (opcional)</span>
          <input
            type="text"
            value={phoneInput}
            onChange={(event) => setPhoneInput(event.target.value)}
            placeholder="Ex: 5511999998888 (com DDI e DDD)"
            disabled={loading}
          />
          <span className="field-hint field-hint-left">
            Com um número aqui, o bot ignora completamente qualquer outro contato — só grupos já
            são ignorados por padrão, isso não muda. Deixe em branco e salve pra voltar a
            responder todo mundo.
          </span>
        </div>

        {savedPhone && (
          <p className="settings-current-status">
            🔒 Modo restrito ativo agora: só responde a <strong>{formatPhone(savedPhone)}</strong>
          </p>
        )}

        <div className="modal-actions">
          {phoneInput && (
            <button type="button" className="btn btn-ghost" onClick={handleClear} disabled={saving}>
              Limpar
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
