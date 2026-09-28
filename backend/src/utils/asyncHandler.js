// Express 5 forwards rejected promises to the error handler on its own; this
// wrapper only exists so route files read uniformly.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
