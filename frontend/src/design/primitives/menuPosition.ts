/** Top-left of a box placed at (x, y), kept `pad` px inside the viewport. */
export function clampToViewport(x: number, y: number, size: { width: number; height: number }, pad = 8) {
    return {
        left: Math.max(pad, Math.min(x, window.innerWidth - size.width - pad)),
        top: Math.max(pad, Math.min(y, window.innerHeight - size.height - pad)),
    };
}
