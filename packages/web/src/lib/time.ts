// "2h 10m", "35m" or "now": how long until a time, for a countdown to a reset.
export const timeUntil = (at: number, now: number = Date.now()): string => {
  const minutes = Math.max(0, Math.round((at - now) / 60_000));
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return `${String(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${String(hours)}h ${String(minutes % 60)}m`;
  }
  return `${String(Math.floor(hours / 24))}d ${String(hours % 24)}h`;
};

// A time of day in the viewer's own time zone, with the weekday when it is not today.
export const clockTime = (at: number, now: number = Date.now()): string => {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return date.toDateString() === new Date(now).toDateString() ? time : `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
};
