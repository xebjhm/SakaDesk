import { clientLog } from '../../utils/clientLog';

/** `surface` of the `dialog` breadcrumb, one per dialog (docs/superpowers/specs/2026-11-05-d2c-dialogs-design.md, Breadcrumbs). */
export type DialogLogId =
    | 'calendar' | 'background' | 'favorites' | 'media_gallery' | 'media_viewer' | 'blog_gallery'
    | 'member_select' | 'member_timeline' | 'about' | 'report_issue' | 'diagnostics' | 'add_service'
    | 'confirm' | 'reveal_all' | 'settings' | 'search' | 'member_profile' | 'login' | 'sync' | 'setup'
    | 'tos' | 'sent_letters' | 'letter_viewer';

/** `surface` of the `dialog_load` breadcrumb: a data load inside a dialog. */
export type DialogLoadSurface =
    | 'calendar' | 'diagnostics' | 'blog_gallery' | 'profile_images' | 'search'
    | 'settings_blog_cache' | 'settings_blog_backup' | 'settings_update_check' | 'settings_blog_clean'
    | 'settings_blog_stats' | 'settings_ai_config' | 'settings_ai_models' | 'settings_ai_key_clear' | 'settings_ai_save'
    | 'settings_ai_cache_clear' | 'settings_ai_test' | 'settings_app_save'
    | 'report_issue'
    | 'search_status' | 'search_backup_status' | 'search_more' | 'search_members'
    | 'background_upload'
    | 'login' | 'login_geo';

/** `skipped`: nothing to do (no images, a rejected file); `cancelled`: aborted or superseded. */
export type DialogLoadOutcome = 'ok' | 'error' | 'partial' | 'cancelled' | 'skipped';
/**
 * Code for why a load failed or was skipped (the AI connection test's backend codes, the
 * background upload's rejections, an empty result, a login whose follow-up step failed). Never
 * message text.
 */
export type DialogLoadReason = 'auth' | 'unreachable' | 'no_key' | 'failed' | 'too_large' | 'not_image' | 'empty' | 'blocked'
    | 'after_login';
export type CloseReason = 'escape' | 'backdrop' | 'button';

/** One `dialog` breadcrumb. Never pass names, ids, paths or text. */
export function logDialog(surface: DialogLogId, phase: 'open' | 'close', reason?: CloseReason | 'app'): void {
    clientLog('dialog', reason === undefined ? { surface, phase } : { surface, phase, reason });
}

/** One `dialog_load` breadcrumb. Never pass names, ids, paths, queries or error text. */
export function logDialogLoad(surface: DialogLoadSurface, outcome: DialogLoadOutcome, count?: number, reason?: DialogLoadReason): void {
    clientLog('dialog_load', {
        surface,
        outcome,
        ...(count === undefined ? {} : { count }),
        ...(reason === undefined ? {} : { reason }),
    });
}
