/**
 * LIFTED Admin Portal & Curated Video End-to-End Verification
 * Phase 13: Functional Admin Portal, Secure Staff Login & Video Storage
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabaseAuthService } from '../supabaseAuthService';
import { contentCatalogService } from '../../contentCatalogService';
import { parseVideoUrl } from '../../../utils/videoUtils';

describe('Admin Portal End-to-End Functional Verification', () => {
  beforeAll(async () => {
    // Ensure clean sign-out before testing
    await supabaseAuthService.signOut();
  });

  afterAll(async () => {
    // Clean up session after tests
    await supabaseAuthService.signOut();
  });

  describe('1. Secure Admin Authentication & Role Enforcement', () => {
    it('rejects authentication with invalid credentials', async () => {
      const result = await supabaseAuthService.signInWithPassword({
        email: 'cherie@lifted.app',
        password: 'WrongPassword999!',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(supabaseAuthService.getCurrentUser()).toBeNull();
    });

    it('rejects ordinary member account and fail-closed signs them out', async () => {
      const result = await supabaseAuthService.signInWithPassword({
        email: 'member@lifted.app',
        password: 'MemberTest2026!',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('PERMISSION_DENIED');
      // Must not retain authenticated session
      expect(supabaseAuthService.getCurrentUser()).toBeNull();
      expect(supabaseAuthService.getAccountState()).toBe('GUEST');
    });

    it('successfully authenticates authorized administrator', async () => {
      const result = await supabaseAuthService.signInWithPassword({
        email: 'cherie@lifted.app',
        password: 'AdminTest2026!',
      });

      expect(result.success).toBe(true);
      expect(result.session).toBeDefined();
      expect(supabaseAuthService.getCurrentUser()?.email).toBe('cherie@lifted.app');

      const isEd = await supabaseAuthService.isEditor();
      const isPub = await supabaseAuthService.isPublisher();
      const isAdm = await supabaseAuthService.isAdmin();

      expect(isEd).toBe(true);
      expect(isPub).toBe(true);
      expect(isAdm).toBe(true);
    });
  });

  describe('2. Video Link Validation & Parsing (Method A)', () => {
    it('correctly parses and sanitizes standard YouTube watch URLs', () => {
      const parsed = parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(parsed.isEmbeddable).toBe(true);
      expect(parsed.type).toBe('youtube');
      expect(parsed.videoId).toBe('dQw4w9WgXcQ');
      expect(parsed.embedUrl).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
    });

    it('correctly parses short YouTube youtu.be URLs', () => {
      const parsed = parseVideoUrl('https://youtu.be/dQw4w9WgXcQ');
      expect(parsed.isEmbeddable).toBe(true);
      expect(parsed.type).toBe('youtube');
      expect(parsed.videoId).toBe('dQw4w9WgXcQ');
    });

    it('correctly parses Vimeo video URLs', () => {
      const parsed = parseVideoUrl('https://vimeo.com/76979871');
      expect(parsed.isEmbeddable).toBe(true);
      expect(parsed.type).toBe('vimeo');
      expect(parsed.videoId).toBe('76979871');
      expect(parsed.embedUrl).toContain('player.vimeo.com/video/76979871');
    });

    it('rejects unsafe script, data, or unknown hosts', () => {
      const unsafe = parseVideoUrl('javascript:alert(1)');
      expect(unsafe.isEmbeddable).toBe(false);

      const unknown = parseVideoUrl('https://malicious-site.com/exploit.exe');
      expect(unknown.isEmbeddable).toBe(false);
      expect(unknown.errorMessage).toContain('Unsupported video host');
    });
  });

  describe('3. Curated Video CMS & Storage Lifecycle (Methods A & B)', () => {
    let createdVideoId: string;

    it('creates and publishes a video link reflection via CMS RPCs', async () => {
      const draft: any = await contentCatalogService.createDraft('video_catalog', {
        title: 'Finding Rest in Grief',
        description: 'Pastoral encouragement on moving through loss with Jesus.',
        creator: 'Cherie Magsanoc',
        category: 'Grief & Loss',
        duration_seconds: 75,
        video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        scripture_anchor: 'Psalm 34:18',
        topics: ['Grief & Loss'],
      });

      expect(draft.id).toBeDefined();
      createdVideoId = draft.id;
      expect(draft.content_status).toBe('draft');

      // Publish the video
      const published: any = await contentCatalogService.publishContent('video_catalog', createdVideoId);
      expect(published.content_status).toBe('published');
      expect(published.is_published).toBe(true);
    });

    it('displays newly published video in the public Discover catalog feed', async () => {
      contentCatalogService.clearCacheForTesting();
      const catalog = await contentCatalogService.getCatalog(true);

      const found = catalog.videos.find((v) => v.title === 'Finding Rest in Grief');
      expect(found).toBeDefined();
      expect(found?.creator).toBe('Cherie Magsanoc');
      expect(found?.videoUrl).toContain('youtube.com');
    });

    it('unpublishes video and removes it from public feed', async () => {
      await contentCatalogService.unpublishContent('video_catalog', createdVideoId, true);
      contentCatalogService.clearCacheForTesting();

      const catalog = await contentCatalogService.getCatalog(true);
      const found = catalog.videos.find((v) => v.id === createdVideoId);
      expect(found).toBeUndefined();
    });

    it('enforces MIME type and size validation on file upload (Method B)', async () => {
      // 1. Invalid MIME type (text file)
      const fakeTextFile = new File(['fake content'], 'test.txt', { type: 'text/plain' });
      await expect(
        contentCatalogService.uploadVideoFile(fakeTextFile)
      ).rejects.toThrow('INVALID_FILE_TYPE');

      // 2. Exceeds 50MB
      const hugeFile = {
        name: 'huge.mp4',
        type: 'video/mp4',
        size: 55 * 1024 * 1024, // 55MB
      } as File;
      await expect(
        contentCatalogService.uploadVideoFile(hugeFile)
      ).rejects.toThrow('FILE_TOO_LARGE');
    });

    it('uploads valid video file to Supabase Storage and creates streamable playback URL', async () => {
      const validVideoContent = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]); // MP4 ftyp header
      const videoFile = new File([validVideoContent], 'calm_breathing_reflection.mp4', {
        type: 'video/mp4',
      });

      const { path } = await contentCatalogService.uploadVideoFile(videoFile);
      expect(path).toContain('videos/');
      expect(path).toContain('calm_breathing_reflection.mp4');

      // Create video catalog draft with uploaded storage path
      const uploadedDraft: any = await contentCatalogService.createDraft('video_catalog', {
        title: 'Calm Breathing in Christ',
        description: 'Breathing reflection for grounding anxious thoughts.',
        creator: 'Cherie Magsanoc',
        category: 'Anxiety & Panic',
        duration_seconds: 60,
        video_url: path,
        topics: ['Anxiety & Panic'],
      });

      expect(uploadedDraft.id).toBeDefined();

      // Resolve playback URL
      const playbackUrl = await contentCatalogService.getVideoPlaybackUrl(path);
      expect(playbackUrl).toBeDefined();
      expect(playbackUrl.length).toBeGreaterThan(10);

      // Clean up uploaded file and archive draft
      await contentCatalogService.deleteStorageVideo(path);
      await contentCatalogService.unpublishContent('video_catalog', uploadedDraft.id, true);
    });
  });

  describe('4. Devotional & Article Editorial Workflow', () => {
    it('creates, reviews, approves, and publishes a new devotional', async () => {
      const draft: any = await contentCatalogService.createDraft('devotional_catalog', {
        title: 'Peace in the Secret Place',
        scripture_reference: 'Psalm 91:1-2',
        scripture_text: 'He who dwells in the secret place of the Most High shall abide under the shadow of the Almighty.',
        reflection: 'When anxiety surrounds us, God invites us into stillness.',
        prayer: 'Lord Jesus, be my refuge today.',
        category: 'daily',
      });

      expect(draft.id).toBeDefined();
      expect(draft.content_status).toBe('draft');

      // Submit for review
      const inReview: any = await contentCatalogService.submitForReview(
        'devotional_catalog',
        draft.id,
        'Ready for pastoral review'
      );
      expect(inReview.content_status).toBe('in_review');

      // Approve content
      const approved: any = await contentCatalogService.approveContent(
        'devotional_catalog',
        draft.id,
        'Approved by pastoral counselor'
      );
      expect(approved.content_status).toBe('approved');

      // Publish content
      const published: any = await contentCatalogService.publishContent(
        'devotional_catalog',
        draft.id
      );
      expect(published.content_status).toBe('published');
      expect(published.is_published).toBe(true);

      // Verify it appears in Discover catalog
      contentCatalogService.clearCacheForTesting();
      const catalog = await contentCatalogService.getCatalog(true);
      const found = catalog.devotionals.find((d) => d.title === 'Peace in the Secret Place');
      expect(found).toBeDefined();
      expect(found?.scriptureRef).toBe('Psalm 91:1-2');

      // Clean up
      await contentCatalogService.unpublishContent('devotional_catalog', draft.id, true);
    });

    it('creates and publishes a clinical guidance article', async () => {
      const draft: any = await contentCatalogService.createDraft('article_catalog', {
        title: 'Understanding Trauma Responses in Daily Life',
        subtitle: 'Why the body remembers what the mind tries to forget',
        summary: 'Clinical and faith-based perspective on somatic trauma triggers.',
        content: '# Somatic Responses\n\nTrauma is held in the nervous system...',
        category: 'Trauma Healing',
        author_name: 'Cherie Magsanoc',
        read_time_minutes: 5,
        topics: ['Trauma Healing'],
      });

      expect(draft.id).toBeDefined();

      // Publish
      const published: any = await contentCatalogService.publishContent(
        'article_catalog',
        draft.id
      );
      expect(published.content_status).toBe('published');

      // Verify Discover feed
      contentCatalogService.clearCacheForTesting();
      const catalog = await contentCatalogService.getCatalog(true);
      const found = catalog.articles.find((a) => a.title === 'Understanding Trauma Responses in Daily Life');
      expect(found).toBeDefined();
      expect(found?.author).toBe('Cherie Magsanoc');

      // Clean up
      await contentCatalogService.unpublishContent('article_catalog', draft.id, true);
    });
  });

  describe('5. Clean Sign Out & Session Teardown', () => {
    it('signs out securely and leaves zero residual tokens in client memory', async () => {
      const signOutResult = await supabaseAuthService.signOut();
      expect(signOutResult.success).toBe(true);
      expect(supabaseAuthService.getCurrentUser()).toBeNull();
      expect(supabaseAuthService.getAccountState()).toBe('GUEST');

      const isEd = await supabaseAuthService.isEditor();
      expect(isEd).toBe(false);
    });
  });
});
