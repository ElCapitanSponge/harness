// A token count in a few characters: 950, 6.6k, 33k, 1.2M.
export const compact = (n: number): string => {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 10_000) {
    return `${String(Math.round(n / 1000))}k`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
};

export interface SentTime {
  // Short, for beside the message: `14:32` for today, `3 Nov, 14:32` for an earlier day, with the year when it is not this one.
  text: string;
  // The full date and time with the zone, for hover and focus.
  full: string;
  // For the time element's dateTime.
  iso: string;
}

const dayKey = (d: Date, timeZone: string | undefined): string => {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};

// When a message was sent, from the gateway's time in milliseconds since the epoch (UTC), shown in the browser's zone. Nothing for an
// event stored before times were kept, so an old conversation shows no time and not a wrong one.
export const sentTime = (at: number | undefined, now: number = Date.now(), opts: { locale?: string; timeZone?: string } = {}): SentTime | undefined => {
  if (at === undefined || !Number.isFinite(at)) {
    return undefined;
  }
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) {
    return undefined;
  }
  const { locale, timeZone } = opts;
  // Always the 24-hour clock (`14:32`), whatever the language, so it reads the same everywhere.
  const clock = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const day = dayKey(d, timeZone);
  const current = dayKey(new Date(now), timeZone);
  const today = day === current;
  const sameYear = day.slice(0, 4) === current.slice(0, 4);
  const date = new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(d);
  return {
    text: today ? clock : `${date}, ${clock}`,
    full: new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "full", timeStyle: "long" }).format(d),
    iso: d.toISOString(),
  };
};
