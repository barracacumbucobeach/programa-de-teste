'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const AUTH_DIR = path.join(DATA_DIR, 'auth_session');
const BUILDER_FILE = path.join(DATA_DIR, 'fluxo_builder.json');
const FLOW_FILE = path.join(DATA_DIR, 'fluxo_bot.json');
const STATE_FILE = path.join(DATA_DIR, 'estado_clientes.json');

/** Fluxo mínimo usado apenas se a pasta data/ estiver vazia. */
const DEFAULT_BUILDER = {
  nodes: [
    {
      id: 'start',
      type: 'message',
      position: { x: 360, y: 60 },
      data: {
        title: 'Início',
        mensagem: 'Olá! 👋 Como posso te ajudar?\n\n1 - Falar com um atendente',
      },
    },
    {
      id: 'no_atendente',
      type: 'message',
      position: { x: 360, y: 320 },
      data: {
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

    compiled[node.id] = {
      mensagem: (node.data?.mensagem || '').trim(),
      opcoes,
    };
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

module.exports = {
  DATA_DIR,
  AUTH_DIR,
  BUILDER_FILE,
  FLOW_FILE,
  STATE_FILE,
  ensureDataDir,
  loadBuilder,
  saveBuilder,
  compileGraph,
  loadFlow,
  loadClientState,
  saveClientStateDebounced,
};
