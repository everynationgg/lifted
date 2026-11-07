import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioNarrationService } from '../audioNarrationService';
import { lifecycleManager } from '../lifecycleManager';

describe('AudioNarrationService', () => {
  let service: AudioNarrationService;
  let mockSpeechSynthesis: any;

  beforeEach(() => {
    mockSpeechSynthesis = {
      speak: vi.fn(),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: vi.fn().mockReturnValue([
        { name: 'Google US English Natural', lang: 'en-US' },
        { name: 'Samantha', lang: 'en-US' },
      ]),
      onvoiceschanged: null,
    };

    vi.stubGlobal('speechSynthesis', mockSpeechSynthesis);
    service = new AudioNarrationService();
  });

  afterEach(() => {
    service.stop();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('detects speech synthesis and loads voices', () => {
    const status = service.getStatus();
    expect(status.hasSpeechSynthesis).toBe(true);
    expect(status.availableVoiceCount).toBe(2);
    expect(status.state).toBe('IDLE');
  });

  it('initiates speech synthesis on play and sets active title', async () => {
    await service.play('Morning Peace', 'The Lord is my strength and my shield.');

    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
    expect(mockSpeechSynthesis.speak).toHaveBeenCalled();
    expect(service.getStatus().activeTextTitle).toBe('Morning Peace');
  });

  it('pauses and resumes active speech synthesis', async () => {
    await service.play('Still Waters', 'He leads me beside still waters.');

    service.pause();
    expect(mockSpeechSynthesis.pause).toHaveBeenCalled();
    expect(service.isPaused()).toBe(true);

    service.resume();
    expect(mockSpeechSynthesis.resume).toHaveBeenCalled();
    expect(service.isPlaying()).toBe(true);
  });

  it('stops speech synthesis and resets state on stop()', async () => {
    await service.play('God Hears', 'God hears every whisper.');
    service.stop();

    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
    expect(service.getStatus().state).toBe('IDLE');
    expect(service.getStatus().activeTextTitle).toBeUndefined();
  });

  it('automatically stops audio on app background transition via lifecycleManager', async () => {
    await service.play('Holding Space', 'Holding space for you today.');
    const stopSpy = vi.spyOn(service, 'stop');

    lifecycleManager.simulatePhaseChangeForTesting('BACKGROUND');

    expect(stopSpy).toHaveBeenCalled();
    expect(service.getStatus().state).toBe('IDLE');
  });

  it('marks state as UNSUPPORTED when window.speechSynthesis is not available', async () => {
    vi.unstubAllGlobals();
    const unsupportedService = new AudioNarrationService();
    await unsupportedService.play('No Speech', 'Testing unsupported environment');

    expect(unsupportedService.getStatus().state).toBe('UNSUPPORTED');
    expect(unsupportedService.getStatus().errorMessage).toContain('not supported');
  });
});
