import { describe, it, expect, beforeEach, vi } from 'vitest';
import { contentCatalogService } from '../contentCatalogService';
import { networkService } from '../networkService';
import { supabaseAuthService } from '../auth/supabaseAuthService';

describe('ContentCatalogService (Phase 10 Public Catalog & Editorial CMS)', () => {
  beforeEach(() => {
    contentCatalogService.clearCacheForTesting();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('Offline-First Content Delivery & Fallback', () => {
    it('returns bundled synthetic fixtures when offline and cache is empty', async () => {
      vi.spyOn(networkService, 'isConnected').mockReturnValue(false);

      const snapshot = await contentCatalogService.getCatalog();
      expect(snapshot).toBeDefined();
      expect(snapshot.source).toBe('bundled');
      expect(snapshot.isOfflineFallback).toBe(true);
      expect(snapshot.devotionals.length).toBeGreaterThan(0);
      expect(snapshot.articles.length).toBeGreaterThan(0);
      expect(snapshot.videos.length).toBeGreaterThan(0);

      // Verify structure matches type contracts
      const firstDev = snapshot.devotionals[0];
      expect(firstDev.id).toBeDefined();
      expect(firstDev.contentId).toBeDefined();
      expect(firstDev.version).toBe(1);
      expect(firstDev.contentStatus).toBe('published');
      expect(firstDev.licenseType).toBeDefined();
    });

    it('retrieves cached catalog from localStorage when available', async () => {
      vi.spyOn(networkService, 'isConnected').mockReturnValue(false);

      const cachedData = {
        schemaVersion: 1,
        cachedAt: Date.now() - 1000,
        devotionals: [
          {
            id: 'cached-dev-1',
            contentId: 'cached-dev-1',
            version: 1,
            language: 'en',
            title: 'Cached Devotional',
            scriptureRef: 'Psalm 23:1',
            scriptureText: 'The Lord is my shepherd.',
            reflection: 'He restores my soul.',
            prayer: 'Thank you Lord.',
            reflectionPrompt: 'Rest in His care.',
            readingTimeMinutes: 3,
            category: 'devotional',
            topics: ['Peace'],
            tags: ['Peace'],
            topicTags: ['Peace'],
            emotionalTags: ['peaceful'],
            contentStatus: 'published',
            licenseType: 'CC_BY',
          },
        ],
        articles: [],
        videos: [],
      };

      localStorage.setItem('lifted_public_catalog_cache_v1', JSON.stringify(cachedData));

      const snapshot = await contentCatalogService.getCatalog();
      expect(snapshot.source).toBe('cache');
      expect(snapshot.devotionals[0].title).toBe('Cached Devotional');
    });

    it('persists fetched remote catalog into localStorage cache', async () => {
      vi.spyOn(networkService, 'isConnected').mockReturnValue(true);

      const mockSupabase = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: async () => {
                  if (table === 'devotional_catalog') {
                    return {
                      data: [
                        {
                          id: 'remote-1',
                          content_id: 'remote-1',
                          version: 2,
                          language: 'en',
                          title: 'Remote Blessed Hope',
                          scripture_reference: 'Titus 2:13',
                          scripture_text: 'Looking for that blessed hope',
                          reflection: 'A steadfast hope in Christ',
                          prayer: 'Lord, keep our eyes on You',
                          day_number: 1,
                          category: 'devotional',
                          topics: ['Hope'],
                          tags: ['Hope'],
                          content_status: 'published',
                          is_published: true,
                          license_type: 'WEB_PUBLIC_DOMAIN',
                        },
                      ],
                      error: null,
                    };
                  }
                  return { data: [], error: null };
                },
              }),
            }),
          }),
        }),
      };

      // @ts-expect-error mock client
      vi.spyOn(supabaseAuthService, 'getClient').mockReturnValue(mockSupabase);

      const snapshot = await contentCatalogService.getCatalog(true);
      expect(snapshot.source).toBe('remote');
      expect(snapshot.devotionals[0].title).toBe('Remote Blessed Hope');

      const cachedRaw = localStorage.getItem('lifted_public_catalog_cache_v1');
      expect(cachedRaw).toBeTruthy();
      const cached = JSON.parse(cachedRaw!);
      expect(cached.devotionals[0].title).toBe('Remote Blessed Hope');
    });

    it('strictly segregates public catalog from personal encrypted vault', async () => {
      // localStorage should only contain public catalog key, no ciphertext envelopes or DEK keys
      vi.spyOn(networkService, 'isConnected').mockReturnValue(false);
      await contentCatalogService.getCatalog();

      const stored = localStorage.getItem('lifted_public_catalog_cache_v1');
      expect(stored).not.toBeNull();
      expect(stored).not.toContain('ciphertext');
      expect(stored).not.toContain('auth_tag');
      expect(stored).not.toContain('journal_envelope');
    });
  });

  describe('Editorial CMS Workflow RPC Invocation', () => {
    it('calls cms_create_draft with sanitized inputs', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: { success: true, id: 'new-draft-id', status: 'draft' },
        error: null,
      });

      const mockSupabase = {
        rpc: mockRpc,
      };

      // @ts-expect-error mock client
      vi.spyOn(supabaseAuthService, 'getClient').mockReturnValue(mockSupabase);

      const result = await contentCatalogService.createDraft('devotional_catalog', {
        title: 'New Devotional <script>alert(1)</script>',
        reflection: 'Safe reflection text',
      });

      expect(result.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith('cms_create_draft', {
        content_type: 'devotional',
        title: 'New Devotional',
        payload: {
          title: 'New Devotional',
          reflection: 'Safe reflection text',
        },
        content_id: null,
      });
    });

    it('calls cms_submit_for_review with change summary', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: { success: true, status: 'in_review' },
        error: null,
      });

      const mockSupabase = { rpc: mockRpc };
      // @ts-expect-error mock client
      vi.spyOn(supabaseAuthService, 'getClient').mockReturnValue(mockSupabase);

      const res = await contentCatalogService.submitForReview(
        'article_catalog',
        'art-123',
        'Updated grounding steps'
      );

      expect(res.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith('cms_submit_for_review', {
        content_type: 'article',
        id: 'art-123',
        change_summary: 'Updated grounding steps',
      });
    });

    it('calls cms_approve_content and cms_publish_content', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const mockSupabase = { rpc: mockRpc };
      // @ts-expect-error mock client
      vi.spyOn(supabaseAuthService, 'getClient').mockReturnValue(mockSupabase);

      await contentCatalogService.approveContent('devotional_catalog', 'dev-1', 'Looks solid');
      expect(mockRpc).toHaveBeenCalledWith('cms_approve_content', {
        content_type: 'devotional',
        id: 'dev-1',
        reviewer_name: 'Looks solid',
      });

      await contentCatalogService.publishContent('devotional_catalog', 'dev-1');
      expect(mockRpc).toHaveBeenCalledWith('cms_publish_content', {
        content_type: 'devotional',
        id: 'dev-1',
      });
    });

    it('throws when unauthenticated or client is not configured', async () => {
      vi.spyOn(supabaseAuthService, 'getClient').mockReturnValue(null);

      await expect(
        contentCatalogService.createDraft('devotional_catalog', { title: 'Test' })
      ).rejects.toThrow('Supabase client is not initialized');
    });
  });
});
