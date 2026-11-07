/**
 * LIFTED — End-to-End Recovery Enrollment & Settings Integration Test
 * Phase 8 Stage 2: UI Integration, Proof-of-Possession & Safe Decoupled Consent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JourneyScreen } from '../JourneyScreen';
import { DEFAULT_USER_PREFERENCES } from '../../data/mockData';
import type { UserPreferences } from '../../types';

describe('End-to-End Recovery Enrollment & Settings Integration', () => {
  let mockPreferences: UserPreferences;
  let onUpdatePreferencesMock: (prefs: Partial<UserPreferences>) => void;

  beforeEach(() => {
    mockPreferences = {
      ...DEFAULT_USER_PREFERENCES,
      recoveryKeyEnrolled: false,
      syncConsentGranted: false,
    };
    onUpdatePreferencesMock = vi.fn((newPrefs) => {
      mockPreferences = { ...mockPreferences, ...newPrefs };
    });
  });

  const renderScreen = (customPrefs?: Partial<UserPreferences>) => {
    return render(
      <JourneyScreen
        userName="Sarah"
        onUpdateUserName={vi.fn()}
        moodHistory={[]}
        savedDevotionals={[]}
        savedContentItems={[]}
        helpingHandsModules={[]}
        prayerRequests={[]}
        journalEntries={[]}
        userPreferences={{ ...mockPreferences, ...customPrefs }}
        onUpdatePreferences={onUpdatePreferencesMock}
        onOpenDevotional={vi.fn()}
        onOpenContentItem={vi.fn()}
        onClearAllData={vi.fn()}
      />
    );
  };

  it('1. Renders Journey Preferences, opens Recovery Enrollment Modal, and walks through 10-step safe enrollment', async () => {
    renderScreen();

    // 1. Open Preferences / Settings panel
    const settingsToggle = screen.getByText('Preferences');
    fireEvent.click(settingsToggle);

    // 2. Locate the "Set Up Account Recovery Key" button in Settings
    const openBtn = screen.getByRole('button', { name: /Set Up Account Recovery Key/i });
    expect(openBtn).toBeInTheDocument();

    // 3. Click to open Recovery Enrollment Modal
    fireEvent.click(openBtn);

    // Verify Step 1: Education Modal is displayed
    expect(screen.getByText('Account Key Recovery Setup')).toBeInTheDocument();
    expect(screen.getByText(/Device Key \(DEK\):/i)).toBeInTheDocument();
    expect(screen.getByText(/Account Key \(AEK\):/i)).toBeInTheDocument();

    // 4. Click "Generate My Recovery Code"
    const generateBtn = screen.getByRole('button', { name: /Generate My Recovery Code/i });
    fireEvent.click(generateBtn);

    // Verify Step 2: Generation view is displayed with 29-symbol code
    await waitFor(() => {
      expect(screen.getByText(/Here is your 29-character cryptographic recovery code/i)).toBeInTheDocument();
    });

    // Check that code is displayed and matches the canonical 29-symbol format: LIFT-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXXX
    const codeDisplay = screen.getByText(/^LIFT-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{5}$/);
    expect(codeDisplay).toBeInTheDocument();
    const generatedCode = codeDisplay.textContent!;

    // Safe storage notice check
    expect(screen.getByText(/LIFTED never creates an automatic unencrypted PDF/i)).toBeInTheDocument();

    // 5. Click "I Have Safely Saved My Code" to proceed to Proof of Possession
    const savedCodeBtn = screen.getByRole('button', { name: /I Have Safely Saved My Code/i });
    fireEvent.click(savedCodeBtn);

    // Verify Step 3: Proof of Possession Challenge view
    await waitFor(() => {
      expect(screen.getByText(/Enter Recovery Code/i)).toBeInTheDocument();
    });

    const inputField = screen.getByPlaceholderText(/LIFT-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXXX/i);
    expect(inputField).toBeInTheDocument();

    // 6. Enter the exact generated code (with lowercase to test normalization)
    const lowerCode = generatedCode.toLowerCase();
    fireEvent.change(inputField, { target: { value: lowerCode } });

    // Click "Verify Possession"
    const verifyBtn = screen.getByRole('button', { name: /Verify Possession/i });
    fireEvent.click(verifyBtn);

    // Verify Step 4: Verification success & Decoupled Cloud Sync Consent
    await waitFor(() => {
      expect(screen.getByText('Account Key Verified Successfully')).toBeInTheDocument();
    });

    // Consent checkbox must be unchecked by default
    const consentCheckbox = screen.getByLabelText(/Authorize encrypted synchronization/i);
    expect(consentCheckbox).not.toBeChecked();

    // User checks consent
    fireEvent.click(consentCheckbox);
    expect(consentCheckbox).toBeChecked();

    // 7. Finish Setup
    const finishBtn = screen.getByRole('button', { name: /Finish Setup/i });
    fireEvent.click(finishBtn);

    // Verify that modal closes and preferences are updated
    expect(onUpdatePreferencesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryKeyEnrolled: true,
        syncConsentGranted: true,
      })
    );
  });

  it('2. Cancelling enrollment leaves local vault and settings completely untouched', async () => {
    renderScreen();

    // Open Settings
    fireEvent.click(screen.getByText('Preferences'));

    // Open Modal
    fireEvent.click(screen.getByRole('button', { name: /Set Up Account Recovery Key/i }));
    expect(screen.getByText('Account Key Recovery Setup')).toBeInTheDocument();

    // Click Close (X button)
    const closeBtn = screen.getByLabelText('Close');
    fireEvent.click(closeBtn);

    // Modal is closed
    expect(screen.queryByText('Account Key Recovery Setup')).not.toBeInTheDocument();

    // Preferences were NOT modified with enrolled flags
    expect(onUpdatePreferencesMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryKeyEnrolled: true,
      })
    );
  });

  it('3. User can revoke cloud sync consent at any time without losing enrolled key or local data', async () => {
    // Render with recovery key already enrolled and sync consent granted
    renderScreen({
      recoveryKeyEnrolled: true,
      syncConsentGranted: true,
    });

    // Open Settings
    fireEvent.click(screen.getByText('Preferences'));

    // Check status display
    expect(screen.getByText(/Enrolled \(29-symbol AEK\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Granted \(Live Sync Inactive\)/i)).toBeInTheDocument();

    // Locate Revoke Consent button
    const revokeBtn = screen.getByRole('button', { name: /Revoke Consent/i });
    expect(revokeBtn).toBeInTheDocument();

    // Click Revoke Consent
    fireEvent.click(revokeBtn);

    // Verifies that only sync consent was revoked
    expect(onUpdatePreferencesMock).toHaveBeenCalledWith({
      syncConsentGranted: false,
    });
  });
});
