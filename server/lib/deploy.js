import { deploy as sourceDeploy } from 'auth0-source-control-extension-tools';
import config from '../lib/config';

import { getChanges as getGitChanges } from './tfs-git';
import { getChanges as getTfvcChanges } from './tfs-tfvc';

export default (storage, id, repositoryId, branch, repository, sha, user, client) => {
  const getChanges = config('TFS_TYPE') === 'git' ? getGitChanges : getTfvcChanges;

  return getChanges(repositoryId, sha)
    .then(context => sourceDeploy({ id, branch, repository, sha, user }, context, client, storage, config));
};
