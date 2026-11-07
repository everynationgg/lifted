/**
 * Video URL Parser & Safe Embed Resolver
 * LIFTED Admin & Discover Streaming Integration
 *
 * Safely parses YouTube, Vimeo, and Supabase Storage / direct video URLs
 * while preventing XSS, javascript: injection, and unsupported embeds.
 */

export interface ParsedVideoInfo {
  isEmbeddable: boolean;
  type: 'youtube' | 'vimeo' | 'storage' | 'direct' | 'unsupported';
  embedUrl?: string;
  videoId?: string;
  sanitizedUrl?: string;
  errorMessage?: string;
}

export function parseVideoUrl(rawUrl: string): ParsedVideoInfo {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { isEmbeddable: false, type: 'unsupported', errorMessage: 'Video URL is empty.' };
  }

  const trimmed = rawUrl.trim();

  // 1. Supabase Storage relative paths
  if (trimmed.startsWith('videos/') || trimmed.startsWith('curated-videos/')) {
    return {
      isEmbeddable: true,
      type: 'storage',
      sanitizedUrl: trimmed,
    };
  }

  try {
    const url = new URL(trimmed);

    // Protocol check: Only http/https
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return {
        isEmbeddable: false,
        type: 'unsupported',
        errorMessage: 'Only HTTP and HTTPS protocols are permitted.',
      };
    }

    // 2. YouTube
    if (url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) {
      let videoId: string | null = null;
      if (url.hostname.includes('youtu.be')) {
        videoId = url.pathname.slice(1).split(/[?&#]/)[0];
      } else if (url.pathname.includes('/embed/')) {
        videoId = url.pathname.split('/embed/')[1].split(/[?&#]/)[0];
      } else if (url.pathname.includes('/shorts/')) {
        videoId = url.pathname.split('/shorts/')[1].split(/[?&#]/)[0];
      } else {
        videoId = url.searchParams.get('v');
      }

      if (videoId && /^[a-zA-Z0-9_-]{6,15}$/.test(videoId)) {
        return {
          isEmbeddable: true,
          type: 'youtube',
          videoId,
          embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`,
          sanitizedUrl: `https://www.youtube.com/watch?v=${videoId}`,
        };
      }
      return {
        isEmbeddable: false,
        type: 'unsupported',
        errorMessage: 'Invalid YouTube link. Could not extract valid video ID.',
      };
    }

    // 3. Vimeo
    if (url.hostname.includes('vimeo.com')) {
      const match = url.pathname.match(/\/(\d+)/);
      if (match && match[1]) {
        return {
          isEmbeddable: true,
          type: 'vimeo',
          videoId: match[1],
          embedUrl: `https://player.vimeo.com/video/${match[1]}?title=0&byline=0`,
          sanitizedUrl: `https://vimeo.com/${match[1]}`,
        };
      }
      return {
        isEmbeddable: false,
        type: 'unsupported',
        errorMessage: 'Invalid Vimeo link. Expected numeric video ID (e.g. vimeo.com/123456789).',
      };
    }

    // 4. Direct video files or Supabase Storage URLs
    if (
      url.pathname.endsWith('.mp4') ||
      url.pathname.endsWith('.webm') ||
      url.pathname.endsWith('.mov') ||
      url.pathname.includes('/storage/v1/object/')
    ) {
      return {
        isEmbeddable: true,
        type: 'direct',
        embedUrl: url.toString(),
        sanitizedUrl: url.toString(),
      };
    }

    return {
      isEmbeddable: false,
      type: 'unsupported',
      errorMessage: 'Unsupported video host. Please provide a YouTube, Vimeo, or direct MP4/WebM URL.',
    };
  } catch {
    return {
      isEmbeddable: false,
      type: 'unsupported',
      errorMessage: 'Malformed URL provided.',
    };
  }
}
