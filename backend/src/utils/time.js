// All timestamps are stored in UTC. "Attendance day" and "late" rules are
// evaluated in the configured APP_TIMEZONE so a server running in UTC still
// splits days at local midnight.
const config = require('../config');

function partsIn(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { dayKey: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
}

const dayKeyOf = (date = new Date(), timeZone = config.APP_TIMEZONE) => partsIn(date, timeZone).dayKey;

function isLate(date, lateAfter = config.LATE_AFTER, timeZone = config.APP_TIMEZONE) {
  if (!lateAfter) return false;
  return partsIn(date, timeZone).hhmm > lateAfter;
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = { dayKeyOf, isLate, partsIn, DAY_KEY_RE };
