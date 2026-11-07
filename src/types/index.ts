export type MoodId =
  | 'happy'
  | 'peaceful'
  | 'grateful'
  | 'hopeful'
  | 'okay'
  | 'tired'
  | 'overwhelmed'
  | 'anxious'
  | 'sad'
  | 'lonely'
  | 'frustrated'
  | 'unsure';

export interface MoodOption {
  id: MoodId;
  label: string;
  iconName: string; // Lucide icon identifier
  shortDesc: string;
  recommendedCategory: 'devotional' | 'helping_hands' | 'positive_emotions' | 'wellness' | 'prayer' | 'crisis';
}

export type ContentCategory = 'devotional' | 'helping_hands' | 'positive_emotions' | 'wellness' | 'prayer' | 'crisis';

export type DiscoverPillarId = 'bible' | 'videos' | 'testimonies' | 'professional';

export interface ContentItem {
  id: string;
  title: string;
  description: string;
  category: ContentCategory;
  type: 'article' | 'devotional' | 'exercise' | 'audio' | 'activity';
  durationMinutes: number;
  scriptureRef?: string;
  scriptureText?: string;
  topicTags: string[];
  emotionalTags: MoodId[];
  isBookmarked?: boolean;
  contentBody?: string;
  authorOrSource?: string;
  audioUrl?: string;
}

export interface VideoItem {
  id: string;
  title: string;
  description: string;
  creator: string;
  durationSeconds: number;
  videoUrl?: string;
  thumbnailGradient: string;
  topicTags: string[];
  emotionalTags: MoodId[];
  scriptureAnchor?: string;
  viewsCount: number;
  likesCount: number;
  isLiked?: boolean;
}

export interface TestimonyItem {
  id: string;
  authorName: string; // e.g. "Sarah M." or "Anonymous"
  authorLifeStage?: string; // e.g. "Age 30 • Navigating sudden loss"
  topicTag: string; // e.g. "Grief & Loss", "Career Burnout", "Overcoming Anxiety"
  emotionalTags: MoodId[];
  struggle: string;
  turningPoint: string;
  healingOutcome: string;
  scriptureAnchor?: string;
  dateStr: string;
  encouragementsCount: number;
  isEncouragedByMe?: boolean;
  status: 'approved' | 'pending' | 'flagged';
  isFeatured?: boolean;
}

export interface ProfessionalArticle {
  id: string;
  title: string;
  subtitle: string;
  author: string;
  credentials: string;
  readingTimeMinutes: number;
  topicTags: string[];
  emotionalTags: MoodId[];
  summary: string;
  contentParagraphs: string[];
  practicalExercise?: {
    title: string;
    instruction: string;
  };
}

export interface Devotional {
  id: string;
  date: string;
  title: string;
  scriptureRef: string;
  scriptureText: string;
  reflection: string;
  prayer: string;
  reflectionPrompt: string;
  readingTimeMinutes: number;
  isBookmarked?: boolean;
  topicTags?: string[];
  emotionalTags?: MoodId[];
}

export interface HelpingHandsStep {
  id: string;
  stepNumber: number;
  title: string;
  purpose: string;
  guidedSequence: string[];
  scriptureAnchor: string;
  biblicalTruth: string;
  exercisePrompt: string;
  practicalTakeaway: string;
  isCompleted: boolean;
  userNote?: string;
}

export interface HelpingHandsModule {
  id: string;
  moduleNumber: number;
  title: string;
  subtitle: string;
  description: string;
  steps: HelpingHandsStep[];
}

export interface PrayerRequest {
  id: string;
  title: string;
  body: string;
  visibility: 'private' | 'confidential' | 'community';
  createdAt: string;
  createdAtTimestamp: number;
  followUpScheduledDays: number;
  intercessorsCount: number;
  isPrayedByMe: boolean;
  followUpTriggered: boolean;
  followUpStatus?: 'still_praying' | 'experiencing_peace' | 'answered';
  isAnswered?: boolean;
  answeredNote?: string;
  remindersEnabled?: boolean;
}

export interface JournalEntry {
  id: string;
  date: string;
  timestamp: number;
  promptQuestion?: string;
  content: string;
  moodTag?: MoodId;
}

export interface MoodCheckInRecord {
  id: string;
  mood: MoodId;
  additionalMoods?: MoodId[];
  note?: string;
  timestamp: number;
  dateStr: string;
}

export interface DownloadableWorkbook {
  id: string;
  title: string;
  subtitle: string;
  pagesCount: number;
  price: string;
  priceAmount: number;
  tag: string;
  description: string;
  tableOfContents: string[];
  isPurchased?: boolean;
}

export interface UserPreferences {
  name: string;
  theme?: string;
  prayerFollowUpReminders: boolean;
  dailyDevotionalReminders: boolean;
  dailyReminderTime?: string;
  notificationsEnabled: boolean;
  language: string;
  currency: string;
  isAdminMode?: boolean;
  hapticsEnabled?: boolean;
  sanctuaryLockEnabled?: boolean;
  sanctuaryAutoLockInterval?: number; // Minutes: 0 (immediately), 1, 5
  useBiometrics?: boolean;
  sanctuaryPin?: string;
  syncConsentGranted?: boolean;
  recoveryKeyEnrolled?: boolean;
}

export interface AiPathwayRecommendations {
  compassionateAcknowledgment: string;
  detectedTheme: string;
  detectedTopic?: string;
  biblePathway: {
    title: string;
    scriptureRef: string;
    scriptureText: string;
    excerpt: string;
    devotionalId?: string;
  };
  videoPathway: VideoItem;
  testimonyPathway: TestimonyItem;
  professionalPathway: ProfessionalArticle;
}

export interface AiRecommendation {
  compassionateAcknowledgment: string;
  primaryRecommendation: ContentItem;
  primaryReason: string;
  alternativeRecommendations: {
    item: ContentItem;
    reason: string;
  }[];
  triagePathways?: AiPathwayRecommendations;
}
