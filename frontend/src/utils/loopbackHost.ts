/**
 * Whether a URL hostname (as `URL.hostname` gives it) names this machine: `localhost` or a
 * `*.localhost` name, `0.0.0.0`, any `127.x.x.x`, or an IPv6 literal starting with `::`
 * (loopback, unspecified, IPv4-mapped or IPv4-compatible; no public address starts so).
 * Names that reach loopback only through DNS are not detected here.
 */
export function isLoopbackHost(rawHost: string): boolean {
    const host = rawHost.toLowerCase().replace(/\.+$/, '');
    return (
        host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0'
        || /^127\.\d+\.\d+\.\d+$/.test(host)
        || host.startsWith('[::')
    );
}
