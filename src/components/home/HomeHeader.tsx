import React, { useState, useEffect } from 'react';
import { User, Check } from 'lucide-react';
import type { MoodId } from '../../types';
import { GlowingOrb } from '../GlowingOrb';

export interface HomeHeaderProps {
  userName: string;
  onUpdateUserName?: (name: string) => void;
  selectedMood: MoodId | null;
  isConversationActive: boolean;
}

export const HomeHeader: React.FC<HomeHeaderProps> = ({
  userName,
  onUpdateUserName,
  selectedMood,
  isConversationActive,
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(userName || '');

  // Smooth Typewriter Animation for greeting
  const fullGreetingText = userName?.trim()
    ? `Hi ${userName.trim()}! Welcome. I'm so glad you're here. How is your day so far?`
    : `Welcome! I'm so glad you're here. How is your day so far?`;

  const [displayedGreeting, setDisplayedGreeting] = useState('');
  const [isTypingComplete, setIsTypingComplete] = useState(false);
  const [prevGreetingText, setPrevGreetingText] = useState(fullGreetingText);

  // Reset typewriter when greeting text changes
  if (fullGreetingText !== prevGreetingText) {
    setPrevGreetingText(fullGreetingText);
    setDisplayedGreeting('');
    setIsTypingComplete(false);
  }

  useEffect(() => {
    let index = 0;
    const timer = setInterval(() => {
      if (index < fullGreetingText.length) {
        setDisplayedGreeting(fullGreetingText.slice(0, index + 1));
        index++;
      } else {
        setIsTypingComplete(true);
        clearInterval(timer);
      }
    }, 25);
    return () => clearInterval(timer);
  }, [fullGreetingText]);

  const handleNameSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (onUpdateUserName) {
      onUpdateUserName(tempName.trim());
    }
    setIsEditingName(false);
  };

  return (
    <div style={{ textAlign: 'center', paddingTop: '0px' }}>
      <GlowingOrb
        selectedMood={selectedMood}
        subtleLabel="A moment to pause, breathe, and be present"
      />

      {!isConversationActive && (
        <>
          {/* Animated Typewriter Greeting */}
          <h1 className="typewriter-heading">
            {displayedGreeting}
            {!isTypingComplete && <span className="typewriter-cursor" />}
          </h1>

          {/* Personalize Name Control */}
          <div style={{ marginTop: '2px', display: 'flex', justifyContent: 'center' }}>
            {isEditingName ? (
              <form onSubmit={handleNameSave} style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="text"
                  autoFocus
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  placeholder="Enter your name"
                  style={{
                    fontSize: '0.78rem',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    border: '1px solid var(--blue-accent)',
                    outline: 'none',
                    width: '140px',
                  }}
                />
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ fontSize: '0.74rem', padding: '4px 10px', minHeight: 'auto' }}
                >
                  <Check size={12} />
                  <span>Save</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingName(false)}
                  style={{ background: 'none', border: 'none', fontSize: '0.74rem', color: 'var(--text-muted)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                onClick={() => {
                  setTempName(userName || '');
                  setIsEditingName(true);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '0.74rem',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <User size={11} />
                <span>{userName?.trim() ? `Not ${userName}? Change name` : '+ Personalize with your name'}</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
