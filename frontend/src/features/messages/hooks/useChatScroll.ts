import { useRef, useCallback, useMemo, useEffect } from 'react';
import type { ListRange } from 'react-virtuoso';
import type { Message } from '../../../types';

const STORAGE_KEY_PREFIX = 'sakadesk_scroll_';
const DEBOUNCE_MS = 500;

interface UseChatScrollResult {
  /** Index to pass to Virtuoso's initialTopMostItemIndex */
  initialTopMostItemIndex: number;
  /** Callback for Virtuoso's rangeChanged prop */
  handleRangeChanged: (range: ListRange) => void;
  /** Call this immediately before room switch to save position */
  savePositionImmediate: () => void;
}

/**
 * Hook for ID-based scroll position save/restore with react-virtuoso.
 *
 * - Saves the top-most visible message ID to localStorage (debounced)
 * - Restores position by finding the saved ID's index in the messages array
 * - Falls back to bottom of list for new rooms or if saved ID not found
 */
export function useChatScroll(
  memberId: string | number,
  messages: Message[]
): UseChatScrollResult {
  const storageKey = `${STORAGE_KEY_PREFIX}${memberId}`;
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedIdRef = useRef<number | null>(null);
  const currentTopIndexRef = useRef<number>(0);

  // Track current state in refs for cleanup access
  // These refs always hold the "current" room's data for saving on switch
  const currentStorageKeyRef = useRef(storageKey);
  const currentMessagesRef = useRef(messages);

  // Update refs when props change
  useEffect(() => {
    currentStorageKeyRef.current = storageKey;
    currentMessagesRef.current = messages;
  }, [storageKey, messages]);

  // Save position for a specific room (uses refs to get current state)
  const saveToStorage = useCallback((key: string, msgs: Message[], topIndex: number) => {
    if (!msgs || msgs.length === 0) return;
    const message = msgs[topIndex];
    if (!message) return;
    localStorage.setItem(key, String(message.id));
  }, []);

  // Save PREVIOUS room's position when memberId changes
  const prevMemberIdRef = useRef(memberId);
  const prevStorageKeyRef = useRef(storageKey);
  const prevMessagesRef = useRef(messages);
  const prevTopIndexRef = useRef(0);

  useEffect(() => {
    if (prevMemberIdRef.current !== memberId) {
      // memberId changed - save the PREVIOUS room's position
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      saveToStorage(prevStorageKeyRef.current, prevMessagesRef.current, prevTopIndexRef.current);

      // Update prev refs to current
      prevMemberIdRef.current = memberId;
    }
    // Always update these for next switch
    prevStorageKeyRef.current = storageKey;
    prevMessagesRef.current = messages;
  }, [memberId, storageKey, messages, saveToStorage]);

  // Calculate initial position (runs once per memberId/messages change)
  const initialTopMostItemIndex = useMemo(() => {
    if (!messages || messages.length === 0) return 0;

    const savedId = localStorage.getItem(storageKey);
    if (!savedId) return messages.length - 1; // New room -> bottom

    const parsedId = Number(savedId);
    const index = messages.findIndex(m => m.id === parsedId);
    return index !== -1 ? index : messages.length - 1; // Not found -> bottom
  }, [storageKey, messages]);

  // Save position (debounced)
  const savePosition = useCallback((topIndex: number) => {
    if (!messages || messages.length === 0) return;

    const message = messages[topIndex];
    if (!message) return;

    // Skip if same ID already saved
    if (lastSavedIdRef.current === message.id) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      localStorage.setItem(storageKey, String(message.id));
      lastSavedIdRef.current = message.id;
    }, DEBOUNCE_MS);
  }, [messages, storageKey]);

  // Immediate save (for unmount/room switch)
  const savePositionImmediate = useCallback(() => {
    if (!messages || messages.length === 0) return;

    const message = messages[currentTopIndexRef.current];
    if (!message) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    localStorage.setItem(storageKey, String(message.id));
    lastSavedIdRef.current = message.id;
  }, [messages, storageKey]);

  // Handler for Virtuoso's rangeChanged
  const handleRangeChanged = useCallback((range: ListRange) => {
    currentTopIndexRef.current = range.startIndex;
    prevTopIndexRef.current = range.startIndex; // Keep prev in sync for room switch
    savePosition(range.startIndex);
  }, [savePosition]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    initialTopMostItemIndex,
    handleRangeChanged,
    savePositionImmediate,
  };
}
