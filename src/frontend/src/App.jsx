import React, { useCallback, useEffect, useState } from 'react';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import TopBar from './components/TopBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import NodePanel from './components/NodePanel.jsx';
import QRModal from './components/QRModal.jsx';
import ToastStack, { useToasts } from './components/ToastStack.jsx';
import MessageNode from './components/nodes/MessageNode.jsx';
import LabeledEdge from './components/edges/LabeledEdge.jsx';
import { api, connectSocket } from './api.js';

const nodeTypes = { message: MessageNode };
const edgeTypes = { labeled: LabeledEdge };

let idCounter = 1;
const generateId = () => `no_${Date.now().toString(36)}_${idCounter++}`;

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
  const { toasts, pushToast, dismissToast } = useToasts();

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

    const closeSocket = connectSocket((message) => {
      if (message.type === 'status') setStatus(message.payload);
    });

    return () => {
      cancelled = true;
      closeSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNodesChange = useCallback((changes) => {
    setNodes((current) => applyNodeChanges(changes, current));
    setDirty(true);
  }, []);

  const onEdgesChange = useCallback((changes) => {
    setEdges((current) => applyEdgeChanges(changes, current));
    setDirty(true);
  }, []);

  const onConnect = useCallback((params) => {
    setEdges((current) => {
      const nextTrigger = String(current.filter((edge) => edge.source === params.source).length + 1);
      return addEdge({ ...params, type: 'labeled', data: { trigger: nextTrigger } }, current);
    });
    setDirty(true);
  }, []);

  const updateNodeData = useCallback((id, patch) => {
    setNodes((current) => current.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)));
    setDirty(true);
  }, []);

  const updateEdgeTrigger = useCallback((id, trigger) => {
    setEdges((current) => current.map((edge) => (edge.id === id ? { ...edge, data: { ...edge.data, trigger } } : edge)));
    setDirty(true);
  }, []);

  const addNode = useCallback(
    (fromId) => {
      const id = generateId();
      const source = fromId ? nodes.find((node) => node.id === fromId) : null;
      const position = source
        ? { x: source.position.x + 260, y: source.position.y + (Math.random() * 120 - 60) }
        : { x: 240 + Math.random() * 200, y: 260 + Math.random() * 200 };

      const newNode = { id, type: 'message', position, data: { title: 'Nova resposta', mensagem: '' } };
      setNodes((current) => [...current, newNode]);

      if (fromId) {
        const siblingCount = edges.filter((edge) => edge.source === fromId).length;
        setEdges((current) => [
          ...current,
          {
            id: `e-${fromId}-${id}`,
            source: fromId,
            target: id,
            type: 'labeled',
            data: { trigger: String(siblingCount + 1) },
          },
        ]);
      }

      setSelectedNodeId(id);
      setDirty(true);
    },
    [nodes, edges]
  );

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
      onAddOption: () => addNode(node.id),
      onDelete: () => deleteNode(node.id),
    },
  }));

  const edgesWithHandlers = edges.map((edge) => ({
    ...edge,
    data: { ...edge.data, onChange: (value) => updateEdgeTrigger(edge.id, value) },
  }));

  return (
    <div className="app-shell">
      <Sidebar
        nodes={nodes}
        edges={edges}
        status={status}
        onAddNode={() => addNode(null)}
        onOpenQr={() => setQrOpen(true)}
      />

      <div className="app-main">
        <TopBar
          saving={saving}
          dirty={dirty}
          lastSavedAt={lastSavedAt}
          status={status}
          onSave={handleSave}
          onOpenQr={() => setQrOpen(true)}
        />

        <div className="canvas-wrap">
          {loading ? (
            <div className="canvas-loading">Carregando fluxo…</div>
          ) : (
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodesWithHandlers}
                edges={edgesWithHandlers}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                onPaneClick={() => setSelectedNodeId(null)}
                fitView
                proOptions={{ hideAttribution: true }}
                defaultEdgeOptions={{ type: 'labeled' }}
              >
                <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#243250" />
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable nodeColor="#25d366" maskColor="rgba(11,18,32,0.75)" />
              </ReactFlow>
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
          onDelete={() => deleteNode(selectedNode.id)}
          onClose={() => setSelectedNodeId(null)}
        />
      )}

      <QRModal open={qrOpen} onClose={() => setQrOpen(false)} status={status} />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
