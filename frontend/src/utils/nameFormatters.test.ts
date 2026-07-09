import { describe, it, expect } from 'vitest'
import { formatName, getShortName, getInitials } from './nameFormatters'

describe('nameFormatters', () => {
    describe('formatName', () => {
        it('should replace underscores with spaces', () => {
            expect(formatName('John_Doe')).toBe('John Doe')
            expect(formatName('Jane_Mary_Smith')).toBe('Jane Mary Smith')
        })

        it('should handle multiple consecutive underscores', () => {
            expect(formatName('John__Doe')).toBe('John  Doe')
        })

        it('should handle names without underscores', () => {
            expect(formatName('John')).toBe('John')
            expect(formatName('John Doe')).toBe('John Doe')
        })

        it('should handle empty string', () => {
            expect(formatName('')).toBe('')
        })

        // SD-FE-GAP-A-04: avatar data from the backend can be nullish at
        // runtime despite the string type; formatName must not throw.
        it('should not throw on nullish input', () => {
            expect(formatName(undefined as unknown as string)).toBe('')
            expect(formatName(null as unknown as string)).toBe('')
        })

        it('should handle Japanese names with underscores', () => {
            expect(formatName('齊藤_京子')).toBe('齊藤 京子')
        })

        it('should handle leading and trailing underscores', () => {
            expect(formatName('_John_')).toBe(' John ')
        })
    })

    describe('getShortName', () => {
        it('should return first 2 characters of first word', () => {
            expect(getShortName('John_Doe')).toBe('Jo')
            expect(getShortName('Kyoko')).toBe('Ky')
        })

        it('should handle single character names', () => {
            expect(getShortName('J')).toBe('J')
        })

        it('should format name before getting short name', () => {
            expect(getShortName('Saito_Kyoko')).toBe('Sa')
        })

        it('should handle names with spaces', () => {
            expect(getShortName('John Doe')).toBe('Jo')
        })

        it('should handle Japanese characters', () => {
            expect(getShortName('齊藤_京子')).toBe('齊藤')
        })

        // SD-FE-GAP-A-04: getShortName must not return a blank avatar for
        // whitespace/nullish names (getInitials already guards; parity here).
        it('should return a fallback for whitespace-only names', () => {
            expect(getShortName('   ')).toBe('?')
        })

        it('should return a fallback for empty string', () => {
            // Prior behavior returned '' (blank avatar); now a visible fallback.
            expect(getShortName('')).toBe('?')
        })

        it('should not throw on a nullish name reaching the formatter', () => {
            expect(getShortName(undefined as unknown as string)).toBe('?')
            expect(getShortName(null as unknown as string)).toBe('?')
        })
    })

    describe('getInitials', () => {
        it('should return initials from name parts', () => {
            expect(getInitials('John_Doe')).toBe('JD')
            expect(getInitials('Jane_Mary_Smith')).toBe('JM')
        })

        it('should return uppercase initials', () => {
            expect(getInitials('john_doe')).toBe('JD')
        })

        it('should handle single word names', () => {
            expect(getInitials('Kyoko')).toBe('K')
        })

        it('should limit to 2 characters', () => {
            expect(getInitials('Alice_Bob_Charlie')).toBe('AB')
        })

        it('should handle empty string', () => {
            expect(getInitials('')).toBe('')
        })

        it('should handle names with spaces', () => {
            expect(getInitials('John Doe')).toBe('JD')
        })

        it('should handle Japanese characters', () => {
            // Japanese characters get uppercased (no-op) and truncated
            expect(getInitials('齊藤_京子')).toBe('齊京')
        })

        it('should filter out empty parts', () => {
            // Double underscore creates empty part
            expect(getInitials('John__Doe')).toBe('JD')
        })

        // SD-FE-GAP-A-05: astral/emoji names must not yield a lone surrogate.
        it('should not split an astral (emoji) character in half', () => {
            // '𠮷' (U+20BB7) and '😀' are surrogate pairs; the result must be two
            // COMPLETE glyphs (2 code points), never a broken half code unit.
            const initials = getInitials('𠮷田_😀')
            expect(initials).toBe('𠮷😀')
            expect(Array.from(initials).length).toBe(2)
        })
    })

    describe('getShortName code-point safety (SD-FE-GAP-A-05)', () => {
        it('should keep a surrogate-pair first character whole', () => {
            const short = getShortName('😀A')
            // Two code points: the emoji + 'A' — not a broken surrogate.
            expect(short).toBe('😀A')
        })
    })
})
