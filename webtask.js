const tools = require('auth0-extension-tools');

const config = require('./server/lib/config');
const expressApp = require('./server');
const logger = require('./server/lib/logger');

module.exports = tools.createExpressServer(function(req, configProvider) {
  logger.info('Starting Delegated Administration extension - Version:', config('CLIENT_VERSION'));
  config.setProvider(configProvider);
  return expressApp();
});