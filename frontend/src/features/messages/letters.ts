/** One sent letter from the local archive (`GET /api/chat/letters_local`). */
export interface Letter {
    id: number;
    text: string;
    /** ISO timestamp (UTC). */
    created_at: string;
    /** Media-route URL of the archived letter image; null when the file is missing. */
    image_url: string | null;
    width: number | null;
    height: number | null;
}
