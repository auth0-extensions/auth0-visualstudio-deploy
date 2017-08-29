const tools = require('auth0-extension-express-tools');

const expressApp = require('./server');
const logger = require('./server/lib/logger');

const createServer = tools.createServer((cfg, storage) => {
  logger.info('Starting Visual Studio Team Services Deploy extension - Version:', process.env.CLIENT_VERSION);
  return expressApp(cfg, storage);
});


module.exports = (context, req, res) => {
  createServer(context, req, res);
};
