/**
 * What stands in for the fan's nickname (`%%%` / `％％％`) when it is unset or hidden: the
 * share export (`recap/share/shareModel.ts`) and `MemoryText` show the same mask. `MemoryText`
 * builds it from `memories.common.nicknameMasked` in corner brackets; its test pins that the
 * result equals this constant.
 */
export const NICKNAME_MASK = '『＊＊＊』';
