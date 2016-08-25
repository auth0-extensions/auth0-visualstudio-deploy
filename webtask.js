const tools = require('auth0-extension-tools');

const config = require('./server/lib/config');
const expressApp = require('./server');

module.exports = tools.createExpressServer(function(req, configProvider) {
  config.setProvider(configProvider);
  return expressApp();
});