# FaceAttend — Face Recognition Attendance

Contactless attendance: a kiosk camera recognises registered people, verifies
they are physically present (not a photo or screen), and records one check-in
per person per day. Administrators register people, review attendance and
manage kiosk devices from a web console.

```
Camera (kiosk browser)
  → frames every ~0.3 s ─────────────────────────────▶ Backend /api/kiosk/scan
                                                        ├─ decode (magic bytes, size caps)
                                                        ├─ detect faces (SSD MobileNet v1)
                                                        ├─ exactly one face? track continuity
                                                        ├─ quality gate (size, blur, light, pose)
                                                        ├─ passive liveness (MiniFASNet ×2)
                                                        ├─ 128-d embedding (face-api ResNet)
                                                        ├─ match: threshold + margin vs runner-up
                                                        ├─ same identity on N frames
                                                        ├─ random head-turn challenge
                                                        ├─ re-confirm identity
                                                        └─ insert attendance (unique per day)
  ◀── state + message (“Verifying identity…”, “Attendance marked successfully.”)
```

All decisions are made on the server; the browser only displays state.

## Stack

| Part | Technology |
|---|---|
| Frontend | React 19 (Create React App), react-router 7 |
| Backend | Node.js ≥ 20, Express 5, Mongoose 8 (MongoDB) |
| Face engine | [@vladmandic/face-api](https://github.com/vladmandic/face-api) on TensorFlow.js — WASM backend, or native `@tensorflow/tfjs-node` automatically when installed |
| Liveness | Silent-Face MiniFASNetV2 + MiniFASNetV1SE (Apache-2.0) via onnxruntime-node, plus a server-verified head-turn challenge |

## Setup

Prerequisites: Node.js 20+, MongoDB 6+ running locally (or a connection string).

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env         # then fill JWT_SECRET and BIOMETRIC_KEY (commands are in the file)
npm run models               # verifies/downloads the anti-spoofing models (already in the repo)
npm run create-admin -- admin    # prompts for a password (10+ chars, letters and numbers)
npm start                    # http://localhost:5000

# 2. Frontend (development)
cd ../frontend
npm install
npm start                    # http://localhost:3000, proxies /api to :5000
```

**Production:** `cd frontend && npm run build`, then `NODE_ENV=production npm start`
in `backend/`. The backend serves the built frontend from the same origin.
Serve it over **HTTPS** (browsers only allow camera access on HTTPS or
localhost; session cookies are `Secure` in production).

On Linux servers, `npm install @tensorflow/tfjs-node` in `backend/` makes
inference several times faster; it is picked up automatically
(`FACE_BACKEND=auto`). On Windows with Node 22 no prebuilt binary exists, so
the WASM backend is used (~300–400 ms per frame on a laptop CPU).

### First run checklist

1. Sign in at `/admin`.
2. **Users → Possible duplicates**: records that look like the same person are
   listed here. Until resolved (delete/deactivate the extras), that person is
   answered with “Unable to verify identity” — by design.
3. **Users → Needs re-registration**: people migrated from the old single-photo
   system. Re-register them with the guided capture.
4. On the kiosk device: sign in, open `/kiosk`, click **Activate this device**,
   then sign out. The kiosk keeps a device token (revocable in Settings).

## How recognition decides

- Every person has 3–8 samples captured from guided poses (straight, slight
  left, slight right). Samples are quality-checked, liveness-checked and must
  be consistent with each other before anything is saved.
- A probe matches a person when its nearest sample is within
  `RECOGNITION_THRESHOLD` **and** the second-best *other* person is at least
  `RECOGNITION_MIN_MARGIN` further away. Otherwise the answer is “Face not
  recognized” / “Unable to verify identity”. The system never just picks the
  nearest face.
- The same identity must be accepted on `STABLE_FRAMES` consecutive good
  frames (2 more if the match is not high-confidence) inside one continuous
  face track. Any second face, lost track or identity change resets progress.
- Registering a face that matches an existing person
  (`DUPLICATE_FACE_THRESHOLD`) is blocked unless an admin explicitly confirms;
  the override is audit-logged.

## Liveness

1. **Passive**: two MiniFASNet models score every good frame; the mean over at
   least `LIVENESS_MIN_FRAMES` frames must reach `LIVENESS_THRESHOLD`, and two
   frames below `LIVENESS_HARD_FAIL` end the attempt as a suspected spoof.
2. **Active**: a random challenge (`turn_left` / `turn_right`, optionally
   `blink`) must be performed by the tracked face within
   `CHALLENGE_TIMEOUT_MS`, followed by a frontal frame that matches the same
   identity again.

Limits: with a single RGB webcam no method is perfect. This stops printed
photos, phone/monitor screens and simple replays. A determined attacker with a
high-quality 3D mask, or who can inject a video stream into the kiosk browser,
is out of scope — use supervised kiosks and depth/IR cameras if that is a threat.

## Configuration

All tunables are environment variables, documented in
[`backend/.env.example`](backend/.env.example). The important ones:

| Variable | Default | Meaning |
|---|---|---|
| `RECOGNITION_THRESHOLD` | 0.5 | Max embedding distance to accept an identity (lower = stricter) |
| `HIGH_CONFIDENCE_THRESHOLD` | 0.4 | Below this the match is “high confidence” (fewer frames needed) |
| `RECOGNITION_MIN_MARGIN` | 0.06 | Required gap to the runner-up person |
| `DUPLICATE_FACE_THRESHOLD` | 0.42 | Registration is flagged below this distance to an existing person |
| `STABLE_FRAMES` | 3 | Consecutive accepted frames before liveness/challenge |
| `LIVENESS_THRESHOLD` | 0.6 | Mean passive liveness score required |
| `CHALLENGE_TYPES` | `turn_left,turn_right` | Active challenges to pick from |
| `MIN_FACE_SIZE_PX` / `MIN_SHARPNESS` / `MIN_BRIGHTNESS` … | see file | Face quality gate |
| `APP_TIMEZONE` | system | Attendance day boundaries and “late” |
| `LATE_AFTER` | empty | `HH:MM` local time after which check-ins are “Late” |
| `ATTENDANCE_COOLDOWN_SEC` | 60 | Re-recognitions within this window skip the DB |

**Do not treat the defaults as calibrated.** Measure them on your camera and
people (next section) before production.

## Measuring accuracy (do this before go-live)

```bash
cd backend
npm run evaluate -- <dataset>                     # recognition
npm run evaluate-liveness -- --live <dir> --spoof <dir>
npm run probe -- <folder>                         # per-image quality/liveness numbers
```

Recognition dataset layout — enrollment and probe photos must be **different
captures** (different day/lighting), never the same images:

```
dataset/
  alice/enroll/*.jpg   alice/probe/*.jpg
  bob/enroll/*.jpg     bob/probe/*.jpg
  _unknown/**/*.jpg    # people who are NOT enrolled
```

The report (written to `evaluation/`, git-ignored) contains detection success
rate, genuine/impostor distance distributions, FAR / FRR / TAR per threshold,
EER, 1:N identification accuracy with the production margin rule, unknown-person
rejection, per-frame latency, and a recommended threshold (largest one with
zero observed false accepts, minus a safety margin). With few impostor
comparisons the report states the statistical upper bound on FAR — collect
more people for a tighter bound. Liveness reports APCER (attacks accepted) and
BPCER (real people rejected) per threshold and per attack type.

## Security model

- **Admins** sign in with bcrypt-hashed passwords; sessions are httpOnly,
  SameSite=Strict JWT cookies (8 h) revocable server-side (logout, password
  change). 5 failed logins lock the account for 15 minutes; login is also
  rate-limited per IP.
- **Kiosks** hold a separate device token that can only call the scan endpoint.
  Revoke devices in Settings.
- Every state-changing request requires `X-Requested-With` and an allowed
  `Origin` (CSRF defence on top of SameSite). Helmet security headers, CSP,
  per-route rate limits, 20 kB JSON limit.
- All input is validated server-side with zod (types, lengths, character sets,
  ObjectIds, dates) — Mongo operator injection is not possible.
- Uploads stay in memory, are size-limited, and are decoded by pure-JS decoders
  only after magic-byte checks with resolution caps. **No face images are
  stored**; `/uploads` is no longer served.
- Face templates are **AES-256-GCM encrypted** with `BIOMETRIC_KEY`, excluded
  from every query by default and never returned by any API.
  Back up `BIOMETRIC_KEY` — losing it means everyone must re-register.
  Rotate keys with `npm run rotate-keys`.
- Logs are structured JSON with automatic redaction of passwords, tokens and
  biometric fields. Administrative and security events (registrations,
  deletions, exports, overrides, failed logins, spoof attempts) go to an audit
  log viewable in Settings.

## Tests

```bash
cd backend && npm test        # 58 tests: unit, API security, attendance integrity, real-model e2e
cd frontend && npm test       # routing, auth guards, error states, API client, validation
```

The real-model end-to-end test uses local face photos of one person from
`FACE_TEST_DIR` (default `backend/uploads`) and is skipped if none exist. API
tests use a separate database (`faceattendance_test`) on the local MongoDB.

### Manual test checklist (run on the real kiosk hardware)

| Area | Scenario | Expected |
|---|---|---|
| Recognition | Registered person, normal light | Marked within ~3–5 s |
| | Same person again | “Attendance already marked today.” |
| | Not registered | “Face not recognized.” — nothing recorded |
| | Look-alike / sibling | Not marked as the other person (“Unable to verify identity” is acceptable) |
| | Glasses on/off, different hairstyle | Recognized (re-register if not) |
| | Dim room / strong backlight | Guidance (“Lighting is too low…”) rather than a wrong match |
| | Far away / too close / head tilted | “Move closer…”, “Move back…”, “Please keep your head straight.” |
| Liveness | Printed photo of a registered person | Never marked |
| | Photo / video on a phone or monitor | Never marked |
| | Real person ignores the head-turn prompt | “Liveness check was not completed.” |
| Multiple people | Two faces in frame | “Please ensure only one person is visible.” — progress resets |
| | Person A starts, person B steps in | Never records A or B from mixed frames |
| Attendance | Stay in front of the camera for 30 s | Exactly one record |
| | Restart server, scan again same day | Still one record |
| | Check-in shortly after local midnight | Counted on the new local day |
| Security | Open `/admin` signed out | Redirected to sign in |
| | Revoke the kiosk in Settings | Kiosk shows “not activated” |
| UI | Deny camera permission | “Unable to access the camera. Please check camera permissions.” |
| | Stop the backend while scanning | Friendly retry message, recovers automatically |
| | Phone / tablet widths | No horizontal scrolling; all actions reachable |

## Operations

- `npm run create-admin -- <user>` also resets a forgotten password.
- `npm run rotate-keys` re-encrypts all templates with a new key and signs
  everyone out.
- The scan session store is in-memory: run a single backend instance (or use
  sticky sessions) per kiosk group.
- Back up MongoDB **and** `backend/.env` together.

See [`docs/AUDIT.md`](docs/AUDIT.md) for the audit findings and a record of
every change made during hardening.
