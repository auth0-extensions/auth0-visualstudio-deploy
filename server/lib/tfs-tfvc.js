import _ from 'lodash';
import path from 'path';
import Promise from 'bluebird';
import request from 'request-promise';
import { constants } from 'auth0-source-control-extension-tools';

import unifyData from './unifyData';
import config from './config';
import logger from './logger';
import common from './common';

/*
 * TFS API connection
 */
let apiInstance = null;

const getApi = () => {
  if (!apiInstance) {
    return common.getApi()
      .then((api) => {
        apiInstance = api;
        return apiInstance;
      });
  }

  return Promise.resolve(apiInstance);
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
          .filter(common.validFilesOnly)
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
        .then(api => api.getItems(project, `${common.getPrefix()}/${directory}`))
        .then(data => {
          if (!data) {
            return resolve([]);
          }

          const files = data
            .filter(f => f.size)
            .filter(f => common.validFilesOnly(f.path));

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
            .filter(f => common.validFilesOnly(f.path));

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
        .then(api => api.getItems(project, `${common.getPrefix()}/${constants.DATABASE_CONNECTIONS_DIRECTORY}`))
        .then(data => {
          if (!data) {
            return resolve([]);
          }

          const subdirs = data.filter(f => f.isFolder && f.path !== `${common.getPrefix()}/${constants.DATABASE_CONNECTIONS_DIRECTORY}`);
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
      databases: getConnectionsTree(project, changesetId),
      emails: getConfigurableTree(project, constants.EMAIL_TEMPLATES_DIRECTORY),
      pages: getConfigurableTree(project, constants.PAGES_DIRECTORY),
      clients: getConfigurableTree(project, constants.CLIENTS_DIRECTORY),
      clientGrants: getConfigurableTree(project, constants.CLIENTS_GRANTS_DIRECTORY),
      connections: getConfigurableTree(project, constants.CONNECTIONS_DIRECTORY),
      rulesConfigs: getConfigurableTree(project, constants.RULES_CONFIGS_DIRECTORY),
      resourceServers: getConfigurableTree(project, constants.RESOURCE_SERVERS_DIRECTORY)
    };

    return Promise.props(promises)
      .then(result => resolve(_.union(
        result.rules,
        result.databases,
        result.emails,
        result.pages,
        result.clients,
        result.clientGrants,
        result.connections,
        result.rulesConfigs,
        result.resourceServers
      )))
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

  _.filter(files, f => common.isRule(f.path)).forEach(file => {
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

  _.filter(files, f => common.isConfigurable(f.path, directory)).forEach(file => {
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
        if (script.name === 'settings') {
          database.settings = file.contents;
        } else {
          database.scripts.push({
            name: script.name,
            scriptFile: file.contents
          });
        }
      })
    );
  });

  return Promise.all(downloads)
    .then(() => database);
};

/*
 * Get all database scripts.
 */
const getDatabaseData = (changesetId, files) => {
  const databases = {};

  _.filter(files, f => common.isDatabaseConnection(f.path)).forEach(file => {
    const script = common.getDatabaseScriptDetails(file.path);
    const settings = common.getDatabaseSettingsDetails(file.path);

    if (script) {
      databases[script.database] = databases[script.database] || [];
      databases[script.database].push({
        ...script,
        id: file.id,
        path: file.path
      });
    }

    if (settings) {
      databases[settings.database] = databases[settings.database] || [];
      databases[settings.database].push({
        ...settings,
        id: file.id,
        path: file.path
      });
    }
  });

  return Promise.map(Object.keys(databases), (databaseName) => downloadDatabaseScript(changesetId, databaseName, databases[databaseName]), { concurrency: 2 });
};

/*
 * Download a single page or email script.
 */
const downloadTemplate = (changesetId, tplName, template) => {
  const downloads = [];
  const currentTpl = {
    metadata: false,
    name: tplName
  };

  if (template.file) {
    downloads.push(downloadFile(template.file, changesetId)
      .then(file => {
        currentTpl.htmlFile = file.contents;
      }));
  }


  if (template.meta_file) {
    downloads.push(downloadFile(template.meta_file, changesetId)
      .then(file => {
        currentTpl.metadata = true;
        currentTpl.metadataFile = file.contents;
      }));
  }

  return Promise.all(downloads).then(() => currentTpl);
};

/*
 * Get all html templates - emails/pages.
 */
const getHtmlTemplates = (changesetId, files, dir, allowedNames) => {
  const templates = {};

  // Determine if we have the script, the metadata or both.
  _.filter(files, f => common.isTemplate(f.path, dir, allowedNames)).forEach(file => {
    const tplName = path.parse(file.path).name;
    const ext = path.parse(file.path).ext;
    templates[tplName] = templates[tplName] || {};

    if (ext !== '.json') {
      templates[tplName].file = file;
      templates[tplName].sha = file.sha;
      templates[tplName].path = file.path;
    } else {
      templates[tplName].meta_file = file;
      templates[tplName].meta_sha = file.sha;
      templates[tplName].meta_path = file.path;
    }
  });

  return Promise.map(Object.keys(templates), (name) =>
    downloadTemplate(changesetId, name, templates[name]), { concurrency: 2 });
};

/*
 * Get email provider.
 */
const getEmailProvider = (changesetId, files) =>
  downloadConfigurable(changesetId, 'emailProvider', { configFile: _.find(files, f => common.isEmailProvider(f.path)) });

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
          databases: getDatabaseData(changesetId, files),
          emailProvider: getEmailProvider(changesetId, files),
          emailTemplates: getHtmlTemplates(changesetId, files, constants.EMAIL_TEMPLATES_DIRECTORY, constants.EMAIL_TEMPLATES_NAMES),
          pages: getHtmlTemplates(changesetId, files, constants.PAGES_DIRECTORY, constants.PAGE_NAMES),
          clients: getConfigurables(changesetId, files, constants.CLIENTS_DIRECTORY),
          clientGrants: getConfigurables(changesetId, files, constants.CLIENTS_GRANTS_DIRECTORY),
          connections: getConfigurables(changesetId, files, constants.CONNECTIONS_DIRECTORY),
          rulesConfigs: getConfigurables(changesetId, files, constants.RULES_CONFIGS_DIRECTORY),
          resourceServers: getConfigurables(changesetId, files, constants.RESOURCE_SERVERS_DIRECTORY)
        };

        return Promise.props(promises)
          .then((result) => resolve(unifyData(result)));
      })
      .catch(e => reject(e));
  });
