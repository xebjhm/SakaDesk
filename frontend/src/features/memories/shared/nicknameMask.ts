import type { TFunction } from 'i18next';

/**
 * What stands in for the fan's nickname (`%%%` / `％％％`) when it is unset or hidden: the
 * share export (`recap/share/shareModel.ts`), `MemoryText` and the day view show the same mask.
 * The views build it with {@link maskedNickname} from `memories.common.nicknameMasked`; its
 * test pins that the result equals this constant.
 */
export const NICKNAME_MASK = '『＊＊＊』';

/** The localized mask in corner brackets, for views that render through i18n. */
export function maskedNickname(t: TFunction): string {
    return `『${t('memories.common.nicknameMasked')}』`;
}
