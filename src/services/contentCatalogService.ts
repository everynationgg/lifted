/**
 * Curated Content Catalog & Offline-First Delivery Service
 * LIFTED Phase 10: Editorial CMS & Public Content Delivery
 *
 * Implements:
 * - Public content catalog retrieval with durable local caching (localStorage: lifted_public_catalog_cache_v1)
 * - Safe offline-first fallback to cached content or approved bundled fixtures
 * - Battery-aware, non-aggressive remote revalidation (min 5-min TTL)
 * - Pure public isolation: completely segregated from encrypted SQLite personal vault
 * - Content sanitization and safe media URL validation
 * - Editorial CMS workflow actions (createDraft, submitForReview, approve, publish, revisioning)
 */

import type { MoodId } from '../types';
import type { Database, ContentStatus } from '../types/database.types';
import { supabaseAuthService } from './auth/supabaseAuthService';
import { networkService } from './networkService';
import { sanitizeMarkdown, sanitizePlainText, validateSafeUrl } from './contentSanitizer';
import {
  DEVOTIONAL_ARCHIVE,
  CURATED_VIDEOS,
  PROFESSIONAL_ARTICLES,
  TODAY_DEVOTIONAL,
} from '../data/mockData';

export type CatalogTableName = 'devotional_catalog' | 'article_catalog' | 'video_catalog';

export interface DevotionalContent {
  id: string;
  contentId: string;
  version: number;
  language: string;
  title: string;
  scriptureRef: string;
  scriptureText: string;
  reflection: string;
  prayer: string;
  reflectionPrompt: string;
  readingTimeMinutes: number;
  category: string;
  topics: string[];
  tags: string[];
  topicTags: string[];
  emotionalTags: MoodId[];
  contentStatus: ContentStatus;
  authorName?: string;
  editorName?: string;
  reviewerName?: string;
  sourceName?: string;
  copyrightOwner?: string;
  licenseType: string;
  attributionText?: string;
  publishedAt?: string;
  audioUrl?: string;
  date: string;
  dayNumber?: number | null;
  isBookmarked?: boolean;
}

export interface ArticleContent {
  id: string;
  contentId: string;
  version: number;
  language: string;
  title: string;
  subtitle: string;
  summary: string;
  content: string;
  contentParagraphs: string[];
  category: string;
  readingTimeMinutes: number;
  topics: string[];
  tags: string[];
  topicTags: string[];
  emotionalTags: MoodId[];
  author: string;
  credentials: string;
  editorName?: string;
  reviewerName?: string;
  sourceName?: string;
  copyrightOwner?: string;
  licenseType: string;
  attributionText?: string;
  practicalExercise?: {
    title: string;
    instruction: string;
  };
  contentStatus: ContentStatus;
  publishedAt?: string;
}

export interface VideoContent {
  id: string;
  contentId: string;
  version: number;
  language: string;
  title: string;
  description: string;
  creator: string;
  durationSeconds: number;
  videoUrl?: string;
  thumbnailGradient: string;
  topics: string[];
  tags: string[];
  topicTags: string[];
  emotionalTags: MoodId[];
  category: string;
  viewsCount: number;
  likesCount: number;
  authorName?: string;
  editorName?: string;
  reviewerName?: string;
  sourceName?: string;
  copyrightOwner?: string;
  licenseType: string;
  attributionText?: string;
  contentStatus: ContentStatus;
  publishedAt?: string;
  isLiked?: boolean;
}

export interface PublicCatalogSnapshot {
  devotionals: DevotionalContent[];
  articles: ArticleContent[];
  videos: VideoContent[];
  source: 'remote' | 'cache' | 'bundled';
  cachedAt: number;
  isOfflineFallback: boolean;
}

interface StoredCatalogCache {
  schemaVersion: number;
  cachedAt: number;
  devotionals: DevotionalContent[];
  articles: ArticleContent[];
  videos: VideoContent[];
}

const CACHE_KEY = 'lifted_public_catalog_cache_v1';
const CACHE_SCHEMA_VERSION = 1;
const MIN_REVALIDATE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes non-aggressive throttle

export class ContentCatalogService {
  private inMemorySnapshot: PublicCatalogSnapshot | null = null;
  private lastFetchAttemptTimestamp = 0;

  /**
   * Constructs initial bundled fallback fixtures with clean metadata.
   */
  private getBundledFixtures(): PublicCatalogSnapshot {
    const allDevotionals = [TODAY_DEVOTIONAL, ...DEVOTIONAL_ARCHIVE];
    const mappedDevotionals: DevotionalContent[] = allDevotionals.map((d, index) => ({
      id: d.id,
      contentId: d.id,
      version: 1,
      language: 'en',
      title: sanitizePlainText(d.title),
      scriptureRef: d.scriptureRef,
      scriptureText: sanitizeMarkdown(d.scriptureText),
      reflection: sanitizeMarkdown(d.reflection),
      prayer: sanitizeMarkdown(d.prayer),
      reflectionPrompt: sanitizeMarkdown(d.reflectionPrompt),
      readingTimeMinutes: d.readingTimeMinutes,
      category: 'devotional',
      topics: d.topicTags || ['Faith & Healing'],
      tags: d.topicTags || ['Faith & Healing'],
      topicTags: d.topicTags || ['Faith & Healing'],
      emotionalTags: d.emotionalTags || ['peaceful'],
      contentStatus: 'published',
      authorName: 'LIFTED Editorial Team',
      editorName: 'Senior Editor',
      reviewerName: 'Clinical Pastoral Reviewer',
      sourceName: 'LIFTED Curated Daily Bread',
      copyrightOwner: 'Every Nation GG / LIFTED',
      licenseType: 'LIFTED_ORIGINAL_CC_BY_NC_ND_4_0',
      attributionText: 'Scripture quotations are from the World English Bible (WEB), Public Domain.',
      publishedAt: '2026-10-01T00:00:00.000Z',
      date: d.date,
      dayNumber: index + 1,
    }));

    const mappedArticles: ArticleContent[] = PROFESSIONAL_ARTICLES.map((a) => ({
      id: a.id,
      contentId: a.id,
      version: 1,
      language: 'en',
      title: sanitizePlainText(a.title),
      subtitle: sanitizePlainText(a.subtitle),
      summary: sanitizeMarkdown(a.summary),
      content: sanitizeMarkdown(a.contentParagraphs.join('\n\n')),
      contentParagraphs: a.contentParagraphs.map((p) => sanitizeMarkdown(p)),
      category: 'wellness',
      readingTimeMinutes: a.readingTimeMinutes,
      topics: a.topicTags,
      tags: a.topicTags,
      topicTags: a.topicTags,
      emotionalTags: a.emotionalTags,
      author: sanitizePlainText(a.author),
      credentials: sanitizePlainText(a.credentials),
      editorName: 'Clinical Director',
      reviewerName: 'Trauma Review Board',
      sourceName: 'LIFTED Clinical Contributors',
      copyrightOwner: 'LIFTED Mental Health Care',
      licenseType: 'LIFTED_LICENSED_EDUCATIONAL',
      attributionText: 'Educational resource reviewed by trauma-informed professionals. Non-clinical.',
      practicalExercise: a.practicalExercise
        ? {
            title: sanitizePlainText(a.practicalExercise.title),
            instruction: sanitizeMarkdown(a.practicalExercise.instruction),
          }
        : undefined,
      contentStatus: 'published',
      publishedAt: '2026-10-01T00:00:00.000Z',
    }));

    const mappedVideos: VideoContent[] = CURATED_VIDEOS.map((v) => {
      const safeUrl = validateSafeUrl(v.videoUrl);
      return {
        id: v.id,
        contentId: v.id,
        version: 1,
        language: 'en',
        title: sanitizePlainText(v.title),
        description: sanitizeMarkdown(v.description),
        creator: sanitizePlainText(v.creator),
        durationSeconds: v.durationSeconds,
        videoUrl: safeUrl.safe ? safeUrl.sanitizedUrl : undefined,
        thumbnailGradient: v.thumbnailGradient,
        topics: v.topicTags,
        tags: v.topicTags,
        topicTags: v.topicTags,
        emotionalTags: v.emotionalTags,
        category: 'wellness',
        viewsCount: v.viewsCount,
        likesCount: v.likesCount,
        authorName: v.creator,
        editorName: 'Media Reviewer',
        reviewerName: 'Pastoral Care',
        sourceName: 'LIFTED Video Library',
        copyrightOwner: 'LIFTED / Partner Ministries',
        licenseType: 'PUBLIC_STREAMING_PERMITTED',
        attributionText: 'Curated video resource for personal encouragement.',
        contentStatus: 'published',
        publishedAt: '2026-10-01T00:00:00.000Z',
      };
    });

    return {
      devotionals: mappedDevotionals,
      articles: mappedArticles,
      videos: mappedVideos,
      source: 'bundled',
      cachedAt: Date.now(),
      isOfflineFallback: true,
    };
  }

  /**
   * Reads cached catalog from localStorage safely.
   */
  private readLocalCache(): StoredCatalogCache | null {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return null;
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredCatalogCache;
      if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Persists public catalog to localStorage. Strictly isolated from SQLite vault.
   */
  private writeLocalCache(
    devotionals: DevotionalContent[],
    articles: ArticleContent[],
    videos: VideoContent[]
  ): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const cache: StoredCatalogCache = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        cachedAt: Date.now(),
        devotionals,
        articles,
        videos,
      };
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      console.warn('Failed to write public catalog cache to localStorage:', e);
    }
  }

  /**
   * Returns current catalog snapshot immediately (memory or local cache or bundled fixtures),
   * triggering non-aggressive background revalidation when connectivity is present.
   */
  async getCatalog(forceRefresh = false): Promise<PublicCatalogSnapshot> {
    // 1. Return in-memory snapshot if recent and not forcing refresh
    const now = Date.now();
    if (
      !forceRefresh &&
      this.inMemorySnapshot &&
      now - this.lastFetchAttemptTimestamp < MIN_REVALIDATE_INTERVAL_MS
    ) {
      return this.inMemorySnapshot;
    }

    // 2. If memory snapshot missing, try reading localStorage cache
    if (!this.inMemorySnapshot) {
      const cached = this.readLocalCache();
      if (cached && cached.devotionals?.length > 0) {
        this.inMemorySnapshot = {
          devotionals: cached.devotionals,
          articles: cached.articles,
          videos: cached.videos,
          source: 'cache',
          cachedAt: cached.cachedAt,
          isOfflineFallback: false,
        };
      } else {
        // Fall back to bundled fixtures immediately so app is instantly ready
        const bundled = this.getBundledFixtures();
        this.writeLocalCache(bundled.devotionals, bundled.articles, bundled.videos);
        this.inMemorySnapshot = bundled;
      }
    }

    // 3. Check connectivity. If offline, return immediately without remote network attempt
    const isOnline = networkService.isConnected();
    if (!isOnline) {
      return {
        ...this.inMemorySnapshot,
        isOfflineFallback: true,
      };
    }

    // 4. Non-aggressive revalidation check
    if (!forceRefresh && now - this.lastFetchAttemptTimestamp < MIN_REVALIDATE_INTERVAL_MS) {
      return this.inMemorySnapshot;
    }

    // 5. Attempt remote fetch
    this.lastFetchAttemptTimestamp = now;
    try {
      const remoteSnapshot = await this.fetchRemoteCatalog();
      if (remoteSnapshot) {
        this.inMemorySnapshot = remoteSnapshot;
        this.writeLocalCache(
          remoteSnapshot.devotionals,
          remoteSnapshot.articles,
          remoteSnapshot.videos
        );
        return remoteSnapshot;
      }
    } catch (err) {
      console.warn('Catalog remote revalidation encountered an error; using cached fallback:', err);
    }

    return {
      ...this.inMemorySnapshot,
      isOfflineFallback: true,
    };
  }

  /**
   * Queries Supabase for published editorial content.
   * RLS guarantees only content_status = 'published' AND is_published = true is visible.
   */
  private async fetchRemoteCatalog(): Promise<PublicCatalogSnapshot | null> {
    const client = supabaseAuthService.getClient();
    if (!client) return null;

    // Concurrently fetch published devotionals, articles, and videos
    const [devsRes, artsRes, vidsRes] = await Promise.all([
      client
        .from('devotional_catalog')
        .select('*')
        .eq('is_published', true)
        .eq('content_status', 'published')
        .order('day_number', { ascending: true, nullsFirst: false }),
      client
        .from('article_catalog')
        .select('*')
        .eq('is_published', true)
        .eq('content_status', 'published')
        .order('created_at', { ascending: false }),
      client
        .from('video_catalog')
        .select('*')
        .eq('is_published', true)
        .eq('content_status', 'published')
        .order('created_at', { ascending: false }),
    ]);

    if (devsRes.error) {
      console.warn('Failed to query devotional_catalog:', devsRes.error.message);
      return null;
    }

    type DevotionalRow = Database['public']['Tables']['devotional_catalog']['Row'];
    type ArticleRow = Database['public']['Tables']['article_catalog']['Row'];
    type VideoRow = Database['public']['Tables']['video_catalog']['Row'];

    const rawDevs = (devsRes.data || []) as DevotionalRow[];
    const rawArts = (artsRes.data || []) as ArticleRow[];
    const rawVids = (vidsRes.data || []) as VideoRow[];

    const devotionals: DevotionalContent[] = rawDevs.map((row) => ({
      id: row.id,
      contentId: row.content_id || row.id,
      version: row.version || 1,
      language: row.language || 'en',
      title: sanitizePlainText(row.title),
      scriptureRef: row.scripture_reference,
      scriptureText: sanitizeMarkdown(row.scripture_text),
      reflection: sanitizeMarkdown(row.reflection),
      prayer: sanitizeMarkdown(row.prayer),
      reflectionPrompt: sanitizeMarkdown(row.reflection.slice(0, 100)),
      readingTimeMinutes: 3,
      category: row.category || 'devotional',
      topics: row.topics || [],
      tags: row.tags || [],
      topicTags: row.topics || [],
      emotionalTags: ['peaceful'],
      contentStatus: row.content_status || 'published',
      authorName: row.author_name || undefined,
      editorName: row.editor_name || undefined,
      reviewerName: row.reviewer_name || undefined,
      sourceName: row.source_name || undefined,
      copyrightOwner: row.copyright_owner || undefined,
      licenseType: row.license_type || 'LIFTED_ORIGINAL',
      attributionText: row.attribution_text || undefined,
      publishedAt: row.published_at || row.created_at,
      date: row.published_at ? new Date(row.published_at).toLocaleDateString() : 'Today',
      audioUrl: row.audio_url ? validateSafeUrl(row.audio_url).sanitizedUrl : undefined,
      dayNumber: row.day_number,
    }));

    const articles: ArticleContent[] = rawArts.map((row) => {
      const exercise = row.practical_exercise as { title?: string; instruction?: string } | null;
      return {
        id: row.id,
        contentId: row.content_id || row.id,
        version: row.version || 1,
        language: row.language || 'en',
        title: sanitizePlainText(row.title),
        subtitle: row.subtitle ? sanitizePlainText(row.subtitle) : 'Professional Clinical & Pastoral Guidance',
        summary: sanitizeMarkdown(row.summary),
        content: sanitizeMarkdown(row.content),
        contentParagraphs: row.content
          .split('\n\n')
          .filter(Boolean)
          .map((p: string) => sanitizeMarkdown(p)),
        category: row.category || 'wellness',
        readingTimeMinutes: row.read_time_minutes || 5,
        topics: row.topics || [],
        tags: row.tags || [],
        topicTags: row.topics || [],
        emotionalTags: ['peaceful', 'hopeful'],
        author: sanitizePlainText(row.author_name || 'LIFTED Contributor'),
        credentials: sanitizePlainText(row.author_credentials || 'Contributor'),
        editorName: row.editor_name || undefined,
        reviewerName: row.reviewer_name || undefined,
        sourceName: row.source_name || undefined,
        copyrightOwner: row.copyright_owner || undefined,
        licenseType: row.license_type || 'LIFTED_ORIGINAL',
        attributionText: row.attribution_text || undefined,
        practicalExercise: exercise
          ? {
              title: sanitizePlainText(exercise.title || 'Grounding Step'),
              instruction: sanitizeMarkdown(exercise.instruction || ''),
            }
          : undefined,
        contentStatus: row.content_status || 'published',
        publishedAt: row.published_at || row.created_at,
      };
    });

    const gradients = [
      'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
      'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
      'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
      'linear-gradient(135deg, #7c2d12 0%, #ea580c 100%)',
      'linear-gradient(135deg, #4338ca 0%, #818cf8 100%)',
    ];

    const videos: VideoContent[] = rawVids.map((row, idx) => {
      const safeVideo = validateSafeUrl(row.video_url);
      return {
        id: row.id,
        contentId: row.content_id || row.id,
        version: row.version || 1,
        language: row.language || 'en',
        title: sanitizePlainText(row.title),
        description: sanitizeMarkdown(row.description),
        creator: sanitizePlainText(row.creator || row.author_name || 'LIFTED Media'),
        durationSeconds: row.duration_seconds || 60,
        videoUrl: safeVideo.safe ? safeVideo.sanitizedUrl : undefined,
        thumbnailGradient: gradients[idx % gradients.length],
        topics: row.topics || [],
        tags: row.tags || [],
        topicTags: row.topics || [],
        emotionalTags: ['peaceful', 'hopeful'],
        category: row.category || 'wellness',
        viewsCount: row.views_count || 0,
        likesCount: row.likes_count || 0,
        authorName: row.author_name || undefined,
        editorName: row.editor_name || undefined,
        reviewerName: row.reviewer_name || undefined,
        sourceName: row.source_name || undefined,
        copyrightOwner: row.copyright_owner || undefined,
        licenseType: row.license_type || 'LIFTED_ORIGINAL',
        attributionText: row.attribution_text || undefined,
        contentStatus: row.content_status || 'published',
        publishedAt: row.published_at || row.created_at,
      };
    });

    return {
      devotionals: devotionals.length > 0 ? devotionals : this.getBundledFixtures().devotionals,
      articles: articles.length > 0 ? articles : this.getBundledFixtures().articles,
      videos: videos.length > 0 ? videos : this.getBundledFixtures().videos,
      source: 'remote',
      cachedAt: Date.now(),
      isOfflineFallback: false,
    };
  }

  // ==========================================
  // Editorial CMS Workflow (Staff Operations)
  // ==========================================

  /**
   * Fetches all items from a catalog table for staff review (including drafts and in_review).
   * RLS allows editors/publishers/admins to see drafts.
   */
  async fetchStaffCatalog(tableName: CatalogTableName) {
    const client = supabaseAuthService.getClient();
    if (!client) throw new Error('Supabase client is not initialized');

    const { data, error } = await client
      .from(tableName)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch staff catalog for ${tableName}: ${error.message}`);
    }

    return data;
  }

  /**
   * Helper to map catalog table name to RPC content_type
   */
  private toContentType(tableName: CatalogTableName): 'devotional' | 'article' | 'video' {
    if (tableName === 'devotional_catalog') return 'devotional';
    if (tableName === 'article_catalog') return 'article';
    if (tableName === 'video_catalog') return 'video';
    throw new Error(`Unsupported catalog table: ${tableName}`);
  }

  /**
   * Creates a new draft in the specified catalog table via RPC cms_create_draft.
   */
  async createDraft(
    tableName: CatalogTableName,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const client = supabaseAuthService.getClient();
    if (!client) throw new Error('Supabase client is not initialized');

    // Pre-sanitize textual inputs in payload
    const sanitizedPayload: Record<string, unknown> = { ...payload };
    for (const [key, val] of Object.entries(sanitizedPayload)) {
      if (typeof val === 'string') {
        sanitizedPayload[key] = key.includes('title')
          ? sanitizePlainText(val)
          : sanitizeMarkdown(val);
      }
    }

    const contentType = this.toContentType(tableName);
    const title = (sanitizedPayload.title as string) || 'Untitled Content';
    const contentId = (sanitizedPayload.content_id as string) || (sanitizedPayload.contentId as string) || null;

    const { data, error } = await (client.rpc as any)('cms_create_draft', {
      content_type: contentType,
      title,
      payload: sanitizedPayload,
      content_id: contentId,
    });

    if (error) {
      throw new Error(`cms_create_draft failed: ${error.message}`);
    }

    const res = data as Record<string, unknown>;
    return {
      ...res,
      content_status: res.status || 'draft',
    };
  }

  /**
   * Submits a draft for review via RPC cms_submit_for_review.
   */
  async submitForReview(
    tableName: CatalogTableName,
    id: string,
    changeSummary?: string
  ): Promise<Record<string, unknown>> {
    const client = supabaseAuthService.getClient();
    if (!client) throw new Error('Supabase client is not initialized');

    const contentType = this.toContentType(tableName);
    const { data, error } = await (client.rpc as any)('cms_submit_for_review', {
      content_type: contentType,
      id,
      change_summary: changeSummary || null,
    });

    if (error) {
      throw new Error(`cms_submit_for_review failed: ${error.message}`);
    }

    const res = data as Record<string, unknown>;
    return {
      ...res,
      content_status: res.status || 'in_review',
    };
  }

  /**
   * Approves reviewed content via RPC cms_approve_content.
   */
  async approveContent(
    tableName: CatalogTableName,
    id: string,
    notes?: string
  ): Promise<Record<string, unknown>> {
    const client = supabaseAuthService.getClient();
    if (!client) throw new Error('Supabase client is not initialized');

    const contentType = this.toContentType(tableName);
    const { data, error } = await (client.rpc as any)('cms_approve_content', {
      content_type: contentType,
      id,
      reviewer_name: notes || null,
    });

    if (error) {
      throw new Error(`cms_approve_content failed: ${error.message}`);
    }

    const res = data as Record<string, unknown>;
    return {
      ...res,
      content_status: res.status || 'approved',
    };
  }

  /**
   * Publishes approved content via RPC cms_publish_content.
   */
  async publishContent(
    tableName: CatalogTableName,
    id: string
  ): Promise<Record<string, unknown>> {
    const client = supabaseAuthService.getClient();
    if (!client) throw new Error('Supabase client is not initialized');

    const contentType = this.toContentType(tableName);
    const { data, error } = await (client.rpc as any)('cms_publish_content', {
      content_type: contentType,
      id,
    });

    if (error) {
      throw new Error(`cms_publish_content failed: ${error.message}`);
    }

    const res = data as Record<string, unknown>;
    return {
      ...res,
      content_status: res.status || 'published',
      is_published: true,
    };
  }

  /**
   * Unpublishes or archives content via RPC cms_unpublish_content.
   */
  async unpublishContent(
    tableName: CatalogTableName,
    id: string,
    archive = false
  ): Promise<Record<string, unknown>> {
    const client = supabaseAuthService.getClient();
    if (!client) throw new Error('Supabase client is not initialized');

    const contentType = this.toContentType(tableName);
    const reason = archive ? 'Archived by editor' : 'Unpublished by editor';
    const { data, error } = await (client.rpc as any)('cms_unpublish_content', {
      content_type: contentType,
      id,
      reason,
    });

    if (error) {
      throw new Error(`cms_unpublish_content failed: ${error.message}`);
    }

    const res = data as Record<string, unknown>;
    return {
      ...res,
      content_status: res.status || (archive ? 'archived' : 'draft'),
      is_published: false,
    };
  }

  /**
   * Creates a new draft revision of published content via RPC cms_create_new_revision.
   */
  async createNewRevision(
    tableName: CatalogTableName,
    id: string,
    changes: Record<string, unknown>,
    changeSummary?: string
  ): Promise<Record<string, unknown>> {
    const client = supabaseAuthService.getClient();
    if (!client) throw new Error('Supabase client is not initialized');

    const contentType = this.toContentType(tableName);
    const newTitle = (changes.title as string) || 'Updated Content';
    const { data, error } = await (client.rpc as any)('cms_create_new_revision', {
      content_type: contentType,
      id,
      new_title: newTitle,
      payload: changes,
      change_summary: changeSummary || null,
    });

    if (error) {
      throw new Error(`cms_create_new_revision failed: ${error.message}`);
    }

    const res = data as Record<string, unknown>;
    return {
      ...res,
      content_status: res.status || 'draft',
    };
  }

  /**
   * Method B: Video File Upload to secure Supabase Storage bucket 'curated-videos'.
   * Enforces MIME validation (mp4, webm, quicktime) and strict 50MB file size limits.
   */
  async uploadVideoFile(
    file: File,
    onProgress?: (pct: number) => void
  ): Promise<{ path: string; storageUrl: string }> {
    const client = supabaseAuthService.getClient();
    if (!client) throw new Error('Supabase client is not initialized');

    // 1. Validate MIME type
    const allowedMimeTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
    if (!allowedMimeTypes.includes(file.type)) {
      throw new Error(
        `INVALID_FILE_TYPE: Only MP4, WebM, and QuickTime videos are supported. Received "${file.type}".`
      );
    }

    // 2. Validate Size (max 50MB)
    const MAX_SIZE_BYTES = 52428800; // 50MB
    if (file.size > MAX_SIZE_BYTES) {
      const mbSize = (file.size / (1024 * 1024)).toFixed(1);
      throw new Error(
        `FILE_TOO_LARGE: Video size (${mbSize} MB) exceeds the preview limit of 50 MB.`
      );
    }

    // 3. Generate sanitized storage path
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `videos/${Date.now()}_${cleanFileName}`;

    if (onProgress) onProgress(20);

    // 4. Convert File/Blob to ArrayBuffer for universal cross-platform (browser, Capacitor, Node/tests) reliability
    let uploadBody: File | ArrayBuffer = file;
    if (typeof file.arrayBuffer === 'function') {
      try {
        uploadBody = await file.arrayBuffer();
      } catch {
        uploadBody = file;
      }
    }

    // 5. Upload file to Supabase Storage
    const { error } = await client.storage
      .from('curated-videos')
      .upload(storagePath, uploadBody, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type,
      });

    if (error) {
      throw new Error(`STORAGE_UPLOAD_ERROR: ${error.message}`);
    }

    if (onProgress) onProgress(100);

    return {
      path: storagePath,
      storageUrl: storagePath,
    };
  }

  /**
   * Deletes a video file from Supabase Storage 'curated-videos'.
   */
  async deleteStorageVideo(path: string): Promise<void> {
    const client = supabaseAuthService.getClient();
    if (!client) throw new Error('Supabase client is not initialized');

    const cleanPath = path.startsWith('curated-videos/') ? path.replace('curated-videos/', '') : path;
    const { error } = await client.storage.from('curated-videos').remove([cleanPath]);
    if (error) {
      throw new Error(`STORAGE_DELETE_ERROR: ${error.message}`);
    }
  }

  /**
   * Resolves a video playback URL for streaming.
   * If URL is external (YouTube/Vimeo), returns directly.
   * If URL is a Supabase Storage path, creates a signed URL or falls back to public URL.
   */
  async getVideoPlaybackUrl(videoUrlOrPath: string): Promise<string> {
    if (!videoUrlOrPath) return '';

    // Direct web video or embed (Method A)
    if (
      videoUrlOrPath.startsWith('http://') ||
      videoUrlOrPath.startsWith('https://')
    ) {
      return videoUrlOrPath;
    }

    // Storage object path (Method B)
    const client = supabaseAuthService.getClient();
    if (!client) return videoUrlOrPath;

    const cleanPath = videoUrlOrPath.startsWith('curated-videos/')
      ? videoUrlOrPath.replace('curated-videos/', '')
      : videoUrlOrPath;

    try {
      // Create 24h signed URL for secure playback
      const { data, error } = await client.storage
        .from('curated-videos')
        .createSignedUrl(cleanPath, 86400);

      if (!error && data?.signedUrl) {
        return data.signedUrl;
      }
    } catch {
      // Fallback below
    }

    const { data } = client.storage.from('curated-videos').getPublicUrl(cleanPath);
    return data?.publicUrl || videoUrlOrPath;
  }

  /**
   * Deletes a catalog item (Admin authority required).
   */
  async deleteCatalogItem(tableName: CatalogTableName, id: string): Promise<void> {
    const client = supabaseAuthService.getClient();
    if (!client) throw new Error('Supabase client is not initialized');

    const { error } = await client.from(tableName).delete().eq('id', id);
    if (error) {
      throw new Error(`Failed to delete ${tableName} item: ${error.message}`);
    }
  }

  /**
   * Clear local memory and cache for testing or reset
   */
  clearCacheForTesting(): void {
    this.inMemorySnapshot = null;
    this.lastFetchAttemptTimestamp = 0;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(CACHE_KEY);
      }
    } catch {
      // Ignored in headless test environments
    }
  }
}

export const contentCatalogService = new ContentCatalogService();
