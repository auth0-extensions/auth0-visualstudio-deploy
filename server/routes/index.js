import _ from 'lodash';
import { Router as router } from 'express';

import html from './html';
import meta from './meta';
import hooks from './hooks';
import webhooks from './webhooks';
import rules from './rules';
import config from '../lib/config';
import deploy from '../lib/deploy';
import manualDeploy from '../lib/manualDeploy';
import { readStorage } from '../lib/storage';
import { dashboardAdmins, requireUser } from '../lib/middlewares';

export default (storageContext) => {
  const routes = router();
  routes.use('/.extensions', hooks());
  routes.use('/', dashboardAdmins());
  routes.get('/', html());
  routes.use('/meta', meta());
  routes.use('/webhooks', webhooks(storageContext));
  routes.use('/api/rules', requireUser, rules());

  routes.get('/api/config', requireUser, (req, res) => {
    res.json({
      secret: config('EXTENSION_SECRET'),
      branch: config('TFS_BRANCH') || config('TFS_PATH'),
      prefix: config('TFS_INSTANCE'),
      repository: config('TFS_PROJECT')
    });
  });

  routes.get('/api/deployments', requireUser, (req, res, next) =>
    readStorage(storageContext)
      .then(data => res.json(_.sortByOrder(data.deployments || [], [ 'date' ], [ false ])))
      .catch(next)
  );

  routes.post('/api/deployments', requireUser, (req, res, next) => {
    if (config('TFS_TYPE') === 'git') {
      manualDeploy(storageContext, 'manual', config('TFS_BRANCH'), config('TFS_PROJECT'), (req.body && req.body.sha) || config('TFS_BRANCH'), req.user.sub)
        .then(stats => res.json(stats))
        .catch(next);
    }
    else if (config('TFS_TYPE') === 'tfvc') {
      deploy(storageContext, 'manual', config('TFS_PROJECT'), config('TFS_PATH'), config('TFS_PROJECT'), (req.body && req.body.sha) || 'latest', req.user.sub)
        .then(stats => res.json(stats))
        .catch(next);
    }
    else {
      res.status(400).json({ message: 'Incorrect TFS_TYPE.' });
    }
  });

  return routes;
};
