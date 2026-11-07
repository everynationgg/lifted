import { useState, useEffect, useRef, useCallback } from 'react';
import { vaultManager } from './vaultManager';

export interface UseEncryptedDraftOptions {
  draftKey: string;
  currentValue: string;
  onRestore: (draftText: string) => void;
  debounceMs?: number;
  enabled?: boolean;
}

export interface UseEncryptedDraftReturn {
  hasDraft: boolean;
  draftText: string | null;
  restoreDraft: () => void;
  discardDraft: () => Promise<void>;
  clearDraft: () => Promise<void>;
  isSaving: boolean;
}

/**
 * Custom React Hook for Encrypted Draft Recovery
 * Features:
 * - Debounced AES-256-GCM encryption before persistence
 * - Restoration prompt on component mount if an uncommitted draft exists
 * - Best-effort immediate flushing on window beforeunload and visibilitychange
 * - Clean disposal upon successful submission
 */
export function useEncryptedDraft({
  draftKey,
  currentValue,
  onRestore,
  debounceMs = 500,
  enabled = true,
}: UseEncryptedDraftOptions): UseEncryptedDraftReturn {
  const [hasDraft, setHasDraft] = useState(false);
  const [draftText, setDraftText] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValueRef = useRef(currentValue);
  useEffect(() => {
    latestValueRef.current = currentValue;
  }, [currentValue]);

  // 1. Check for existing draft on mount
  useEffect(() => {
    if (!enabled) return;

    let isMounted = true;
    const checkDraft = async () => {
      try {
        if (!vaultManager.isReady()) {
          await vaultManager.initialize();
        }
        if (!vaultManager.isReady()) return;
        const draft = await vaultManager.drafts.getDraft(draftKey);
        if (isMounted && draft && draft.content && draft.content.trim()) {
          // Only show draft if different from initial value
          if (draft.content.trim() !== latestValueRef.current.trim()) {
            setHasDraft(true);
            setDraftText(draft.content);
          }
        }
      } catch {
        // Ignore draft reading errors silently
      }
    };

    checkDraft();
    return () => {
      isMounted = false;
    };
  }, [draftKey, enabled]);

  // 2. Debounced autosave
  useEffect(() => {
    if (!enabled) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    if (!currentValue || !currentValue.trim()) {
      return;
    }

    saveTimeoutRef.current = setTimeout(async () => {
      if (!vaultManager.isReady()) {
        await vaultManager.initialize();
      }
      if (!vaultManager.isReady()) return;
      try {
        setIsSaving(true);
        await vaultManager.drafts.saveDraft(draftKey, currentValue);
      } catch {
        // Ignore draft write error silently
      } finally {
        setIsSaving(false);
      }
    }, debounceMs);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [currentValue, debounceMs, draftKey, enabled]);

  // 3. Best-effort flush on app backgrounding or page unload
  const flushImmediately = useCallback(async () => {
    const val = latestValueRef.current;
    if (val && val.trim()) {
      if (!vaultManager.isReady()) {
        await vaultManager.initialize();
      }
      if (vaultManager.isReady()) {
        try {
          await vaultManager.drafts.saveDraft(draftKey, val);
        } catch {
          /* Ignore */
        }
      }
    }
  }, [draftKey]);

  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushImmediately();
      }
    };

    window.addEventListener('beforeunload', flushImmediately);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', flushImmediately);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, flushImmediately]);

  // 4. User actions: Restore, Discard, and Clear
  const restoreDraft = useCallback(() => {
    if (draftText !== null) {
      onRestore(draftText);
      setHasDraft(false);
    }
  }, [draftText, onRestore]);

  const discardDraft = useCallback(async () => {
    setHasDraft(false);
    setDraftText(null);
    if (!vaultManager.isReady()) {
      await vaultManager.initialize();
    }
    if (vaultManager.isReady()) {
      try {
        await vaultManager.drafts.clearDraft(draftKey);
      } catch {
        /* Ignore */
      }
    }
  }, [draftKey]);

  const clearDraft = useCallback(async () => {
    setHasDraft(false);
    setDraftText(null);
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (!vaultManager.isReady()) {
      await vaultManager.initialize();
    }
    if (vaultManager.isReady()) {
      try {
        await vaultManager.drafts.clearDraft(draftKey);
      } catch {
        /* Ignore */
      }
    }
  }, [draftKey]);

  return {
    hasDraft,
    draftText,
    restoreDraft,
    discardDraft,
    clearDraft,
    isSaving,
  };
}
