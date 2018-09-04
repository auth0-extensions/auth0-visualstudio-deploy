import _ from 'lodash';
import path from 'path';
import Promise from 'bluebird';
import { getPersonalAccessTokenHandler, getBearerHandler, WebApi } from 'vso-node-api';
import VsoOAuth2 from 'node-oauth2-vso';
import request from 'request-promise';
import { constants, unifyDatabases, unifyScripts } from 'auth0-source-control-extension-tools';

import config from './config';
import logger from '../lib/logger';


/*
 * TFS API connection
 */
let tfvcApi = null;

const getCredentials = () =>
  new Promise((resolve, reject) => {
    if (config('TFS_AUTH_METHOD') === 'pat') {
      return resolve(getPersonalAccessTokenHandler(config('TFS_TOKEN')));
    }

    const vsoOAuth2 = new VsoOAuth2(config('TFS_CLIENT_ID'),
      config('TFS_CLIENT_SECRET'),
      '',
      'https://app.vssps.visualstudio.com/oauth2/authorize',
      'https://app.vssps.visualstudio.com/oauth2/token');
    return vsoOAuth2.getOAuthAccessToken('', null, (err, token) => {
      if (err) {
        return reject(err);
      }

      return resolve(getBearerHandler(token));
    });
  });

const getApi = () => {
  if (!tfvcApi) {
    const collectionURL = `https://${config('TFS_INSTANCE')}.visualstudio.com/${config('TFS_COLLECTION')}`;
    return getCredentials()
      .then((vsCredentials) => {
        const vsConnection = new WebApi(collectionURL, vsCredentials);
        return vsConnection.getTfvcApi()
          .then((api) => {
            tfvcApi = api;
            return tfvcApi;
          });
      });
  }

  return Promise.resolve(tfvcApi);
};

/*
 * Check if a file is part of the rules folder.
 */
const isRule = (file) =>
  file.indexOf(`${config('TFS_PATH')}/${constants.RULES_DIRECTORY}/`) === 0;

/*
 * Check if a file is part of the database folder.
 */
const isDatabaseConnection = (file) =>
  file.indexOf(`${config('TFS_PATH')}/${constants.DATABASE_CONNECTIONS_DIRECTORY}/`) === 0;

/*
 * Check if a file is part of the pages folder.
 */
const isPage = (file) =>
  file.indexOf(`${config('TFS_PATH')}/${constants.PAGES_DIRECTORY}/`) === 0
  && constants.PAGE_NAMES.indexOf(file.split('/').pop()) >= 0;

/*
 * Check if a file is part of configurable folder.
 */
const isConfigurable = (file, directory) =>
  file.indexOf(`${config('TFS_PATH')}/${directory}/`) === 0;

/*
 * Get the details of a database file script.
 */
const getDatabaseScriptDetails = (filename) => {
  const parts = filename.replace(`${config('TFS_PATH')}/`, '').split('/');
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
  if (isPage(fileName)) {
    return true;
  } else if (isDatabaseConnection(fileName)) {
    const script = getDatabaseScriptDetails(fileName);
    return !!script;
  } else if (isRule(fileName)
    || isConfigurable(fileName, constants.CLIENTS_DIRECTORY)
    || isConfigurable(fileName, constants.RESOURCE_SERVERS_DIRECTORY)
    || isConfigurable(fileName, constants.RULES_CONFIGS_DIRECTORY)) {
    return /\.(js|json)$/i.test(fileName);
  }
  return false;
};

/*
 * Get a flat list of changes and files that need to be added/updated/removed.
 */
export const hasChanges = (changesetId) =>
  getApi()
    .then(
      api => api.getChangesetChanges(changesetId).then(data =>
        _.chain(data)
          .map(file => file.item.path)
          .flattenDeep()
          .uniq()
          .filter(validFilesOnly)
          .value()
          .length > 0)
    );


/*
 * Get configurables tree.
 */
const getConfigurableTree = (project, directory) =>
  new Promise((resolve, reject) => {
    try {
      getApi()
        .then(api => api.getItems(project, `${config('TFS_PATH')}/${directory}`))
        .then(data => {
          if (!data) {
            return resolve([]);
          }

          const files = data
            .filter(f => f.size)
            .filter(f => validFilesOnly(f.path));

          return resolve(files);
        })
        .catch(e => reject(e));
    } catch (e) {
      reject(e);
    }
  });

/*
 * Get connection files for one db connection
 */
const getConnectionTreeByPath = (project, branch, filePath) =>
  new Promise((resolve, reject) => {
    try {
      getApi()
        .then(api => api.getItems(project, filePath))
        .then(data => {
          if (!data) {
            return resolve([]);
          }

          const files = data
            .filter(f => f.size)
            .filter(f => validFilesOnly(f.path));

          return resolve(files);
        });
    } catch (e) {
      reject(e);
    }
  });

/*
 * Get all files for all database-connections.
 */
const getConnectionsTree = (project, branch) =>
  new Promise((resolve, reject) => {
    try {
      getApi()
        .then(api => api.getItems(project, `${config('TFS_PATH')}/${constants.DATABASE_CONNECTIONS_DIRECTORY}`))
        .then(data => {
          if (!data) {
            return resolve([]);
          }

          const subdirs = data.filter(f => f.isFolder && f.path !== `${config('TFS_PATH')}/${constants.DATABASE_CONNECTIONS_DIRECTORY}`);
          const promisses = [];
          let files = [];
          subdirs.forEach(subdir => {
            promisses.push(getConnectionTreeByPath(project, branch, subdir.path).then(tree => {
              files = files.concat(tree);
            }));
          });

          return Promise.all(promisses)
            .then(() => resolve(files));
        })
        .catch(e => reject(e));
    } catch (e) {
      reject(e);
    }
  });

/*
 * Get full tree.
 */
const getTree = (project, changesetId) =>
  new Promise((resolve, reject) => {
    // Getting separate trees for rules and connections, as tfsvc does not provide full (recursive) tree
    const promises = {
      rules: getConfigurableTree(project, constants.RULES_DIRECTORY),
      connections: getConnectionsTree(project, changesetId),
      pages: getConfigurableTree(project, constants.PAGES_DIRECTORY),
      clients: getConfigurableTree(project, constants.CLIENTS_DIRECTORY),
      ruleConfigs: getConfigurableTree(project, constants.RULES_CONFIGS_DIRECTORY),
      resourceServers: getConfigurableTree(project, constants.RESOURCE_SERVERS_DIRECTORY)
    };

    Promise.props(promises)
      .then(result => resolve(_.union(result.rules, result.connections, result.pages, result.clients, result.ruleConfigs, result.resourceServers)))
      .catch(e => reject(e));
  });

/*
 * Download a single file.
 */
const downloadFile = (file, changesetId) => {
  const version = parseInt(changesetId, 10) || null;
  const versionString = (version) ? `&version=${version}` : '';
  const auth = new Buffer(`${config('TFS_USERNAME')}:${config('TFS_TOKEN')}`).toString('base64');

  const options = {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'text/html'
    },
    uri: `https://${config('TFS_INSTANCE')}.visualstudio.com/${config('TFS_COLLECTION')}/_apis/tfvc/items?path=${file.path}${versionString}&api-version=1.0`
  };

  return request.get(options)
    .then((data) => ({
      fileName: file.path,
      contents: data
    }))
    .catch(e => e);
};

/*
 * Download a single rule with its metadata.
 */
const downloadRule = (changesetId, ruleName, rule) => {
  const currentRule = {
    script: false,
    metadata: false,
    name: ruleName
  };

  const downloads = [];

  if (rule.script) {
    downloads.push(downloadFile(rule.scriptFile, changesetId)
      .then(file => {
        currentRule.script = true;
        currentRule.scriptFile = file.contents;
      }));
  }

  if (rule.metadata) {
    downloads.push(downloadFile(rule.metadataFile, changesetId)
      .then(file => {
        currentRule.metadata = true;
        currentRule.metadataFile = JSON.parse(file.contents);
      }));
  }

  return Promise.all(downloads)
    .then(() => currentRule);
};

/*
 * Download a single configurable file.
 */
const downloadConfigurable = (changesetId, name, item) => {
  const configurable = {
    metadata: false,
    name
  };

  const downloads = [];

  if (item.configFile) {
    downloads.push(downloadFile(item.configFile, changesetId)
      .then(file => {
        configurable.configFile = JSON.parse(file.contents);
      }));
  }

  if (item.metadataFile) {
    downloads.push(downloadFile(item.metadataFile, changesetId)
      .then(file => {
        configurable.metadata = true;
        configurable.metadataFile = JSON.parse(file.contents);
      }));
  }

  return Promise.all(downloads).then(() => configurable);
};

/*
 * Determine if we have the script, the metadata or both.
 */
const getRules = (changesetId, files) => {
  // Rules object.
  const rules = {};

  _.filter(files, f => isRule(f.path)).forEach(file => {
    const ruleName = path.parse(file.path).name;
    rules[ruleName] = rules[ruleName] || {};

    if (/\.js$/i.test(file.path)) {
      rules[ruleName].script = true;
      rules[ruleName].scriptFile = file;
    } else if (/\.json$/i.test(file.path)) {
      rules[ruleName].metadata = true;
      rules[ruleName].metadataFile = file;
    }
  });

  // Download all rules.
  return Promise.map(Object.keys(rules), ruleName => downloadRule(changesetId, ruleName, rules[ruleName]), { concurrency: 2 });
};

/*
 * Determine if we have the script, the metadata or both.
 */
const getConfigurables = (changesetId, files, directory) => {
  const configurables = {};

  _.filter(files, f => isConfigurable(f.path, directory)).forEach(file => {
    let meta = false;
    let name = path.parse(file.path).name;
    const ext = path.parse(file.path).ext;

    if (ext === '.json') {
      if (name.endsWith('.meta')) {
        name = path.parse(name).name;
        meta = true;
      }

      /* Initialize object if needed */
      configurables[name] = configurables[name] || {};

      if (meta) {
        configurables[name].metadataFile = file;
      } else {
        configurables[name].configFile = file;
      }
    }
  });

  // Download all rules.
  return Promise.map(Object.keys(configurables), key => downloadConfigurable(changesetId, key, configurables[key]), { concurrency: 2 });
};

/*
 * Download a single database script.
 */
const downloadDatabaseScript = (changesetId, databaseName, scripts) => {
  const database = {
    name: databaseName,
    scripts: []
  };

  const downloads = [];

  scripts.forEach(script => {
    downloads.push(downloadFile(script, changesetId)
      .then(file => {
        database.scripts.push({
          name: script.name,
          scriptFile: file.contents
        });
      })
    );
  });

  return Promise.all(downloads)
    .then(() => database);
};

/*
 * Get all database scripts.
 */
const getDatabaseScripts = (changesetId, files) => {
  const databases = {};

  _.filter(files, f => isDatabaseConnection(f.path)).forEach(file => {
    const script = getDatabaseScriptDetails(file.path);
    if (script) {
      databases[script.database] = databases[script.database] || [];
      databases[script.database].push({
        ...script,
        id: file.id,
        path: file.path
      });
    }
  });

  return Promise.map(Object.keys(databases), (databaseName) => downloadDatabaseScript(changesetId, databaseName, databases[databaseName]), { concurrency: 2 });
};

/*
 * Download a single page script.
 */
const downloadPage = (changesetId, pageName, page) => {
  const downloads = [];
  const currentPage = {
    metadata: false,
    name: pageName
  };

  if (page.file) {
    downloads.push(downloadFile(page.file, changesetId)
      .then(file => {
        currentPage.htmlFile = file.contents;
      }));
  }


  if (page.meta_file) {
    downloads.push(downloadFile(page.meta_file, changesetId)
      .then(file => {
        currentPage.metadata = true;
        currentPage.metadataFile = file.contents;
      }));
  }

  return Promise.all(downloads).then(() => currentPage);
};

/*
 * Get all pages.
 */
const getPages = (changesetId, files) => {
  const pages = {};

  // Determine if we have the script, the metadata or both.
  _.filter(files, f => isPage(f.path)).forEach(file => {
    const pageName = path.parse(file.path).name;
    const ext = path.parse(file.path).ext;
    pages[pageName] = pages[pageName] || {};

    if (ext !== '.json') {
      pages[pageName].file = file;
      pages[pageName].sha = file.sha;
      pages[pageName].path = file.path;
    } else {
      pages[pageName].meta_file = file;
      pages[pageName].meta_sha = file.sha;
      pages[pageName].meta_path = file.path;
    }
  });

  return Promise.map(Object.keys(pages), (pageName) =>
    downloadPage(changesetId, pageName, pages[pageName]), { concurrency: 2 });
};

/*
 * Get a list of all changes that need to be applied to rules and database scripts.
 */
export const getChanges = (project, changesetId) =>
  new Promise((resolve, reject) => {
    getTree(project, changesetId)
      .then(files => {
        logger.debug(`Files in tree: ${JSON.stringify(files.map(file => ({
          name: file.path,
          id: file.id
        })), null, 2)}`);

        const promises = {
          rules: getRules(changesetId, files),
          databases: getDatabaseScripts(changesetId, files),
          pages: getPages(changesetId, files),
          clients: getConfigurables(changesetId, files, constants.CLIENTS_DIRECTORY),
          ruleConfigs: getConfigurables(changesetId, files, constants.RULES_CONFIGS_DIRECTORY),
          resourceServers: getConfigurables(changesetId, files, constants.RESOURCE_SERVERS_DIRECTORY)
        };

        Promise.props(promises)
          .then((result) =>
            resolve({
              rules: unifyScripts(result.rules),
              databases: unifyDatabases(result.databases),
              pages: unifyScripts(result.pages),
              clients: unifyScripts(result.clients),
              ruleConfigs: unifyScripts(result.ruleConfigs),
              resourceServers: unifyScripts(result.resourceServers)
            }));
      })
      .catch(e => reject(e));
  });
