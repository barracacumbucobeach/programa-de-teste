const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4477';
const WS_URL = API_BASE.replace(/^http/, 'ws') + '/ws';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Erro ${res.status} ao chamar ${path}`);
  }
  return data;
}

export const api = {
  getBuilder: () => request('/api/builder'),
  saveBuilder: (graph) => request('/api/builder', { method: 'POST', body: JSON.stringify(graph) }),
  getStatus: () => request('/api/status'),
  restartSession: () => request('/api/session/restart', { method: 'POST' }),
  connectSession: () => request('/api/session/connect', { method: 'POST' }),
  logoutSession: () => request('/api/session/logout', { method: 'POST' }),
  getConversations: () => request('/api/conversations'),
  getConversationMessages: (jid) => request(`/api/conversations/${encodeURIComponent(jid)}`),
  deleteConversation: (jid) => request(`/api/conversations/${encodeURIComponent(jid)}`, { method: 'DELETE' }),
  getCustomers: () => request('/api/customers'),
  deleteCustomer: (jid) => request(`/api/customers/${encodeURIComponent(jid)}`, { method: 'DELETE' }),
  getHandoffs: () => request('/api/handoffs'),
  resolveHandoff: (jid) => request(`/api/handoffs/${encodeURIComponent(jid)}/resolve`, { method: 'POST' }),
  getConfig: () => request('/api/config'),
  saveConfig: (config) => request('/api/config', { method: 'POST', body: JSON.stringify(config) }),
};

/**
 * Abre um WebSocket com o motor local e reconecta automaticamente
 * (com backoff) caso a conexão caia. Retorna uma função para encerrar.
 */
export function connectSocket(onMessage) {
  let socket;
  let retry = 1000;
  let closedByUser = false;

  function open() {
    try {
      socket = new WebSocket(WS_URL);
    } catch {
      return;
    }

    socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch {
        /* payload inválido, ignora */
      }
    };

    socket.onopen = () => {
      retry = 1000;
    };

    socket.onclose = () => {
      if (closedByUser) return;
      setTimeout(open, retry);
      retry = Math.min(retry * 1.5, 10000);
    };

    socket.onerror = () => socket.close();
  }

  open();

  return () => {
    closedByUser = true;
    socket?.close();
  };
}
