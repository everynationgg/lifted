import { describe, it, expect } from 'vitest';
import {
  getLocalDateString,
  isTodayLocal,
  formatLocalTime,
  generateMessageId,
} from '../dateUtils';

describe('dateUtils - Timezone-Aware Local Date Handling', () => {
  it('formats a date to YYYY-MM-DD format', () => {
    const fixedDate = new Date(2026, 9, 31, 14, 30, 0); // Oct 31, 2026
    const str = getLocalDateString(fixedDate);
    expect(str).toBe('2026-10-31');
  });

  it('correctly matches today local date', () => {
    const today = new Date();
    const todayStr = getLocalDateString(today);
    expect(isTodayLocal(todayStr, today)).toBe(true);
  });

  it('rejects stale or mismatched check-in dates', () => {
    const today = new Date(2026, 9, 31);
    expect(isTodayLocal('2026-10-30', today)).toBe(false);
    expect(isTodayLocal('2026-11-01', today)).toBe(false);
    expect(isTodayLocal(null, today)).toBe(false);
    expect(isTodayLocal(undefined, today)).toBe(false);
    expect(isTodayLocal('', today)).toBe(false);
  });

  it('formats local time as a readable string', () => {
    const timeStr = formatLocalTime(new Date());
    expect(typeof timeStr).toBe('string');
    expect(timeStr.length).toBeGreaterThan(0);
  });

  it('generates unique event-driven message IDs', () => {
    const userMsgId = generateMessageId('user');
    const aiMsgId = generateMessageId('ai');
    expect(userMsgId.startsWith('user-')).toBe(true);
    expect(aiMsgId.startsWith('ai-')).toBe(true);
    expect(userMsgId).not.toBe(aiMsgId);
  });

  it('avoids UTC off-by-one boundary shift', () => {
    // 11:30 PM local time on Oct 31
    const lateNightDate = new Date(2026, 9, 31, 23, 30, 0);
    const localStr = getLocalDateString(lateNightDate);
    expect(localStr).toBe('2026-10-31');
  });
});
