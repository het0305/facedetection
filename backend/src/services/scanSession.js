// Server-side recognition state machine for the attendance kiosk.
//
//   SEARCH ──(same identity accepted on N good frames + passive liveness ok)──▶
//   CHALLENGE ──(random head turn / blink performed on the tracked face)──▶
//   CONFIRM ──(one more frontal frame matches the same identity)──▶ mark ▶ DONE
//
// Any track break (face lost, second face, different person) resets progress,
// so attendance can never be assembled from frames of different people.
// All decisions are made here, never on the client.
const crypto = require('crypto');
const config = require('../config');
const { iou } = require('./faceGeometry');
const { euclidean } = require('./matcher');
const { Challenge, randomChallengeType } = require('./liveness');

// Descriptor drift allowed inside one track before we assume the person changed.
const TRACK_CONSISTENCY = 0.6;
const CHALLENGE_CONSISTENCY = 0.75; // turned faces embed less consistently
const MAX_MISSED_FRAMES = 3;

const MESSAGES = {
  NO_FACE: 'Looking for face...',
  MULTIPLE_FACES: 'Please ensure only one person is visible.',
  VERIFYING: 'Verifying identity...',
  CHECKING_LIVENESS: 'Checking liveness...',
  MARKED: 'Attendance marked successfully.',
  ALREADY_MARKED: 'Attendance already marked today.',
  UNKNOWN: 'Face not recognized.',
  UNVERIFIED: 'Unable to verify identity. Please try again.',
  SPOOF: 'Unable to confirm a live person. Please try again.',
  LIVENESS_FAILED: 'Liveness check was not completed. Please try again.',
  TIMEOUT: 'Unable to verify identity. Please try again.',
  ERROR: 'Something went wrong while recording attendance. Please try again.',
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

class ScanSession {
  /**
   * @param {object} deps
   * @param {(d:Float32Array)=>Promise<object>} deps.match  gallery match
   * @param {(args:object)=>Promise<{status:string, record:object}>} deps.mark
   * @param {(event:string, details:object)=>void} [deps.onSecurityEvent]
   */
  constructor({ owner, deviceId, deps, cfg = config, now = () => Date.now(), random = randomChallengeType }) {
    this.id = crypto.randomUUID();
    this.owner = owner;
    this.deviceId = deviceId;
    this.deps = deps;
    this.cfg = cfg;
    this.now = now;
    this.random = random;
    this.createdAt = now();
    this.lastSeen = this.createdAt;
    this.busy = false;
    this.result = null;
    this.resetProgress();
  }

  resetProgress() {
    this.phase = 'SEARCH';
    this.track = null;
    this.missed = 0;
    this.anchor = null;
    this.candidate = null;
    this.unknownHits = 0;
    this.liveScores = [];
    this.spoofStrikes = 0;
    this.frontalPoses = [];
    this.challenge = null;
    this.confirmMisses = 0;
  }

  /** What the kiosk should compute for the next frame. */
  analysisOptions() {
    if (this.phase === 'CHALLENGE') return { mode: 'challenge', descriptor: true, liveness: false };
    return { mode: 'recognition', descriptor: true, liveness: this.cfg.LIVENESS_ENABLED };
  }

  respond(state, extra = {}) {
    const needed = this.requiredHits();
    const hits = this.candidate ? this.candidate.hits : 0;
    let progress = Math.min(0.6, (hits / needed) * 0.6);
    if (this.phase === 'CHALLENGE') progress = 0.7;
    if (this.phase === 'CONFIRM') progress = 0.9;
    return {
      sessionId: this.id,
      state,
      terminal: false,
      message: extra.message || MESSAGES[state],
      face: extra.face || null,
      progress,
      challenge: this.challenge ? this.challenge.type : null,
      result: null,
    };
  }

  finish(state, extra = {}) {
    this.phase = 'DONE';
    this.result = {
      sessionId: this.id,
      state,
      terminal: true,
      message: MESSAGES[state],
      face: extra.face || null,
      progress: state === 'MARKED' || state === 'ALREADY_MARKED' ? 1 : 0,
      challenge: null,
      result: extra.result || null,
    };
    if (['SPOOF', 'LIVENESS_FAILED'].includes(state) && this.deps.onSecurityEvent) {
      this.deps.onSecurityEvent(state === 'SPOOF' ? 'liveness.spoof_suspected' : 'liveness.challenge_failed', {
        claimedIdentity: this.candidate ? this.candidate.person?.rollNo : null,
        livenessScores: this.liveScores.map((s) => Math.round(s * 1000) / 1000),
        challenge: this.challenge ? this.challenge.type : null,
      });
    }
    return this.result;
  }

  requiredHits() {
    if (!this.candidate || !this.candidate.distances.length) return this.cfg.STABLE_FRAMES;
    return median(this.candidate.distances) <= this.cfg.HIGH_CONFIDENCE_THRESHOLD
      ? this.cfg.STABLE_FRAMES
      : this.cfg.STABLE_FRAMES + 2;
  }

  isContinuous(box) {
    if (!this.track) return true;
    if (iou(box, this.track) >= 0.3) return true;
    const dx = box.x + box.width / 2 - (this.track.x + this.track.width / 2);
    const dy = box.y + box.height / 2 - (this.track.y + this.track.height / 2);
    return Math.hypot(dx, dy) < 0.5 * Math.max(box.width, this.track.width);
  }

  /** Feed one analysed frame (output of faceAnalysis.analyzeFrame). */
  async step(a) {
    if (this.phase === 'DONE') return this.result;
    const now = this.now();
    this.lastSeen = now;
    if (now - this.createdAt > this.cfg.SCAN_SESSION_TIMEOUT_MS) return this.finish('TIMEOUT');

    if (a.faceCount === 0) {
      this.missed += 1;
      if (this.missed >= MAX_MISSED_FRAMES) this.resetProgress();
      return this.respond('NO_FACE');
    }
    if (a.faceCount > 1) {
      this.resetProgress();
      return this.respond('MULTIPLE_FACES');
    }

    const face = a.face;
    if (!this.isContinuous(face.normBox)) this.resetProgress();
    this.track = face.normBox;
    this.missed = 0;
    const faceOut = face.normBox;

    if (this.phase === 'CHALLENGE') return this.stepChallenge(face, faceOut);

    if (!face.quality.ok) return this.respond('QUALITY', { message: face.quality.message, face: faceOut });

    if (face.liveness != null) {
      this.liveScores.push(face.liveness);
      if (face.liveness < this.cfg.LIVENESS_HARD_FAIL) {
        this.spoofStrikes += 1;
        if (this.spoofStrikes >= 2) return this.finish('SPOOF', { face: faceOut });
      }
    }

    if (this.anchor && euclidean(face.descriptor, this.anchor) > TRACK_CONSISTENCY) {
      this.resetProgress();
      this.track = face.normBox;
      return this.respond('VERIFYING', { face: faceOut });
    }

    const m = await this.deps.match(face.descriptor);
    if (!m.accepted) {
      this.unknownHits += 1;
      if (this.candidate) this.candidate.hits = Math.max(0, this.candidate.hits - 1);
      if (this.phase === 'CONFIRM') {
        this.confirmMisses += 1;
        if (this.confirmMisses >= 3) return this.finish('UNVERIFIED', { face: faceOut });
      } else if (this.unknownHits >= this.cfg.UNKNOWN_AFTER_FRAMES && (!this.candidate || this.candidate.hits === 0)) {
        return this.finish(m.reason === 'AMBIGUOUS' ? 'UNVERIFIED' : 'UNKNOWN', { face: faceOut });
      }
      return this.respond('VERIFYING', { face: faceOut });
    }

    if (this.candidate && this.candidate.id !== m.id) {
      // Identity flipped between frames: never average two people together.
      if (this.phase === 'CONFIRM') return this.finish('UNVERIFIED', { face: faceOut });
      this.resetProgress();
      this.track = face.normBox;
    }
    if (!this.candidate) this.candidate = { id: m.id, person: m.person, hits: 0, distances: [] };
    if (!this.anchor) this.anchor = face.descriptor;
    this.candidate.hits += 1;
    this.candidate.distances.push(m.distance);
    this.unknownHits = 0;
    this.frontalPoses.push(face.pose);

    if (this.phase === 'CONFIRM') return this.finalize(faceOut);
    if (this.candidate.hits < this.requiredHits()) return this.respond('VERIFYING', { face: faceOut });

    if (this.cfg.LIVENESS_ENABLED) {
      const recent = this.liveScores.slice(-this.cfg.LIVENESS_MAX_FRAMES);
      if (recent.length < this.cfg.LIVENESS_MIN_FRAMES) return this.respond('CHECKING_LIVENESS', { face: faceOut });
      if (avg(recent) < this.cfg.LIVENESS_THRESHOLD) {
        if (this.liveScores.length >= this.cfg.LIVENESS_MAX_FRAMES) return this.finish('SPOOF', { face: faceOut });
        return this.respond('CHECKING_LIVENESS', { face: faceOut });
      }
    }

    if (this.cfg.CHALLENGE_ENABLED) {
      const recentPoses = this.frontalPoses.slice(-5);
      this.challenge = new Challenge(
        this.random(this.cfg.CHALLENGE_TYPES),
        { yaw: median(recentPoses.map((p) => p.yaw)), ear: median(recentPoses.map((p) => p.ear)) },
        this.cfg,
        now
      );
      this.phase = 'CHALLENGE';
      return this.respond('CHALLENGE', { message: this.challenge.message, face: faceOut });
    }
    return this.finalize(faceOut);
  }

  stepChallenge(face, faceOut) {
    if (this.challenge.expired(this.now())) return this.finish('LIVENESS_FAILED', { face: faceOut });
    if (face.descriptor && this.anchor && euclidean(face.descriptor, this.anchor) > CHALLENGE_CONSISTENCY) {
      return this.finish('UNVERIFIED', { face: faceOut });
    }
    if (!face.quality.ok) return this.respond('CHALLENGE', { message: face.quality.message, face: faceOut });
    const stage = this.challenge.update(face.pose);
    if (stage === 'failed') return this.finish('LIVENESS_FAILED', { face: faceOut });
    if (stage === 'done') {
      this.phase = 'CONFIRM';
      return this.respond('VERIFYING', { face: faceOut });
    }
    return this.respond('CHALLENGE', { message: this.challenge.message, face: faceOut });
  }

  async finalize(faceOut) {
    const distance = median(this.candidate.distances);
    const verification = {
      distance: Math.round(distance * 10000) / 10000,
      confidence: distance <= this.cfg.HIGH_CONFIDENCE_THRESHOLD ? 'high' : 'standard',
      liveness: this.liveScores.length ? Math.round(avg(this.liveScores) * 1000) / 1000 : undefined,
      challenge: this.challenge ? this.challenge.type : undefined,
    };
    try {
      const { status, record } = await this.deps.mark({
        student: this.candidate.person,
        verification,
        deviceId: this.deviceId,
      });
      return this.finish(status, {
        face: faceOut,
        result: {
          name: this.candidate.person.name,
          rollNo: this.candidate.person.rollNo,
          checkInAt: record.checkInAt,
          attendanceStatus: record.status,
        },
      });
    } catch (err) {
      if (this.deps.onError) this.deps.onError(err);
      return this.finish('ERROR', { face: faceOut });
    }
  }
}

// ---- in-memory session store ------------------------------------------------
// Sessions are short-lived (seconds) and bound to the kiosk that created them.
// A multi-instance deployment would need sticky sessions or a shared store.
class SessionStore {
  constructor({ ttlMs = config.SCAN_SESSION_TIMEOUT_MS * 2, max = 500 } = {}) {
    this.sessions = new Map();
    this.ttlMs = ttlMs;
    this.max = max;
    this.timer = setInterval(() => this.sweep(), 10000);
    this.timer.unref();
  }

  get(id, owner) {
    const s = id ? this.sessions.get(id) : null;
    return s && s.owner === owner ? s : null;
  }

  create(args) {
    if (this.sessions.size >= this.max) this.sweep(true);
    const s = new ScanSession(args);
    this.sessions.set(s.id, s);
    return s;
  }

  sweep(force = false) {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.lastSeen > this.ttlMs || (force && s.phase === 'DONE')) this.sessions.delete(id);
    }
  }
}

module.exports = { ScanSession, SessionStore, MESSAGES };
