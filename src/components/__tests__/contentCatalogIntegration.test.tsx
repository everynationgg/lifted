import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DiscoverScreen } from '../DiscoverScreen';
import { ContentDetailModal } from '../ContentDetailModal';
import { AdminWebviewPortal } from '../AdminWebviewPortal';
import { contentCatalogService } from '../../services/contentCatalogService';
import { networkService } from '../../services/networkService';
import { supabaseAuthService } from '../../services/auth/supabaseAuthService';
import { HELPING_HANDS_MODULES } from '../../data/mockData';

describe('Phase 10: Content Catalog & Editorial CMS Integration', () => {
  beforeEach(() => {
    localStorage.clear();
    contentCatalogService.clearCacheForTesting();
    vi.restoreAllMocks();
    vi.spyOn(networkService, 'isConnected').mockReturnValue(false);
    vi.spyOn(supabaseAuthService, 'getClient').mockReturnValue(null);

    const mockSpeechSynthesis = {
      speak: vi.fn(),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: vi.fn().mockReturnValue([]),
      onvoiceschanged: null,
    };
    vi.stubGlobal('speechSynthesis', mockSpeechSynthesis);
  });

  describe('DiscoverScreen Public Catalog & Offline-First UX', () => {
    it('renders public catalog items and displays offline indicator when network is disconnected', async () => {
      const onOpenDevotional = vi.fn();
      const onOpenContentItem = vi.fn();

      render(
        <DiscoverScreen
          onOpenDevotional={onOpenDevotional}
          onOpenContentItem={onOpenContentItem}
          helpingHandsModules={HELPING_HANDS_MODULES}
          onToggleCompleteStep={vi.fn()}
          onSaveStepNote={vi.fn()}
        />
      );

      // Verify header and offline indicator
      expect(screen.getByText('Discover Resources')).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByTestId('offline-catalog-indicator')).toBeInTheDocument();
      });
      expect(
        screen.getByText(/Offline Mode • Viewing downloaded curated resources/i)
      ).toBeInTheDocument();

      // Verify today's reflection anchor is displayed
      expect(screen.getByText("Today’s Reflection Anchor")).toBeInTheDocument();

      // Click "Read Full Devotional"
      const readBtn = screen.getByText('Read Full Devotional');
      fireEvent.click(readBtn);

      expect(onOpenDevotional).toHaveBeenCalled();
      const passedDev = onOpenDevotional.mock.calls[0][0];
      expect(passedDev.title).toBeDefined();
      expect(passedDev.scriptureRef).toBeDefined();
    });

    it('filters devotionals by topic filter buttons', async () => {
      render(
        <DiscoverScreen
          onOpenDevotional={vi.fn()}
          onOpenContentItem={vi.fn()}
          helpingHandsModules={HELPING_HANDS_MODULES}
          onToggleCompleteStep={vi.fn()}
          onSaveStepNote={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Discover Resources')).toBeInTheDocument();
      });

      // Click "Anxiety & Peace" filter
      const anxietyFilter = screen.getByRole('button', { name: /^Anxiety & Peace$/i });
      fireEvent.click(anxietyFilter);

      expect(anxietyFilter).toHaveClass('active');
    });
  });

  describe('ContentDetailModal Sanitization & Editorial Attribution', () => {
    it('renders sanitized text and displays editorial attribution and licensing metadata', () => {
      const mockDevotional = {
        id: 'dev-meta-1',
        contentId: 'dev-meta-1',
        version: 1,
        language: 'en',
        title: 'Safe Living Hope <script>alert("xss")</script>',
        date: 'Today',
        scriptureRef: '1 Peter 1:3',
        scriptureText: 'Blessed be the God and Father of our Lord Jesus Christ.',
        reflection: 'He has caused us to be born again to a living hope through the resurrection.',
        prayer: 'Lord, anchor my heart in living hope.',
        reflectionPrompt: 'Where do you need renewal today?',
        readingTimeMinutes: 3,
        authorName: 'Dr. John Doe, M.Div.',
        reviewerName: 'Clinical Pastoral Reviewer',
        attributionText: 'Scripture from World English Bible (WEB), Public Domain.',
        licenseType: 'LIFTED_ORIGINAL_CC_BY_4_0',
        contentStatus: 'published' as const,
      };

      render(
        <ContentDetailModal
          devotional={mockDevotional}
          onClose={vi.fn()}
          isBookmarked={false}
          onToggleBookmark={vi.fn()}
        />
      );

      // Verify title is sanitized without script tags
      expect(screen.getByText('Safe Living Hope')).toBeInTheDocument();
      expect(screen.queryByText(/<script>/)).not.toBeInTheDocument();

      // Verify editorial metadata section is rendered
      expect(screen.getByText(/Dr\. John Doe, M\.Div\./i)).toBeInTheDocument();
      expect(screen.getByText(/Clinical Pastoral Reviewer/i)).toBeInTheDocument();
      expect(screen.getByText(/World English Bible \(WEB\)/i)).toBeInTheDocument();
    });
  });

  describe('AdminWebviewPortal Editorial CMS Workflow', () => {
    it('supports full editorial lifecycle: Draft -> Review -> Approve -> Publish -> Revision', async () => {
      render(
        <AdminWebviewPortal
          onExitToApp={vi.fn()}
          onLogout={vi.fn()}
        />
      );

      // Switch to Devotionals tab
      const devTab = screen.getByRole('button', { name: /Devotionals/i });
      fireEvent.click(devTab);

      // Compose a new draft
      const titleInput = screen.getByPlaceholderText(/e\.g\. Restoring Quiet in the Soul/i);
      const scriptureInput = screen.getByPlaceholderText(/e\.g\. Psalm 23:1-3/i);
      const reflectionInput = screen.getByPlaceholderText(/Write the trauma-informed faith reflection/i);

      fireEvent.change(titleInput, { target: { value: 'Walking Through the Valley' } });
      fireEvent.change(scriptureInput, { target: { value: 'Psalm 23:4' } });
      fireEvent.change(reflectionInput, { target: { value: 'Even in the deepest shadow, God is near.' } });

      // Save as Draft
      const saveDraftBtn = screen.getByRole('button', { name: /^Save as Draft$/i });
      fireEvent.click(saveDraftBtn);

      // Check that the new draft appears with "DRAFT" badge
      await waitFor(() => {
        expect(screen.getByText('Walking Through the Valley')).toBeInTheDocument();
      });

      // Submit for Review
      const submitReviewBtn = screen.getByRole('button', { name: /^Submit Review$/i });
      fireEvent.click(submitReviewBtn);

      // Verify it transitions to IN REVIEW
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^Approve$/i })).toBeInTheDocument();
      });

      // Approve content
      const approveBtn = screen.getByRole('button', { name: /^Approve$/i });
      fireEvent.click(approveBtn);

      // Verify it transitions to APPROVED and shows Publish button
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^Publish$/i })).toBeInTheDocument();
      });

      // Publish content
      const publishBtn = screen.getByRole('button', { name: /^Publish$/i });
      fireEvent.click(publishBtn);

      // Verify it transitions to PUBLISHED and shows New Revision button
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /^New Revision$/i }).length).toBeGreaterThan(0);
      });

      // Create new revision
      const revisionBtns = screen.getAllByRole('button', { name: /^New Revision$/i });
      fireEvent.click(revisionBtns[0]);

      // Verify version bump to v2 Draft
      await waitFor(() => {
        expect(screen.getByText('v2')).toBeInTheDocument();
      });
    });
  });
});

