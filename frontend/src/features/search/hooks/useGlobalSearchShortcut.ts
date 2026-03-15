import { useEffect } from 'react';

/**
 * Listens for Cmd+K (Mac) or Ctrl+K (Windows/Linux) keyboard shortcut
 * and invokes the provided callback to open the search modal.
 */
export function useGlobalSearchShortcut(onOpen: () => void): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key === 'k') {
        e.preventDefault();
        onOpen();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onOpen]);
}
