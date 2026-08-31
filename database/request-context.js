const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function requestContextMiddleware(req, res, next) {
  storage.run({ requestId: req.id || null, userId: null }, next);
}

function setCurrentUser(userId) {
  const context = storage.getStore();
  if (context) context.userId = userId || null;
}

function getRequestContext() {
  return storage.getStore() || {};
}

module.exports = { requestContextMiddleware, setCurrentUser, getRequestContext };
