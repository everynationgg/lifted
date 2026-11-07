# Project Context: LIFTED

## Overview
LIFTED is a holistic, faith-based mobile-first application designed for adults and parents navigating healing from past trauma and mental health challenges. 

- **Client**: Cherie Magsanoc (Lifted)
- **Infrastructure Host**: Every Nation GG
- **Primary Platform**: Mobile (iOS & Android / React Native or Mobile-First PWA), Web secondary
- **Status**: Discovery Complete & Architecture Definition

## Stack (Recommended Target)
- **Frontend & Native Shell**: React 19 + TypeScript + Vite wrapped with Capacitor (`@capacitor/android`, `@capacitor/ios`)
- **Native App ID**: `com.lifted.app`
- **Design System**: Powder blue sky/cloud palette (`#E0F2FE`, `#7DD3FC`, `#0284C7`), warm off-whites, accessible contrast
- **Backend/Database**: Supabase (PostgreSQL with Row Level Security, Auth, Storage, Edge Functions)
- **Scheduled Tasks**: Supabase pg_cron / Edge Functions (for 3-day automated prayer follow-ups)
- **Payments**: Stripe for donations & digital downloadable materials
- **Internationalization**: i18n framework ready for global language expansion

## Core Modules & Business Rules
1. **Personalized Check-in**: Daily greeting and emotional state selection with AI Guide routing to relevant pathways.
2. **Daily Devotionals**: Faith-based readings, scriptures, and reflection prompts.
3. **Positive Emotions**: Gratitude exercises, uplifting affirmations, and 4-7-8 trauma-grounding breath pacer.
4. **Helping Hands**: Structured self-healing steps grounded in faith and trauma-informed practices ("God's hands as Helping Hands").
5. **Prayer Requests**: Submission of personal requests, reassurance mechanisms, and automated 3-day follow-up.
6. **You're Not Alone (Safety & Crisis)**: Dedicated support for acute emotional lows and isolation. Must include immediate crisis hotline handoff (988, 741741) and clear non-clinical disclaimers.
7. **Generosity & Store**: Donation processing and secure purchase/delivery of downloadable healing workbooks.

## Native Build & Tooling
- **Android App Bundle (Release AAB)**: `LIFTED-v1.0.0-release.aab` & `LIFTED-release.aab` compiled in root directory (`npm run android:bundle`). Complies with Google Play API 36+ target mandate and 16 KB page-size alignment.
- **Android APK (Release)**: `LIFTED-v1.0.0-release.apk` & `LIFTED-release.apk` compiled in root directory (`npm run android:release`). Uses JDK 21 (`C:/Program Files/Android/Android Studio/jbr`), compileSdk 36, targetSdk 36, and signed with `lifted-release.keystore` (v1/v2/v3 scheme).
- **Android APK (Debug)**: `LIFTED-debug.apk` compiled in root directory (`npm run android:apk`).
- **iOS Workspace**: Generated in `ios/App/App.xcworkspace`. Requires macOS with Xcode 26+ and iOS 26 SDK for App Store submission.
- **Sync Command**: `npx cap sync`

## Validation
- Linting: `npm run lint` (`oxlint`)
- Web Build: `npm run build`
- Android Debug Build: `npm run android:apk`
- Android Release APK: `npm run android:release`
- Android Release Bundle: `npm run android:bundle`
