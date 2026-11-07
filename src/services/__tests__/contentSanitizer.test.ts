import { describe, it, expect } from 'vitest';
import {
  sanitizeMarkdown,
  sanitizePlainText,
  validateSafeUrl,
} from '../contentSanitizer';

describe('Content Sanitizer & Safe Media Validator', () => {
  describe('validateSafeUrl', () => {
    it('approves trusted https video and media domains', () => {
      const trustedUrls = [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtu.be/dQw4w9WgXcQ',
        'https://vimeo.com/123456789',
        'https://player.vimeo.com/video/123456789',
        'https://everynation.org/media/sermon.mp4',
        'https://everynation.org.ph/updates',
        'https://lifted-app.com/audio/sample.mp3',
        'https://subdomain.lifted-app.com/narration.mp3',
        '/assets/audio/grounding.mp3',
      ];

      for (const url of trustedUrls) {
        const result = validateSafeUrl(url);
        expect(result.safe).toBe(true);
        expect(result.sanitizedUrl).toBeDefined();
      }
    });

    it('rejects unapproved schemes (http, javascript, data, file)', () => {
      const dangerousUrls = [
        'http://youtube.com/watch?v=insecure',
        'javascript:alert(document.cookie)',
        'data:text/html,<script>alert(1)</script>',
        'file:///etc/passwd',
        'vbscript:msgbox(1)',
      ];

      for (const url of dangerousUrls) {
        const result = validateSafeUrl(url);
        expect(result.safe).toBe(false);
        expect(result.reason).toBeDefined();
      }
    });

    it('rejects untrusted third-party hostnames and direct IP addresses', () => {
      const invalidHosts = [
        'https://malicious-site.com/exploit.mp4',
        'https://192.168.1.100/video.mp4',
        'https://not-youtube.com/watch',
      ];

      for (const url of invalidHosts) {
        const result = validateSafeUrl(url);
        expect(result.safe).toBe(false);
      }
    });

    it('handles null, undefined, and empty string safely', () => {
      expect(validateSafeUrl(null).safe).toBe(false);
      expect(validateSafeUrl(undefined).safe).toBe(false);
      expect(validateSafeUrl('').safe).toBe(false);
      expect(validateSafeUrl('   ').safe).toBe(false);
    });
  });

  describe('sanitizeMarkdown', () => {
    it('strips script, iframe, object, and style tags', () => {
      const malicious =
        'Here is good text.<script>alert("pwned")</script> And an iframe: <iframe src="evil.html"></iframe> Finished.';
      const cleaned = sanitizeMarkdown(malicious);

      expect(cleaned).not.toContain('<script>');
      expect(cleaned).not.toContain('alert("pwned")');
      expect(cleaned).not.toContain('<iframe>');
      expect(cleaned).toContain('Here is good text.');
      expect(cleaned).toContain('Finished.');
    });

    it('strips inline event handler attributes', () => {
      const malicious = '<img src="valid.jpg" onerror="alert(1)" onload="evil()" /> Safe text';
      const cleaned = sanitizeMarkdown(malicious);

      expect(cleaned).not.toContain('onerror');
      expect(cleaned).not.toContain('onload');
      expect(cleaned).toContain('Safe text');
    });

    it('neutralizes markdown javascript: links', () => {
      const malicious = 'Click [here](javascript:stealData()) to read.';
      const cleaned = sanitizeMarkdown(malicious);

      expect(cleaned).not.toContain('javascript:');
      expect(cleaned).toContain('[here](#blocked-unsafe-link)');
    });

    it('neutralizes DOM-based SVG and MathML XSS vectors', () => {
      const svgExploit = '<p>Safe</p><svg onload="alert(document.cookie)"><circle r="40"/></svg>';
      const cleaned = sanitizeMarkdown(svgExploit);
      expect(cleaned).not.toContain('<svg');
      expect(cleaned).not.toContain('onload');
      expect(cleaned).not.toContain('alert');
      expect(cleaned).toContain('Safe');
    });

    it('neutralizes nested tags and evasive casing', () => {
      const evasive = '<scr<script>ipt>alert(1)</script> <a hrEF="javaSCRIPT:exploit()">Link</a>';
      const cleaned = sanitizeMarkdown(evasive);
      expect(cleaned).not.toContain('<script>');
      expect(cleaned).not.toContain('exploit()');
      expect(cleaned).not.toContain('javaSCRIPT:');
    });

    it('unwraps disallowed HTML tags while preserving inner text', () => {
      const html = '<marquee>Important Announcement</marquee><blink>Blinking Text</blink>';
      const cleaned = sanitizeMarkdown(html);
      expect(cleaned).not.toContain('<marquee>');
      expect(cleaned).not.toContain('<blink>');
      expect(cleaned).toContain('Important Announcement');
      expect(cleaned).toContain('Blinking Text');
    });

    it('preserves legitimate safe markdown formatting', () => {
      const safeMarkdown = `
# Daily Devotional: Peace That Passes Understanding
**Philippians 4:6-7**

Do not be anxious about anything, but in every situation, by prayer and petition.

- Point 1
- Point 2

*Take a deep breath and rest.*
      `.trim();

      const cleaned = sanitizeMarkdown(safeMarkdown);
      expect(cleaned).toContain('Daily Devotional: Peace That Passes Understanding');
      expect(cleaned).toContain('**Philippians 4:6-7**');
      expect(cleaned).toContain('- Point 1');
    });
  });

  describe('sanitizePlainText', () => {
    it('removes all HTML markup and trims extra whitespace', () => {
      const raw = '<h3>Title with <strong>bold</strong> words</h3> <p>Paragraph text.</p>';
      const cleaned = sanitizePlainText(raw);

      expect(cleaned).toBe('Title with bold words Paragraph text.');
      expect(cleaned).not.toContain('<');
      expect(cleaned).not.toContain('>');
    });

    it('handles empty or non-string input safely', () => {
      expect(sanitizePlainText('')).toBe('');
      expect(sanitizePlainText('   ')).toBe('');
      // @ts-expect-error test non-string runtime guard
      expect(sanitizePlainText(null)).toBe('');
    });
  });
});
