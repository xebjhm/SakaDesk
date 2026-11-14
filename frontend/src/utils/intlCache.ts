const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * One shared Intl.DateTimeFormat per locale and options (UI health P-B7): building one per call
 * showed in long lists (bubbles, search results, Memories days). Throws a RangeError on an invalid
 * locale, like the constructor (callers that fall back keep their try/catch). The cache is
 * practically bounded: a few locales times the fixed option literals of the callers.
 * A formatter built without an explicit `timeZone` keeps the zone it resolved when it was first
 * built: if the system time zone changes while the app runs, these labels keep the old zone until
 * a restart (resolving the zone on every call would cost what this cache saves).
 */
export function dateTimeFormat(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${locale ?? ''}|${JSON.stringify(options)}`;
    let formatter = formatters.get(key);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat(locale, options);
        formatters.set(key, formatter);
    }
    return formatter;
}
