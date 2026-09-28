// zod-based request validation. Parsed values are exposed as req.valid so
// handlers only ever see typed, trimmed, bounded data (and never Mongo
// operator objects such as {"$ne": null}).
const { badRequest } = require('../utils/errors');

function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue.path.join('.');
    throw badRequest('VALIDATION_ERROR', field ? `${field}: ${issue.message}` : issue.message);
  }
  return r.data;
}

const make = (key) => (schema) => (req, _res, next) => {
  req.valid = { ...(req.valid || {}), [key]: parse(schema, req[key] ?? {}) };
  next();
};

module.exports = { body: make('body'), query: make('query'), params: make('params'), parse };
