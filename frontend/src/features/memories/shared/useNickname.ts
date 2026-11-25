import { createContext, createElement, useContext, type ReactNode } from 'react';

/**
 * The fan's nickname for the active service. It already flows App → Layout → ContentArea →
 * `MemoriesFeature` as a prop (the profile the app loaded), so Memories never fetches it
 * again: `MemoriesFeature` provides it here and every Memories view reads it with
 * {@link useNickname}.
 */
const NicknameContext = createContext<string | undefined>(undefined);

export function NicknameProvider({ nickname, children }: { nickname: string | undefined; children: ReactNode }) {
    return createElement(NicknameContext.Provider, { value: nickname }, children);
}

/** The nickname, or `undefined` when it is unset or blank (callers then mask it). */
export function useNickname(): string | undefined {
    const nickname = useContext(NicknameContext);
    return nickname?.trim() ? nickname : undefined;
}
