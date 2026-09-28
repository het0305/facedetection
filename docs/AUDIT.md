# Audit and hardening record

Date: 2026-09-28 · Branch: `hardening`

## 1. Original system

- React 19 (CRA) + `react-webcam`; Express 5 + Mongoose; `face-api.js` 0.22
  (unmaintained since 2020) on pure-JS TensorFlow (CPU).
- Detection: TinyFaceDetector at 320 px on a 320×240 capture. Embedding: face-api
  128-d ResNet descriptor. Matching: nearest neighbour under a hard-coded
  Euclidean distance of 0.5 against **one** image per student.
- No liveness, no authentication, no validation, no tests (the single test failed).
- Attendance: find-then-insert per server-local day; every scan rewrote an
  Excel file with only the current day's rows.

### Measured on the existing data (14 students)

- 50 of 91 student pairs were closer than the 0.5 acceptance threshold; the
  closest pair was 0.114 apart.
- Clustering showed 10 of the 14 records are almost certainly the same person
  registered under different roll numbers. With nearest-neighbour matching, that
  person's attendance went to whichever record happened to be nearest.
- Re-embedding stored upload photos with the new engine matched their stored
  embeddings at distance 0.04–0.35 with the runner-up only 0.002–0.03 further
  away — i.e. identification between those records was effectively random.

## 2. Findings by severity

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | CRITICAL | No liveness: a phone photo marked attendance | Fixed: passive MiniFASNet + server-verified challenge |
| 2 | CRITICAL | Nearest-match only, single sample, uncalibrated threshold → wrong identities | Fixed: threshold + margin rule, multi-frame stability, multi-sample enrollment, evaluation tooling |
| 3 | CRITICAL | Duplicate face registrations undetected (present in live data) | Fixed: blocked at registration; duplicates report in admin |
| 4 | CRITICAL | No authentication on any endpoint; `/uploads` face photos public; CORS `*` | Fixed: admin sessions, kiosk device tokens, CSRF guard, no static uploads |
| 5 | CRITICAL | Face photos + attendance sheets committed to a public GitHub repo | Stopped for new data (`.gitignore`; nothing is written any more). History left unchanged at the owner's request |
| 6 | CRITICAL | Registration response returned the raw embedding | Fixed: templates `select:false`, stripped from JSON, encrypted at rest |
| 7 | HIGH | Find-then-insert race → duplicate attendance | Fixed: unique `(studentId, dayKey)` index + duplicate-key handling |
| 8 | HIGH | Excel file overwritten with only today's rows; concurrent writes | Fixed: export generated from the DB for any date range |
| 9 | HIGH | `detectSingleFace` silently chose one of several faces | Fixed: exactly one face required; tracking resets on changes |
| 10 | HIGH | "No face" threw → HTTP 500 and leaked the rejected upload file | Fixed: friendly results, no disk writes |
| 11 | HIGH | Every attendance photo kept forever (incl. unknown people), unreferenced | Fixed: uploads processed in memory only |
| 12 | HIGH | `require('../models/Student')` vs `student.js` — crashes on Linux | Fixed (new module layout) |
| 13 | HIGH | Internal error messages returned to clients | Fixed: central error handler with request ids |
| 14 | MEDIUM | Weak detector/resolution; no quality gate | Fixed: SSD MobileNet, 640–960 px frames, quality gate with guidance |
| 15 | MEDIUM | Slow unmaintained engine | Fixed: `@vladmandic/face-api` (same model family, compatible embeddings), WASM/native backend |
| 16 | MEDIUM | Server-local day boundaries and locale | Fixed: `APP_TIMEZONE`, UTC storage, `dayKey` |
| 17 | MEDIUM | Crash when a student referenced by attendance is deleted | Fixed: name/ID snapshot on every record |
| 18 | MEDIUM | No input validation; uploads checked by extension only | Fixed: zod schemas; magic bytes; decoder caps |
| 19 | MEDIUM | No rate limiting, logging or audit trail | Fixed |
| 20 | LOW | Hard-coded URLs/thresholds | Fixed: config module + `.env.example` |
| 21 | LOW | Dependency clutter (`fs`/`path` placeholder packages, `react-router-dom` in backend, tracked `node_modules`, duplicate model folders) | Fixed in `backend/`; root `package.json`/`models/` left untouched (unused by the app) |
| 22 | LOW | Broken default test | Replaced with real tests |
| 23 | LOW | Manual-capture UI, `alert()`, disappearing messages, no admin tools | Rebuilt |

Also found during the work:

- The repository was mid-way through a stale interactive rebase and `main` was 9
  commits behind `origin/main` (whose history deletes `backend/`). The rebase
  bookkeeping was dropped with `git rebase --quit` (no file changes) and all
  work was done on a new `hardening` branch. **Reconciling with `origin/main` is
  left to the owner.**
- `@tensorflow/tfjs-node` has no prebuilt binary for Windows + Node 22 (404), so
  the WASM backend is the default there.

## 3. Changes

Each entry: problem → why it matters → solution → side effects → how tested.

### Recognition decision (`backend/src/services/matcher.js`, `gallery.js`, `scanSession.js`)
- **Problem**: nearest face under 0.5 was accepted from a single frame.
- **Why**: with similar or duplicate identities this assigns attendance to the
  wrong person — the worst failure for this system.
- **Solution**: accept only if distance ≤ `RECOGNITION_THRESHOLD` *and* the
  runner-up person is ≥ `RECOGNITION_MIN_MARGIN` further; require the same
  identity on 3 (or 5 for non-high-confidence) consecutive good frames in one
  continuous track; re-confirm after the liveness challenge; distance to the
  first accepted embedding must stay consistent within the track.
- **Side effects**: people registered several times are now answered
  "Unable to verify identity" until duplicates are removed (intended).
- **Tested**: `unit.recognition.test.js`, `unit.scanSession.test.js` (unknown,
  ambiguous, identity switch, track break, multiple faces), real-model
  `integration.engine.test.js`.

### Multi-sample enrollment + quality gate (`enrollmentService.js`, `quality.js`, `faceGeometry.js`)
- **Problem**: one unvalidated photo per person.
- **Solution**: 3–8 samples from guided poses; each sample must have exactly
  one face, pass size/blur/brightness/contrast/over-exposure/roll/yaw/pitch
  checks, match the requested pose, pass liveness, and all samples must be
  mutually consistent. Matching uses nearest-sample distance (centroid is
  available via `MATCH_STRATEGY` and compared by the evaluation script).
- **Tested**: quality/pose unit tests; check-sample and registration e2e with real images.

### Liveness (`liveness.js`, `faceEngine.js#antispoofInput`)
- **Solution**: MiniFASNetV2 (crop ×2.7) + MiniFASNetV1SE (×4.0), 80×80 BGR
  raw-pixel NCHW input per the reference implementation, mean "real" softmax
  probability; randomised head-turn challenge verified from landmark yaw on the
  server, with a timeout and wrong-direction limit.
- **Measured**: 8 real webcam frames scored 0.89–0.998. Attack performance has
  **not** been measured yet (no attack samples available) — run
  `npm run evaluate-liveness` with printed/phone/screen captures.
- **Tested**: in a browser with a still-photo camera feed the kiosk reached the
  challenge and ended with "Liveness check was not completed" (no record).

### Attendance integrity (`attendanceService.js`, `models/Attendance.js`, `utils/time.js`)
- Unique index on `(studentId, dayKey)`; `dayKey` computed in `APP_TIMEZONE`;
  optional `LATE_AFTER`; in-memory cooldown; verification evidence (distance,
  confidence, liveness, challenge, device) stored per record; name/ID snapshot.
- **Tested**: 10 concurrent check-ins → exactly 1 record; DB rejects a
  duplicate; timezone and late-rule tests; second kiosk session same day →
  "already marked".

### Security (`middleware/*`, `routes/auth.js`, `utils/biometricCrypto.js`, `app.js`)
- Admin accounts (bcrypt 12, lockout, rate limit, revocable JWT cookies),
  kiosk device tokens with a separate audience, CSRF header + Origin check,
  helmet/CSP, zod validation, memory-only uploads with magic-byte checks,
  AES-256-GCM template encryption, redacting logger, audit log.
- **Tested**: `api.security.test.js` — every admin route rejects anonymous
  calls; CSRF/origin; generic login errors; NoSQL injection; lockout; logout
  revocation; forged/`alg:none` tokens; kiosk-token scope and revocation;
  disguised/oversized/SVG uploads; no biometric fields in responses; headers.

### Data migration (`migrations/index.js`)
- Idempotent at every start: legacy `embeddings` → encrypted `samples`
  (flagged `hasLegacySample`), legacy attendance → `dayKey`/`checkInAt`/snapshot,
  duplicate check before the unique index is built.
- A full JSON backup of the database was taken first
  (`backend/backups/`, git-ignored). It contains the old **plaintext**
  embeddings — delete it once you are satisfied.
- **Tested**: migration test with legacy documents (run twice); applied to the
  real database (14 students, 17 attendance records).

### Secrets
- `backend/.env` untracked; `.env.example` added; fresh `JWT_SECRET` and
  `BIOMETRIC_KEY` generated. During the work an intermediate local commit
  briefly contained the new `.env`; it was never pushed, the branch was
  rewritten without it, and both secrets were rotated afterwards
  (`npm run rotate-keys`), so the unreachable object holds no live secret.

### Frontend (`frontend/src/**`)
- Kiosk with continuous scanning, face box, status/progress, challenge cue,
  result card, device activation; guided registration wizard with live
  server feedback and auto-capture; admin dashboard, users, attendance,
  settings; friendly error handling; old URLs redirect.
- **Tested**: Jest/RTL tests; production build with lint-as-error; headless
  Edge run with a fake camera: full kiosk success path, "already marked",
  challenge failure for a still feed, no console errors, no horizontal
  overflow at 390 px.

## 4. Remaining risks and recommendations

1. **Calibrate** `RECOGNITION_THRESHOLD` and `LIVENESS_THRESHOLD` with the
   evaluation scripts on real users and real attack samples before go-live.
2. **Resolve the duplicate cluster** in the existing data (10 records) and
   re-register migrated users.
3. Consider purging the face photos from the public git history
   (`git filter-repo`) — they remain visible in old commits.
4. For stronger anti-spoofing, use an IR/depth camera; a single RGB camera
   cannot defeat high-quality masks or injected video streams.
5. Rotation-invariant alignment (similarity transform to the eye line) could
   further improve accuracy; the roll limit in the quality gate compensates
   for now.
6. The kiosk scan session store is in-memory (single instance).
