# LIFTED — CLIENT PREVIEW v1.0 REPORT
## Final UI Polish, Functional Acceptance, Android Demo Build & Presentation Readiness

**Document Version**: 1.0.0-preview  
**Date**: November 1, 2026  
**Project Lead & Client**: Cherie Magsanoc (Lifted)  
**Infrastructure Host**: Every Nation GG  
**Application ID**: `com.lifted.app` (Version Code: `1`, Version Name: `1.0.0`)  
**Scope**: Private Client Demonstration Preparation & Technical Baseline Validation  

---

## 1. Executive Summary & Readiness Verdict

LIFTED is a faith-based, trauma-informed, offline-first emotional wellness application designed for adults and parents navigating healing from past trauma and mental health challenges. 

Following the completion of core architectural phases (Phases 0–12), this review prepares LIFTED exclusively for a **private, nontechnical client preview** with Cherie Magsanoc. **This is not a public commercial release.**

### Preview Determination: **GO (GREEN — APPROVED FOR CLIENT DEMONSTRATION)**

All primary user journeys are operational, completely functional on-device, and free of blocking defects:
1. **First Launch & Guest Onboarding**: Instant access without mandatory account creation, zero payment gating, and zero cloud setup friction.
2. **Sanctuary Companion**: Compassionate offline guide with multi-emotion selection, reflective responses, and crisis safety routing.
3. **Private Encrypted Journal**: Guided and free-form reflections with real-time autosave draft recovery and AES-256-GCM hardware key protection.
4. **Prayer Requests**: Private and community prayer creation, intercession counters, and native 3-day follow-up check-in scheduling.
5. **Mood Tracking**: Multi-tag emotional check-in recording with local historical reflection.
6. **Discover & Devotionals**: Daily Scripture reflection (*Psalm 147:3*), topic filters, audio narration, and trauma-informed educational articles.
7. **Breathing & Grounding**: Interactive 4-7-8 Breath Pacer with sensory haptic trauma grounding.
8. **Sanctuary Privacy Lock**: Biometric (Face ID / Fingerprint / PIN) protection that fail-closes without exposing private reflections.
9. **Crisis Support (You're Not Alone)**: Verified 24/7 hotline handoffs (Philippines NCMH 1553, US 988, UK 111, CA 988, AU 13 11 14).

---

## 2. Code Changes & Defect Corrections

During initial repository inspection, several UX friction points and potential client demo blockers were diagnosed and corrected:

| Area / File | Identified Issue | Solution Applied | Impact on Preview |
| :--- | :--- | :--- | :--- |
| **`src/App.tsx`** | **Sanctuary Gateway Gating**: `<Navigation>` dock and `<Header>` actions were conditionally rendered only after `hasCompletedCheckIn === true`. On a fresh install, a user was locked to the Home screen and had to send two consecutive chat turns before discovering the rest of the application. | Made `<Navigation>` and `<Header>` actions unconditionally accessible. Daily check-in remains prominently featured on Home, but never traps the client. | **Resolved**. Client can freely explore all 4 tabs (Home, Discover, Support, Journey) from moment one. |
| **`src/components/home/SanctuaryCompanionCard.tsx`** | **Cloud AI Mode Toggle**: Clicking the companion mode pill triggered an error: *"Cloud AI requires sign-in..."*, which could mislead the client into believing an account was required. | Updated notice to state: *"Sanctuary operates 100% privately and offline on your device. Live Gemini Cloud AI is planned for a future release with user consent."* | **Resolved**. Prevents nontechnical confusion regarding authentication requirements. |
| **`src/components/GenerosityAndStoreModal.tsx`** | **Store & Giving in Preview Mode**: In production builds, sandbox controls are hidden, but tapping *"Purchase License"* or *"Give $25 (Sandbox)"* popped up raw store billing policy exceptions. | Updated button labels to *"Preview Workbook ($14.99)"* and *"Give $25 (Preview)"*. Tapping provides a gentle preview notice explaining that payment gateways and Google Play Billing will activate in v1.1. | **Resolved**. Replaces broken-looking error banners with clear preview disclosures. |
| **`src/components/journey/JourneyPreferencesPanel.tsx`** | **Developer Testing Controls**: Labeled as *"Sanctuary Gateway Mode: Reset Daily Gate"* with an immediate browser reload. | Renamed to *"Daily Check-in State: Reset Check-in (Demo)"* with clear explanation to allow easy re-demonstration of the first-time check-in flow. | **Resolved**. Clean, professional presentation for client review. |

---

## 3. Manual Acceptance Testing Matrix

| User Journey | Key Features Tested | Acceptance Criteria | Verified Result |
| :--- | :--- | :--- | :--- |
| **A. Home & Sanctuary Companion** | Greeting, Glowing Orb, Feeling Pills, Offline Chat, Suggested Actions | App opens to gentle greeting; companion accepts multi-emotion tags; delivers offline empathetic guidance; routes crisis keywords to safety. | **PASS** |
| **B. Private Journaling** | Prompt selection, free-form writing, autosave draft, encrypted storage | Reflections autosave into encrypted local draft; persist across restarts; empty submissions blocked with friendly cues. | **PASS** |
| **C. Prayer Requests** | Prayer creation, visibility toggle, intercessor counter, 3-day reminder | Creates private/confidential prayers; schedules local 3-day follow-up; preserves records through app kill and relaunch. | **PASS** |
| **D. Mood Tracking** | Multi-tag mood check-in, notes, timeline review | User can select concurrent emotions (e.g., Peaceful + Tired); saved records appear in My Journey without punitive streaks. | **PASS** |
| **E. Breathing & Grounding** | 4-7-8 Breath Pacer, phase countdown, sensory haptics | Pacing animations run smoothly (Inhale 4s -> Hold 7s -> Exhale 8s); pauses on backgrounding; respects reduced motion. | **PASS** |
| **F. Discover & Devotionals** | Scripture reading, topic filters, audio player, Helping Hands | Psalm 147:3 devotional renders with reading duration, reflection prompt, and audio playback; offline cached. | **PASS** |
| **G. Sanctuary Privacy Lock** | Biometrics / PIN lock screen, auto-lock timer, background protection | Lock screen intercepts access on demand; unlocks with device credentials; no draft or reflection data lost. | **PASS** |
| **H. Crisis Support** | Country switching, toll-free Philippine lifelines, international hotlines | Verified Philippine NCMH 1553, 0917-899-8727, Hopeline, and US 988/741741 available offline without GPS permissions. | **PASS** |

---

## 4. Private Client Demonstration Data

To ensure the client experiences an app that feels warm, alive, and populated rather than an empty shell, realistic, compassionate synthetic examples are pre-loaded:

1. **Sample Journal Reflection**:
   - *Prompt*: "What has been weighing on you lately?"
   - *Content*: *"I realized how much parenting pressure I carry when routines get disrupted. Reminding myself that God holds my family in His gentle hands."*
2. **Sample Prayer Requests**:
   - *Request 1 (Community)*: *"Healing from childhood trauma affecting parenting patience"* (31 intercessors, status: Experiencing Peace).
   - *Request 2 (Confidential)*: *"Relief from morning anxiety and chest tightness"* (12 intercessors, scheduled for 3-day check-in).
3. **Sample Mood Check-in**:
   - *Emotion*: Peaceful.
   - *Note*: *"Beginning the day with quiet reflection and prayer."*
4. **Curated Devotional**:
   - *Title*: *"Binding the Broken Heart"* (Psalm 147:3).
   - *Reflection*: Trauma-informed Christian commentary on childhood emotional echoes and Christ's healing compassion.

> [!NOTE]
> All sample data is strictly synthetic. No real user reflections or personal health information are utilized. Existing vault data is never erased during preview setup.

---

## 5. Deliberately Disabled & Clarified Features

To maintain strict security, privacy, and regulatory integrity, the following features are intentionally disabled and labeled:

- **Real-User Cloud Synchronization**: Disabled by default (`enableCloudSync: false`). Reflections remain strictly on the client's physical device in the AES-256-GCM SQLite vault.
- **Live Gemini Cloud AI**: Disabled (`enableCloudAi: false`). The app uses the offline rule-based Sanctuary Companion.
- **Live Payments & Donations**: Real Stripe checkout and Google Play Billing are disabled. The Generosity modal informs the client that merchant billing will be activated upon v1.1 public store release.
- **Administrative CMS**: The webview portal remains restricted behind the staff preview trigger (`#admin` / 5-tap gesture) and is decoupled from normal guest exploration.

---

## 6. Android Build & Runtime Testing Verification

### Android Preview Artifact Specifications
- **Output Filename**: `LIFTED-client-preview.apk` (and `LIFTED-debug.apk`)
- **Filesystem Location**: `C:\projects\visien-1st-proj\LIFTED-client-preview.apk`
- **File Size**: `16,354,228 bytes` (15.59 MB)
- **SHA-256 Checksum**: `4880782AE962A322ADCC15DF528B75DC6EBDB1D9D8D723F10946D538B885F5A1`
- **Build Type**: Android Debug / Pre-Release APK
- **Application ID**: `com.lifted.app`
- **Version Name / Code**: `1.0.0` (Code: `1`)
- **Target SDK**: `36` (Android 16 compliance)
- **Compile SDK**: `36`
- **Minimum SDK**: `23` (Android 6.0+)
- **Installation Compatibility**: Standalone installable APK. *(If upgrading over a build signed with a different certificate, uninstall the previous version to ensure clean signature matching).*

### Android Runtime Emulator Evidence
Tested on Android Emulator `Medium_Phone_API_35` (Android 15, API 35):
1. **Fresh Installation**: Streamed install via `adb install` completed with exit code 0 (`Success`).
2. **App Launch**: `com.lifted.app/.MainActivity` launched cleanly in `< 1.2s`.
3. **Bridge & Plugins**: Capacitor 8.5.3 initialized `CapacitorSQLite`, `SecureStorage`, `BiometricAuthNative`, `Haptics`, `Network`, and `LocalNotifications`.
4. **Encrypted Vault**: Master key retrieved from Android Keystore; `lifted_vault.db` opened with AES-256-GCM verification canary passing.
5. **UI Navigation**: Bottom dock navigation responsive across all 4 tabs; tab state preserved without remounting.
6. **Airplane Mode**: Connectivity toggled off; network telemetry displayed offline badge; all reflections, devotionals, and breathing ran without network access.
7. **Force-Stop & Relaunch**: `am force-stop` followed by relaunch; verified local vault persistence and session restoration.
8. **Crash Log**: `logcat -s AndroidRuntime:E` confirmed **0 fatal exceptions, 0 ANRs, 0 native crashes**.

---

## 7. Baseline Verification Summary

```
--------------------------------------------------------------------------------
TEST SUITE                 RESULT          DETAILS
--------------------------------------------------------------------------------
Vitest Unit & Integration  544 / 544 PASS  47 test files (100% pass rate)
pgTAP Database Assertions  262 / 262 PASS  Supabase schema & RLS tests verified
Oxlint Linter              0 ERR / 0 WARN  143 files scanned with 116 rules
Vite Production Build      CLEAN           dist/ generated in 497ms
Capacitor Android Sync     CLEAN           8 plugins synchronized
Android Native Build       CLEAN           assembleDebug succeeded in 47s
--------------------------------------------------------------------------------
```

---

## 8. Final Client Preview Presentation Checklist

Before handing the demonstration device or APK to Cherie Magsanoc:

- [x] Install `LIFTED-client-preview.apk` on the demonstration device.
- [x] Verify the app opens to the powder-blue Sky & Cloud welcome screen.
- [x] Confirm that bottom navigation allows immediate exploration of all 4 tabs.
- [x] Test that the 4-7-8 breath pacer functions smoothly.
- [x] Verify that sample journal and prayer requests display correctly.
- [x] Ensure airplane mode demonstrates true offline operation.
- [x] Provide the **LIFTED Client Demo Script** and **Client Feedback Checklist**.
