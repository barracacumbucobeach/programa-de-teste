import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function formatDate(at) {
  if (!at) return '—';
  return new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Banco de clientes: mostra as variáveis coletadas (nome, e-mail, telefone…) por contato,
 *  com opção de excluir o registro — como pedido, "salvar ou deletar". */
export default function CustomersModal({ open, onClose, pushToast }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deletingJid, setDeletingJid] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .getCustomers()
      .then(setCustomers)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const handleDelete = async (jid) => {
    setDeletingJid(jid);
    try {
      await api.deleteCustomer(jid);
      setCustomers((prev) => prev.filter((c) => c.jid !== jid));
      pushToast?.('success', 'Cliente removido do banco de dados.');
    } catch (err) {
      pushToast?.('error', err.message);
    } finally {
      setDeletingJid(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3>Banco de clientes</h3>
          <button type="button" className="icon-btn" onClick={onClose} title="Fechar">
            ✕
          </button>
        </div>

        <p className="customers-hint">
          Dados coletados pelos nós de "Pergunta" do fluxo (nome, e-mail, telefone, etc.).
        </p>

        {loading && <p className="conversations-empty">Carregando…</p>}
        {!loading && customers.length === 0 && (
          <p className="conversations-empty">Nenhum cliente com dados salvos ainda.</p>
        )}

        {!loading && customers.length > 0 && (
          <div className="customers-table-wrap">
            <table className="customers-table">
              <thead>
                <tr>
                  <th>Contato</th>
                  <th>Variáveis salvas</th>
                  <th>Atualizado em</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.jid}>
                    <td className="customers-phone">+{customer.phone}</td>
                    <td>
                      <div className="customers-vars">
                        {Object.entries(customer.variables || {}).map(([key, value]) => (
                          <span key={key} className="customers-var-tag">
                            <strong>{key}:</strong> {value}
                          </span>
                        ))}
                        {Object.keys(customer.variables || {}).length === 0 && (
                          <span className="customers-var-empty">—</span>
                        )}
                      </div>
                    </td>
                    <td className="customers-date">{formatDate(customer.updatedAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-outline-danger"
                        onClick={() => handleDelete(customer.jid)}
                        disabled={deletingJid === customer.jid}
                      >
                        🗑 Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
