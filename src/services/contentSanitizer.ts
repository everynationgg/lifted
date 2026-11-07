/**
 * Content Sanitizer & Safe Media Validator
 * LIFTED Phase 10 & 11: Editorial CMS & Public Content Delivery
 *
 * Provides defense-in-depth sanitization for public and editorial content:
 * - Vetted structural DOM traversal and attribute allowlist (DOMParser)
 * - Layered fallback for non-DOM environments
 * - Strips XSS vectors, executable script tags, event handlers, and malicious HTML/SVG/MathML
 * - Validates media and external resource URLs against approved secure protocols and domain allowlists
 */

// Trusted hostnames for embedded media (videos, podcasts, trusted audio)
const TRUSTED_MEDIA_DOMAINS = [
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'vimeo.com',
  'player.vimeo.com',
  'everynation.org',
  'everynation.org.ph',
  'everynationgg.org',
  'lifted-app.com',
  'supabase.co',
];

// Disallowed HTML blocks (with their content) that must never be rendered in curated content
const DANGEROUS_BLOCK_TAG_REGEX = /<(?:script|style|iframe|object|embed|applet|frameset|form|svg|math)\b[^>]*>[\s\S]*?<\/(?:script|style|iframe|object|embed|applet|frameset|form|svg|math)>|<(?:script|style|iframe|object|embed|applet|frameset|frame|base|form|input|button|textarea|select|link|meta|svg|math)\b[^>]*\/?>/gi;

// Disallowed standalone tags
const DANGEROUS_TAG_REGEX = /<\/?(?:script|style|iframe|object|embed|applet|frameset|frame|base|form|input|button|textarea|select|link|meta|svg|math)\b[^>]*>/gi;

// Disallowed inline event handlers (e.g. onload=, onerror=, onclick=) - matches whole attribute
const DANGEROUS_ATTR_REGEX = /\s+on[a-z0-9_-]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi;

// Disallowed dangerous URI schemes in markdown/html links - matches whole attribute
const DANGEROUS_PROTOCOL_ATTR_REGEX = /\s+(?:href|src|xlink:href)\s*=\s*(?:'[^']*javascript:[^']*'|"[^"]*javascript:[^"]*"|'[^']*vbscript:[^']*'|"[^"]*vbscript:[^"]*"|'[^']*data:[^']*'|"[^"]*data:[^"]*"|'[^']*file:[^']*'|"[^"]*file:[^"]*"|[^\s>]*javascript:[^\s>]*|[^\s>]*vbscript:[^\s>]*|[^\s>]*data:[^\s>]*|[^\s>]*file:[^\s>]*)/gi;

// Markdown inline links: [text](javascript:alert(1))
const MARKDOWN_DANGEROUS_LINK_REGEX = /\[([^\]]*)\]\((?:javascript|vbscript|data|file):[^)]*\)/gi;

// Allowed safe HTML tags for curated and rich content
const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark', 'small', 'sub', 'sup',
  'span', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li',
  'hr', 'br',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'a', 'img'
]);

// Allowed safe attributes on elements
const ALLOWED_ATTRS = new Set([
  'href', 'src', 'alt', 'title', 'class', 'target', 'rel', 'width', 'height'
]);

// Allowed URI protocols for links and images
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export interface SafeUrlResult {
  safe: boolean;
  sanitizedUrl?: string;
  reason?: string;
}

/**
 * Validates a media or external link URL against approved protocols (https:)
 * and trusted hosting domains.
 */
export function validateSafeUrl(url?: string | null): SafeUrlResult {
  if (!url || typeof url !== 'string') {
    return { safe: false, reason: 'Empty or non-string URL' };
  }

  const trimmed = url.trim();

  // Allow safe relative paths
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return { safe: true, sanitizedUrl: trimmed };
  }

  // Parse absolute URL
  try {
    const parsed = new URL(trimmed);

    // Only https is permitted for remote resources
    if (parsed.protocol !== 'https:') {
      return {
        safe: false,
        reason: `Disallowed protocol '${parsed.protocol}'. Only 'https:' is permitted.`,
      };
    }

    // Verify hostname is not empty or IP address
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return {
        safe: false,
        reason: 'Direct IP address hosts are not permitted for public media.',
      };
    }

    // Check against trusted domain allowlist or subdomains
    const isTrusted = TRUSTED_MEDIA_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );

    if (!isTrusted) {
      return {
        safe: false,
        reason: `Hostname '${hostname}' is not in the trusted media domain allowlist.`,
      };
    }

    return { safe: true, sanitizedUrl: parsed.toString() };
  } catch {
    return { safe: false, reason: 'Malformed URL structure' };
  }
}

/**
 * Sanitizes an HTML document body using comprehensive DOM traversal and allowlisting.
 */
function sanitizeDomTree(body: HTMLElement): void {
  // 1. Remove dangerous block subtrees completely
  const dangerousSelectors = [
    'script', 'style', 'iframe', 'object', 'embed', 'applet',
    'form', 'svg', 'math', 'base', 'meta', 'link', 'template', 'button', 'input'
  ];
  for (const sel of dangerousSelectors) {
    const nodes = Array.from(body.querySelectorAll(sel));
    for (const node of nodes) {
      node.remove();
    }
  }

  // 2. Query all remaining elements
  const allElements = Array.from(body.querySelectorAll('*'));
  for (const el of allElements) {
    const tagName = el.tagName.toLowerCase();

    // If tag is not in whitelist, unwrap its child nodes and remove element
    if (!ALLOWED_TAGS.has(tagName)) {
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }

    // Inspect attributes
    const attributes = Array.from(el.attributes);
    for (const attr of attributes) {
      const attrName = attr.name.toLowerCase();
      const attrVal = attr.value.trim().toLowerCase();

      // Disallow non-whitelisted attributes or event handlers
      if (!ALLOWED_ATTRS.has(attrName) || attrName.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }

      // Handle href and src URLs
      if (attrName === 'href' || attrName === 'src') {
        if (
          attrVal.includes('javascript:') ||
          attrVal.includes('vbscript:') ||
          attrVal.includes('data:') ||
          attrVal.includes('file:')
        ) {
          el.removeAttribute(attr.name);
          continue;
        }

        if (attrVal.startsWith('/') || attrVal.startsWith('#')) {
          continue;
        }

        try {
          const parsed = new URL(attr.value);
          if (!ALLOWED_PROTOCOLS.has(parsed.protocol.toLowerCase())) {
            el.removeAttribute(attr.name);
          }
        } catch {
          el.removeAttribute(attr.name);
        }
      }
    }

    // For links, set secure target and rel
    if (tagName === 'a') {
      el.setAttribute('rel', 'noopener noreferrer');
    }
  }
}

/**
 * Sanitizes markdown or rich-text content using a vetted DOM-tree parsing approach
 * where a DOM environment is available, combined with robust pattern neutralization.
 */
export function sanitizeMarkdown(content: string): string {
  if (!content || typeof content !== 'string') return '';

  let sanitized = content;

  // 1. First neutralize dangerous markdown link schemes e.g. [click](javascript:alert(1))
  sanitized = sanitized.replace(MARKDOWN_DANGEROUS_LINK_REGEX, '[$1](#blocked-unsafe-link)');

  // 2. DOM-based structural sanitization if DOMParser is available (Browser or JSDOM)
  if (typeof window !== 'undefined' && typeof window.DOMParser !== 'undefined') {
    try {
      const parser = new window.DOMParser();
      const doc = parser.parseFromString(sanitized, 'text/html');
      
      sanitizeDomTree(doc.body);

      sanitized = doc.body.innerHTML;
    } catch {
      sanitized = fallbackRegexSanitize(sanitized);
    }
  } else {
    sanitized = fallbackRegexSanitize(sanitized);
  }

  // 3. Final safety pass on output to guarantee no leaked protocol/event handlers
  sanitized = sanitized
    .replace(DANGEROUS_PROTOCOL_ATTR_REGEX, '')
    .replace(DANGEROUS_ATTR_REGEX, '');

  return sanitized;
}

/**
 * Defense-in-depth regex-based fallback for environments without DOMParser.
 */
function fallbackRegexSanitize(content: string): string {
  let cleaned = content;
  cleaned = cleaned.replace(DANGEROUS_BLOCK_TAG_REGEX, '');
  cleaned = cleaned.replace(DANGEROUS_TAG_REGEX, '');
  cleaned = cleaned.replace(DANGEROUS_ATTR_REGEX, '');
  cleaned = cleaned.replace(DANGEROUS_PROTOCOL_ATTR_REGEX, '');
  return cleaned;
}

/**
 * Strips all HTML tags entirely for plain text presentation (summaries, previews).
 */
export function sanitizePlainText(text: string): string {
  if (!text || typeof text !== 'string') return '';
  const withoutDangerousBlocks = text.replace(DANGEROUS_BLOCK_TAG_REGEX, '');
  return withoutDangerousBlocks.replace(/<[^>]*>/g, '').trim();
}
