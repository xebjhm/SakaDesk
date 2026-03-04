import { describe, it, expect } from 'vitest'
import {
    groupThemes,
    getThemeForService,
    getThemeCSSVariables,
    type GroupId,
} from './groupThemes'

describe('groupThemes', () => {
    describe('theme definitions', () => {
        it('should define all group themes', () => {
            expect(Object.keys(groupThemes)).toEqual(['hinatazaka', 'sakurazaka', 'nogizaka', 'yodel', 'default'])
        })

        it('should have correct id for each theme', () => {
            const groupIds: GroupId[] = ['hinatazaka', 'sakurazaka', 'nogizaka', 'yodel', 'default']
            for (const id of groupIds) {
                expect(groupThemes[id].id).toBe(id)
            }
        })

        it('should have valid names for each theme', () => {
            expect(groupThemes.hinatazaka.name).toBe('Hinatazaka46')
            expect(groupThemes.hinatazaka.nameJp).toBe('日向坂46')
            expect(groupThemes.sakurazaka.name).toBe('Sakurazaka46')
            expect(groupThemes.sakurazaka.nameJp).toBe('櫻坂46')
            expect(groupThemes.nogizaka.name).toBe('Nogizaka46')
            expect(groupThemes.nogizaka.nameJp).toBe('乃木坂46')
            expect(groupThemes.default.name).toBe('Default')
        })

        it('should have valid hex color codes for primary colors', () => {
            const hexColorRegex = /^#[0-9A-Fa-f]{6}$/
            for (const theme of Object.values(groupThemes)) {
                expect(theme.primaryColor).toMatch(hexColorRegex)
                expect(theme.secondaryColor).toMatch(hexColorRegex)
            }
        })

        it('should have all required theme sections', () => {
            for (const theme of Object.values(groupThemes)) {
                expect(theme).toHaveProperty('ambient')
                expect(theme).toHaveProperty('surface')
                expect(theme).toHaveProperty('text')
                expect(theme).toHaveProperty('interaction')
                expect(theme).toHaveProperty('vibe')
                expect(theme).toHaveProperty('blog')
                expect(theme).toHaveProperty('modals')
                expect(theme).toHaveProperty('messages')
            }
        })

        it('should have valid header gradient structure', () => {
            for (const theme of Object.values(groupThemes)) {
                expect(theme.messages.headerGradient).toHaveProperty('from')
                expect(theme.messages.headerGradient).toHaveProperty('via')
                expect(theme.messages.headerGradient).toHaveProperty('to')
            }
        })

        it('should have valid sidebar gradient array', () => {
            for (const theme of Object.values(groupThemes)) {
                expect(Array.isArray(theme.messages.sidebarGradient)).toBe(true)
                expect(theme.messages.sidebarGradient.length).toBe(3)
            }
        })

        it('should have valid shelter colors structure', () => {
            for (const theme of Object.values(groupThemes)) {
                expect(theme.messages.shelterColors).toHaveProperty('picture')
                expect(theme.messages.shelterColors).toHaveProperty('video')
                expect(theme.messages.shelterColors).toHaveProperty('voice')
                expect(theme.messages.shelterColors).toHaveProperty('text')
            }
        })

        it('should have valid header style', () => {
            for (const theme of Object.values(groupThemes)) {
                expect(['gradient', 'light']).toContain(theme.messages.headerStyle)
            }
        })

        it('should have valid shelter style', () => {
            for (const theme of Object.values(groupThemes)) {
                expect(['classic', 'light']).toContain(theme.messages.shelterStyle)
            }
        })
    })

    describe('getThemeForService', () => {
        it('should return hinatazaka theme for hinatazaka service IDs', () => {
            expect(getThemeForService('hinatazaka46')).toBe(groupThemes.hinatazaka)
            expect(getThemeForService('Hinatazaka46')).toBe(groupThemes.hinatazaka)
            expect(getThemeForService('HINATAZAKA46')).toBe(groupThemes.hinatazaka)
            expect(getThemeForService('hinata')).toBe(groupThemes.hinatazaka)
        })

        it('should return sakurazaka theme for sakurazaka service IDs', () => {
            expect(getThemeForService('sakurazaka46')).toBe(groupThemes.sakurazaka)
            expect(getThemeForService('Sakurazaka46')).toBe(groupThemes.sakurazaka)
            expect(getThemeForService('sakura')).toBe(groupThemes.sakurazaka)
        })

        it('should return nogizaka theme for nogizaka service IDs', () => {
            expect(getThemeForService('nogizaka46')).toBe(groupThemes.nogizaka)
            expect(getThemeForService('Nogizaka46')).toBe(groupThemes.nogizaka)
            expect(getThemeForService('nogi')).toBe(groupThemes.nogizaka)
        })

        it('should return default theme for null service ID', () => {
            expect(getThemeForService(null)).toBe(groupThemes.default)
        })

        it('should return default theme for unknown service IDs', () => {
            expect(getThemeForService('unknown')).toBe(groupThemes.default)
            expect(getThemeForService('akb48')).toBe(groupThemes.default)
            expect(getThemeForService('')).toBe(groupThemes.default)
        })
    })

    describe('getThemeCSSVariables', () => {
        it('should return CSS variable mappings', () => {
            const variables = getThemeCSSVariables(groupThemes.hinatazaka)

            expect(variables).toHaveProperty('--theme-primary')
            expect(variables).toHaveProperty('--theme-secondary')
            expect(variables).toHaveProperty('--theme-accent')
            expect(variables).toHaveProperty('--theme-bg')
            expect(variables).toHaveProperty('--theme-card')
            expect(variables).toHaveProperty('--theme-glass')
            expect(variables).toHaveProperty('--theme-glass-border')
            expect(variables).toHaveProperty('--theme-text-primary')
            expect(variables).toHaveProperty('--theme-text-secondary')
            expect(variables).toHaveProperty('--theme-text-muted')
            expect(variables).toHaveProperty('--theme-hover-glow')
            expect(variables).toHaveProperty('--theme-focus-ring')
            expect(variables).toHaveProperty('--theme-button-gradient')
        })

        it('should map primary color correctly', () => {
            const hinataVars = getThemeCSSVariables(groupThemes.hinatazaka)
            expect(hinataVars['--theme-primary']).toBe(groupThemes.hinatazaka.primaryColor)

            const sakuraVars = getThemeCSSVariables(groupThemes.sakurazaka)
            expect(sakuraVars['--theme-primary']).toBe(groupThemes.sakurazaka.primaryColor)
        })

        it('should map surface colors correctly', () => {
            const vars = getThemeCSSVariables(groupThemes.nogizaka)
            expect(vars['--theme-bg']).toBe(groupThemes.nogizaka.surface.background)
            expect(vars['--theme-card']).toBe(groupThemes.nogizaka.surface.card)
            expect(vars['--theme-glass']).toBe(groupThemes.nogizaka.surface.glass)
        })

        it('should map text colors correctly', () => {
            const vars = getThemeCSSVariables(groupThemes.default)
            expect(vars['--theme-text-primary']).toBe(groupThemes.default.text.primary)
            expect(vars['--theme-text-secondary']).toBe(groupThemes.default.text.secondary)
            expect(vars['--theme-text-muted']).toBe(groupThemes.default.text.muted)
        })
    })

    describe('theme consistency', () => {
        it('should have consistent vibe arrays (non-empty strings)', () => {
            for (const theme of Object.values(groupThemes)) {
                expect(Array.isArray(theme.vibe)).toBe(true)
                expect(theme.vibe.length).toBeGreaterThan(0)
                for (const v of theme.vibe) {
                    expect(typeof v).toBe('string')
                    expect(v.length).toBeGreaterThan(0)
                }
            }
        })

        it('should have valid ambient orb configurations', () => {
            for (const theme of Object.values(groupThemes)) {
                for (const orb of [theme.ambient.orb1, theme.ambient.orb2, theme.ambient.orb3]) {
                    expect(typeof orb.color).toBe('string')
                    expect(typeof orb.position).toBe('string')
                    expect(typeof orb.size).toBe('string')
                    expect(typeof orb.opacity).toBe('number')
                    expect(orb.opacity).toBeGreaterThanOrEqual(0)
                    expect(orb.opacity).toBeLessThanOrEqual(1)
                }
            }
        })
    })
})
