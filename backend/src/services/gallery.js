// In-memory gallery of active identities, decrypted once and refreshed after
// any enrollment change, so per-frame matching never touches the database.
const Student = require('../models/Student');
const { decryptDescriptor } = require('../utils/biometricCrypto');
const matcher = require('./matcher');
const logger = require('../utils/logger');

let people = null;
let meta = new Map();
let loading = null;

async function load() {
  const students = await Student.find({ active: true, sampleCount: { $gt: 0 } })
    .select('+samples name rollNo')
    .lean();
  const nextPeople = [];
  const nextMeta = new Map();
  for (const s of students) {
    const id = String(s._id);
    try {
      const descriptors = s.samples.map((x) => decryptDescriptor(x.enc));
      nextPeople.push({ id, descriptors, centroid: matcher.centroid(descriptors) });
      nextMeta.set(id, { id, name: s.name, rollNo: s.rollNo });
    } catch (err) {
      // Wrong BIOMETRIC_KEY or corrupted record: skip it rather than match on garbage.
      logger.error('Could not decrypt biometric samples', { studentId: id, err: err.message });
    }
  }
  people = nextPeople;
  meta = nextMeta;
  logger.info('Gallery loaded', { identities: people.length });
}

async function ensureLoaded() {
  if (people) return;
  if (!loading) loading = load().finally(() => (loading = null));
  await loading;
}

async function invalidate() {
  people = null;
  await ensureLoaded();
}

async function match(descriptor) {
  await ensureLoaded();
  const result = matcher.match(descriptor, people);
  return { ...result, person: result.id ? meta.get(result.id) : null };
}

/** Includes inactive identities: a deactivated user must not be re-enrolled under a new record silently. */
async function findSimilar(descriptors, threshold, { excludeId } = {}) {
  const all = await Student.find(excludeId ? { _id: { $ne: excludeId } } : {})
    .select('+samples name rollNo active')
    .lean();
  const candidates = [];
  const info = new Map();
  for (const s of all) {
    if (!s.samples?.length) continue;
    try {
      candidates.push({ id: String(s._id), descriptors: s.samples.map((x) => decryptDescriptor(x.enc)) });
      info.set(String(s._id), { id: String(s._id), name: s.name, rollNo: s.rollNo, active: s.active });
    } catch {
      /* logged by load() */
    }
  }
  return matcher.findSimilar(descriptors, candidates, threshold).map((h) => ({ ...info.get(h.id), distance: h.distance }));
}

/** Pairs of registered identities that look like the same person. */
async function suspectedDuplicates(threshold) {
  const all = await Student.find({ sampleCount: { $gt: 0 } }).select('+samples name rollNo active').lean();
  const people = [];
  for (const s of all) {
    try {
      people.push({
        student: { id: String(s._id), name: s.name, rollNo: s.rollNo, active: s.active },
        descriptors: s.samples.map((x) => decryptDescriptor(x.enc)),
      });
    } catch {
      /* skip */
    }
  }
  const pairs = [];
  for (let i = 0; i < people.length; i += 1) {
    for (let j = i + 1; j < people.length; j += 1) {
      let d = Infinity;
      for (const a of people[i].descriptors) for (const b of people[j].descriptors) d = Math.min(d, matcher.euclidean(a, b));
      if (d <= threshold) pairs.push({ a: people[i].student, b: people[j].student, distance: d });
    }
  }
  return pairs.sort((x, y) => x.distance - y.distance);
}

const size = () => (people ? people.length : null);

module.exports = { load, ensureLoaded, invalidate, match, findSimilar, suspectedDuplicates, size };
