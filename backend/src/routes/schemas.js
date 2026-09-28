// Shared request schemas.
const { z } = require('zod');
const mongoose = require('mongoose');
const { DAY_KEY_RE } = require('../utils/time');

const nameSchema = z
  .string()
  .trim()
  .min(2, 'must be at least 2 characters')
  .max(100)
  .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u, 'may only contain letters, spaces and . \' -');

const rollNoSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/, 'may only contain letters, numbers and / _ -');

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v) && /^[a-f0-9]{24}$/i.test(v), 'invalid id');

const dayKey = z.string().regex(DAY_KEY_RE, 'must be YYYY-MM-DD');

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { nameSchema, rollNoSchema, objectId, dayKey, pageSchema, escapeRegex };
