import { deploy as sourceDeploy } from 'auth0-source-control-extension-tools';

import report from './reporter';
import { getExcluded } from './storage';
import config from './config';
import { getChanges as getGitChanges } from './tfs-git';
import { getChanges as getTfvcChanges } from './tfs-tfvc';

export default (storage, id, repositoryId, branch, repository, sha, user, client) => {
  const getChanges = config('TFS_TYPE') === 'git' ? getGitChanges : getTfvcChanges;

  const repo = {
    id,
    sha,
    user,
    branch,
    repository
  };

  return getChanges(repositoryId, sha)
    .then(assets =>
      getExcluded(storage)
        .then((exclude) => {
          assets.exclude = exclude;
          repo.assets = assets;

          return assets;
        }))
    .then(assets => sourceDeploy(assets, client, config))
    .then(progress => report(storage, { repo, progress }))
    .catch(err => report(storage, { repo, error: err.message })
      .then(() => Promise.reject(err)));
};
