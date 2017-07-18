import { ArgumentError, UnauthorizedError } from 'auth0-extension-tools';

const parsePush = ({ notificationId = '', resource = {}, eventType = '' }) => {
  const refParts = resource.refUpdates[0].name.split('/');
  const checkoutSha = resource.refUpdates[0].newObjectId;

  return {
    id: notificationId,
    repositoryId: resource.repository.id,
    event: eventType,
    branch: refParts.length === 3 ? refParts[2] : '',
    pushId: resource.pushId,
    repository: resource.repository.name,
    user: resource.pushedBy.uniqueName,
    sha: checkoutSha
  };
};

const parsePR = ({ notificationId = '', resource = {}, eventType = '' }) => {
  const refParts = resource.targetRefName.split('/');
  const checkoutSha = resource.lastMergeCommit.commitId;

  return {
    id: notificationId,
    repositoryId: resource.repository.id,
    event: eventType,
    branch: refParts.length === 3 ? refParts[2] : '',
    pullRequestId: resource.pullRequestId,
    repository: resource.repository.name,
    user: resource.createdBy.uniqueName,
    sha: checkoutSha
  };
};

module.exports = (secret) => (req, res, next) => {
  if (!secret || secret.length === 0) {
    return next(new UnauthorizedError('The extension secret is not set, unable to verify webhook signature.'));
  }

  if (secret !== req.headers['x-hook-secret']) {
    return next(new UnauthorizedError('The webhook secret is incorrect.'));
  }

  if (req.body.eventType === 'git.push' && (!req.body.resource.refUpdates || !req.body.resource.refUpdates[0])) {
    return next(new ArgumentError('The webhook details are incorrect.'));
  }

  if (req.body.eventType === 'git.pullrequest.merged') {
    req.webhook = parsePR(req.body);
  }
  else {
    req.webhook = parsePush(req.body);
  }
  

  return next();
};
