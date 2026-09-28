// Date/time helpers. `timeZone` comes from the server (APP_TIMEZONE) so the
// admin console shows the same local times the attendance rules use.
export function formatTime(value, timeZone) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(value));
}

export function formatDateTime(value, timeZone) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value));
}

export function formatDate(value, timeZone) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone }).format(new Date(value));
}

/** "2026-09-28" -> localized date without timezone shifting. */
export function formatDayKey(dayKey) {
  if (!dayKey) return '';
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
}

/** Today's YYYY-MM-DD in the given zone. */
export function todayKey(timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
}

// Mirrors the server-side validation so users get instant feedback.
export const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;
export const ROLL_RE = /^[A-Za-z0-9][A-Za-z0-9/_-]*$/;

export function validateName(v) {
  const s = v.trim();
  if (s.length < 2) return 'Name must be at least 2 characters.';
  if (s.length > 100) return 'Name is too long.';
  if (!NAME_RE.test(s)) return "Name may only contain letters, spaces and . ' -";
  return null;
}

export function validateRollNo(v) {
  const s = v.trim();
  if (!s) return 'ID is required.';
  if (s.length > 32) return 'ID is too long.';
  if (!ROLL_RE.test(s)) return 'ID may only contain letters, numbers and / _ -';
  return null;
}
