'use strict';

const fs = require('fs');
const path = require('path');

// Em desenvolvimento os dados ficam em <projeto>/data. Quando empacotado em
// Electron, main.js define AUTOFLOW_DATA_DIR apontando para uma pasta
// gravável do usuário (app.getPath('userData')), já que o app instalado
// costuma ficar num diretório somente leitura.
const DATA_DIR = process.env.AUTOFLOW_DATA_DIR
  ? path.resolve(process.env.AUTOFLOW_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const AUTH_DIR = path.join(DATA_DIR, 'auth_session');
const BUILDER_FILE = path.join(DATA_DIR, 'fluxo_builder.json');
const FLOW_FILE = path.join(DATA_DIR, 'fluxo_bot.json');
const STATE_FILE = path.join(DATA_DIR, 'estado_clientes.json');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversas.jsonl');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'clientes.json');

/** Fluxo mínimo usado apenas se a pasta data/ estiver vazia. */
const DEFAULT_BUILDER = {
  nodes: [
    {
      id: 'start',
      type: 'message',
      position: { x: 360, y: 60 },
      data: {
        kind: 'text',
        title: 'Início',
        mensagem: 'Olá! 👋 Como posso te ajudar?\n\n1 - Falar com um atendente',
      },
    },
    {
      id: 'no_atendente',
      type: 'message',
      position: { x: 360, y: 320 },
      data: {
        kind: 'text',
        title: 'Atendente',
        mensagem: 'Perfeito! Já vou te encaminhar para um de nossos atendentes.',
      },
    },
  ],
  edges: [
    {
      id: 'e-start-atendente',
      source: 'start',
      target: 'no_atendente',
      type: 'labeled',
      data: { trigger: '1' },
    },
  ],
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf-8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`⚠️  Falha ao ler ${file}:`, err.message);
    return fallback;
  }
}

function writeJSONAtomic(file, data) {
  ensureDataDir();
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

function loadBuilder() {
  return readJSON(BUILDER_FILE, null) || DEFAULT_BUILDER;
}

function validateGraph(graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('Estrutura de fluxo inválida.');
  }
  if (!graph.nodes.some((n) => n.id === 'start')) {
    throw new Error('O fluxo precisa de um nó inicial chamado "start".');
  }
}

const MESSAGE_KINDS = new Set(['text', 'image', 'video', 'audio']);
const INPUT_KINDS = new Set(['input_text', 'input_number', 'input_email', 'input_phone']);
const VALID_KINDS = new Set([...MESSAGE_KINDS, ...INPUT_KINDS]);

/** Converte o grafo visual (nós + conexões) no formato usado pelo motor de execução. */
function compileGraph(graph) {
  const compiled = {};

  for (const node of graph.nodes) {
    const outgoing = graph.edges.filter((edge) => edge.source === node.id);
    const opcoes = {};

    outgoing.forEach((edge) => {
      const gatilho = String(edge.data?.trigger ?? edge.label ?? '1').trim();
      if (gatilho) opcoes[gatilho] = edge.target;
    });

    const kind = VALID_KINDS.has(node.data?.kind) ? node.data.kind : 'text';

    compiled[node.id] = {
      kind,
      mensagem: (node.data?.mensagem || '').trim(),
      mediaUrl: (node.data?.mediaUrl || '').trim(),
      opcoes,
    };

    if (INPUT_KINDS.has(kind)) {
      compiled[node.id].variable = (node.data?.variable || '').trim() || 'resposta';
      // Nó de pergunta: segue sempre para a primeira (única) conexão de saída,
      // independentemente do texto que o cliente responder.
      compiled[node.id].next = outgoing[0]?.target || null;
    }
  }

  return compiled;
}

function saveBuilder(graph) {
  validateGraph(graph);
  writeJSONAtomic(BUILDER_FILE, graph);
  const compiled = compileGraph(graph);
  writeJSONAtomic(FLOW_FILE, compiled);
  return compiled;
}

function loadFlow() {
  return readJSON(FLOW_FILE, null) || compileGraph(loadBuilder());
}

function loadClientState() {
  return readJSON(STATE_FILE, {});
}

let saveStateTimer = null;
function saveClientStateDebounced(state) {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(() => writeJSONAtomic(STATE_FILE, state), 800);
}

function loadCustomersRaw() {
  return readJSON(CUSTOMERS_FILE, {});
}

let saveCustomersTimer = null;
function saveCustomersDebounced(customers) {
  clearTimeout(saveCustomersTimer);
  saveCustomersTimer = setTimeout(() => writeJSONAtomic(CUSTOMERS_FILE, customers), 500);
}

module.exports = {
  DATA_DIR,
  AUTH_DIR,
  BUILDER_FILE,
  FLOW_FILE,
  STATE_FILE,
  CONVERSATIONS_FILE,
  CUSTOMERS_FILE,
  MESSAGE_KINDS,
  INPUT_KINDS,
  ensureDataDir,
  loadBuilder,
  saveBuilder,
  compileGraph,
  loadFlow,
  loadClientState,
  saveClientStateDebounced,
  loadCustomersRaw,
  saveCustomersDebounced,
};
