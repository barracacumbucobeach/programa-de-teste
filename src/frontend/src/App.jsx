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
import SettingsModal from './components/SettingsModal.jsx';
import ToastStack, { useToasts } from './components/ToastStack.jsx';
import MessageNode, { KIND_META } from './components/nodes/MessageNode.jsx';
import LabeledEdge from './components/edges/LabeledEdge.jsx';
import { api, connectSocket } from './api.js';
import { getInitialTheme, applyTheme } from './theme.js';

const nodeTypes = { message: MessageNode };
const edgeTypes = { labeled: LabeledEdge };

let idCounter = 1;
const generateId = () => `no_${Date.now().toString(36)}_${idCounter++}`;

let stepIdCounter = 1;
const generateStepId = () => `step_${Date.now().toString(36)}_${stepIdCounter++}`;

let optionIdCounter = 1;
const generateOptionId = () => `opt_${Date.now().toString(36)}_${optionIdCounter++}`;

/**
 * Cada nó do quadro é um "grupo" (estilo Typebot): uma pilha de balões
 * dentro do mesmo cartão (`data.steps`), com uma ligação de entrada só
 * (sempre pelo primeiro balão) e saídas só a partir do último balão da
 * pilha (continuação natural) ou de um botão nomeado em qualquer balão.
 *
 * Fluxos salvos antes dessa mudança guardavam um balão só, direto em
 * `data` (sem `data.steps`) — normalizeGroupNode() envolve esse formato
 * antigo numa pilha de um balão só, reaproveitando o próprio id do nó
 * como id do balão, pra bater com o mesmo esquema usado no backend
 * (store.js) e não precisar reescrever nenhuma ligação já salva.
 */
function normalizeGroupNode(node) {
  if (Array.isArray(node.data?.steps)) return node;
  const { title, kind, mensagem, mediaUrl, variable, mensagemRetorno, options } = node.data || {};
  return {
    ...node,
    data: {
      title: title || '',
      steps: [
        {
          id: node.id,
          kind: kind || 'text',
          mensagem: mensagem || '',
          mediaUrl: mediaUrl || '',
          variable,
          mensagemRetorno,
          options: Array.isArray(options) ? options : [],
        },
      ],
    },
  };
}

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
      {/* Seta usada no fim de toda ligação (LabeledEdge referencia por id) —
          definida uma vez aqui fora, com cor via CSS (classe, não atributo),
          pra acompanhar o tema em vez de ficar travada numa cor fixa. */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <marker
            id="autoflow-edge-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="18"
            markerHeight="18"
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="autoflow-edge-arrow-fill" />
          </marker>
        </defs>
      </svg>
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
        connectionLineType="smoothstep"
        // Raio de "ímã" ao redor de cada conector — sem isso, era preciso soltar o
        // mouse quase em cima do pontinho verde pra a ligação realmente pegar, o
        // que foi relatado como difícil de acertar. Com um raio maior, soltar perto
        // do conector já é suficiente.
        connectionRadius={35}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#243250" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor="#25d366"
          maskColor="rgba(11,18,32,0.75)"
          bgColor="var(--bg-panel-alt)"
        />
      </ReactFlow>
    </div>
  );
}

export default function App() {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedStepId, setSelectedStepId] = useState(null);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
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
        setNodes((builder.nodes || []).map((n) => normalizeGroupNode({ ...n, type: 'message' })));
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

  const onConnect = useCallback((params) => {
    // Uma ligação "solta" (puxada do conector de baixo do grupo — que só
    // existe no ÚLTIMO balão da pilha) representa o próximo passo natural
    // do grupo — segue sempre, sem número, sem asterisco, sem nada pra
    // configurar. Como só faz sentido UM próximo passo natural por grupo,
    // uma nova ligação assim SUBSTITUI a anterior (se houver) em vez de se
    // somar a ela.
    //
    // Só vira uma escolha numerada quando o balão tem botões nomeados
    // (cada um com seu próprio conector e seu próprio número, podendo estar
    // em QUALQUER balão da pilha, não só o último) — esses continuam
    // podendo se somar à vontade, indo e voltando quantas vezes for
    // preciso, inclusive para um grupo anterior no fluxo.
    const isFreeConnection = !params.sourceHandle;

    setEdges((current) => {
      const base = isFreeConnection
        ? current.filter((edge) => edge.source !== params.source || edge.sourceHandle)
        : current;
      return addEdge({ ...params, type: 'labeled', data: {} }, base);
    });
    setDirty(true);
  }, []);

  /** Seleciona um GRUPO inteiro (clique em qualquer parte do cartão que não
   *  seja um balão específico) — o painel abre editando o primeiro balão. */
  const selectGroup = useCallback((nodeId) => {
    setSelectedNodeId(nodeId);
    setSelectedStepId(null);
  }, []);

  /** Seleciona um balão específico dentro de um grupo (clique na linha
   *  daquele balão, dentro do cartão empilhado). */
  const selectStep = useCallback((nodeId, stepId) => {
    setSelectedNodeId(nodeId);
    setSelectedStepId(stepId);
  }, []);

  const updateGroupTitle = useCallback((nodeId, title) => {
    setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, title } } : node)));
    setDirty(true);
  }, []);

  const updateStepData = useCallback((nodeId, stepId, patch) => {
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== nodeId) return node;
        const steps = node.data.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step));
        return { ...node, data: { ...node.data, steps } };
      })
    );
    setDirty(true);
  }, []);

  /** Cria um grupo novo no quadro (arrastado ou clicado na paleta), com um
   *  balão só — a ligação até outro grupo é sempre feita à mão pelo
   *  usuário arrastando a partir das bordas, como no Typebot. */
  const createNodeAt = useCallback((kind, position) => {
    const groupId = generateId();
    const meta = KIND_META[kind];
    const stepId = generateStepId();
    const step = { id: stepId, kind, mensagem: '', mediaUrl: '' };
    if (meta?.group === 'input') step.variable = meta.defaultVariable;
    if (meta?.group === 'bubble') step.options = [];
    const newNode = { id: groupId, type: 'message', position, data: { title: '', steps: [step] } };
    setNodes((current) => [...current, newNode]);
    setSelectedNodeId(groupId);
    setSelectedStepId(stepId);
    setDirty(true);
  }, []);

  /** Clique na paleta (sem arrastar): cria o grupo numa posição em cascata perto do centro do quadro. */
  const addNodeFromPalette = useCallback(
    (kind) => {
      createNodeAt(kind, { x: 240 + Math.random() * 240, y: 260 + Math.random() * 240 });
    },
    [createNodeAt]
  );

  /** "+ Adicionar balão" no rodapé do cartão: empilha mais um balão dentro
   *  do MESMO grupo — é assim que se constrói uma sequência, sem precisar
   *  criar um nó novo nem desenhar uma ligação pra cada mensagem. */
  const addStep = useCallback((nodeId, kind = 'text') => {
    const meta = KIND_META[kind];
    const stepId = generateStepId();
    const newStep = { id: stepId, kind, mensagem: '', mediaUrl: '' };
    if (meta?.group === 'input') newStep.variable = meta.defaultVariable;
    if (meta?.group === 'bubble') newStep.options = [];
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, steps: [...node.data.steps, newStep] } } : node
      )
    );
    setSelectedNodeId(nodeId);
    setSelectedStepId(stepId);
    setDirty(true);
  }, []);

  /** Apaga um balão específico da pilha. Se for o único balão do grupo,
   *  apaga o grupo inteiro (igual excluir um nó, como sempre funcionou) —
   *  o balão de entrada do grupo "Início" nunca pode ser removido assim,
   *  já que é ele que recebe a primeira mensagem de qualquer cliente. */
  const deleteStep = useCallback(
    (nodeId, stepId) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const steps = node.data.steps;
      const isOnlyStep = steps.length <= 1;
      if (nodeId === 'start' && (isOnlyStep || steps[0].id === stepId)) return;

      if (isOnlyStep) {
        setNodes((current) => current.filter((n) => n.id !== nodeId));
        setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
      } else {
        const removedStep = steps.find((s) => s.id === stepId);
        const removedOptionIds = new Set((removedStep?.options || []).map((o) => o.id));
        setNodes((current) =>
          current.map((n) =>
            n.id === nodeId ? { ...n, data: { ...n.data, steps: n.data.steps.filter((s) => s.id !== stepId) } } : n
          )
        );
        setEdges((current) => current.filter((edge) => !(edge.source === nodeId && removedOptionIds.has(edge.sourceHandle))));
      }
      setSelectedStepId(null);
      setDirty(true);
    },
    [nodes]
  );

  /** Apaga o grupo inteiro (todos os balões da pilha de uma vez). */
  const deleteGroup = useCallback((nodeId) => {
    if (nodeId === 'start') return;
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedNodeId((current) => (current === nodeId ? null : current));
    setSelectedStepId(null);
    setDirty(true);
  }, []);

  /** "+ Adicionar botão" num balão: só cria o botão nomeado com seu próprio
   *  conector — a ligação até outro grupo é sempre feita à mão pelo
   *  usuário arrastando a partir dele, como no Typebot. */
  const addStepOption = useCallback((nodeId, stepId) => {
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== nodeId) return node;
        const steps = node.data.steps.map((step) => {
          if (step.id !== stepId) return step;
          const options = Array.isArray(step.options) ? step.options : [];
          const newOption = { id: generateOptionId(), label: `Opção ${options.length + 1}` };
          return { ...step, options: [...options, newOption] };
        });
        return { ...node, data: { ...node.data, steps } };
      })
    );
    setDirty(true);
  }, []);

  const updateStepOption = useCallback((nodeId, stepId, optionId, label) => {
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== nodeId) return node;
        const steps = node.data.steps.map((step) =>
          step.id !== stepId ? step : { ...step, options: (step.options || []).map((o) => (o.id === optionId ? { ...o, label } : o)) }
        );
        return { ...node, data: { ...node.data, steps } };
      })
    );
    setDirty(true);
  }, []);

  const removeStepOption = useCallback((nodeId, stepId, optionId) => {
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== nodeId) return node;
        const steps = node.data.steps.map((step) =>
          step.id !== stepId ? step : { ...step, options: (step.options || []).filter((o) => o.id !== optionId) }
        );
        return { ...node, data: { ...node.data, steps } };
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
   *  formas produzem exatamente a mesma conexão. O id do botão já é único
   *  em todo o fluxo, então não precisa saber a qual balão da pilha ele
   *  pertence pra ligar certo. */
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
  const selectedSteps = selectedNode?.data?.steps || [];
  const activeStepId = selectedStepId && selectedSteps.some((s) => s.id === selectedStepId) ? selectedStepId : selectedSteps[0]?.id;
  const selectedStep = selectedSteps.find((s) => s.id === activeStepId) || null;

  const nodesWithHandlers = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      selected: node.id === selectedNodeId,
      selectedStepId: node.id === selectedNodeId ? activeStepId : null,
      onSelectStep: (stepId) => selectStep(node.id, stepId),
      onDeleteGroup: () => deleteGroup(node.id),
      onAddStep: (kind) => addStep(node.id, kind),
      onDeleteStep: (stepId) => deleteStep(node.id, stepId),
      onStepMensagemChange: (stepId, value) => updateStepData(node.id, stepId, { mensagem: value }),
      onAddStepOption: (stepId) => addStepOption(node.id, stepId),
      onUpdateStepOption: (stepId, optionId, label) => updateStepOption(node.id, stepId, optionId, label),
      onRemoveStepOption: (stepId, optionId) => removeStepOption(node.id, stepId, optionId),
    },
  }));

  const edgesWithHandlers = edges.map((edge) => ({
    ...edge,
    data: {
      ...edge.data,
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
        onOpenSettings={() => setSettingsOpen(true)}
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
                onSelectNode={selectGroup}
                onDeselect={() => setSelectedNodeId(null)}
                onCreateNodeAt={createNodeAt}
              />
            </ReactFlowProvider>
          )}
        </div>
      </div>

      {selectedNode && selectedStep && (
        <NodePanel
          node={selectedNode}
          step={selectedStep}
          isLastStep={selectedSteps[selectedSteps.length - 1]?.id === selectedStep.id}
          edges={edges}
          nodes={nodes}
          onChangeGroupTitle={(title) => updateGroupTitle(selectedNode.id, title)}
          onChangeStep={(patch) => updateStepData(selectedNode.id, selectedStep.id, patch)}
          onSetOptionTarget={(optionId, targetNodeId) => setOptionTarget(selectedNode.id, optionId, targetNodeId)}
          onDeleteStep={() => deleteStep(selectedNode.id, selectedStep.id)}
          onDeleteGroup={() => deleteGroup(selectedNode.id)}
          onClose={() => setSelectedNodeId(null)}
        />
      )}

      <QRModal open={qrOpen} onClose={() => setQrOpen(false)} status={status} />
      <ConversationsModal
        open={conversationsOpen}
        onClose={() => setConversationsOpen(false)}
        liveMessage={liveMessage}
        pushToast={pushToast}
      />
      <CustomersModal open={customersOpen} onClose={() => setCustomersOpen(false)} pushToast={pushToast} />
      <HandoffsModal
        open={handoffsOpen}
        onClose={() => setHandoffsOpen(false)}
        liveHandoff={liveHandoff}
        liveHandoffResolved={liveHandoffResolved}
        pushToast={pushToast}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} pushToast={pushToast} />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
