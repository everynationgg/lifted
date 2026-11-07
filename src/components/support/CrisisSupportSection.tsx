import React, { useState } from 'react';
import {
  ShieldAlert,
  Globe,
  PhoneCall,
  MessageSquare,
  Sparkles,
  Send,
  Info,
} from 'lucide-react';
import { useCrisisDirectory } from '../../services/crisisDirectoryService';

export const CrisisSupportSection: React.FC = () => {
  const crisisDir = useCrisisDirectory();
  const [crisisStep, setCrisisStep] = useState<number>(1);
  const [ventText, setVentText] = useState('');
  const [ventSubmitted, setVentSubmitted] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Safe Harbor Banner */}
      <div
        className="white-card"
        style={{
          background: 'linear-gradient(180deg, #FFFFFF 0%, #FFF5F7 100%)',
          border: '1px solid var(--rose-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldAlert size={20} color="var(--rose-text)" />
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--rose-text)', textTransform: 'uppercase' }}>
            Safe Harbor & Support
          </span>
        </div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
          You're Not Alone
        </h2>
        <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.5 }}>
          If you are feeling overwhelmed, deeply isolated, or wondering if you can go on—pause and take one gentle breath. You are safe here, your life has irreplaceable value, and help is available right now.
        </p>

        {/* Location Selector (No GPS Permission Required) */}
        <div
          style={{
            marginTop: '12px',
            padding: '8px 12px',
            background: '#FFFFFF',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--rose-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Globe size={15} color="var(--rose-text)" />
            <label
              htmlFor="crisis-country-select"
              style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}
            >
              Crisis Support Country:
            </label>
          </div>
          <select
            id="crisis-country-select"
            value={crisisDir.currentCountry.countryCode}
            onChange={(e) => crisisDir.setCountry(e.target.value as any)}
            aria-label="Select crisis support country"
            style={{
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.82rem',
              fontWeight: 600,
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            {crisisDir.allCountries.map((c) => (
              <option key={c.countryCode} value={c.countryCode}>
                {c.flagEmoji} {c.countryName}
              </option>
            ))}
          </select>
        </div>

        {/* Direct Emergency & Crisis Lifelines */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' }}>
          {crisisDir.currentCountry.resources.map((res) => {
            const isEmergency = res.serviceType === 'emergency';
            const hasPhone = Boolean(res.phoneNumber);
            const hasSms = Boolean(res.smsNumber);

            return (
              <div
                key={res.id}
                style={{
                  background: isEmergency ? '#FFF1F2' : '#FFFFFF',
                  border: isEmergency ? '1.5px solid var(--rose-border)' : '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {res.name}
                      </span>
                      {res.isTollFree && (
                        <span
                          style={{
                            fontSize: '0.66rem',
                            fontWeight: 700,
                            background: '#DCFCE7',
                            color: '#15803D',
                            padding: '1px 6px',
                            borderRadius: 'var(--radius-full)',
                          }}
                        >
                          Toll-Free
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: '0.66rem',
                          fontWeight: 600,
                          background: 'var(--bg-secondary)',
                          color: 'var(--text-secondary)',
                          padding: '1px 6px',
                          borderRadius: 'var(--radius-full)',
                        }}
                      >
                        {res.operatingHours}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.4 }}>
                      {res.description}
                    </p>
                    {res.geographicOrNetworkRestrictions && (
                      <p style={{ fontSize: '0.72rem', color: '#B45309', marginTop: '2px', fontStyle: 'italic' }}>
                        {res.geographicOrNetworkRestrictions}
                      </p>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '2px' }}>
                  {hasPhone && (
                    <a
                      href={crisisDir.formatTelUri(res.phoneNumber)}
                      aria-label={`Call ${res.name} at ${res.phoneNumber}`}
                      style={{
                        background: isEmergency ? 'var(--rose-text)' : 'var(--blue-accent-dark)',
                        color: '#FFFFFF',
                        padding: '8px 14px',
                        borderRadius: 'var(--radius-full)',
                        fontWeight: 700,
                        fontSize: '0.82rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        textDecoration: 'none',
                      }}
                    >
                      <PhoneCall size={14} />
                      <span>Call {res.phoneNumber}</span>
                    </a>
                  )}

                  {hasSms && (
                    <a
                      href={crisisDir.formatSmsUri(res.smsNumber, res.smsBody)}
                      aria-label={`Text ${res.name} at ${res.smsNumber}`}
                      style={{
                        background: '#FFFFFF',
                        color: 'var(--rose-text)',
                        border: '1px solid var(--rose-border)',
                        padding: '8px 14px',
                        borderRadius: 'var(--radius-full)',
                        fontWeight: 600,
                        fontSize: '0.82rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        textDecoration: 'none',
                      }}
                    >
                      <MessageSquare size={14} />
                      <span>Text {res.smsBody ? `"${res.smsBody}" to ` : ''}{res.smsNumber}</span>
                    </a>
                  )}
                </div>

                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Verified: {res.officialVerificationSource} ({res.lastVerificationDate})
                </div>
              </div>
            );
          })}
        </div>

        {/* Non-Clinical Emergency Disclaimer */}
        <div
          style={{
            marginTop: '12px',
            padding: '10px 12px',
            background: '#FFFBEB',
            border: '1px solid #FDE68A',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.72rem',
            color: '#92400E',
            lineHeight: 1.45,
          }}
        >
          <strong>Important Safety Notice:</strong> Tapping a call or text button opens your device's native telephone or messaging dialer, which requires active carrier reception or phone service. Opening a dialer does not guarantee that a responder is immediately connected. LIFTED is a spiritual and emotional support companion and does not provide clinical emergency or psychiatric medical care.
        </div>
      </div>

      {/* "How to Go By One More Day" */}
      <div className="white-card">
        <h3 style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Guidance for "One More Day"
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
          When the future feels too dark, do not carry tomorrow. Focus only on this hour.
        </p>

        <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
          {[
            { num: 1, label: '1. Stay Present' },
            { num: 2, label: '2. Somatic Grounding' },
            { num: 3, label: '3. Valley Presence' },
          ].map((st) => (
            <button
              key={st.num}
              onClick={() => setCrisisStep(st.num)}
              style={{
                flex: 1,
                padding: '6px 4px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.74rem',
                fontWeight: 600,
                background: crisisStep === st.num ? 'var(--blue-powder)' : 'var(--bg-secondary)',
                color: crisisStep === st.num ? 'var(--text-primary)' : 'var(--text-secondary)',
                border: crisisStep === st.num ? '1px solid var(--blue-accent)' : '1px solid var(--border-subtle)',
              }}
            >
              {st.label}
            </button>
          ))}
        </div>

        <div
          style={{
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-md)',
            padding: '14px',
            marginTop: '10px',
          }}
        >
          {crisisStep === 1 && (
            <p style={{ fontSize: '0.84rem', color: 'var(--text-primary)', lineHeight: 1.55 }}>
              <strong>Shrink your horizon:</strong> You do not need to solve your entire life, family, or marriage today. You only need to navigate the next 15 minutes. "Do not worry about tomorrow, for tomorrow will worry about itself" (Matthew 6:34).
            </p>
          )}
          {crisisStep === 2 && (
            <p style={{ fontSize: '0.84rem', color: 'var(--text-primary)', lineHeight: 1.55 }}>
              <strong>Reconnect with physical safety:</strong> Place both feet flat on the ground. Put one hand gently on your chest and feel your breath. Drink a cool glass of water. Remind your nervous system: <em>"In this exact room, in this exact moment, I am safe."</em>
            </p>
          )}
          {crisisStep === 3 && (
            <p style={{ fontSize: '0.84rem', color: 'var(--text-primary)', lineHeight: 1.55 }}>
              <strong>The God who stays in the valley:</strong> "The Lord is close to the brokenhearted and saves those who are crushed in spirit" (Psalm 34:18). God does not demand you pretend to be strong. He sits beside you in the quiet ashes right now.
            </p>
          )}
        </div>
      </div>

      {/* Safe Venting Box */}
      <div className="white-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sparkles size={16} color="var(--blue-accent-dark)" />
          <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Pour Out What You Feel
          </h3>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
          Write raw, unfiltered thoughts without religious judgment.
        </p>

        {ventSubmitted ? (
          <div
            style={{
              background: 'var(--blue-light-sky)',
              padding: '12px',
              borderRadius: 'var(--radius-md)',
              marginTop: '8px',
              fontSize: '0.82rem',
              color: 'var(--text-primary)',
            }}
          >
            Thank you for releasing that weight from inside your mind. The Lord honors your honesty.
          </div>
        ) : (
          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <textarea
              rows={3}
              value={ventText}
              onChange={(e) => setVentText(e.target.value)}
              placeholder="Tell God and yourself exactly what hurts right now..."
              style={{
                padding: '10px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                fontSize: '0.84rem',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
              }}
            />
            <button
              onClick={() => {
                if (ventText.trim()) setVentSubmitted(true);
              }}
              className="btn-primary"
              style={{ alignSelf: 'flex-start', fontSize: '0.8rem', padding: '6px 14px' }}
            >
              <Send size={13} />
              <span>Release Burden</span>
            </button>
          </div>
        )}
      </div>

      {/* Pastoral & Clinical Boundary Statement */}
      <div
        style={{
          background: '#FFFFFF',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 14px',
          display: 'flex',
          gap: '8px',
        }}
      >
        <Info size={16} color="var(--text-secondary)" style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
          <strong>Pastoral & Non-Clinical Disclaimer:</strong> LIFTED is a spiritual emotional healing companion, not a clinical healthcare or psychiatric provider. If you or someone you know is in acute danger of self-harm or medical emergency, please call your local emergency services ({crisisDir.currentCountry.emergencyNumber}) or contact the 24/7 crisis hotlines listed above.
        </p>
      </div>
    </div>
  );
};
