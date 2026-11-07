/**
 * Date utilities for timezone-aware local date calculations.
 * Ensures consistent YYYY-MM-DD date strings based on the user's local device calendar,
 * avoiding the UTC off-by-one errors caused by Date.prototype.toISOString().
 */

/**
 * Returns a date formatted as 'YYYY-MM-DD' in the specified (or local) timezone.
 */
export function getLocalDateString(d: Date = new Date()): string {
  // 'en-CA' outputs ISO-formatted 'YYYY-MM-DD' in the environment's local timezone
  return d.toLocaleDateString('en-CA');
}

/**
 * Formats current local time as 'HH:MM AM/PM'.
 */
export function formatLocalTime(d: Date = new Date()): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Generates an event-driven deterministic unique message ID.
 */
export function generateMessageId(prefix: 'user' | 'ai'): string {
  return `${prefix}-${Date.now()}`;
}

/**
 * Checks whether the provided date string matches today's local date.
 */
export function isTodayLocal(dateStr: string | null | undefined, now: Date = new Date()): boolean {
  if (!dateStr) return false;
  return dateStr.trim() === getLocalDateString(now);
}
