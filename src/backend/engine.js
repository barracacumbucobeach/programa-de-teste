'use strict';

const { createServer } = require('./server');
const WhatsAppConnection = require('./whatsapp');
const FlowEngine = require('./flowEngine');
const ConversationLog = require('./conversationLog');
const CustomerStore = require('./customerStore');
const store = require('./store');
const { createLogger } = require('./logger');

const logger = createLogger('engine');
const PORT = process.env.PORT || 4477;

async function main() {
  store.ensureDataDir();

  const customerStore = new CustomerStore();
  const flowEngine = new FlowEngine(customerStore);
  const conversationLog = new ConversationLog();
  const whatsapp = new WhatsAppConnection(flowEngine, conversationLog);

  const { server } = createServer({ whatsapp, flowEngine, conversationLog, customerStore });

  server.listen(PORT, () => {
    logger.info(`🚀 AutoFlow Desktop — motor ouvindo em http://localhost:${PORT}`);
    logger.info('   Abra o construtor visual (npm run dev:frontend) para editar o fluxo e ler o QR Code.');
  });

  await whatsapp.start();

  const shutdown = () => {
    logger.info('👋 Encerrando AutoFlow Desktop...');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('Erro fatal ao iniciar o motor:', err);
  process.exit(1);
});
