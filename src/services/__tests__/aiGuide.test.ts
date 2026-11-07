import { describe, it, expect } from 'vitest';
import { isCrisisCheck, generateTriagePathways, generateCompassionateGuidance } from '../aiGuide';

describe('aiGuide Service', () => {
  describe('isCrisisCheck - Zero Latency Safety Barrier', () => {
    // 40+ Crisis variations covering mixed casing, punctuation, surrounding sentences
    const crisisCases = [
      'I want to kill myself',
      'i want to kill myself',
      'I WANT TO KILL MYSELF',
      'Thinking about suicide today',
      'SUICIDE thoughts won\'t stop',
      'I am going to end my life',
      'End My Life please',
      'I just want to end it all',
      'END IT ALL',
      'I cannot go on living like this',
      'cannot go on anymore',
      'cant go on',
      "I can't go on",
      'CANNOT GO ON...',
      'I want to die',
      'i want to die...',
      'I WANT TO DIE!',
      'Gave up on living',
      'give up on living',
      'I think I will hurt myself',
      'hurting myself again',
      'I have no reason to live',
      'No Reason To Live',
      'no reason to live!!',
      'there is no point in living',
      'struggling with self harm urges',
      'relapsed on self-harm',
      'SELF HARM',
      'I am going to take my own life',
      'taking my own life soon',
      'I wish i were dead',
      'wish I was dead',
      'everyone would be better off dead',
      'my family is better off without me',
      'I ending my life tonight',
      "don't want to wake up ever again",
      'dont want to wake up',
      'planning to overdose',
      'tempted to cut myself',
      'cutting myself to feel something',
      'slit my wrist',
      'hanging myself',
      'about to jump off a bridge',
      '   suicide   ',
      'What if I just end my life right now?',
      // Multi-language (Tagalog / Filipino) crisis expressions
      'Gusto ko nang mamatay dahil sa sobrang sakit',
      'Ayoko na mabuhay sa mundong ito',
      'Balak kong magpakamatay mamayang gabi',
      'Gusto ko nang wakasan ang buhay ko',
      // Phonetic misspellings
      'Thinking about suiside today',
      'Suicid thoughts won\'t stop',
      'I want to kil myself tonight',
      // Negation / Minimization (safety-first defensive routing)
      'I am not suicidal but I wish I were dead',
    ];

    it.each(crisisCases)('correctly detects acute crisis: "%s"', (phrase) => {
      expect(isCrisisCheck(phrase)).toBe(true);
    });

    const nonCrisisCases = [
      'I had a very long day at work',
      'My schedule is killing my free time',
      'I feel tired and need rest',
      'Grieving the loss of my father',
      'Feeling anxious about tomorrow exam',
      'Can you help me pray for my marriage?',
      'I am sad but holding on to hope',
      'Work was overwhelming today',
      'Thank you for listening to me',
      'Hello, good morning!',
      'I want to breathe and calm down',
      'God is good even when times are tough',
    ];

    it.each(nonCrisisCases)('does not falsely trigger crisis on non-crisis expression: "%s"', (phrase) => {
      expect(isCrisisCheck(phrase)).toBe(false);
    });
  });

  describe('generateTriagePathways', () => {
    it('routes grief and bereavement correctly', () => {
      const triage = generateTriagePathways('sad', 'My grandfather died yesterday');
      expect(triage.detectedTheme).toBe('Grief & Loss');
      expect(triage.biblePathway.scriptureRef).toContain('Psalm 34:18');
    });

    it('routes Tagalog grief term namatay correctly', () => {
      const triage = generateTriagePathways('sad', 'namatay ang asawa ko');
      expect(triage.detectedTheme).toBe('Grief & Loss');
    });

    it('routes burnout and exhaustion correctly', () => {
      const triage = generateTriagePathways('tired', 'I am completely burned out and exhausted');
      expect(triage.detectedTheme).toBe('Burnout & Rest');
      expect(triage.biblePathway.scriptureRef).toContain('Matthew 11:28');
    });

    it('routes Tagalog burnout term pagod correctly', () => {
      const triage = generateTriagePathways('tired', 'sobrang pagod na ang katawan ko');
      expect(triage.detectedTheme).toBe('Burnout & Rest');
    });

    it('routes parenting and frustration correctly', () => {
      const triage = generateTriagePathways('frustrated', 'I yelled at my kids and feel terrible');
      expect(triage.detectedTheme).toBe('Parenting & Generational Healing');
      expect(triage.biblePathway.scriptureRef).toContain('James 1:19');
    });

    it('routes anxiety correctly', () => {
      const triage = generateTriagePathways('anxious', 'My chest feels tight with worry');
      expect(triage.detectedTheme).toBe('Anxiety & Nervous System Calm');
      expect(triage.biblePathway.scriptureRef).toContain('Philippians 4:6-7');
    });

    it('routes default fallback correctly', () => {
      const triage = generateTriagePathways('unsure', 'I just feel overwhelmed');
      expect(triage.detectedTheme).toBe('Anxiety & Nervous System Calm');
    });
  });

  describe('generateCompassionateGuidance', () => {
    it('prioritizes crisis hotline referrals when crisis phrase is present', () => {
      const rec = generateCompassionateGuidance('overwhelmed', 'I want to end my life');
      expect(rec.primaryRecommendation.category).toBe('crisis');
      expect(rec.primaryReason).toContain('crisis support');
      expect(rec.alternativeRecommendations.length).toBeGreaterThan(0);
    });

    it('synthesizes multi-mood combinations in compassionate acknowledgment', () => {
      const rec = generateCompassionateGuidance(['sad', 'anxious'], 'Having a difficult time today');
      expect(rec.compassionateAcknowledgment).toContain('grief and anxiety');
    });

    it('provides standard devotional and breathing exercise for non-crisis mood', () => {
      const rec = generateCompassionateGuidance('peaceful', 'Enjoying a quiet morning');
      expect(rec.primaryRecommendation).toBeDefined();
      expect(rec.alternativeRecommendations.some((alt) => alt.item.id === 'cat-breath-478')).toBe(true);
    });
  });
});
