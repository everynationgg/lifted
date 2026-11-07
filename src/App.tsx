import React, { useState, useEffect } from 'react';
import type {
  MoodId,
  PrayerRequest,
  HelpingHandsModule,
  JournalEntry,
  MoodCheckInRecord,
  Devotional,
  ContentItem,
  UserPreferences,
  DiscoverPillarId,
} from './types';
import {
  TODAY_DEVOTIONAL,
  DEVOTIONAL_ARCHIVE,
  HELPING_HANDS_MODULES,
  INITIAL_PRAYER_REQUESTS,
  DEFAULT_USER_PREFERENCES,
  CONTENT_CATALOG,
} from './data/mockData';
import { Header } from './components/Header';
import { Navigation, type PrimaryTabId } from './components/Navigation';
import { HomeScreen } from './components/HomeScreen';
import { DiscoverScreen } from './components/DiscoverScreen';
import { SupportScreen } from './components/SupportScreen';
import { JourneyScreen } from './components/JourneyScreen';
import { GenerosityAndStoreModal } from './components/GenerosityAndStoreModal';
import { ContentDetailModal } from './components/ContentDetailModal';
import { AdminLoginModal } from './components/AdminLoginModal';
import { AdminWebviewPortal } from './components/AdminWebviewPortal';
import { StorageMigrationModal } from './components/StorageMigrationModal';
import { SanctuaryLockScreen } from './components/SanctuaryLockScreen';
import { haptics } from './services/hapticsService';
import { notificationService } from './services/notificationService';
import { sanctuaryPrivacyManager, useSanctuaryLock } from './services/privacy/SanctuaryPrivacyManager';
import { getLocalDateString, isTodayLocal } from './utils/dateUtils';
import { vaultManager } from './storage/vaultManager';
import { migrationCoordinator, type MigrationStateSnapshot } from './storage/migration/migrationCoordinator';
import { networkService } from './services/networkService';
import { lifecycleManager } from './services/lifecycleManager';

export const App: React.FC = () => {
  // Navigation State
  const [activeTab, setActiveTab] = useState<PrimaryTabId>('home');
  const [discoverPillar, setDiscoverPillar] = useState<DiscoverPillarId>('bible');
  const [discoverTopic, setDiscoverTopic] = useState<string>('All');

  // Admin & Security State
  const [isAdminLoginOpen, setIsAdminLoginOpen] = useState<boolean>(false);
  const [isAdminPreviewActive, setIsAdminPreviewActive] = useState<boolean>(false);
  const [adminPortalMode, setAdminPortalMode] = useState<'authenticated' | 'preview'>('preview');

  // Clean up any legacy admin session flags from previous builds
  useEffect(() => {
    try {
      localStorage.removeItem('lifted_admin_session');
      sessionStorage.removeItem('lifted_admin_session');
    } catch {
      // Ignore storage errors
    }
  }, []);

  // URL Hash Listener for /#admin route
  useEffect(() => {
    const checkHash = () => {
      if (window.location.hash === '#admin') {
        setIsAdminLoginOpen(true);
      }
    };

    checkHash();
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  }, []);

  // Modals State
  const [isStoreOpen, setIsStoreOpen] = useState<boolean>(false);
  const [readingDevotional, setReadingDevotional] = useState<Devotional | null>(null);
  const [readingContentItem, setReadingContentItem] = useState<ContentItem | null>(null);

  // Controlled Storage Migration & Vault Authoritative State
  const [migrationSnapshot, setMigrationSnapshot] = useState<MigrationStateSnapshot>(() =>
    migrationCoordinator.getSnapshot()
  );
  const [isHydrated, setIsHydrated] = useState<boolean>(false);
  const isVaultAuthoritative = migrationSnapshot.state === 'COMPLETED';

  useEffect(() => {
    const unsubscribe = migrationCoordinator.subscribe((snapshot) => {
      setMigrationSnapshot(snapshot);
    });
    migrationCoordinator.checkReadiness().catch(console.error);
    return unsubscribe;
  }, []);

  // Initialize Network Telemetry and Native App Lifecycle Managers
  useEffect(() => {
    networkService.initialize().catch(console.error);
    lifecycleManager.initialize().catch(console.error);
    return () => {
      networkService.teardown().catch(console.error);
      lifecycleManager.teardown().catch(console.error);
    };
  }, []);

  // User State
  const [userPreferences, setUserPreferences] = useState<UserPreferences>(() => {
    const saved = localStorage.getItem('lifted_user_preferences');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Clear hardcoded initial name if it was 'Cherie'
        if (parsed.name === 'Cherie') {
          parsed.name = '';
        }
        return parsed;
      } catch {
        return DEFAULT_USER_PREFERENCES;
      }
    }
    return DEFAULT_USER_PREFERENCES;
  });

  const [userName, setUserName] = useState<string>(() => {
    return userPreferences.name && userPreferences.name !== 'Cherie' ? userPreferences.name : '';
  });

  // Sanctuary Gateway Check-in Gating State:
  // Requires user to complete daily check-in conversation before full app is unlocked
  const [hasCompletedCheckIn, setHasCompletedCheckIn] = useState<boolean>(() => {
    const lastCheckIn = localStorage.getItem('lifted_last_checkin_date');
    return isTodayLocal(lastCheckIn);
  });

  const handleCheckInComplete = () => {
    const todayStr = getLocalDateString();
    if (isVaultAuthoritative) {
      vaultManager.saveCheckInDate(todayStr).catch(console.error);
    } else {
      localStorage.setItem('lifted_last_checkin_date', todayStr);
    }
    setHasCompletedCheckIn(true);
  };

  // Mood Check-in History
  const [selectedMood, setSelectedMood] = useState<MoodId | null>(null);
  const [moodHistory, setMoodHistory] = useState<MoodCheckInRecord[]>(() => {
    const saved = localStorage.getItem('lifted_mood_history');
    if (saved) return JSON.parse(saved);
    return [
      {
        id: 'mood-init-1',
        mood: 'peaceful',
        note: 'Beginning the day with quiet reflection and prayer.',
        timestamp: Date.now() - 24 * 60 * 60 * 1000,
        dateStr: 'Yesterday',
      },
    ];
  });

  // Helping Hands Modules State
  const [helpingHandsModules, setHelpingHandsModules] = useState<HelpingHandsModule[]>(() => {
    const saved = localStorage.getItem('lifted_helping_hands');
    return saved ? JSON.parse(saved) : HELPING_HANDS_MODULES;
  });

  // Prayer Requests State
  const [prayerRequests, setPrayerRequests] = useState<PrayerRequest[]>(() => {
    const saved = localStorage.getItem('lifted_prayer_requests');
    return saved ? JSON.parse(saved) : INITIAL_PRAYER_REQUESTS;
  });

  // Journal Entries State
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>(() => {
    const saved = localStorage.getItem('lifted_journal_entries');
    if (saved) return JSON.parse(saved);
    return [
      {
        id: 'j-init-1',
        date: 'Oct 22, 2026',
        timestamp: Date.now() - 24 * 60 * 60 * 1000,
        promptQuestion: 'What has been weighing on you lately?',
        content: 'I realized how much parenting pressure I carry when routines get disrupted. Reminding myself that God holds my family in His gentle hands.',
      },
    ];
  });

  // Saved Bookmarks
  const [savedDevotionalIds, setSavedDevotionalIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('lifted_saved_devotionals');
    return saved ? JSON.parse(saved) : ['dev-today'];
  });

  const [savedContentItemIds, setSavedContentItemIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('lifted_saved_content');
    return saved ? JSON.parse(saved) : ['cat-breath-478'];
  });

  const sanctuaryLock = useSanctuaryLock();

  // Initialize Sanctuary Privacy Lock with persisted preferences
  useEffect(() => {
    sanctuaryPrivacyManager.initialize(userPreferences);
  }, [userPreferences]);

  // Notification action handler: Deep-links to Sanctuary or Journey without exposing unencrypted records
  useEffect(() => {
    const unsubscribe = notificationService.onNotificationAction((event) => {
      if (sanctuaryPrivacyManager.isLocked()) {
        sanctuaryPrivacyManager.queueDeepLink({
          type: event.type,
          prayerId: event.prayerId,
          timestamp: Date.now(),
        });
        return;
      }
      if (event.type === 'daily_checkin') {
        setActiveTab('home');
      } else if (event.type === 'prayer_followup') {
        setActiveTab('journey');
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Hydrate from authoritative vault once migration is COMPLETED
  useEffect(() => {
    if (!isVaultAuthoritative) return;
    let isMounted = true;

    const hydrateFromVault = async () => {
      try {
        const [
          vaultJournals,
          vaultPrayers,
          vaultMoods,
          vaultPrefs,
          vaultHh,
          vaultBookmarks,
          vaultCheckInDate,
        ] = await Promise.all([
          vaultManager.journals.getAll(),
          vaultManager.prayers.getAll(),
          vaultManager.moods.getAll(),
          vaultManager.getUserPreferences(),
          vaultManager.getHelpingHands(HELPING_HANDS_MODULES),
          vaultManager.getBookmarks(),
          vaultManager.getCheckInDate(),
        ]);

        if (!isMounted) return;

        if (vaultJournals && vaultJournals.length > 0) {
          setJournalEntries(
            vaultJournals.map((j) => ({
              id: j.id,
              date: j.date,
              timestamp: j.timestamp,
              promptQuestion: j.promptQuestion,
              content: j.content,
              moodTag: j.moodTag,
            }))
          );
        }

        if (vaultPrayers && vaultPrayers.length > 0) {
          setPrayerRequests(
            vaultPrayers.map((p) => ({
              id: p.id,
              title: p.title,
              body: p.request,
              visibility: p.visibility || (p.isPrivate ? 'private' : 'community'),
              createdAt: new Date(p.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              }),
              createdAtTimestamp: p.createdAt,
              followUpScheduledDays: p.followUpScheduledDays ?? 3,
              intercessorsCount: p.intercessorsCount,
              isPrayedByMe: p.isPrayedByMe,
              followUpTriggered: Boolean(p.followUpTriggered),
              followUpStatus: p.followUpStatus === 'none' ? undefined : (p.followUpStatus as PrayerRequest['followUpStatus']),
              isAnswered: p.isAnswered,
              answeredNote: p.answeredNote,
              remindersEnabled: p.remindersEnabled,
            }))
          );
        }

        if (vaultMoods && vaultMoods.length > 0) {
          setMoodHistory(
            vaultMoods.map((m) => ({
              id: m.id,
              mood: m.mood,
              additionalMoods: m.additionalMoods,
              note: m.note,
              timestamp: m.timestamp,
              dateStr: m.dateStr,
            }))
          );
        }

        if (vaultPrefs) {
          setUserPreferences(vaultPrefs);
          if (vaultPrefs.name) setUserName(vaultPrefs.name);
          sanctuaryPrivacyManager.updateFromPreferences(vaultPrefs);
        }

        if (vaultHh) {
          setHelpingHandsModules(vaultHh);
        }

        if (vaultBookmarks) {
          if (vaultBookmarks.devotionals?.length) setSavedDevotionalIds(vaultBookmarks.devotionals);
          if (vaultBookmarks.content?.length) setSavedContentItemIds(vaultBookmarks.content);
        }

        if (vaultCheckInDate) {
          setHasCompletedCheckIn(isTodayLocal(vaultCheckInDate));
        }

        if (isVaultAuthoritative && vaultManager.driver) {
          notificationService.initialize(vaultManager.driver).then(() => {
            if (vaultPrefs) {
              const currentPrayers = (vaultPrayers || []).map((p) => ({
                id: p.id,
                title: p.title,
                body: p.request,
                visibility: p.visibility || (p.isPrivate ? 'private' : 'community'),
                createdAt: new Date(p.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                }),
                createdAtTimestamp: p.createdAt,
                followUpScheduledDays: p.followUpScheduledDays ?? 3,
                intercessorsCount: p.intercessorsCount,
                isPrayedByMe: p.isPrayedByMe,
                followUpTriggered: Boolean(p.followUpTriggered),
                followUpStatus: p.followUpStatus === 'none' ? undefined : (p.followUpStatus as PrayerRequest['followUpStatus']),
                isAnswered: p.isAnswered,
                answeredNote: p.answeredNote,
                remindersEnabled: p.remindersEnabled,
              }));
              notificationService.reconcileSchedules(vaultPrefs, currentPrayers).catch(console.warn);
            }
          }).catch(console.warn);
        }

        setIsHydrated(true);
      } catch (err) {
        console.error('Failed to hydrate state from encrypted vault:', err);
      }
    };

    hydrateFromVault();
    return () => {
      isMounted = false;
    };
  }, [isVaultAuthoritative]);

  // Persistence Effects:
  // Split-brain safeguard: When vault is authoritative, writes to localStorage are disabled!
  // Hydration safeguard: Vault writes are inhibited until initial hydration completes.
  useEffect(() => {
    if (isVaultAuthoritative) {
      if (isHydrated) {
        vaultManager.saveUserPreferences(userPreferences).catch(console.error);
      }
    } else {
      localStorage.setItem('lifted_user_preferences', JSON.stringify(userPreferences));
    }
  }, [userPreferences, isVaultAuthoritative, isHydrated]);

  useEffect(() => {
    if (!isVaultAuthoritative) {
      localStorage.setItem('lifted_mood_history', JSON.stringify(moodHistory));
    }
  }, [moodHistory, isVaultAuthoritative]);

  useEffect(() => {
    if (isVaultAuthoritative) {
      if (isHydrated) {
        vaultManager.saveHelpingHands(helpingHandsModules).catch(console.error);
      }
    } else {
      localStorage.setItem('lifted_helping_hands', JSON.stringify(helpingHandsModules));
    }
  }, [helpingHandsModules, isVaultAuthoritative, isHydrated]);

  useEffect(() => {
    if (!isVaultAuthoritative) {
      localStorage.setItem('lifted_prayer_requests', JSON.stringify(prayerRequests));
    }
  }, [prayerRequests, isVaultAuthoritative]);

  useEffect(() => {
    if (!isVaultAuthoritative) {
      localStorage.setItem('lifted_journal_entries', JSON.stringify(journalEntries));
    }
  }, [journalEntries, isVaultAuthoritative]);

  useEffect(() => {
    if (isVaultAuthoritative) {
      if (isHydrated) {
        vaultManager.saveBookmarks({ devotionals: savedDevotionalIds, content: savedContentItemIds }).catch(console.error);
      }
    } else {
      localStorage.setItem('lifted_saved_devotionals', JSON.stringify(savedDevotionalIds));
    }
  }, [savedDevotionalIds, savedContentItemIds, isVaultAuthoritative, isHydrated]);

  useEffect(() => {
    if (!isVaultAuthoritative) {
      localStorage.setItem('lifted_saved_content', JSON.stringify(savedContentItemIds));
    }
  }, [savedContentItemIds, isVaultAuthoritative]);

  // Handlers
  const handleSelectMood = (moodInput: MoodId | MoodId[] | null, note?: string) => {
    if (!moodInput) {
      setSelectedMood(null);
      return;
    }
    haptics.light();
    const moods = Array.isArray(moodInput) ? moodInput : [moodInput];
    const primaryMood = moods[0];
    const additionalMoods = moods.slice(1);

    setSelectedMood(primaryMood);
    const newRecord: MoodCheckInRecord = {
      id: `mood-${Date.now()}`,
      mood: primaryMood,
      additionalMoods: additionalMoods.length > 0 ? additionalMoods : undefined,
      note,
      timestamp: Date.now(),
      dateStr: 'Today',
    };
    setMoodHistory((prev) => [newRecord, ...prev]);

    if (isVaultAuthoritative) {
      vaultManager.moods.create(newRecord).catch((err) => {
        console.error('Failed to persist encrypted mood check-in:', err);
      });
    }
  };

  const handleUpdateUserName = (newName: string) => {
    setUserName(newName);
    setUserPreferences((prev) => ({ ...prev, name: newName }));
  };

  const handleUpdatePreferences = (prefs: Partial<UserPreferences>) => {
    if (prefs.hapticsEnabled !== undefined) {
      haptics.setEnabled(prefs.hapticsEnabled);
    }
    const nextPrefs = { ...userPreferences, ...prefs };
    setUserPreferences(nextPrefs);

    if (
      prefs.dailyDevotionalReminders !== undefined ||
      prefs.dailyReminderTime !== undefined ||
      prefs.prayerFollowUpReminders !== undefined ||
      prefs.notificationsEnabled !== undefined
    ) {
      notificationService.reconcileSchedules(nextPrefs, prayerRequests).catch(console.warn);
    }

    if (
      prefs.sanctuaryLockEnabled !== undefined ||
      prefs.sanctuaryAutoLockInterval !== undefined ||
      prefs.useBiometrics !== undefined
    ) {
      sanctuaryPrivacyManager.updateFromPreferences(nextPrefs);
    }
  };

  const handleToggleCompleteStep = (moduleId: string, stepId: string) => {
    haptics.light();
    setHelpingHandsModules((prevModules) =>
      prevModules.map((module) => {
        if (module.id === moduleId) {
          return {
            ...module,
            steps: module.steps.map((step) =>
              step.id === stepId ? { ...step, isCompleted: !step.isCompleted } : step
            ),
          };
        }
        return module;
      })
    );
  };

  const handleSaveStepNote = (moduleId: string, stepId: string, note: string) => {
    setHelpingHandsModules((prevModules) =>
      prevModules.map((module) => {
        if (module.id === moduleId) {
          return {
            ...module,
            steps: module.steps.map((step) =>
              step.id === stepId ? { ...step, userNote: note } : step
            ),
          };
        }
        return module;
      })
    );
  };

  const handleAddPrayerRequest = async (
    req: Omit<PrayerRequest, 'id' | 'createdAt' | 'createdAtTimestamp' | 'intercessorsCount' | 'isPrayedByMe' | 'followUpTriggered'>
  ): Promise<boolean> => {
    const created: PrayerRequest = {
      ...req,
      id: `pray-${Date.now()}`,
      createdAt: 'Just now',
      createdAtTimestamp: Date.now(),
      intercessorsCount: 1,
      isPrayedByMe: true,
      followUpTriggered: false,
    };

    if (isVaultAuthoritative) {
      try {
        await vaultManager.prayers.create({
          id: created.id,
          title: created.title,
          request: created.body,
          body: created.body,
          category: created.visibility === 'community' ? 'community' : 'personal',
          visibility: created.visibility,
          isPrivate: created.visibility !== 'community',
          followUpStatus: 'none',
          followUpScheduledDays: created.followUpScheduledDays,
          intercessorsCount: created.intercessorsCount,
          isPrayedByMe: created.isPrayedByMe,
          followUpTriggered: false,
          remindersEnabled: created.remindersEnabled,
        });
        setPrayerRequests((prev) => [created, ...prev]);
        haptics.success();

        // Schedule native automated 3-day prayer follow-up
        if (userPreferences.prayerFollowUpReminders && created.remindersEnabled !== false) {
          notificationService.schedulePrayerFollowUp(created.id, created.createdAtTimestamp).catch(console.warn);
        }
        return true;
      } catch {
        // Redact reflection content from logs to protect user privacy
        console.error('Failed to persist encrypted prayer request [secure audit: persistence rejected]');
        return false;
      }
    } else {
      setPrayerRequests((prev) => [created, ...prev]);
      haptics.success();

      // Schedule native automated 3-day prayer follow-up
      if (userPreferences.prayerFollowUpReminders && created.remindersEnabled !== false) {
        notificationService.schedulePrayerFollowUp(created.id, created.createdAtTimestamp).catch(console.warn);
      }
      return true;
    }
  };

  const handlePrayForRequest = (id: string) => {
    haptics.light();
    setPrayerRequests((prev) =>
      prev.map((req) => {
        if (req.id === id) {
          const nextPrayed = !req.isPrayedByMe;
          const nextCount = nextPrayed ? req.intercessorsCount + 1 : req.intercessorsCount - 1;
          if (isVaultAuthoritative) {
            vaultManager.prayers
              .update(id, {
                isPrayedByMe: nextPrayed,
                intercessorsCount: nextCount,
              })
              .catch(console.error);
          }
          return {
            ...req,
            isPrayedByMe: nextPrayed,
            intercessorsCount: nextCount,
          };
        }
        return req;
      })
    );
  };

  const handleSimulateFollowUp = (id: string) => {
    setPrayerRequests((prev) =>
      prev.map((req) => (req.id === id ? { ...req, followUpTriggered: true } : req))
    );
  };

  const handleAnswerFollowUp = (
    id: string,
    status: 'still_praying' | 'experiencing_peace' | 'answered'
  ) => {
    if (status === 'answered') {
      notificationService.cancelPrayerFollowUp(id).catch(console.warn);
    }
    setPrayerRequests((prev) =>
      prev.map((req) => {
        if (req.id === id) {
          if (isVaultAuthoritative) {
            vaultManager.prayers
              .update(id, {
                followUpStatus: status,
                isAnswered: status === 'answered',
              })
              .catch(console.error);
          }
          return {
            ...req,
            followUpStatus: status,
            isAnswered: status === 'answered',
          };
        }
        return req;
      })
    );
  };

  const handleToggleReminder = (id: string) => {
    setPrayerRequests((prev) =>
      prev.map((req) => {
        if (req.id === id) {
          const nextReminders = !req.remindersEnabled;
          if (isVaultAuthoritative) {
            vaultManager.prayers
              .update(id, {
                remindersEnabled: nextReminders,
              })
              .catch(console.error);
          }
          if (nextReminders) {
            if (userPreferences.prayerFollowUpReminders) {
              notificationService.schedulePrayerFollowUp(req.id, req.createdAtTimestamp).catch(console.warn);
            }
          } else {
            notificationService.cancelPrayerFollowUp(req.id).catch(console.warn);
          }
          return { ...req, remindersEnabled: nextReminders };
        }
        return req;
      })
    );
  };

  const handleAddJournalEntry = async (content: string, prompt?: string): Promise<boolean> => {
    const newEntry: JournalEntry = {
      id: `journal-${Date.now()}`,
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      timestamp: Date.now(),
      promptQuestion: prompt,
      content,
    };

    if (isVaultAuthoritative) {
      try {
        const idRecord = await vaultManager.identity.getOrCreateIdentity();
        await vaultManager.journals.create({
          id: newEntry.id,
          date: newEntry.date,
          timestamp: newEntry.timestamp,
          content: newEntry.content,
          promptQuestion: newEntry.promptQuestion,
          localUserId: idRecord.localUserId,
          cloudUserId: null,
        });
        setJournalEntries((prev) => [newEntry, ...prev]);
        return true;
      } catch {
        // Redact reflection content from logs to protect user privacy
        console.error('Failed to persist encrypted journal entry [secure audit: persistence rejected]');
        return false;
      }
    } else {
      setJournalEntries((prev) => [newEntry, ...prev]);
      return true;
    }
  };

  const handleToggleDevotionalBookmark = (devId: string) => {
    setSavedDevotionalIds((prev) =>
      prev.includes(devId) ? prev.filter((id) => id !== devId) : [...prev, devId]
    );
  };

  const handleToggleContentBookmark = (contentId: string) => {
    setSavedContentItemIds((prev) =>
      prev.includes(contentId) ? prev.filter((id) => id !== contentId) : [...prev, contentId]
    );
  };

  const handleClearAllData = () => {
    if (isVaultAuthoritative) {
      Promise.all([
        vaultManager.journals.getAll().then((entries) => Promise.all(entries.map((e) => vaultManager.journals.delete(e.id)))),
        vaultManager.prayers.getAll().then((prayers) => Promise.all(prayers.map((p) => vaultManager.prayers.delete(p.id)))),
        vaultManager.moods.getAll().then((moods) => Promise.all(moods.map((m) => vaultManager.moods.delete(m.id)))),
      ]).catch(console.error);
    }
    localStorage.clear();
    sessionStorage.clear();
    setMoodHistory([]);
    setPrayerRequests(INITIAL_PRAYER_REQUESTS);
    setJournalEntries([]);
    setHelpingHandsModules(HELPING_HANDS_MODULES);
    setSavedDevotionalIds([]);
    setSavedContentItemIds([]);
    setSelectedMood(null);
    setHasCompletedCheckIn(false);
  };

  // Content for modals
  const savedDevotionals = DEVOTIONAL_ARCHIVE.filter((d) => savedDevotionalIds.includes(d.id));
  const savedContentItems = CONTENT_CATALOG.filter((c) => savedContentItemIds.includes(c.id));

  // If Admin Portal is active, render the dedicated Full-Width Desktop Webview CMS!
  if (isAdminPreviewActive) {
    return (
      <AdminWebviewPortal
        mode={adminPortalMode}
        onExitToApp={() => {
          setIsAdminPreviewActive(false);
          if (window.location.hash === '#admin') window.location.hash = '';
        }}
        onLogout={() => {
          setIsAdminPreviewActive(false);
          if (window.location.hash === '#admin') window.location.hash = '';
        }}
      />
    );
  }

  return (
    <>
      {/* Ambient Powder Blue Cloud Backdrop */}
      <div className="sky-bg">
        <div className="sky-cloud-1" />
        <div className="sky-cloud-2" />
      </div>

      <div className="app-viewport-wrapper">
        <div className="mobile-frame">
          {/* Top Header */}
          <Header
            showActions={true}
            onOpenStoreModal={() => setIsStoreOpen(true)}
            onOpenSettingsModal={() => setActiveTab('journey')}
            onNavigateHome={() => setActiveTab('home')}
            onSecretAdminTrigger={() => {
              setIsAdminLoginOpen(true);
            }}
          />

          {/* Main Content Area: Keep-Alive Preserves Tab State, Chat Memory & Scroll */}
          <main className="screen-scroll-container">
            <div style={{ display: activeTab === 'home' ? 'block' : 'none' }}>
              <HomeScreen
                userName={userName}
                onUpdateUserName={handleUpdateUserName}
                selectedMood={selectedMood}
                onSelectMood={handleSelectMood}
                onNavigateTab={(tab) => setActiveTab(tab)}
                onOpenDevotional={(dev) => setReadingDevotional(dev)}
                onOpenContentItem={(item) => {
                  if (item.type === 'devotional') {
                    setReadingDevotional(TODAY_DEVOTIONAL);
                  } else {
                    setReadingContentItem(item);
                  }
                }}
                onNavigateDiscoverPillar={(pillar, topicTag) => {
                  setDiscoverPillar(pillar);
                  if (topicTag) setDiscoverTopic(topicTag);
                  setActiveTab('discover');
                }}
                recentSavedCount={savedDevotionals.length + savedContentItems.length}
                isUnlocked={hasCompletedCheckIn}
                onCheckInComplete={handleCheckInComplete}
              />
            </div>

            <div style={{ display: activeTab === 'discover' ? 'block' : 'none' }}>
              <DiscoverScreen
                isTabVisible={activeTab === 'discover'}
                onOpenDevotional={(dev) => setReadingDevotional(dev)}
                onOpenContentItem={(item) => setReadingContentItem(item)}
                helpingHandsModules={helpingHandsModules}
                onToggleCompleteStep={handleToggleCompleteStep}
                onSaveStepNote={handleSaveStepNote}
                initialPillar={discoverPillar}
                initialTopicTag={discoverTopic}
              />
            </div>

            <div style={{ display: activeTab === 'support' ? 'block' : 'none' }}>
              <SupportScreen
                userName={userName}
                prayerRequests={prayerRequests}
                onAddPrayerRequest={handleAddPrayerRequest}
                onPrayForRequest={handlePrayForRequest}
                onSimulateFollowUp={handleSimulateFollowUp}
                onAnswerFollowUp={handleAnswerFollowUp}
                onToggleReminder={handleToggleReminder}
                journalEntries={journalEntries}
                onAddJournalEntry={handleAddJournalEntry}
              />
            </div>

            <div style={{ display: activeTab === 'journey' ? 'block' : 'none' }}>
              <JourneyScreen
                userName={userName}
                onUpdateUserName={handleUpdateUserName}
                moodHistory={moodHistory}
                savedDevotionals={savedDevotionals}
                savedContentItems={savedContentItems}
                helpingHandsModules={helpingHandsModules}
                prayerRequests={prayerRequests}
                journalEntries={journalEntries}
                userPreferences={userPreferences}
                onUpdatePreferences={handleUpdatePreferences}
                onOpenDevotional={(dev) => setReadingDevotional(dev)}
                onOpenContentItem={(item) => setReadingContentItem(item)}
                onClearAllData={handleClearAllData}
                onOpenAdminLogin={() => {
                  setIsAdminLoginOpen(true);
                }}
              />
            </div>
          </main>

          {/* Four Primary Navigation Destinations Dock: Always accessible */}
          <Navigation
            activeTab={activeTab}
            onSelectTab={(tab) => setActiveTab(tab)}
          />
        </div>
      </div>

      {/* Generosity & Store Modal */}
      <GenerosityAndStoreModal
        isOpen={isStoreOpen}
        onClose={() => setIsStoreOpen(false)}
      />

      {/* Admin Login Modal (Triggered via /#admin, 5-tap gesture, or secret settings link) */}
      <AdminLoginModal
        isOpen={isAdminLoginOpen}
        onClose={() => {
          setIsAdminLoginOpen(false);
          if (window.location.hash === '#admin') window.location.hash = '';
        }}
        onLoginSuccess={(isDemo?: boolean) => {
          setAdminPortalMode(isDemo ? 'preview' : 'authenticated');
          setIsAdminPreviewActive(true);
        }}
      />

      {/* Reading / Detail Modal for Devotionals and Articles */}
      <ContentDetailModal
        devotional={readingDevotional}
        contentItem={readingContentItem}
        onClose={() => {
          setReadingDevotional(null);
          setReadingContentItem(null);
        }}
        isBookmarked={
          readingDevotional
            ? savedDevotionalIds.includes(readingDevotional.id)
            : readingContentItem
            ? savedContentItemIds.includes(readingContentItem.id)
            : false
        }
        onToggleBookmark={() => {
          if (readingDevotional) {
            handleToggleDevotionalBookmark(readingDevotional.id);
          } else if (readingContentItem) {
            handleToggleContentBookmark(readingContentItem.id);
          }
        }}
      />

      {/* Sanctuary Privacy Lock Screen (Rendered over the application when locked) */}
      {sanctuaryLock.isLocked && (
        <SanctuaryLockScreen
          onUnlockSuccess={() => {
            const pending = sanctuaryPrivacyManager.getPendingDeepLink();
            if (pending) {
              if (pending.type === 'daily_checkin') {
                setActiveTab('home');
              } else if (pending.type === 'prayer_followup') {
                setActiveTab('journey');
              }
            }
          }}
        />
      )}

      {/* Controlled Secure Storage Migration Modal */}
      <StorageMigrationModal
        snapshot={migrationSnapshot}
        onConsent={async () => {
          await migrationCoordinator.startMigrationWithConsent();
        }}
        onDismiss={() => {
          migrationCoordinator.dismissConsentBanner();
        }}
      />
    </>
  );
};

export default App;
