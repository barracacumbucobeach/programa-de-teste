import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import TopBar from './components/TopBar.jsx';
import Sidebar, { DRAG_MIME } from './components/Sidebar.jsx';
import NodePanel from './components/NodePanel.jsx';
import QRModal from './components/QRModal.jsx';
import ConversationsModal from './components/ConversationsModal.jsx';
import CustomersModal from './components/CustomersModal.jsx';
import HandoffsModal from './components/HandoffsModal.jsx';
import ToastStack, { useToasts } from './components/ToastStack.jsx';
import MessageNode, { KIND_META } from './components/nodes/MessageNode.jsx';
import LabeledEdge from './components/edges/LabeledEdge.jsx';
import { api, connectSocket } from './api.js';
import { getInitialTheme, applyTheme } from './theme.js';

const nodeTypes = { message: MessageNode };
const edgeTypes = { labeled: LabeledEdge };

let idCounter = 1;
const generateId = () => `no_${Date.now().toString(36)}_${idCounter++}`;

let optionIdCounter = 1;
const generateOptionId = () => `opt_${Date.now().toString(36)}_${optionIdCounter++}`;

/** Notificação nativa do sistema operacional (funciona dentro do Electron
 *  sem nenhuma configuração extra) — usada para avisar de um pedido de
 *  atendimento humano mesmo com a janela minimizada/em segundo plano. */
function notifyDesktop(title, body) {
  try {
    if (typeof Notification === 'undefined') return;
    const show = () => new Notification(title, { body });
    if (Notification.permission === 'granted') {
      show();
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') show();
      });
    }
  } catch {
    /* notificações não suportadas neste ambiente — ignora silenciosamente */
  }
}

/**
 * Área do quadro (React Flow) isolada num componente próprio só para poder
 * usar useReactFlow() — o hook exige estar dentro do <ReactFlowProvider>,
 * que envolve este componente lá embaixo em App().
 */
function FlowCanvas({ nodes, edges, onNodesChange, onEdgesChange, onConnect, onSelectNode, onDeselect, onCreateNodeAt }) {
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef(null);

  const handleDrop = useCallback(
    (event) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData(DRAG_MIME);
      if (!kind) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onCreateNodeAt(kind, position);
    },
    [screenToFlowPosition, onCreateNodeAt]
  );

  const handleDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <div className="canvas-drop-area" ref={wrapperRef} onDrop={handleDrop} onDragOver={handleDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={onDeselect}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'labeled' }}
        connectionLineStyle={{ stroke: '#25d366', strokeWidth: 3 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#243250" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="#25d366" maskColor="rgba(11,18,32,0.75)" />
      </ReactFlow>
    </div>
  );
}

export default function App() {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState({
    status: 'disconnected',
    phone: null,
    qr: null,
    stats: { received: 0, sent: 0 },
  });
  const [qrOpen, setQrOpen] = useState(false);
  const [conversationsOpen, setConversationsOpen] = useState(false);
  const [customersOpen, setCustomersOpen] = useState(false);
  const [handoffsOpen, setHandoffsOpen] = useState(false);
  const [liveMessage, setLiveMessage] = useState(null);
  const [liveHandoff, setLiveHandoff] = useState(null);
  const [liveHandoffResolved, setLiveHandoffResolved] = useState(null);
  const [pendingHandoffs, setPendingHandoffs] = useState([]);
  const [theme, setTheme] = useState(getInitialTheme);
  const { toasts, pushToast, dismissToast } = useToasts();

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const builder = await api.getBuilder();
        if (cancelled) return;
        setNodes((builder.nodes || []).map((n) => ({ ...n, type: 'message', data: { ...n.data } })));
        setEdges((builder.edges || []).map((e) => ({ ...e, type: 'labeled' })));
      } catch (err) {
        pushToast('error', `Falha ao carregar fluxo: ${err.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    api.getStatus().then(setStatus).catch(() => {});
    api.getHandoffs().then(setPendingHandoffs).catch(() => {});

    const closeSocket = connectSocket((message) => {
      if (message.type === 'status') setStatus(message.payload);
      if (message.type === 'message-log') setLiveMessage(message.payload);

      if (message.type === 'handoff') {
        const payload = message.payload;
        setPendingHandoffs((current) => [payload, ...current.filter((h) => h.jid !== payload.jid)]);
        setLiveHandoff(payload);
        pushToast('info', `🙋 +${payload.phone} quer falar com um atendente${payload.nodeTitle ? ` (${payload.nodeTitle})` : ''}!`);
        notifyDesktop('Atendimento solicitado', `+${payload.phone} quer falar com um atendente`);
      }

      if (message.type === 'handoff-resolved') {
        setPendingHandoffs((current) => current.filter((h) => h.jid !== message.payload.jid));
        setLiveHandoffResolved(message.payload);
      }
    });

    return () => {
      cancelled = true;
      closeSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNodesChange = useCallback((changes) => {
    setNodes((current) => applyNodeChanges(changes, current));
    // Ignora mudanças que o React Flow dispara sozinho ao medir/selecionar
    // nós (não são edições reais do usuário) para não marcar "não salvo"
    // logo após carregar um fluxo intocado.
    const isRealEdit = changes.some((c) => c.type !== 'dimensions' && c.type !== 'select');
    if (isRealEdit) setDirty(true);
  }, []);

  const onEdgesChange = useCallback((changes) => {
    setEdges((current) => applyEdgeChanges(changes, current));
    const isRealEdit = changes.some((c) => c.type !== 'select');
    if (isRealEdit) setDirty(true);
  }, []);

  const onConnect = useCallback(
    (params) => {
      // Nós de "Pergunta" só seguem para UM próximo passo (o painel mostra
      // "Depois de responder, segue para X"). Se já existir uma conexão
      // saindo desse nó, uma nova ligação SUBSTITUI a antiga em vez de
      // apenas se somar a ela — senão a ligação "sobrando" continuava
      // silenciosamente ativa e o motor sempre usava a primeira criada,
      // o que parecia um bug aleatório de "loop" para quem estava editando.
      const sourceKind = nodes.find((node) => node.id === params.source)?.data?.kind;
      const isSingleNext = sourceKind?.startsWith('input_');

      setEdges((current) => {
        const base = isSingleNext ? current.filter((edge) => edge.source !== params.source) : current;
        const nextTrigger = String(base.filter((edge) => edge.source === params.source).length + 1);
        return addEdge({ ...params, type: 'labeled', data: { trigger: nextTrigger } }, base);
      });
      setDirty(true);
    },
    [nodes]
  );

  const updateNodeData = useCallback((id, patch) => {
    setNodes((current) => current.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)));
    setDirty(true);
  }, []);

  const updateEdgeTrigger = useCallback((id, trigger) => {
    setEdges((current) => current.map((edge) => (edge.id === id ? { ...edge, data: { ...edge.data, trigger } } : edge)));
    setDirty(true);
  }, []);

  /** Cria um nó solto no quadro (arrastado ou clicado na paleta), sem conectar automaticamente —
   *  a ligação entre nós é feita manualmente pelas bordas, como no Typebot. */
  const createNodeAt = useCallback((kind, position) => {
    const id = generateId();
    const meta = KIND_META[kind];
    const data = { kind, title: meta?.label || 'Nova resposta', mensagem: '', mediaUrl: '' };
    if (meta?.group === 'input') data.variable = meta.defaultVariable;
    if (meta?.group === 'bubble') data.options = [];
    const newNode = { id, type: 'message', position, data };
    setNodes((current) => [...current, newNode]);
    setSelectedNodeId(id);
    setDirty(true);
  }, []);

  /** Clique na paleta (sem arrastar): cria o nó numa posição em cascata perto do centro do quadro. */
  const addNodeFromPalette = useCallback(
    (kind) => {
      createNodeAt(kind, { x: 240 + Math.random() * 240, y: 260 + Math.random() * 240 });
    },
    [createNodeAt]
  );

  /** "+ Adicionar botão" dentro de um balão: só cria o botão nomeado com seu
   *  próprio conector — a ligação até outro nó é sempre feita à mão pelo
   *  usuário arrastando a partir dele, como no Typebot. */
  const addNodeOption = useCallback((nodeId) => {
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== nodeId) return node;
        const options = Array.isArray(node.data.options) ? node.data.options : [];
        const newOption = { id: generateOptionId(), label: `Opção ${options.length + 1}` };
        return { ...node, data: { ...node.data, options: [...options, newOption] } };
      })
    );
    setDirty(true);
  }, []);

  const updateNodeOption = useCallback((nodeId, optionId, label) => {
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== nodeId) return node;
        const options = (node.data.options || []).map((option) =>
          option.id === optionId ? { ...option, label } : option
        );
        return { ...node, data: { ...node.data, options } };
      })
    );
    setDirty(true);
  }, []);

  const removeNodeOption = useCallback((nodeId, optionId) => {
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== nodeId) return node;
        const options = (node.data.options || []).filter((option) => option.id !== optionId);
        return { ...node, data: { ...node.data, options } };
      })
    );
    // Remove também a conexão que saía especificamente desse botão, se houver.
    setEdges((current) => current.filter((edge) => !(edge.source === nodeId && edge.sourceHandle === optionId)));
    setDirty(true);
  }, []);

  const deleteEdge = useCallback((edgeId) => {
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
    setDirty(true);
  }, []);

  /** Liga (ou troca) o destino de um botão pelo seletor do painel lateral —
   *  alternativa ao arrastar o conector do botão direto no quadro; as duas
   *  formas produzem exatamente a mesma conexão. */
  const setOptionTarget = useCallback((nodeId, optionId, targetNodeId) => {
    setEdges((current) => {
      const withoutOld = current.filter((edge) => !(edge.source === nodeId && edge.sourceHandle === optionId));
      if (!targetNodeId) return withoutOld;
      return [
        ...withoutOld,
        {
          id: `e-${nodeId}-${optionId}-${targetNodeId}`,
          source: nodeId,
          sourceHandle: optionId,
          target: targetNodeId,
          type: 'labeled',
        },
      ];
    });
    setDirty(true);
  }, []);

  const deleteNode = useCallback((id) => {
    if (id === 'start') return;
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    setSelectedNodeId((current) => (current === id ? null : current));
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await api.saveBuilder({ nodes, edges });
      setLastSavedAt(Date.now());
      setDirty(false);
      pushToast('success', 'Fluxo salvo e ativado com sucesso!');
    } catch (err) {
      pushToast('error', err.message);
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, pushToast]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;

  const nodesWithHandlers = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      selected: node.id === selectedNodeId,
      onDelete: () => deleteNode(node.id),
      onMensagemChange: (value) => updateNodeData(node.id, { mensagem: value }),
      onAddNodeOption: () => addNodeOption(node.id),
      onUpdateNodeOption: (optionId, label) => updateNodeOption(node.id, optionId, label),
      onRemoveNodeOption: (optionId) => removeNodeOption(node.id, optionId),
    },
  }));

  const edgesWithHandlers = edges.map((edge) => ({
    ...edge,
    data: {
      ...edge.data,
      onChange: (value) => updateEdgeTrigger(edge.id, value),
      onDelete: () => deleteEdge(edge.id),
    },
  }));

  return (
    <div className="app-shell">
      <Sidebar
        nodes={nodes}
        edges={edges}
        status={status}
        onAddNode={addNodeFromPalette}
        onOpenQr={() => setQrOpen(true)}
        onOpenConversations={() => setConversationsOpen(true)}
        onOpenCustomers={() => setCustomersOpen(true)}
        onOpenHandoffs={() => setHandoffsOpen(true)}
        pendingHandoffCount={pendingHandoffs.length}
      />

      <div className="app-main">
        <TopBar
          saving={saving}
          dirty={dirty}
          lastSavedAt={lastSavedAt}
          status={status}
          onSave={handleSave}
          onOpenQr={() => setQrOpen(true)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <div className="canvas-wrap">
          {loading ? (
            <div className="canvas-loading">Carregando fluxo…</div>
          ) : (
            <ReactFlowProvider>
              <FlowCanvas
                nodes={nodesWithHandlers}
                edges={edgesWithHandlers}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onSelectNode={setSelectedNodeId}
                onDeselect={() => setSelectedNodeId(null)}
                onCreateNodeAt={createNodeAt}
              />
            </ReactFlowProvider>
          )}
        </div>
      </div>

      {selectedNode && (
        <NodePanel
          node={selectedNode}
          edges={edges}
          nodes={nodes}
          onChange={(patch) => updateNodeData(selectedNode.id, patch)}
          onEdgeTriggerChange={updateEdgeTrigger}
          onSetOptionTarget={(optionId, targetNodeId) => setOptionTarget(selectedNode.id, optionId, targetNodeId)}
          onDelete={() => deleteNode(selectedNode.id)}
          onClose={() => setSelectedNodeId(null)}
        />
      )}

      <QRModal open={qrOpen} onClose={() => setQrOpen(false)} status={status} />
      <ConversationsModal open={conversationsOpen} onClose={() => setConversationsOpen(false)} liveMessage={liveMessage} />
      <CustomersModal open={customersOpen} onClose={() => setCustomersOpen(false)} pushToast={pushToast} />
      <HandoffsModal
        open={handoffsOpen}
        onClose={() => setHandoffsOpen(false)}
        liveHandoff={liveHandoff}
        liveHandoffResolved={liveHandoffResolved}
        pushToast={pushToast}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
