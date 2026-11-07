import { useState, useEffect } from 'react';
import {
  SUPPORTED_CRISIS_COUNTRIES,
  CRISIS_DIRECTORY_VERSION,
  type CountryCrisisProfile,
} from '../data/crisisDirectory';

const STORAGE_KEY_COUNTRY = 'lifted_crisis_country';

export class CrisisDirectoryService {
  private currentCountryCode: 'PH' | 'US' | 'CA' | 'GB' | 'AU' = 'PH';
  private listeners: Set<(profile: CountryCrisisProfile) => void> = new Set();

  constructor() {
    this.currentCountryCode = this.loadInitialCountry();
  }

  getVersion(): string {
    return CRISIS_DIRECTORY_VERSION;
  }

  getAllCountries(): CountryCrisisProfile[] {
    return SUPPORTED_CRISIS_COUNTRIES;
  }

  getCurrentCountryCode(): 'PH' | 'US' | 'CA' | 'GB' | 'AU' {
    return this.currentCountryCode;
  }

  getCurrentProfile(): CountryCrisisProfile {
    const found = SUPPORTED_CRISIS_COUNTRIES.find((c) => c.countryCode === this.currentCountryCode);
    return found || SUPPORTED_CRISIS_COUNTRIES[0];
  }

  getProfileByCode(code: string): CountryCrisisProfile | undefined {
    return SUPPORTED_CRISIS_COUNTRIES.find((c) => c.countryCode === code.toUpperCase());
  }

  setCountry(code: 'PH' | 'US' | 'CA' | 'GB' | 'AU'): CountryCrisisProfile {
    this.currentCountryCode = code;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_COUNTRY, code);
      } catch {
        /* Ignore */
      }
    }
    const profile = this.getCurrentProfile();
    this.notify(profile);
    return profile;
  }

  subscribe(listener: (profile: CountryCrisisProfile) => void): () => void {
    this.listeners.add(listener);
    listener(this.getCurrentProfile());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(profile: CountryCrisisProfile): void {
    for (const listener of this.listeners) {
      try {
        listener(profile);
      } catch (err) {
        console.error('CrisisDirectory listener error:', err);
      }
    }
  }

  /**
   * Sanitizes phone number and returns a valid tel: protocol URI
   */
  formatTelUri(phoneNumber?: string): string {
    if (!phoneNumber) return '#';
    const cleaned = phoneNumber.replace(/[^\d+]/g, '');
    return `tel:${cleaned}`;
  }

  /**
   * Generates a cross-platform SMS URI with optional pre-filled body
   */
  formatSmsUri(smsNumber?: string, smsBody?: string): string {
    if (!smsNumber) return '#';
    const cleaned = smsNumber.replace(/[^\d+]/g, '');
    if (!smsBody) return `sms:${cleaned}`;

    const encodedBody = encodeURIComponent(smsBody);
    // Standard cross-platform format
    return `sms:${cleaned}?body=${encodedBody}`;
  }

  /**
   * Heuristic device timezone detection without requiring GPS location permissions
   */
  detectLocaleCountry(): 'PH' | 'US' | 'CA' | 'GB' | 'AU' {
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const tzLower = timeZone.toLowerCase();

      if (tzLower.includes('manila') || tzLower.includes('asia/manila')) {
        return 'PH';
      }
      if (tzLower.includes('london') || tzLower.includes('europe/london') || tzLower.includes('belfast')) {
        return 'GB';
      }
      if (
        tzLower.includes('toronto') ||
        tzLower.includes('vancouver') ||
        tzLower.includes('montreal') ||
        tzLower.includes('edmonton') ||
        tzLower.includes('winnipeg') ||
        tzLower.includes('halifax')
      ) {
        return 'CA';
      }
      if (
        tzLower.includes('sydney') ||
        tzLower.includes('melbourne') ||
        tzLower.includes('brisbane') ||
        tzLower.includes('perth') ||
        tzLower.includes('adelaide') ||
        tzLower.includes('hobart') ||
        tzLower.includes('darwin')
      ) {
        return 'AU';
      }
      if (
        tzLower.includes('new_york') ||
        tzLower.includes('chicago') ||
        tzLower.includes('los_angeles') ||
        tzLower.includes('denver') ||
        tzLower.includes('phoenix') ||
        tzLower.includes('anchorage') ||
        tzLower.includes('honolulu') ||
        tzLower.includes('america/')
      ) {
        return 'US';
      }
    } catch {
      /* Fallback to default */
    }

    return 'PH';
  }

  private loadInitialCountry(): 'PH' | 'US' | 'CA' | 'GB' | 'AU' {
    if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY_COUNTRY);
        if (stored && ['PH', 'US', 'CA', 'GB', 'AU'].includes(stored)) {
          return stored as 'PH' | 'US' | 'CA' | 'GB' | 'AU';
        }
      } catch {
        /* Ignore */
      }
    }
    return this.detectLocaleCountry();
  }
}

export const crisisDirectoryService = new CrisisDirectoryService();

/**
 * Custom React Hook for accessing localized offline crisis support
 */
export function useCrisisDirectory(): {
  currentCountry: CountryCrisisProfile;
  allCountries: CountryCrisisProfile[];
  setCountry: (code: 'PH' | 'US' | 'CA' | 'GB' | 'AU') => void;
  formatTelUri: (phone?: string) => string;
  formatSmsUri: (sms?: string, body?: string) => string;
} {
  const [currentCountry, setCurrentCountry] = useState<CountryCrisisProfile>(() =>
    crisisDirectoryService.getCurrentProfile()
  );

  useEffect(() => {
    return crisisDirectoryService.subscribe(setCurrentCountry);
  }, []);

  return {
    currentCountry,
    allCountries: crisisDirectoryService.getAllCountries(),
    setCountry: (code) => crisisDirectoryService.setCountry(code),
    formatTelUri: (phone) => crisisDirectoryService.formatTelUri(phone),
    formatSmsUri: (sms, body) => crisisDirectoryService.formatSmsUri(sms, body),
  };
}
