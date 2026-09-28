// Central configuration. Every tunable value lives here and is read from the
// environment (see backend/.env.example). Nothing else should read process.env.
const path = require('path');
const { z } = require('zod');

require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });

const bool = (def) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));
const num = (def, min = -Infinity, max = Infinity) => z.coerce.number().min(min).max(max).default(def);
const list = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v.split(',').map((s) => s.trim()).filter(Boolean)));

const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: num(5000, 1, 65535),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  TRUST_PROXY: bool(false),
  CORS_ORIGINS: list([]),
  SERVE_FRONTEND: bool(true),

  // Secrets
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  BIOMETRIC_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'BIOMETRIC_KEY must be 64 hex characters (32 bytes)'),

  // Sessions
  ADMIN_SESSION_HOURS: num(8, 1, 72),
  KIOSK_SESSION_DAYS: num(30, 1, 365),
  COOKIE_SECURE: z.enum(['true', 'false', 'auto']).default('auto'),
  LOGIN_MAX_FAILURES: num(5, 1, 50),
  LOGIN_LOCK_MINUTES: num(15, 1, 1440),

  // Attendance rules
  APP_TIMEZONE: z.string().default(systemTz),
  LATE_AFTER: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'LATE_AFTER must be HH:MM')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  ATTENDANCE_COOLDOWN_SEC: num(60, 0, 86400),

  // Engine
  FACE_BACKEND: z.enum(['auto', 'wasm', 'node']).default('auto'),
  DETECTOR_MIN_CONFIDENCE: num(0.5, 0.1, 0.99),
  MAX_PROCESS_DIMENSION: num(960, 320, 4096),

  // Recognition (face-api 128-d descriptors, Euclidean distance; lower = more similar)
  RECOGNITION_THRESHOLD: num(0.5, 0.2, 0.8),
  HIGH_CONFIDENCE_THRESHOLD: num(0.4, 0.1, 0.8),
  RECOGNITION_MIN_MARGIN: num(0.06, 0, 0.5),
  MATCH_STRATEGY: z.enum(['min', 'centroid']).default('min'),
  DUPLICATE_FACE_THRESHOLD: num(0.42, 0.1, 0.8),
  ENROLL_SAME_PERSON_THRESHOLD: num(0.55, 0.2, 0.9),
  ENROLL_MIN_SAMPLES: num(3, 1, 10),
  ENROLL_MAX_SAMPLES: num(8, 1, 20),

  // Face quality
  MIN_FACE_SIZE_PX: num(90, 40, 1000),
  ENROLL_MIN_FACE_SIZE_PX: num(110, 40, 1000),
  MAX_FACE_FRAME_RATIO: num(0.85, 0.3, 1),
  MIN_DETECTION_SCORE: num(0.7, 0.1, 1),
  MIN_BRIGHTNESS: num(55, 0, 255),
  MAX_BRIGHTNESS: num(205, 0, 255),
  MIN_CONTRAST: num(18, 0, 128),
  MAX_OVEREXPOSED_RATIO: num(0.25, 0, 1),
  MIN_SHARPNESS: num(20, 0, 10000),
  MAX_YAW: num(0.35, 0.05, 1),
  MAX_ROLL_DEG: num(20, 1, 90),
  MIN_PITCH_RATIO: num(0.2, 0, 1),
  MAX_PITCH_RATIO: num(0.65, 0, 1),

  // Liveness
  LIVENESS_ENABLED: bool(true),
  LIVENESS_MODEL_DIR: z.string().default(path.join(__dirname, '../../models/antispoof')),
  LIVENESS_THRESHOLD: num(0.6, 0, 1),
  LIVENESS_HARD_FAIL: num(0.2, 0, 1),
  LIVENESS_MIN_FRAMES: num(3, 1, 30),
  LIVENESS_MAX_FRAMES: num(8, 1, 60),
  REGISTRATION_REQUIRE_LIVENESS: bool(true),
  CHALLENGE_ENABLED: bool(true),
  CHALLENGE_TYPES: list(['turn_left', 'turn_right']),
  CHALLENGE_TIMEOUT_MS: num(10000, 1000, 60000),
  // Same size as the enrollment "slight turn" pose (yaw >= 0.15).
  CHALLENGE_TURN_DELTA: num(0.15, 0.05, 1),
  CHALLENGE_BLINK_RATIO: num(0.65, 0.1, 0.95),

  // Scan state machine
  STABLE_FRAMES: num(3, 1, 20),
  UNKNOWN_AFTER_FRAMES: num(4, 1, 30),
  SCAN_SESSION_TIMEOUT_MS: num(25000, 3000, 300000),

  // Uploads
  MAX_UPLOAD_BYTES: num(2 * 1024 * 1024, 10 * 1024, 20 * 1024 * 1024),
  MAX_IMAGE_DIMENSION: num(4096, 320, 10000),
  MIN_IMAGE_DIMENSION: num(160, 32, 2000),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

function load(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration (check backend/.env):\n${lines.join('\n')}`);
  }
  const c = parsed.data;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: c.APP_TIMEZONE });
  } catch {
    throw new Error(`Invalid configuration: APP_TIMEZONE "${c.APP_TIMEZONE}" is not a valid IANA time zone`);
  }
  if (c.HIGH_CONFIDENCE_THRESHOLD > c.RECOGNITION_THRESHOLD) {
    throw new Error('Invalid configuration: HIGH_CONFIDENCE_THRESHOLD must be <= RECOGNITION_THRESHOLD');
  }
  const allowedChallenges = ['turn_left', 'turn_right', 'blink'];
  const bad = c.CHALLENGE_TYPES.filter((t) => !allowedChallenges.includes(t));
  if (bad.length) throw new Error(`Invalid configuration: unknown CHALLENGE_TYPES ${bad.join(', ')}`);
  if (c.CHALLENGE_ENABLED && c.CHALLENGE_TYPES.length === 0) {
    throw new Error('Invalid configuration: CHALLENGE_TYPES is empty while CHALLENGE_ENABLED=true');
  }
  c.isProduction = c.NODE_ENV === 'production';
  // The CRA dev server (npm start in frontend/) proxies /api from :3000.
  if (c.NODE_ENV === 'development' && c.CORS_ORIGINS.length === 0) c.CORS_ORIGINS = ['http://localhost:3000'];
  c.cookieSecure = c.COOKIE_SECURE === 'auto' ? c.isProduction : c.COOKIE_SECURE === 'true';
  return c;
}

module.exports = load();
module.exports.load = load;
Object.freeze(module.exports);
