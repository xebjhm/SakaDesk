/** True when the backend's popup currently owns this voice (GET /api/call-popup/active). */
export async function isCallPopupActive(
    ctx: { service: string; groupId: number; memberId: number }, messageId: number,
): Promise<boolean> {
    try {
        const q = new URLSearchParams({
            service: ctx.service, group_id: String(ctx.groupId),
            member_id: String(ctx.memberId), message_id: String(messageId),
        });
        const res = await fetch(`/api/call-popup/active?${q}`);
        if (!res.ok) return false;
        const body = await res.json() as { active?: unknown };
        return body.active === true;
    } catch {
        return false;
    }
}
