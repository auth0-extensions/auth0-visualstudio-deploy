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

    case 'databases': {
      const customScripts = {};
      _.forEach(item.scripts, (script) => { customScripts[script.name] = script.scriptFile; });

      return ({ strategy: 'auth0', name: item.name, options: { customScripts, enabledDatabaseCustomization: true } });
    }

    case 'resourceServers':
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
    _.forEach(data, (item) => result[type].push(unifyItem(item, type)));
  });

  return result;
}
