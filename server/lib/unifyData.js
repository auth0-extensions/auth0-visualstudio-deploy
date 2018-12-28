import _ from 'lodash';
import logger from './logger';

const unifyItem = (item, type) => {
  switch (type) {
    default:
    case 'rules': {
      let meta = item.metadataFile || {};

      try {
        meta = JSON.parse(item.metadataFile);
      } catch (e) {
        logger.info(`Cannot parse metadata of ${item.name} ${type}`);
      }

      const { order = 0, enabled, stage = 'login_success' } = meta;

      return ({ script: item.scriptFile, name: item.name, order, stage, enabled });
    }
    case 'pages': {
      let meta = item.metadataFile || {};

      try {
        meta = JSON.parse(item.metadataFile);
      } catch (e) {
        logger.info(`Cannot parse metadata of ${item.name} ${type}`);
      }

      const { enabled } = meta;

      return ({ html: item.htmlFile, name: item.name, enabled });
    }

    case 'emailTemplates': {
      if (item.name === 'provider') return null;
      let meta = item.metadataFile || {};
      try {
        meta = JSON.parse(item.metadataFile);
      } catch (e) {
        logger.info(`Cannot parse metadata of ${item.name} ${type}`);
      }

      return ({ ...meta, body: item.htmlFile });
    }
    case 'clientGrants':
    case 'emailProvider': {
      let data = item.configFile || {};
      try {
        data = JSON.parse(item.configFile);
      } catch (e) {
        logger.info(`Cannot parse metadata of ${item.name} ${type}`);
      }

      return ({ ...data });
    }

    case 'databases': {
      let settings = item.settings || {};
      try {
        settings = JSON.parse(item.settings);
      } catch (e) {
        logger.info(`Cannot parse settings of ${item.name} ${type}`);
      }
      const customScripts = {};
      const options = settings.options || {};

      _.forEach(item.scripts, (script) => { customScripts[script.name] = script.scriptFile; });

      if (item.scripts || item.scripts.length) {
        options.customScripts = customScripts;
        options.enabledDatabaseCustomization = true;
      }

      return ({ ...settings, options, strategy: 'auth0', name: item.name });
    }

    case 'resourceServers':
    case 'connections':
    case 'clients': {
      let meta = item.metadataFile || {};
      let data = item.configFile || {};

      try {
        data = JSON.parse(item.configFile);
      } catch (e) {
        logger.info(`Cannot parse config of ${item.name} ${type}`);
      }

      try {
        meta = JSON.parse(item.metadataFile);
      } catch (e) {
        logger.info(`Cannot parse metadata of ${item.name} ${type}`);
      }

      return ({ name: item.name, ...meta, ...data });
    }

    case 'rulesConfigs': {
      let data = item.configFile || {};

      try {
        data = JSON.parse(item.configFile);
      } catch (e) {
        logger.info(`Cannot parse config of ${item.name} ${type}`);
      }

      return ({ key: item.name, value: data.value });
    }
  }
};

export default function (assets) {
  const result = {};

  _.forEach(assets, (data, type) => {
    result[type] = [];
    if (Array.isArray(data)) {
      _.forEach(data, (item) => {
        const unified = unifyItem(item, type);
        if (unified) result[type].push(unified);
      });
    } else {
      result[type] = unifyItem(data, type);
    }
  });

  return result;
}
