'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, shell } = require('electron');

const DEV_URL = 'http://localhost:5173';
const DIST_INDEX = path.join(__dirname, '..', 'dist', 'index.html');

// Sem dist/index.html gerado (npm run build:frontend), assume-se que estamos
// em desenvolvimento e que o Vite já está rodando em DEV_URL (via `npm run
// electron:dev`, que sobe motor + builder + Electron juntos).
const isDev = !fs.existsSync(DIST_INDEX);

let mainWindow;

/**
 * O app já se chamou "AutoFlow Desktop" antes de virar "Fluxia" — como a
 * pasta de dados do usuário (fluxos salvos, conexão do WhatsApp, clientes,
 * conversas...) mora dentro de uma pasta com o nome do app, uma troca de
 * nome sozinha faria o Windows/Linux/Mac criar uma pasta nova vazia e
 * "esconder" tudo que já existia, inclusive a sessão do WhatsApp já pareada
 * (obrigando a escanear o QR code de novo). Antes de semear os dados
 * padrão, se a pasta nova ainda não existe mas a pasta do nome antigo
 * existe, migra tudo de uma vez — só roda na primeira execução com o nome
 * novo, nunca sobrescreve nada que já esteja na pasta nova.
 */
function migrateFromOldAppName(userDataDir) {
  if (fs.existsSync(userDataDir)) return; // já rodou com o nome novo antes

  const oldUserDataDir = path.join(path.dirname(app.getPath('userData')), 'AutoFlow Desktop', 'data');
  if (!fs.existsSync(oldUserDataDir)) return; // instalação nova, nunca teve o nome antigo

  fs.mkdirSync(path.dirname(userDataDir), { recursive: true });
  fs.cpSync(oldUserDataDir, userDataDir, { recursive: true });
}

/**
 * Copia o fluxo de exemplo (data/fluxo_builder.json e fluxo_bot.json,
 * empacotados dentro do app) para a pasta gravável do usuário na primeira
 * execução, sem nunca sobrescrever um fluxo que o usuário já tenha salvo.
 */
function seedUserData(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });

  const seeds = ['fluxo_builder.json', 'fluxo_bot.json'];
  for (const name of seeds) {
    const dest = path.join(userDataDir, name);
    const source = path.join(__dirname, '..', 'data', name);
    if (!fs.existsSync(dest) && fs.existsSync(source)) {
      fs.copyFileSync(source, dest);
    }
  }
}

/** Inicia o motor local (API + conexão WhatsApp) dentro do processo do Electron. */
function startEngine() {
  const userDataDir = path.join(app.getPath('userData'), 'data');
  migrateFromOldAppName(userDataDir);
  seedUserData(userDataDir);
  process.env.AUTOFLOW_DATA_DIR = userDataDir;

  // engine.js dispara sua própria inicialização assim que é importado.
  require('../src/backend/engine');
}

function loadWithRetry(win, url, attempt = 0) {
  win.loadURL(url).catch(() => {
    if (attempt >= 40) return; // ~20s tentando — desiste e deixa a tela em branco/erro
    setTimeout(() => loadWithRetry(win, url, attempt + 1), 500);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(null);

  if (isDev) {
    loadWithRetry(mainWindow, DEV_URL);
  } else {
    mainWindow.loadFile(DIST_INDEX);
  }

  // Links externos (ex.: um link de catálogo clicado por engano) abrem no
  // navegador padrão do sistema em vez de dentro da janela do app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Em desenvolvimento o motor já roda como processo separado
  // (`npm run start:engine`, disparado pelo script `electron:dev`).
  if (!isDev) {
    startEngine();
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
