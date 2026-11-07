import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Video,
  BookOpen,
  HeartHandshake,
  FileText,
  Plus,
  Trash2,
  CheckCircle,
  Star,
  Smartphone,
  LogOut,
  Play,
  Send,
  Check,
  Archive,
  RefreshCw,
  FileEdit,
  UploadCloud,
  Link as LinkIcon,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { VideoItem, Devotional, TestimonyItem, ProfessionalArticle } from '../types';
import type { AppRole, ContentStatus } from '../types/database.types';
import {
  CURATED_VIDEOS,
  DEVOTIONAL_ARCHIVE,
  COMMUNITY_TESTIMONIES,
  PROFESSIONAL_ARTICLES,
} from '../data/mockData';
import { contentCatalogService } from '../services/contentCatalogService';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';
import { sanitizeMarkdown, sanitizePlainText } from '../services/contentSanitizer';
import { parseVideoUrl, type ParsedVideoInfo } from '../utils/videoUtils';

interface AdminWebviewPortalProps {
  onExitToApp: () => void;
  onLogout: () => void;
  mode?: 'authenticated' | 'preview';
}

type AdminTab = 'videos' | 'testimonies' | 'devotionals' | 'articles';

interface EditorialDevotional extends Devotional {
  contentStatus: ContentStatus;
  version: number;
  category?: string;
  topics?: string[];
  tags?: string[];
}

interface EditorialVideo extends VideoItem {
  contentStatus: ContentStatus;
  version: number;
}

interface EditorialArticle extends ProfessionalArticle {
  contentStatus: ContentStatus;
  version: number;
  category?: string;
  content?: string;
  topics?: string[];
  tags?: string[];
}

export const AdminWebviewPortal: React.FC<AdminWebviewPortalProps> = ({
  onExitToApp,
  onLogout,
  mode = 'preview',
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('videos');
  const [portalMode] = useState<'authenticated' | 'preview'>(() => {
    if (mode === 'authenticated') return 'authenticated';
    return supabaseAuthService.getCurrentUser()?.email ? 'authenticated' : 'preview';
  });

  // User & Auth State
  const [userRole, setUserRole] = useState<AppRole | 'guest'>('guest');
  const [userEmail] = useState<string>(() => supabaseAuthService.getCurrentUser()?.email || '');
  const [isPublisher, setIsPublisher] = useState<boolean>(false);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState<boolean>(false);

  // Video Management State
  const [videoMethod, setVideoMethod] = useState<'link' | 'upload'>('link');
  const [videosList, setVideosList] = useState<EditorialVideo[]>(() =>
    CURATED_VIDEOS.map((v) => ({ ...v, contentStatus: 'published', version: 1 }))
  );
  const [newVideoTitle, setNewVideoTitle] = useState('');
  const [newVideoCreator, setNewVideoCreator] = useState('Lifted Care');
  const [newVideoTag, setNewVideoTag] = useState('Grief & Loss');
  const [newVideoDuration, setNewVideoDuration] = useState('60');
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [newVideoScripture, setNewVideoScripture] = useState('');
  const [newVideoDescription, setNewVideoDescription] = useState('');
  const [newVideoAttribution, setNewVideoAttribution] = useState('Every Nation GG / LIFTED');

  // Video Upload State (Method B)
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploadingVideo, setIsUploadingVideo] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Video Preview Modal State
  const [previewingVideo, setPreviewingVideo] = useState<{
    title: string;
    videoUrl?: string;
    parsed: ParsedVideoInfo;
    resolvedUrl?: string;
  } | null>(null);

  // Testimony State
  const [testimoniesList, setTestimoniesList] = useState<TestimonyItem[]>(COMMUNITY_TESTIMONIES);

  // Devotional State
  const [devotionalsList, setDevotionalsList] = useState<EditorialDevotional[]>(() =>
    DEVOTIONAL_ARCHIVE.map((d) => ({ ...d, contentStatus: 'published', version: 1 }))
  );
  const [newDevDate, setNewDevDate] = useState('Tomorrow');
  const [newDevTitle, setNewDevTitle] = useState('');
  const [newDevScriptureRef, setNewDevScriptureRef] = useState('');
  const [newDevScriptureText, setNewDevScriptureText] = useState('');
  const [newDevReflection, setNewDevReflection] = useState('');
  const [newDevPrayer, setNewDevPrayer] = useState('');
  const [newDevPrompt, setNewDevPrompt] = useState('');

  // Articles State
  const [articlesList, setArticlesList] = useState<EditorialArticle[]>(() =>
    PROFESSIONAL_ARTICLES.map((a) => ({ ...a, contentStatus: 'published', version: 1 }))
  );
  const [newArticleTitle, setNewArticleTitle] = useState('');
  const [newArticleSubtitle, setNewArticleSubtitle] = useState('');
  const [newArticleAuthor, setNewArticleAuthor] = useState('Cherie Magsanoc');
  const [newArticleCredentials, setNewArticleCredentials] = useState('Pastoral Counselor & Trauma Advocate');
  const [newArticleCategory, setNewArticleCategory] = useState('Trauma Healing');
  const [newArticleReadingTime, setNewArticleReadingTime] = useState('4');
  const [newArticleSummary, setNewArticleSummary] = useState('');
  const [newArticleContent, setNewArticleContent] = useState('');

  // Banner Notification
  const [bannerMessage, setBannerMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showNotification = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setBannerMessage({ text, type });
    setTimeout(() => setBannerMessage(null), 4000);
  }, []);

  // Fetch Live Database Catalog for Authenticated Staff
  const loadDatabaseCatalog = useCallback(async () => {
    if (portalMode !== 'authenticated') return;
    setIsLoadingCatalog(true);

    try {
      // 1. Fetch remote videos
      const remoteVideos = await contentCatalogService.fetchStaffCatalog('video_catalog');
      if (remoteVideos && remoteVideos.length > 0) {
        const mappedVideos: EditorialVideo[] = remoteVideos.map((r: any) => ({
          id: r.id,
          title: r.title,
          description: r.description,
          creator: r.creator || 'Lifted Care',
          durationSeconds: r.duration_seconds || 60,
          videoUrl: r.video_url,
          thumbnailGradient: r.thumbnail_gradient || 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
          topicTags: r.topics && r.topics.length > 0 ? r.topics : [r.category || 'General'],
          emotionalTags: ['peaceful'],
          scriptureAnchor: r.scripture_anchor || undefined,
          viewsCount: 1,
          likesCount: 1,
          contentStatus: (r.content_status as ContentStatus) || (r.is_published ? 'published' : 'draft'),
          version: r.version || 1,
        }));
        setVideosList(mappedVideos);
      }

      // 2. Fetch remote devotionals
      const remoteDevotionals = await contentCatalogService.fetchStaffCatalog('devotional_catalog');
      if (remoteDevotionals && remoteDevotionals.length > 0) {
        const mappedDevs: EditorialDevotional[] = remoteDevotionals.map((r: any) => ({
          id: r.id,
          date: r.created_at ? new Date(r.created_at).toLocaleDateString() : 'Today',
          title: r.title,
          scriptureRef: r.scripture_reference,
          scriptureText: r.scripture_text,
          reflection: r.reflection,
          prayer: r.prayer,
          reflectionPrompt: r.reflection_prompt || '',
          readingTimeMinutes: r.reading_time_minutes || 3,
          category: r.category || 'daily',
          topics: r.topics || [],
          tags: r.tags || [],
          topicTags: r.topics || ['devotional'],
          emotionalTags: ['peaceful'],
          contentStatus: (r.content_status as ContentStatus) || (r.is_published ? 'published' : 'draft'),
          version: r.version || 1,
        }));
        setDevotionalsList(mappedDevs);
      }

      // 3. Fetch remote articles
      const remoteArticles = await contentCatalogService.fetchStaffCatalog('article_catalog');
      if (remoteArticles && remoteArticles.length > 0) {
        const mappedArticles: EditorialArticle[] = remoteArticles.map((r: any) => ({
          id: r.id,
          title: r.title,
          subtitle: r.subtitle || '',
          summary: r.summary,
          content: r.content,
          contentParagraphs: [r.content],
          category: r.category,
          readingTimeMinutes: r.read_time_minutes || 3,
          topics: r.topics || [],
          tags: r.tags || [],
          topicTags: r.topics || ['Article'],
          emotionalTags: ['hopeful'],
          author: r.author_name || 'Lifted Editorial',
          credentials: 'Staff Contributor',
          contentStatus: (r.content_status as ContentStatus) || (r.is_published ? 'published' : 'draft'),
          version: r.version || 1,
        }));
        setArticlesList(mappedArticles);
      }
    } catch (err) {
      console.warn('Failed to fetch remote staff catalog, displaying cached items:', err);
    } finally {
      setIsLoadingCatalog(false);
    }
  }, [portalMode]);

  // Role bootstrap on mount
  useEffect(() => {
    supabaseAuthService.getUserRole().then((role) => {
      if (role) setUserRole(role);
    }).catch(() => {});

    supabaseAuthService.isPublisher().then((pub) => setIsPublisher(pub)).catch(() => {});
  }, []);

  // When switching to authenticated mode, fetch catalog
  useEffect(() => {
    if (portalMode === 'authenticated') {
      const timer = setTimeout(() => {
        void loadDatabaseCatalog();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [portalMode, loadDatabaseCatalog]);

  const handleSignOut = async () => {
    await supabaseAuthService.signOut();
    onLogout();
  };

  const renderStatusBadge = (status: ContentStatus = 'published', version = 1) => {
    const badges: Record<ContentStatus, { bg: string; color: string; label: string }> = {
      draft: { bg: '#FEF3C7', color: '#92400E', label: 'Draft' },
      in_review: { bg: '#EDE9FE', color: '#6D28D9', label: 'In Review' },
      approved: { bg: '#E0F2FE', color: '#0369A1', label: 'Approved' },
      published: { bg: '#DCFCE7', color: '#15803D', label: 'Published' },
      archived: { bg: '#F1F5F9', color: '#475569', label: 'Archived' },
    };
    const b = badges[status] || badges.published;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span
          style={{
            fontSize: '0.68rem',
            fontWeight: 700,
            background: b.bg,
            color: b.color,
            padding: '2px 8px',
            borderRadius: '12px',
            textTransform: 'uppercase',
          }}
        >
          {b.label}
        </span>
        <span
          style={{
            fontSize: '0.68rem',
            fontWeight: 600,
            background: '#F1F5F9',
            color: '#64748B',
            padding: '2px 6px',
            borderRadius: '8px',
          }}
        >
          v{version}
        </span>
      </div>
    );
  };

  // ============================================================================
  // VIDEO MANAGEMENT HANDLERS (Methods A & B)
  // ============================================================================

  // Method A: Add Video via YouTube or Vimeo Link
  const handleAddVideoLink = async (publishImmediately = false) => {
    if (!newVideoTitle.trim()) {
      showNotification('Video title is required.', 'error');
      return;
    }
    if (!newVideoUrl.trim()) {
      showNotification('Please provide a valid YouTube or Vimeo video link.', 'error');
      return;
    }

    const parsed = parseVideoUrl(newVideoUrl);
    if (!parsed.isEmbeddable) {
      showNotification(parsed.errorMessage || 'Invalid video link. Only YouTube or Vimeo links are supported.', 'error');
      return;
    }

    const gradients = [
      'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
      'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
      'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
      'linear-gradient(135deg, #7c2d12 0%, #ea580c 100%)',
    ];
    const pickedGradient = gradients[Math.floor(Math.random() * gradients.length)];
    const sanitizedTitle = sanitizePlainText(newVideoTitle);
    const sanitizedCreator = sanitizePlainText(newVideoCreator) || 'Lifted Care';
    const sanitizedScripture = newVideoScripture.trim() ? sanitizePlainText(newVideoScripture) : 'Psalm 34:18';
    const targetStatus: ContentStatus = publishImmediately ? 'published' : 'draft';

    const localItem: EditorialVideo = {
      id: `vid-${Date.now()}`,
      title: sanitizedTitle,
      description: newVideoDescription.trim() || `Short-form faith & wellness reflection on ${newVideoTag}.`,
      creator: sanitizedCreator,
      durationSeconds: parseInt(newVideoDuration, 10) || 60,
      videoUrl: parsed.sanitizedUrl || newVideoUrl.trim(),
      thumbnailGradient: pickedGradient,
      topicTags: [newVideoTag],
      emotionalTags: ['peaceful', 'hopeful'],
      scriptureAnchor: sanitizedScripture,
      viewsCount: 1,
      likesCount: 1,
      contentStatus: targetStatus,
      version: 1,
    };

    if (portalMode === 'authenticated') {
      try {
        const draftRes: any = await contentCatalogService.createDraft('video_catalog', {
          title: sanitizedTitle,
          description: localItem.description,
          creator: sanitizedCreator,
          category: newVideoTag,
          duration_seconds: localItem.durationSeconds,
          video_url: localItem.videoUrl,
          scripture_anchor: sanitizedScripture,
          thumbnail_gradient: pickedGradient,
          topics: [newVideoTag],
          attribution_text: newVideoAttribution.trim() || 'LIFTED Care',
        });

        if (publishImmediately && draftRes?.id) {
          await contentCatalogService.publishContent('video_catalog', draftRes.id);
          contentCatalogService.clearCacheForTesting();
        }
        await loadDatabaseCatalog();
        showNotification(publishImmediately ? 'Video published to live Discover feed!' : 'Video draft saved to catalog.');
      } catch (err: any) {
        showNotification(`Database error: ${err.message}`, 'error');
        return;
      }
    } else {
      setVideosList([localItem, ...videosList]);
      showNotification('Preview video added (mock state).');
    }

    setNewVideoTitle('');
    setNewVideoUrl('');
    setNewVideoScripture('');
    setNewVideoDescription('');
  };

  // Method B: Upload Video File to Supabase Storage
  const handleUploadVideoFile = async (publishImmediately = false) => {
    if (!selectedVideoFile) {
      showNotification('Please select a video file to upload.', 'error');
      return;
    }
    if (!newVideoTitle.trim()) {
      showNotification('Please provide a video title.', 'error');
      return;
    }

    if (portalMode !== 'authenticated') {
      showNotification('Staff authentication required to upload files to Supabase Storage.', 'error');
      return;
    }

    setIsUploadingVideo(true);
    setUploadProgress(10);

    try {
      // 1. Upload to Supabase Storage 'curated-videos'
      const { path } = await contentCatalogService.uploadVideoFile(
        selectedVideoFile,
        (pct) => setUploadProgress(pct)
      );

      const sanitizedTitle = sanitizePlainText(newVideoTitle);
      const sanitizedCreator = sanitizePlainText(newVideoCreator) || 'Lifted Care';
      const pickedGradient = 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)';

      // 2. Create catalog draft row with the storage path
      const draftRes: any = await contentCatalogService.createDraft('video_catalog', {
        title: sanitizedTitle,
        description: newVideoDescription.trim() || `Faith reflection video on ${newVideoTag}.`,
        creator: sanitizedCreator,
        category: newVideoTag,
        duration_seconds: parseInt(newVideoDuration, 10) || 60,
        video_url: path,
        scripture_anchor: newVideoScripture.trim() || undefined,
        thumbnail_gradient: pickedGradient,
        topics: [newVideoTag],
        attribution_text: newVideoAttribution.trim() || 'Uploaded video file',
      });

      // 3. Publish if requested
      if (publishImmediately && draftRes?.id) {
        await contentCatalogService.publishContent('video_catalog', draftRes.id);
        contentCatalogService.clearCacheForTesting();
      }

      await loadDatabaseCatalog();
      showNotification(
        publishImmediately
          ? `File "${selectedVideoFile.name}" uploaded and published to Discover feed!`
          : `File "${selectedVideoFile.name}" uploaded and saved as draft!`
      );

      // Reset form
      setSelectedVideoFile(null);
      setNewVideoTitle('');
      setNewVideoDescription('');
      setNewVideoScripture('');
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      showNotification(`Upload failed: ${err.message}`, 'error');
    } finally {
      setIsUploadingVideo(false);
    }
  };

  // Video Actions
  const handlePublishVideo = async (id: string) => {
    try {
      if (portalMode === 'authenticated') {
        await contentCatalogService.publishContent('video_catalog', id);
        contentCatalogService.clearCacheForTesting();
        await loadDatabaseCatalog();
      } else {
        setVideosList((prev) =>
          prev.map((v) => (v.id === id ? { ...v, contentStatus: 'published' } : v))
        );
      }
      showNotification('Video published to Discover feed!');
    } catch (err: any) {
      showNotification(`Publish failed: ${err.message}`, 'error');
    }
  };

  const handleUnpublishVideo = async (id: string) => {
    try {
      if (portalMode === 'authenticated') {
        await contentCatalogService.unpublishContent('video_catalog', id, true);
        contentCatalogService.clearCacheForTesting();
        await loadDatabaseCatalog();
      } else {
        setVideosList((prev) =>
          prev.map((v) => (v.id === id ? { ...v, contentStatus: 'archived' } : v))
        );
      }
      showNotification('Video unpublished and archived.');
    } catch (err: any) {
      showNotification(`Unpublish failed: ${err.message}`, 'error');
    }
  };

  const handleDeleteVideo = async (id: string) => {
    try {
      if (portalMode === 'authenticated') {
        await contentCatalogService.unpublishContent('video_catalog', id, true);
        contentCatalogService.clearCacheForTesting();
        await loadDatabaseCatalog();
      } else {
        setVideosList(videosList.filter((v) => v.id !== id));
      }
      showNotification('Video archived/removed.');
    } catch (err: any) {
      showNotification(`Archive failed: ${err.message}`, 'error');
    }
  };

  const handlePreviewVideoModal = async (video: EditorialVideo) => {
    const parsed = parseVideoUrl(video.videoUrl || '');
    let resolvedUrl = video.videoUrl;
    if (parsed.type === 'storage' && video.videoUrl) {
      resolvedUrl = await contentCatalogService.getVideoPlaybackUrl(video.videoUrl);
    }
    setPreviewingVideo({
      title: video.title,
      videoUrl: video.videoUrl,
      parsed,
      resolvedUrl,
    });
  };

  // ============================================================================
  // DEVOTIONAL MANAGEMENT HANDLERS
  // ============================================================================

  const handleSaveDevotional = async (asDraft: boolean) => {
    if (!newDevTitle.trim() || !newDevScriptureRef.trim()) {
      showNotification('Title and Scripture Reference are required.', 'error');
      return;
    }

    const sanitizedTitle = sanitizePlainText(newDevTitle);
    const sanitizedReflection = sanitizeMarkdown(newDevReflection);
    const sanitizedPrayer = sanitizeMarkdown(newDevPrayer);
    const sanitizedScriptureText = sanitizeMarkdown(newDevScriptureText);

    if (portalMode === 'authenticated') {
      try {
        const draftRes: any = await contentCatalogService.createDraft('devotional_catalog', {
          title: sanitizedTitle,
          scripture_reference: newDevScriptureRef.trim(),
          scripture_text: sanitizedScriptureText,
          reflection: sanitizedReflection,
          prayer: sanitizedPrayer,
          reflection_prompt: newDevPrompt.trim(),
          category: 'daily',
        });

        if (!asDraft && draftRes?.id) {
          await contentCatalogService.publishContent('devotional_catalog', draftRes.id);
          contentCatalogService.clearCacheForTesting();
        }
        await loadDatabaseCatalog();
        showNotification(asDraft ? 'Devotional draft saved.' : 'Devotional published to Bible Pillar!');
      } catch (err: any) {
        showNotification(`Database error: ${err.message}`, 'error');
        return;
      }
    } else {
      const localDev: EditorialDevotional = {
        id: `dev-${Date.now()}`,
        date: newDevDate.trim(),
        title: sanitizedTitle,
        scriptureRef: newDevScriptureRef.trim(),
        scriptureText: sanitizedScriptureText,
        reflection: sanitizedReflection,
        prayer: sanitizedPrayer,
        reflectionPrompt: newDevPrompt.trim(),
        readingTimeMinutes: 3,
        category: 'daily',
        topics: ['daily'],
        tags: [],
        topicTags: ['devotional'],
        emotionalTags: ['peaceful'],
        contentStatus: asDraft ? 'draft' : 'published',
        version: 1,
      };
      setDevotionalsList([localDev, ...devotionalsList]);
      showNotification(asDraft ? 'Devotional draft saved (preview).' : 'Devotional published (preview).');
    }

    setNewDevTitle('');
    setNewDevScriptureRef('');
    setNewDevScriptureText('');
    setNewDevReflection('');
    setNewDevPrayer('');
    setNewDevPrompt('');
  };

  const handleSubmitDevotionalReview = async (id: string) => {
    try {
      if (portalMode === 'authenticated') {
        await contentCatalogService.submitForReview('devotional_catalog', id, 'Staff editorial review');
        await loadDatabaseCatalog();
      } else {
        setDevotionalsList((prev) =>
          prev.map((d) => (d.id === id ? { ...d, contentStatus: 'in_review' } : d))
        );
      }
      showNotification('Devotional submitted for review.');
    } catch (err: any) {
      showNotification(`Review error: ${err.message}`, 'error');
    }
  };

  const handleApproveDevotional = async (id: string) => {
    try {
      if (portalMode === 'authenticated') {
        await contentCatalogService.approveContent('devotional_catalog', id, 'Editorial approval');
        await loadDatabaseCatalog();
      } else {
        setDevotionalsList((prev) =>
          prev.map((d) => (d.id === id ? { ...d, contentStatus: 'approved' } : d))
        );
      }
      showNotification('Devotional approved.');
    } catch (err: any) {
      showNotification(`Approval error: ${err.message}`, 'error');
    }
  };

  const handlePublishDevotional = async (id: string) => {
    try {
      if (portalMode === 'authenticated') {
        await contentCatalogService.publishContent('devotional_catalog', id);
        contentCatalogService.clearCacheForTesting();
        await loadDatabaseCatalog();
      } else {
        setDevotionalsList((prev) =>
          prev.map((d) => (d.id === id ? { ...d, contentStatus: 'published' } : d))
        );
      }
      showNotification('Devotional published to Discover feed!');
    } catch (err: any) {
      showNotification(`Publish error: ${err.message}`, 'error');
    }
  };

  const handleUnpublishDevotional = async (id: string) => {
    try {
      if (portalMode === 'authenticated') {
        await contentCatalogService.unpublishContent('devotional_catalog', id, true);
        contentCatalogService.clearCacheForTesting();
        await loadDatabaseCatalog();
      } else {
        setDevotionalsList((prev) =>
          prev.map((d) => (d.id === id ? { ...d, contentStatus: 'archived' } : d))
        );
      }
      showNotification('Devotional archived.');
    } catch (err: any) {
      showNotification(`Unpublish error: ${err.message}`, 'error');
    }
  };

  const handleCreateNewRevisionDevotional = async (id: string) => {
    const target = devotionalsList.find((d) => d.id === id);
    if (!target) return;

    try {
      if (portalMode === 'authenticated') {
        await contentCatalogService.createNewRevision(
          'devotional_catalog',
          id,
          { reflection: `${target.reflection} [Revised]` },
          'Editorial revision'
        );
        await loadDatabaseCatalog();
      } else {
        setDevotionalsList((prev) =>
          prev.map((d) =>
            d.id === id
              ? {
                  ...d,
                  contentStatus: 'draft',
                  version: (d.version || 1) + 1,
                  title: `${d.title} (v${(d.version || 1) + 1} Draft)`,
                }
              : d
          )
        );
      }
      showNotification(`New revision draft created for "${target.title}".`);
    } catch (err: any) {
      showNotification(`Revision error: ${err.message}`, 'error');
    }
  };

  // ============================================================================
  // ARTICLE MANAGEMENT HANDLERS
  // ============================================================================

  const handleSaveArticle = async (asDraft: boolean) => {
    if (!newArticleTitle.trim() || !newArticleContent.trim()) {
      showNotification('Article Title and Content are required.', 'error');
      return;
    }

    const sanitizedTitle = sanitizePlainText(newArticleTitle);
    const sanitizedSubtitle = sanitizePlainText(newArticleSubtitle);
    const sanitizedSummary = sanitizePlainText(newArticleSummary) || sanitizedTitle;
    const sanitizedContent = sanitizeMarkdown(newArticleContent);

    if (portalMode === 'authenticated') {
      try {
        const draftRes: any = await contentCatalogService.createDraft('article_catalog', {
          title: sanitizedTitle,
          subtitle: sanitizedSubtitle,
          summary: sanitizedSummary,
          content: sanitizedContent,
          category: newArticleCategory,
          read_time_minutes: parseInt(newArticleReadingTime, 10) || 3,
          author_name: sanitizePlainText(newArticleAuthor) || 'Cherie Magsanoc',
          topics: [newArticleCategory],
        });

        if (!asDraft && draftRes?.id) {
          await contentCatalogService.publishContent('article_catalog', draftRes.id);
          contentCatalogService.clearCacheForTesting();
        }
        await loadDatabaseCatalog();
        showNotification(asDraft ? 'Article draft saved.' : 'Article published to Discover section!');
      } catch (err: any) {
        showNotification(`Database error: ${err.message}`, 'error');
        return;
      }
    } else {
      const localArticle: EditorialArticle = {
        id: `art-${Date.now()}`,
        title: sanitizedTitle,
        subtitle: sanitizedSubtitle,
        summary: sanitizedSummary,
        content: sanitizedContent,
        contentParagraphs: [sanitizedContent],
        category: newArticleCategory,
        readingTimeMinutes: parseInt(newArticleReadingTime, 10) || 3,
        topics: [newArticleCategory],
        tags: [],
        topicTags: [newArticleCategory],
        emotionalTags: ['hopeful'],
        author: newArticleAuthor || 'Cherie Magsanoc',
        credentials: newArticleCredentials,
        contentStatus: asDraft ? 'draft' : 'published',
        version: 1,
      };
      setArticlesList([localArticle, ...articlesList]);
      showNotification(asDraft ? 'Article draft saved (preview).' : 'Article published (preview).');
    }

    setNewArticleTitle('');
    setNewArticleSubtitle('');
    setNewArticleSummary('');
    setNewArticleContent('');
  };

  const handlePublishArticle = async (id: string) => {
    try {
      if (portalMode === 'authenticated') {
        await contentCatalogService.publishContent('article_catalog', id);
        contentCatalogService.clearCacheForTesting();
        await loadDatabaseCatalog();
      } else {
        setArticlesList((prev) =>
          prev.map((a) => (a.id === id ? { ...a, contentStatus: 'published' } : a))
        );
      }
      showNotification('Article published to Discover feed!');
    } catch (err: any) {
      showNotification(`Publish failed: ${err.message}`, 'error');
    }
  };

  const handleUnpublishArticle = async (id: string) => {
    try {
      if (portalMode === 'authenticated') {
        await contentCatalogService.unpublishContent('article_catalog', id, true);
        contentCatalogService.clearCacheForTesting();
        await loadDatabaseCatalog();
      } else {
        setArticlesList((prev) =>
          prev.map((a) => (a.id === id ? { ...a, contentStatus: 'archived' } : a))
        );
      }
      showNotification('Article moved to archive.');
    } catch (err: any) {
      showNotification(`Unpublish failed: ${err.message}`, 'error');
    }
  };

  // Testimony Handlers
  const handleToggleFeature = (id: string) => {
    setTestimoniesList(
      testimoniesList.map((t) => (t.id === id ? { ...t, isFeatured: !t.isFeatured } : t))
    );
    showNotification('Testimony featured status updated.');
  };

  const handleDeleteTestimony = (id: string) => {
    setTestimoniesList(testimoniesList.filter((t) => t.id !== id));
    showNotification('Testimony removed from community list.');
  };

  return (
    <div className="admin-portal-wrapper">
      {/* Editorial CMS Role & Mode Banner */}
      <div
        style={{
          background: portalMode === 'authenticated' ? '#F0FDF4' : '#FEF3C7',
          borderBottom: portalMode === 'authenticated' ? '1px solid #BBF7D0' : '1px solid #FDE68A',
          color: portalMode === 'authenticated' ? '#166534' : '#92400E',
          padding: '8px 16px',
          fontSize: '0.76rem',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {portalMode === 'authenticated' ? (
            <>
              <ShieldCheck size={16} color="#16A34A" />
              <span>
                <strong>AUTHENTICATED STAFF PORTAL:</strong> Logged in as{' '}
                <strong>{userEmail || 'Staff'}</strong> • Authority:{' '}
                <span
                  style={{
                    background: '#DCFCE7',
                    color: '#15803D',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {userRole || 'Editor'}
                </span>
                {isPublisher && (
                  <span style={{ marginLeft: '6px', fontSize: '0.72rem', color: '#047857' }}>
                    (Publisher Approval Rights Enabled)
                  </span>
                )}
              </span>
            </>
          ) : (
            <>
              <AlertTriangle size={16} color="#D97706" />
              <span>
                <strong>READ-ONLY DEMO MODE:</strong> Mock state interface preview. Content changes are local and will not persist to the cloud database.
              </span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {portalMode === 'authenticated' && (
            <button
              onClick={loadDatabaseCatalog}
              disabled={isLoadingCatalog}
              style={{
                background: '#FFFFFF',
                border: '1px solid #BBF7D0',
                color: '#166534',
                padding: '3px 10px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.72rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontWeight: 600,
              }}
              title="Refresh catalog from Supabase"
            >
              <RefreshCw size={12} className={isLoadingCatalog ? 'spin' : ''} />
              <span>{isLoadingCatalog ? 'Syncing...' : 'Sync Cloud'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Header */}
      <header className="admin-portal-header">
        <div className="admin-header-top-row">
          <div className="admin-brand-group">
            <div className="admin-brand-logo">L</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-primary)', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center' }}>
                LIFTED <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#0284C7', background: '#E0F2FE', padding: '2px 8px', borderRadius: '12px', marginLeft: '6px' }}>Editorial CMS</span>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                Client Preview • Cherie Magsanoc • Every Nation GG
              </div>
            </div>
          </div>

          <div className="admin-header-actions">
            <button
              onClick={onExitToApp}
              className="btn-secondary"
              style={{ fontSize: '0.78rem', padding: '6px 12px', gap: '5px', minHeight: 'auto', borderRadius: 'var(--radius-full)' }}
              title="Return to mobile view"
            >
              <Smartphone size={14} />
              <span>App View</span>
            </button>

            <button
              onClick={handleSignOut}
              style={{
                background: '#FEE2E2',
                color: '#DC2626',
                border: '1px solid #FECACA',
                padding: '6px 12px',
                borderRadius: 'var(--radius-full)',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
              title="Log out of staff portal"
            >
              <LogOut size={14} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="admin-tab-scroll-container">
          <button
            onClick={() => setActiveTab('videos')}
            className={`admin-tab-btn ${activeTab === 'videos' ? 'active' : ''}`}
          >
            <Video size={14} />
            <span>Videos ({videosList.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('devotionals')}
            className={`admin-tab-btn ${activeTab === 'devotionals' ? 'active' : ''}`}
          >
            <BookOpen size={14} />
            <span>Devotionals ({devotionalsList.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('articles')}
            className={`admin-tab-btn ${activeTab === 'articles' ? 'active' : ''}`}
          >
            <FileText size={14} />
            <span>Articles ({articlesList.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('testimonies')}
            className={`admin-tab-btn ${activeTab === 'testimonies' ? 'active' : ''}`}
          >
            <HeartHandshake size={14} />
            <span>Stories ({testimoniesList.length})</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="admin-main-container">
        {/* Banner Alert */}
        {bannerMessage && (
          <div
            style={{
              background: bannerMessage.type === 'success' ? '#ECFDF5' : '#FEF2F2',
              border: bannerMessage.type === 'success' ? '1px solid #A7F3D0' : '1px solid #FECACA',
              color: bannerMessage.type === 'success' ? '#065F46' : '#991B1B',
              padding: '12px 18px',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.88rem',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              animation: 'fadeIn 0.25s ease',
            }}
          >
            {bannerMessage.type === 'success' ? (
              <CheckCircle size={18} color="#059669" />
            ) : (
              <AlertTriangle size={18} color="#DC2626" />
            )}
            <span>{bannerMessage.text}</span>
          </div>
        )}

        {/* ======================================================== */}
        {/* 1. VIDEOS CMS WORKSPACE (Methods A & B) */}
        {/* ======================================================== */}
        {activeTab === 'videos' && (
          <div className="admin-two-col-layout">
            <div className="admin-card-container">
              {/* Method Selector: Video Link vs Storage Upload */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <button
                  type="button"
                  onClick={() => setVideoMethod('link')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: videoMethod === 'link' ? '2px solid #0284C7' : '1px solid var(--border-subtle)',
                    background: videoMethod === 'link' ? '#EFF6FF' : '#FFFFFF',
                    color: videoMethod === 'link' ? '#0284C7' : 'var(--text-secondary)',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <LinkIcon size={14} />
                  <span>Method A: Video Link</span>
                </button>

                <button
                  type="button"
                  onClick={() => setVideoMethod('upload')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: videoMethod === 'upload' ? '2px solid #0284C7' : '1px solid var(--border-subtle)',
                    background: videoMethod === 'upload' ? '#EFF6FF' : '#FFFFFF',
                    color: videoMethod === 'upload' ? '#0284C7' : 'var(--text-secondary)',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <UploadCloud size={14} />
                  <span>Method B: File Upload</span>
                </button>
              </div>

              {/* METHOD A: Video Link Form */}
              {videoMethod === 'link' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAddVideoLink(false);
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
                >
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>
                      Video Title *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. When Loneliness Hits in Your 30s"
                      value={newVideoTitle}
                      onChange={(e) => setNewVideoTitle(e.target.value)}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>
                        Creator / Speaker
                      </label>
                      <input
                        type="text"
                        value={newVideoCreator}
                        onChange={(e) => setNewVideoCreator(e.target.value)}
                        placeholder="e.g. Cherie Magsanoc"
                        style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>
                        Duration (Seconds)
                      </label>
                      <input
                        type="number"
                        value={newVideoDuration}
                        onChange={(e) => setNewVideoDuration(e.target.value)}
                        placeholder="60"
                        style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>
                      Topic Category *
                    </label>
                    <select
                      value={newVideoTag}
                      onChange={(e) => setNewVideoTag(e.target.value)}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem', background: '#FFFFFF' }}
                    >
                      <option value="Grief & Loss">Grief & Loss</option>
                      <option value="Burnout & Rest">Burnout & Rest</option>
                      <option value="Anxiety & Panic">Anxiety & Panic</option>
                      <option value="Parenting">Parenting</option>
                      <option value="Generational Healing">Generational Healing</option>
                      <option value="Heartbreak & Dating">Heartbreak & Dating</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>
                      YouTube or Vimeo URL *
                    </label>
                    <input
                      type="url"
                      required
                      placeholder="https://www.youtube.com/watch?v=... or https://vimeo.com/..."
                      value={newVideoUrl}
                      onChange={(e) => setNewVideoUrl(e.target.value)}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}
                    />
                    {newVideoUrl && (
                      <div style={{ marginTop: '6px', fontSize: '0.74rem' }}>
                        {(() => {
                          const p = parseVideoUrl(newVideoUrl);
                          if (p.isEmbeddable) {
                            return <span style={{ color: '#059669', fontWeight: 600 }}>✓ Verified {p.type.toUpperCase()} embed link ready</span>;
                          }
                          return <span style={{ color: '#DC2626' }}>⚠ {p.errorMessage}</span>;
                        })()}
                      </div>
                    )}
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>
                      Scripture Anchor (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Psalm 34:18 — Near to the brokenhearted"
                      value={newVideoScripture}
                      onChange={(e) => setNewVideoScripture(e.target.value)}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>
                      Description / Key Takeaway
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Short reflection summary..."
                      value={newVideoDescription}
                      onChange={(e) => setNewVideoDescription(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.84rem' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>
                      Attribution / License
                    </label>
                    <input
                      type="text"
                      value={newVideoAttribution}
                      onChange={(e) => setNewVideoAttribution(e.target.value)}
                      placeholder="Every Nation GG / LIFTED"
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                    <button
                      type="submit"
                      className="btn-secondary"
                      style={{ flex: 1, padding: '10px 14px', fontSize: '0.84rem', justifyContent: 'center' }}
                    >
                      Save as Draft
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddVideoLink(true)}
                      className="btn-primary dark-accent"
                      style={{ flex: 1, padding: '10px 14px', fontSize: '0.84rem', justifyContent: 'center', gap: '6px' }}
                    >
                      <Plus size={16} />
                      <span>Publish to Feed</span>
                    </button>
                  </div>
                </form>
              )}

              {/* METHOD B: Video File Upload Form */}
              {videoMethod === 'upload' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div
                    style={{
                      border: '2px dashed #BAE6FD',
                      borderRadius: 'var(--radius-md)',
                      background: '#F0F9FF',
                      padding: '20px',
                      textAlign: 'center',
                      cursor: 'pointer',
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <UploadCloud size={32} color="#0284C7" style={{ margin: '0 auto 8px' }} />
                    <div style={{ fontSize: '0.86rem', fontWeight: 600, color: '#0369A1' }}>
                      {selectedVideoFile ? selectedVideoFile.name : 'Click to Select Video File'}
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#64748B', marginTop: '4px' }}>
                      Supported formats: MP4, WebM, QuickTime (Max 50MB)
                    </div>
                    {selectedVideoFile && (
                      <div style={{ fontSize: '0.74rem', color: '#059669', fontWeight: 600, marginTop: '6px' }}>
                        File size: {(selectedVideoFile.size / (1024 * 1024)).toFixed(2)} MB
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setSelectedVideoFile(file);
                          if (!newVideoTitle) {
                            setNewVideoTitle(file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));
                          }
                        }
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>
                      Video Title *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Grounding in the Peace of God"
                      value={newVideoTitle}
                      onChange={(e) => setNewVideoTitle(e.target.value)}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>
                        Creator / Speaker
                      </label>
                      <input
                        type="text"
                        value={newVideoCreator}
                        onChange={(e) => setNewVideoCreator(e.target.value)}
                        placeholder="e.g. Cherie Magsanoc"
                        style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>
                        Category *
                      </label>
                      <select
                        value={newVideoTag}
                        onChange={(e) => setNewVideoTag(e.target.value)}
                        style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem', background: '#FFFFFF' }}
                      >
                        <option value="Grief & Loss">Grief & Loss</option>
                        <option value="Burnout & Rest">Burnout & Rest</option>
                        <option value="Anxiety & Panic">Anxiety & Panic</option>
                        <option value="Parenting">Parenting</option>
                        <option value="Generational Healing">Generational Healing</option>
                      </select>
                    </div>
                  </div>

                  {/* Upload Progress Bar */}
                  {isUploadingVideo && (
                    <div style={{ margin: '8px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', marginBottom: '4px' }}>
                        <span>Uploading to Supabase Storage...</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div style={{ height: '6px', background: '#E2E8F0', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#0284C7', transition: 'width 0.3s ease' }} />
                      </div>
                    </div>
                  )}

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>
                      Attribution / License
                    </label>
                    <input
                      type="text"
                      value={newVideoAttribution}
                      onChange={(e) => setNewVideoAttribution(e.target.value)}
                      placeholder="Every Nation GG / LIFTED"
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                    <button
                      type="button"
                      disabled={isUploadingVideo || !selectedVideoFile}
                      onClick={() => handleUploadVideoFile(false)}
                      className="btn-secondary"
                      style={{ flex: 1, padding: '10px 14px', fontSize: '0.84rem', justifyContent: 'center' }}
                    >
                      Upload as Draft
                    </button>
                    <button
                      type="button"
                      disabled={isUploadingVideo || !selectedVideoFile}
                      onClick={() => handleUploadVideoFile(true)}
                      className="btn-primary dark-accent"
                      style={{ flex: 1, padding: '10px 14px', fontSize: '0.84rem', justifyContent: 'center', gap: '6px' }}
                    >
                      {isUploadingVideo ? (
                        <>
                          <Loader2 size={16} className="spin" />
                          <span>Uploading...</span>
                        </>
                      ) : (
                        <>
                          <UploadCloud size={16} />
                          <span>Upload & Publish</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Video List & Live Previews */}
            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '6px' }}>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Catalog Videos ({videosList.length})
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Published videos appear live in the mobile Discover tab
                </span>
              </div>

              <div className="admin-cards-grid">
                {videosList.map((video) => (
                  <div
                    key={video.id}
                    style={{
                      background: '#FFFFFF',
                      borderRadius: 'var(--radius-lg)',
                      overflow: 'hidden',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                    }}
                  >
                    {/* Thumbnail card with Preview Play Button */}
                    <div
                      style={{
                        background: video.thumbnailGradient || 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
                        height: '140px',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        color: '#FFFFFF',
                        position: 'relative',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <span style={{ background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem' }}>
                          #{video.topicTags[0]}
                        </span>
                        {renderStatusBadge(video.contentStatus, video.version)}
                      </div>

                      <button
                        type="button"
                        onClick={() => handlePreviewVideoModal(video)}
                        style={{
                          background: 'rgba(255,255,255,0.25)',
                          border: '1px solid rgba(255,255,255,0.6)',
                          backdropFilter: 'blur(4px)',
                          borderRadius: 'var(--radius-full)',
                          padding: '6px 14px',
                          color: '#FFFFFF',
                          fontSize: '0.76rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          alignSelf: 'center',
                        }}
                      >
                        <Play size={14} fill="#fff" />
                        <span>Watch Clip</span>
                      </button>

                      <div style={{ fontSize: '0.7rem', opacity: 0.85 }}>
                        Duration: {video.durationSeconds}s
                      </div>
                    </div>

                    {/* Metadata & Editorial Controls */}
                    <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                          {video.title}
                        </div>
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                          By {video.creator}
                        </div>
                        {video.scriptureAnchor && (
                          <div style={{ fontSize: '0.72rem', color: '#0284C7', marginTop: '4px', fontStyle: 'italic' }}>
                            {video.scriptureAnchor}
                          </div>
                        )}
                        {video.videoUrl && (
                          <div style={{ fontSize: '0.70rem', color: '#64748B', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            Source: {video.videoUrl}
                          </div>
                        )}
                      </div>

                      {/* Editorial Actions Toolbar */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {video.contentStatus !== 'published' && (
                            <button
                              type="button"
                              onClick={() => handlePublishVideo(video.id)}
                              style={{
                                background: '#DCFCE7',
                                color: '#15803D',
                                border: 'none',
                                padding: '4px 8px',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <CheckCircle size={12} />
                              <span>Publish</span>
                            </button>
                          )}
                          {video.contentStatus === 'published' && (
                            <button
                              type="button"
                              onClick={() => handleUnpublishVideo(video.id)}
                              style={{
                                background: '#FEF3C7',
                                color: '#92400E',
                                border: 'none',
                                padding: '4px 8px',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <Archive size={12} />
                              <span>Unpublish</span>
                            </button>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDeleteVideo(video.id)}
                          style={{
                            background: '#FEE2E2',
                            color: '#DC2626',
                            border: 'none',
                            padding: '4px 8px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.72rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <Trash2 size={12} />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* 2. DEVOTIONALS WORKSPACE */}
        {/* ======================================================== */}
        {activeTab === 'devotionals' && (
          <div className="admin-two-col-layout">
            <div className="admin-card-container">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <BookOpen size={18} color="#0284C7" />
                <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Compose Daily Devotional
                </h2>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveDevotional(false);
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>Date</label>
                    <input
                      type="text"
                      value={newDevDate}
                      onChange={(e) => setNewDevDate(e.target.value)}
                      placeholder="e.g. November 2, 2026"
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>Scripture Ref *</label>
                    <input
                      type="text"
                      required
                      value={newDevScriptureRef}
                      onChange={(e) => setNewDevScriptureRef(e.target.value)}
                      placeholder="e.g. Psalm 23:1-3"
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>Devotional Title *</label>
                  <input
                    type="text"
                    required
                    value={newDevTitle}
                    onChange={(e) => setNewDevTitle(e.target.value)}
                    placeholder="e.g. Restoring Quiet in the Soul"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>Scripture Verse Text</label>
                  <textarea
                    rows={2}
                    value={newDevScriptureText}
                    onChange={(e) => setNewDevScriptureText(e.target.value)}
                    placeholder="Paste the verse text..."
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.84rem' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>Reflection Paragraph *</label>
                  <textarea
                    rows={4}
                    required
                    value={newDevReflection}
                    onChange={(e) => setNewDevReflection(e.target.value)}
                    placeholder="Write the trauma-informed faith reflection..."
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.84rem' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>Closing Prayer</label>
                  <input
                    type="text"
                    value={newDevPrayer}
                    onChange={(e) => setNewDevPrayer(e.target.value)}
                    placeholder="Lord, grant me stillness and restore my soul..."
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.84rem' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  <button
                    type="button"
                    onClick={() => handleSaveDevotional(true)}
                    className="btn-secondary"
                    style={{ flex: 1, padding: '10px 14px', fontSize: '0.84rem', justifyContent: 'center' }}
                  >
                    Save as Draft
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveDevotional(false)}
                    className="btn-primary dark-accent"
                    style={{ flex: 1, padding: '10px 14px', fontSize: '0.84rem', justifyContent: 'center' }}
                  >
                    Publish Directly
                  </button>
                </div>
              </form>
            </div>

            {/* Devotionals Catalog List */}
            <div style={{ width: '100%' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '14px' }}>
                Catalog Devotionals ({devotionalsList.length})
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {devotionalsList.map((dev) => (
                  <div
                    key={dev.id}
                    style={{
                      background: '#FFFFFF',
                      padding: '14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.94rem' }}>{dev.title}</div>
                        <div style={{ fontSize: '0.76rem', color: '#0284C7', marginTop: '2px' }}>{dev.scriptureRef}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                        {renderStatusBadge(dev.contentStatus, dev.version)}
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{dev.date}</span>
                      </div>
                    </div>

                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                      {dev.reflection.slice(0, 140)}...
                    </p>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px', flexWrap: 'wrap' }}>
                      {dev.contentStatus === 'draft' && (
                        <button
                          type="button"
                          onClick={() => handleSubmitDevotionalReview(dev.id)}
                          style={{ background: '#EDE9FE', color: '#6D28D9', border: 'none', padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <Send size={12} />
                          <span>Submit Review</span>
                        </button>
                      )}

                      {dev.contentStatus === 'in_review' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleApproveDevotional(dev.id)}
                            style={{ background: '#E0F2FE', color: '#0369A1', border: 'none', padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                          >
                            <Check size={12} />
                            <span>Approve</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePublishDevotional(dev.id)}
                            style={{ background: '#DCFCE7', color: '#15803D', border: 'none', padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                          >
                            <CheckCircle size={12} />
                            <span>Publish</span>
                          </button>
                        </>
                      )}

                      {dev.contentStatus === 'approved' && (
                        <button
                          type="button"
                          onClick={() => handlePublishDevotional(dev.id)}
                          style={{ background: '#DCFCE7', color: '#15803D', border: 'none', padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <CheckCircle size={12} />
                          <span>Publish</span>
                        </button>
                      )}

                      {dev.contentStatus === 'published' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCreateNewRevisionDevotional(dev.id)}
                            style={{ background: '#F1F5F9', color: '#334155', border: 'none', padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                          >
                            <FileEdit size={12} />
                            <span>New Revision</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUnpublishDevotional(dev.id)}
                            style={{ background: '#FEE2E2', color: '#DC2626', border: 'none', padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                          >
                            <Archive size={12} />
                            <span>Unpublish</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* 3. ARTICLES WORKSPACE */}
        {/* ======================================================== */}
        {activeTab === 'articles' && (
          <div className="admin-two-col-layout">
            <div className="admin-card-container">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <FileText size={18} color="#0284C7" />
                <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Compose Guidance Article
                </h2>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveArticle(false);
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
              >
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>Article Title *</label>
                  <input
                    type="text"
                    required
                    value={newArticleTitle}
                    onChange={(e) => setNewArticleTitle(e.target.value)}
                    placeholder="e.g. Navigating Nervous System Triggers in Parenting"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>Author</label>
                    <input
                      type="text"
                      value={newArticleAuthor}
                      onChange={(e) => setNewArticleAuthor(e.target.value)}
                      placeholder="e.g. Cherie Magsanoc"
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>Credentials</label>
                    <input
                      type="text"
                      value={newArticleCredentials}
                      onChange={(e) => setNewArticleCredentials(e.target.value)}
                      placeholder="Pastoral Counselor & Trauma Advocate"
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>Category</label>
                    <select
                      value={newArticleCategory}
                      onChange={(e) => setNewArticleCategory(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem', background: '#FFFFFF' }}
                    >
                      <option value="Trauma Healing">Trauma Healing</option>
                      <option value="Parenting">Parenting</option>
                      <option value="Nervous System">Nervous System</option>
                      <option value="Faith & Psychology">Faith & Psychology</option>
                      <option value="Grief & Loss">Grief & Loss</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>Reading Time (Min)</label>
                    <input
                      type="number"
                      value={newArticleReadingTime}
                      onChange={(e) => setNewArticleReadingTime(e.target.value)}
                      placeholder="4"
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.86rem' }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>Summary / Abstract</label>
                  <textarea
                    rows={2}
                    value={newArticleSummary}
                    onChange={(e) => setNewArticleSummary(e.target.value)}
                    placeholder="A brief executive summary of the article..."
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.84rem' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '4px' }}>Article Content (Markdown supported) *</label>
                  <textarea
                    rows={6}
                    required
                    value={newArticleContent}
                    onChange={(e) => setNewArticleContent(e.target.value)}
                    placeholder="Write the full clinical guidance content..."
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.84rem' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                  <button
                    type="button"
                    onClick={() => handleSaveArticle(true)}
                    className="btn-secondary"
                    style={{ flex: 1, padding: '10px 14px', fontSize: '0.84rem', justifyContent: 'center' }}
                  >
                    Save as Draft
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveArticle(false)}
                    className="btn-primary dark-accent"
                    style={{ flex: 1, padding: '10px 14px', fontSize: '0.84rem', justifyContent: 'center' }}
                  >
                    Publish Directly
                  </button>
                </div>
              </form>
            </div>

            {/* Articles Catalog List */}
            <div style={{ width: '100%' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '14px' }}>
                Curated Articles ({articlesList.length})
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {articlesList.map((art) => (
                  <div
                    key={art.id}
                    style={{
                      background: '#FFFFFF',
                      padding: '16px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, background: '#F3E8FF', color: '#7E22CE', padding: '2px 8px', borderRadius: '12px' }}>
                          {art.category} • {art.readingTimeMinutes} min
                        </span>
                        <div style={{ fontWeight: 700, fontSize: '0.98rem', marginTop: '6px' }}>{art.title}</div>
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>By {art.author}</div>
                      </div>
                      {renderStatusBadge(art.contentStatus, art.version)}
                    </div>

                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                      {art.summary.slice(0, 160)}...
                    </p>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px' }}>
                      {art.contentStatus !== 'published' ? (
                        <button
                          type="button"
                          onClick={() => handlePublishArticle(art.id)}
                          style={{ background: '#DCFCE7', color: '#15803D', border: 'none', padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <CheckCircle size={12} />
                          <span>Publish</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleUnpublishArticle(art.id)}
                          style={{ background: '#FEE2E2', color: '#DC2626', border: 'none', padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <Archive size={12} />
                          <span>Unpublish</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* 4. TESTIMONIES WORKSPACE */}
        {/* ======================================================== */}
        {activeTab === 'testimonies' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div className="admin-stats-grid">
              <div style={{ background: '#FFFFFF', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Total Stories</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '2px' }}>{testimoniesList.length}</div>
              </div>
              <div style={{ background: '#FFFFFF', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.76rem', color: '#D97706', fontWeight: 600 }}>Featured Stories</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#D97706', marginTop: '2px' }}>
                  {testimoniesList.filter((t) => t.isFeatured).length}
                </div>
              </div>
              <div style={{ background: '#FFFFFF', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.76rem', color: '#059669', fontWeight: 600 }}>Active Encouragements</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#059669', marginTop: '2px' }}>
                  {testimoniesList.reduce((acc, curr) => acc + curr.encouragementsCount, 0)}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {testimoniesList.map((item) => (
                <div
                  key={item.id}
                  className="admin-card-container"
                  style={{
                    border: item.isFeatured ? '2px solid #F59E0B' : '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div className="admin-testimony-header">
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '1.02rem', color: 'var(--text-primary)' }}>
                        {item.authorName} {item.isFeatured && <span style={{ color: '#D97706', fontSize: '0.78rem', background: '#FEF3C7', padding: '2px 8px', borderRadius: '12px', marginLeft: '6px' }}>⭐ Featured</span>}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                        {item.authorLifeStage} • Posted {item.dateStr}
                      </div>
                    </div>

                    <div className="admin-testimony-actions">
                      <span style={{ fontSize: '0.74rem', background: '#E0F2FE', color: '#0369A1', padding: '3px 10px', borderRadius: '12px', fontWeight: 600 }}>
                        #{item.topicTag}
                      </span>
                      <button
                        onClick={() => handleToggleFeature(item.id)}
                        style={{
                          fontSize: '0.76rem',
                          padding: '4px 12px',
                          background: item.isFeatured ? '#FEF3C7' : '#F1F5F9',
                          color: item.isFeatured ? '#B45309' : 'var(--text-secondary)',
                          border: 'none',
                          borderRadius: 'var(--radius-full)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontWeight: 600,
                        }}
                      >
                        <Star size={13} fill={item.isFeatured ? '#B45309' : 'none'} />
                        <span>{item.isFeatured ? 'Unfeature' : 'Feature Story'}</span>
                      </button>
                      <button
                        onClick={() => handleDeleteTestimony(item.id)}
                        style={{
                          fontSize: '0.76rem',
                          padding: '4px 12px',
                          background: '#FEE2E2',
                          color: '#DC2626',
                          border: 'none',
                          borderRadius: 'var(--radius-full)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontWeight: 600,
                        }}
                      >
                        <Trash2 size={13} />
                        <span>Remove</span>
                      </button>
                    </div>
                  </div>

                  <div className="admin-testimony-steps">
                    <div style={{ background: '#F8FAFC', padding: '10px', borderRadius: 'var(--radius-md)', borderLeft: '3px solid #0284C7' }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#0284C7', textTransform: 'uppercase' }}>1. The Struggle</div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-primary)', marginTop: '4px', lineHeight: 1.45 }}>{item.struggle}</p>
                    </div>
                    <div style={{ background: '#F8FAFC', padding: '10px', borderRadius: 'var(--radius-md)', borderLeft: '3px solid #F59E0B' }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#B45309', textTransform: 'uppercase' }}>2. The Turning Point</div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-primary)', marginTop: '4px', lineHeight: 1.45 }}>{item.turningPoint}</p>
                    </div>
                    <div style={{ background: '#F8FAFC', padding: '10px', borderRadius: 'var(--radius-md)', borderLeft: '3px solid #10B981' }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#047857', textTransform: 'uppercase' }}>3. Healing Outcome</div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-primary)', marginTop: '4px', lineHeight: 1.45 }}>{item.healingOutcome}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Video Preview Modal */}
      {previewingVideo && (
        <div className="modal-overlay" onClick={() => setPreviewingVideo(null)}>
          <div
            className="modal-content"
            style={{ maxWidth: '600px', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                {previewingVideo.title}
              </div>
              <button
                onClick={() => setPreviewingVideo(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Video Player Embed / HTML5 Video */}
            <div style={{ borderRadius: '12px', overflow: 'hidden', background: '#000000', marginBottom: '14px' }}>
              {previewingVideo.parsed.type === 'youtube' && previewingVideo.parsed.embedUrl && (
                <iframe
                  src={previewingVideo.parsed.embedUrl}
                  title={previewingVideo.title}
                  style={{ width: '100%', height: '320px', border: 'none' }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              )}

              {previewingVideo.parsed.type === 'vimeo' && previewingVideo.parsed.embedUrl && (
                <iframe
                  src={previewingVideo.parsed.embedUrl}
                  title={previewingVideo.title}
                  style={{ width: '100%', height: '320px', border: 'none' }}
                  allow="autoplay; fullscreen; picture-in-picture"
                  allowFullScreen
                />
              )}

              {(previewingVideo.parsed.type === 'storage' || previewingVideo.parsed.type === 'direct') && (
                <video
                  src={previewingVideo.resolvedUrl || previewingVideo.videoUrl}
                  controls
                  autoPlay
                  playsInline
                  style={{ width: '100%', maxHeight: '340px' }}
                />
              )}

              {previewingVideo.parsed.type === 'unsupported' && (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: '#FFFFFF' }}>
                  <Play size={40} style={{ margin: '0 auto 10px', opacity: 0.6 }} />
                  <div>No streamable media source found.</div>
                  <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginTop: '6px' }}>
                    {previewingVideo.videoUrl || 'Standard simulated reflection'}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setPreviewingVideo(null)}
                className="btn-secondary"
                style={{ fontSize: '0.82rem', padding: '8px 16px' }}
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
