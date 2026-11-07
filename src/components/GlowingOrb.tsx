import React, { useState, useEffect } from 'react';
import { Feather, Sparkles } from 'lucide-react';
import type { MoodId } from '../types';

interface GlowingOrbProps {
  selectedMood?: MoodId | null;
  onPauseClick?: () => void;
  subtleLabel?: string;
}

export const GlowingOrb: React.FC<GlowingOrbProps> = ({
  selectedMood,
  onPauseClick,
  subtleLabel = 'A moment to pause, breathe, and be present',
}) => {
  const [isBreathingMode, setIsBreathingMode] = useState(false);
  const [breathPhase, setBreathPhase] = useState<'Inhale' | 'Hold' | 'Exhale'>('Inhale');
  const [secondsLeft, setSecondsLeft] = useState(4);

  // Guided breathing cycle when user taps the orb
  useEffect(() => {
    let timer: any = null;
    if (isBreathingMode) {
      timer = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            setBreathPhase((current) => {
              if (current === 'Inhale') return 'Hold';
              if (current === 'Hold') return 'Exhale';
              return 'Inhale';
            });
            return 4;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isBreathingMode]);

  const handleOrbClick = () => {
    if (!isBreathingMode) {
      setIsBreathingMode(true);
      setBreathPhase('Inhale');
      setSecondsLeft(4);
    } else {
      setIsBreathingMode(false);
    }
    if (onPauseClick) onPauseClick();
  };

  const getMoodAuraClass = () => {
    if (!selectedMood) return '';
    return `mood-${selectedMood}`;
  };

  const getSomaticPhaseClass = () => {
    if (!isBreathingMode) return '';
    return `somatic-${breathPhase.toLowerCase()}`;
  };

  return (
    <div className="glowing-orb-container" aria-label="Calming Glowing Orb">
      <div className="glowing-orb-wrapper">
        {/* Mood-responsive ambient outer halo */}
        <div className={`orb-ambient-aura ${getMoodAuraClass()}`} />

        {/* 3D Volumetric Ethereal Sphere */}
        <div
          className={`glowing-orb ${getSomaticPhaseClass()}`}
          onClick={handleOrbClick}
          role="button"
          tabIndex={0}
          title={isBreathingMode ? 'Tap to pause breathing guide' : 'Tap for a gentle breathing pause'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handleOrbClick();
            }
          }}
        >
          {/* Delicate Sanctuary Watermark Emblem (Eliminates flat/empty look while keeping non-avatar calm) */}
          <div className="orb-inner-watermark">
            {isBreathingMode ? (
              <Sparkles size={20} />
            ) : (
              <Feather size={22} />
            )}
          </div>
        </div>
      </div>

      {/* Subtitle / Interactive Breath Guide Text */}
      <div className="orb-pause-text" onClick={handleOrbClick}>
        {isBreathingMode ? (
          <span style={{ color: 'var(--blue-accent-dark)', fontWeight: 600 }}>
            {breathPhase === 'Inhale' && `Inhale peace gently (${secondsLeft}s)...`}
            {breathPhase === 'Hold' && `Hold stillness (${secondsLeft}s)...`}
            {breathPhase === 'Exhale' && `Release tension (${secondsLeft}s)...`}
          </span>
        ) : (
          <span>{subtleLabel}</span>
        )}
      </div>
    </div>
  );
};
