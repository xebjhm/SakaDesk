import { clientLog } from '../../utils/clientLog';

/** `surface` of the `dialog` breadcrumb, one per dialog (docs/superpowers/specs/2026-11-05-d2c-dialogs-design.md, Breadcrumbs). */
export type DialogLogId =
    | 'calendar' | 'background' | 'favorites' | 'media_gallery' | 'media_viewer' | 'blog_gallery'
    | 'member_select' | 'member_timeline' | 'about' | 'report_issue' | 'diagnostics' | 'add_service'
    | 'confirm' | 'reveal_all' | 'settings' | 'search' | 'member_profile' | 'login' | 'sync' | 'setup'
    | 'tos' | 'sent_letters';

/** `surface` of the `dialog_load` breadcrumb: a data load inside a dialog. */
export type DialogLoadSurface =
    | 'calendar' | 'diagnostics' | 'blog_gallery' | 'profile_images' | 'search'
    | 'settings_blog_cache' | 'settings_blog_backup' | 'settings_update_check' | 'settings_blog_clean'
    | 'settings_blog_stats' | 'settings_ai_config' | 'settings_ai_models' | 'settings_ai_key_clear' | 'settings_ai_save'
    | 'report_issue';

export type DialogLoadOutcome = 'ok' | 'error' | 'partial' | 'cancelled';
export type CloseReason = 'escape' | 'backdrop' | 'button';

/** One `dialog` breadcrumb. Never pass names, ids, paths or text. */
export function logDialog(surface: DialogLogId, phase: 'open' | 'close', reason?: CloseReason | 'app'): void {
    clientLog('dialog', reason === undefined ? { surface, phase } : { surface, phase, reason });
}

/** One `dialog_load` breadcrumb. Never pass names, ids, paths, queries or error text. */
export function logDialogLoad(surface: DialogLoadSurface, outcome: DialogLoadOutcome, count?: number): void {
    clientLog('dialog_load', count === undefined ? { surface, outcome } : { surface, outcome, count });
}
