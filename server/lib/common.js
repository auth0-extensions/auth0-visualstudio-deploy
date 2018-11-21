import path from 'path';
import { getPersonalAccessTokenHandler, getBasicHandler, WebApi } from 'vso-node-api';
import { constants } from 'auth0-source-control-extension-tools';

import config from './config';

const getApi = () => {
  const apiType = config('TFS_TYPE') === 'git' ? 'getGitApi' : 'getTfvcApi';
  const collectionURL = `https://${config('TFS_INSTANCE')}.visualstudio.com/${config('TFS_COLLECTION')}`;
  const vsCredentials = config('TFS_AUTH_METHOD') === 'pat' ?
    getPersonalAccessTokenHandler(config('TFS_TOKEN')) :
    getBasicHandler(config('TFS_USERNAME'), config('TFS_PASSWORD'));
  const vsConnection = new WebApi(collectionURL, vsCredentials);
  return vsConnection[apiType]();
};

const getBaseDir = () => {
  let baseDir = config('BASE_DIR') || '';
  if (baseDir.startsWith('/')) baseDir = baseDir.slice(1);
  if (baseDir !== '' && !baseDir.endsWith('/')) baseDir += '/';
  return baseDir;
};

const getPrefix = () =>
  (config('TFS_TYPE') === 'git' ? getBaseDir() : config('TFS_PATH'));

/*
 * Check if a file is part of the rules folder.
 */
const isRule = (file) =>
  file.indexOf(`${path.join(getPrefix(), constants.RULES_DIRECTORY)}/`) === 0;

/*
 * Check if a file is part of the database folder.
 */
const isDatabaseConnection = (file) =>
  file.indexOf(`${path.join(getPrefix(), constants.DATABASE_CONNECTIONS_DIRECTORY)}/`) === 0;

/*
 * Check if a file is part of the templates folder - emails or pages.
 */
const isTemplate = (file, dir, allowedNames) =>
  file.indexOf(`${path.join(getPrefix(), dir)}/`) === 0 && allowedNames.indexOf(file.split('/').pop()) >= 0;

/*
 * Check if a file is part of the pages folder.
 */
const isEmailProvider = (file) =>
  file === path.join(getPrefix(), constants.EMAIL_TEMPLATES_DIRECTORY, 'provider.json');

/*
 * Check if a file is part of configurable folder.
 */
const isConfigurable = (file, directory) =>
  file.indexOf(`${path.join(getPrefix(), directory)}/`) === 0;

/*
 * Get the details of a database file script.
 */
const getDatabaseScriptDetails = (filename) => {
  if (config('TFS_TYPE') !== 'git') {
    filename = filename.replace(`${config('TFS_PATH')}/`, '');
  }

  const parts = filename.split('/');
  if (parts.length === 3 && /\.js$/i.test(parts[2])) {
    const scriptName = path.parse(parts[2]).name;
    if (constants.DATABASE_SCRIPTS.indexOf(scriptName) > -1) {
      return {
        database: parts[1],
        name: path.parse(scriptName).name
      };
    }
  }

  return null;
};

/*
 * Only Javascript and JSON files.
 */
const validFilesOnly = (fileName) => {
  if (isTemplate(fileName, constants.PAGES_DIRECTORY, constants.PAGE_NAMES)) {
    return true;
  } else if (isTemplate(fileName, constants.EMAIL_TEMPLATES_DIRECTORY, constants.EMAIL_TEMPLATES_NAMES)) {
    return true;
  } else if (isEmailProvider(fileName)) {
    return true;
  } else if (isRule(fileName)) {
    return /\.(js|json)$/i.test(fileName);
  } else if (isConfigurable(fileName, constants.CLIENTS_DIRECTORY)) {
    return /\.(js|json)$/i.test(fileName);
  } else if (isConfigurable(fileName, constants.CLIENTS_GRANTS_DIRECTORY)) {
    return /\.(js|json)$/i.test(fileName);
  } else if (isConfigurable(fileName, constants.CONNECTIONS_DIRECTORY)) {
    return /\.(js|json)$/i.test(fileName);
  } else if (isConfigurable(fileName, constants.RESOURCE_SERVERS_DIRECTORY)) {
    return /\.(js|json)$/i.test(fileName);
  } else if (isConfigurable(fileName, constants.RULES_CONFIGS_DIRECTORY)) {
    return /\.(js|json)$/i.test(fileName);
  } else if (isDatabaseConnection(fileName)) {
    const script = getDatabaseScriptDetails(fileName);
    return !!script;
  }

  return false;
};

module.exports = {
  getApi,
  getPrefix,
  isRule,
  isDatabaseConnection,
  isTemplate,
  isEmailProvider,
  isConfigurable,
  getDatabaseScriptDetails,
  validFilesOnly
};
