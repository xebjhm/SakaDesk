/**
 * Reading styles for the sanitized blog HTML in BlogReader. Tailwind arbitrary variants
 * reach the elements of the post; every value is a design token. The search marks are
 * injected by BlogReader, the translation lines by useInlineBlogTranslations (own classes).
 */
export const BLOG_PROSE = [
    // Reading type in the app font: 16 px / 28 px (`text-reading`; the serif is for titles only).
    'break-words text-reading text-primary',
    // Paragraph rhythm: one 16 px gap between blocks; <br> runs keep their own blank lines.
    '[&_p]:mb-4 [&_p:last-child]:mb-0',
    '[&_:is(h1,h2,h3,h4)]:mb-3 [&_:is(h1,h2,h3,h4)]:mt-8 [&_:is(h1,h2,h3,h4)]:text-title [&_:is(h1,h2,h3,h4)]:font-semibold',
    '[&_:is(ul,ol)]:mb-4 [&_:is(ul,ol)]:pl-6 [&_ul]:list-disc [&_ol]:list-decimal',
    // Links: the strong group text with the group underline (Colour system roles).
    '[&_a]:text-group-strong [&_a]:underline [&_a]:decoration-group [&_a]:underline-offset-4 [&_a:hover]:decoration-2',
    // Photos are the member's content: own corners and size, never wider than the column.
    '[&_img]:h-auto [&_img]:max-w-full [&_img]:cursor-pointer',
    // Search matches: exact (filled) and by reading (filled + dashed underline).
    '[&_mark.search-highlight]:bg-mark-exact [&_mark.search-highlight]:px-1 [&_mark.search-highlight]:text-inherit',
    '[&_mark.search-highlight.reading]:border-b-2 [&_mark.search-highlight.reading]:border-dashed [&_mark.search-highlight.reading]:border-mark-underline [&_mark.search-highlight.reading]:bg-mark-reading',
].join(' ');
