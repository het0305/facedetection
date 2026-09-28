// Identity decision. Pure functions (no DB) so the rules are unit-testable
// and shared by the live system and the evaluation script.
//
// A probe is accepted only when BOTH hold:
//   1. best person distance <= RECOGNITION_THRESHOLD
//   2. the runner-up *different person* is at least RECOGNITION_MIN_MARGIN
//      further away (prevents picking between two similar-looking people)
// Otherwise the result is "unknown". False acceptance is worse than rejection.
const config = require('../config');

function euclidean(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

function centroid(descriptors) {
  const c = new Float32Array(descriptors[0].length);
  for (const d of descriptors) for (let i = 0; i < c.length; i += 1) c[i] += d[i];
  for (let i = 0; i < c.length; i += 1) c[i] /= descriptors.length;
  return c;
}

/** Distance from a probe to one person under the configured strategy. */
function personDistance(probe, person, strategy) {
  if (strategy === 'centroid') return euclidean(probe, person.centroid || centroid(person.descriptors));
  let best = Infinity;
  for (const d of person.descriptors) best = Math.min(best, euclidean(probe, d));
  return best;
}

/**
 * @param {Float32Array} probe
 * @param {{id:string, descriptors:Float32Array[], centroid?:Float32Array}[]} people
 * @returns {{accepted:boolean, reason:'OK'|'NO_MATCH'|'AMBIGUOUS'|'EMPTY_GALLERY',
 *            id?:string, distance?:number, secondDistance?:number, margin?:number,
 *            confidence?:'high'|'standard'}}
 */
function match(probe, people, cfg = config) {
  if (!people.length) return { accepted: false, reason: 'EMPTY_GALLERY' };
  let best = null;
  let second = null;
  for (const p of people) {
    if (!p.descriptors.length) continue;
    const d = personDistance(probe, p, cfg.MATCH_STRATEGY);
    if (!best || d < best.d) {
      second = best;
      best = { id: p.id, d };
    } else if (!second || d < second.d) {
      second = { id: p.id, d };
    }
  }
  if (!best) return { accepted: false, reason: 'EMPTY_GALLERY' };
  const margin = second ? second.d - best.d : Infinity;
  const base = { id: best.id, distance: best.d, secondDistance: second ? second.d : null, margin };
  if (best.d > cfg.RECOGNITION_THRESHOLD) return { ...base, accepted: false, reason: 'NO_MATCH' };
  if (margin < cfg.RECOGNITION_MIN_MARGIN) return { ...base, accepted: false, reason: 'AMBIGUOUS' };
  return {
    ...base,
    accepted: true,
    reason: 'OK',
    confidence: best.d <= cfg.HIGH_CONFIDENCE_THRESHOLD ? 'high' : 'standard',
  };
}

/** People whose nearest sample is within `threshold` of any of the probes. */
function findSimilar(probes, people, threshold) {
  const hits = [];
  for (const p of people) {
    let best = Infinity;
    for (const probe of probes) best = Math.min(best, personDistance(probe, p, 'min'));
    if (best <= threshold) hits.push({ id: p.id, distance: best });
  }
  return hits.sort((a, b) => a.distance - b.distance);
}

/** Largest pairwise distance inside one enrollment set (should be small). */
function maxPairwise(descriptors) {
  let max = 0;
  for (let i = 0; i < descriptors.length; i += 1) {
    for (let j = i + 1; j < descriptors.length; j += 1) max = Math.max(max, euclidean(descriptors[i], descriptors[j]));
  }
  return max;
}

module.exports = { euclidean, centroid, personDistance, match, findSimilar, maxPairwise };
