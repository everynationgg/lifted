import { describe, it, expect, beforeEach } from 'vitest';
import { CrisisDirectoryService } from '../crisisDirectoryService';
import { SUPPORTED_CRISIS_COUNTRIES } from '../../data/crisisDirectory';

describe('CrisisDirectoryService', () => {
  let service: CrisisDirectoryService;

  beforeEach(() => {
    localStorage.clear();
    service = new CrisisDirectoryService();
  });

  it('provides all 5 core supported country profiles', () => {
    const countries = service.getAllCountries();
    expect(countries.length).toBe(5);
    const codes = countries.map((c) => c.countryCode);
    expect(codes).toContain('PH');
    expect(codes).toContain('US');
    expect(codes).toContain('CA');
    expect(codes).toContain('GB');
    expect(codes).toContain('AU');
  });

  it('includes verified hotlines with non-empty verification sources and dates', () => {
    for (const country of SUPPORTED_CRISIS_COUNTRIES) {
      expect(country.resources.length).toBeGreaterThan(0);
      for (const res of country.resources) {
        expect(res.name).toBeTruthy();
        expect(res.operatingHours).toBe('24/7');
        expect(res.officialVerificationSource).toBeTruthy();
        expect(res.lastVerificationDate).toMatch(/^\d{4}-\d{2}$/);
      }
    }
  });

  it('verifies Philippine hotlines contain NCMH 1553 toll-free and mobile', () => {
    const ph = service.getProfileByCode('PH');
    expect(ph).toBeDefined();
    const ncmh = ph?.resources.find((r) => r.phoneNumber === '1553');
    expect(ncmh).toBeDefined();
    expect(ncmh?.isTollFree).toBe(true);

    const mobile = ph?.resources.find((r) => r.phoneNumber === '0917-899-8727');
    expect(mobile).toBeDefined();
  });

  it('verifies UK resources distinguish NHS 111 urgent care from Samaritans 116 123 listening', () => {
    const gb = service.getProfileByCode('GB');
    expect(gb).toBeDefined();
    const nhs111 = gb?.resources.find((r) => r.phoneNumber === '111');
    const samaritans = gb?.resources.find((r) => r.phoneNumber === '116 123');

    expect(nhs111?.serviceType).toBe('urgent_mental_health');
    expect(samaritans?.serviceType).toBe('emotional_listening');
  });

  it('allows manual country switching and notifies subscribers', () => {
    let notifiedCountry = '';
    const unsubscribe = service.subscribe((profile) => {
      notifiedCountry = profile.countryCode;
    });

    service.setCountry('GB');
    expect(service.getCurrentCountryCode()).toBe('GB');
    expect(notifiedCountry).toBe('GB');

    service.setCountry('AU');
    expect(service.getCurrentCountryCode()).toBe('AU');
    expect(notifiedCountry).toBe('AU');

    unsubscribe();
  });

  it('formats tel: and sms: URIs correctly', () => {
    expect(service.formatTelUri('1553')).toBe('tel:1553');
    expect(service.formatTelUri('0917-899-8727')).toBe('tel:09178998727');
    expect(service.formatTelUri('+1 (800) 273-8255')).toBe('tel:+18002738255');
    expect(service.formatTelUri(undefined)).toBe('#');

    expect(service.formatSmsUri('741741', 'HOME')).toBe('sms:741741?body=HOME');
    expect(service.formatSmsUri('85258', 'SHOUT')).toBe('sms:85258?body=SHOUT');
    expect(service.formatSmsUri(undefined)).toBe('#');
  });
});
