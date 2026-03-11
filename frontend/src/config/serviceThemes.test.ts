import { describe, it, expect } from 'vitest'
import {
    serviceThemes,
    getServiceTheme,
    getServiceThemeCSSVariables,
    type GroupId,
} from './serviceThemes'

describe('serviceThemes', () => {
    describe('theme definitions', () => {
        it('should define all group themes', () => {
            expect(Object.keys(serviceThemes)).toEqual(['hinatazaka', 'sakurazaka', 'nogizaka', 'yodel', 'default'])
        })

        it('should have correct id for each theme', () => {
            const groupIds: GroupId[] = ['hinatazaka', 'sakurazaka', 'nogizaka', 'yodel', 'default']
            for (const id of groupIds) {
                expect(serviceThemes[id].id).toBe(id)
            }
        })

        it('should have valid names for each theme', () => {
            expect(serviceThemes.hinatazaka.name).toBe('Hinatazaka46')
            expect(serviceThemes.hinatazaka.nameJp).toBe('日向坂46')
            expect(serviceThemes.sakurazaka.name).toBe('Sakurazaka46')
            expect(serviceThemes.sakurazaka.nameJp).toBe('櫻坂46')
            expect(serviceThemes.nogizaka.name).toBe('Nogizaka46')
            expect(serviceThemes.nogizaka.nameJp).toBe('乃木坂46')
            expect(serviceThemes.default.name).toBe('Default')
        })

        it('should have valid hex color codes for primary colors', () => {
            const hexColorRegex = /^#[0-9A-Fa-f]{6}$/
            for (const theme of Object.values(serviceThemes)) {
                expect(theme.primaryColor).toMatch(hexColorRegex)
                expect(theme.secondaryColor).toMatch(hexColorRegex)
            }
        })

        it('should have all required theme sections', () => {
            for (const theme of Object.values(serviceThemes)) {
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
            for (const theme of Object.values(serviceThemes)) {
                expect(theme.messages.headerGradient).toHaveProperty('from')
                expect(theme.messages.headerGradient).toHaveProperty('via')
                expect(theme.messages.headerGradient).toHaveProperty('to')
            }
        })

        it('should have valid sidebar gradient array', () => {
            for (const theme of Object.values(serviceThemes)) {
                expect(Array.isArray(theme.messages.sidebarGradient)).toBe(true)
                expect(theme.messages.sidebarGradient.length).toBe(3)
            }
        })

        it('should have valid shelter colors structure', () => {
            for (const theme of Object.values(serviceThemes)) {
                expect(theme.messages.shelterColors).toHaveProperty('picture')
                expect(theme.messages.shelterColors).toHaveProperty('video')
                expect(theme.messages.shelterColors).toHaveProperty('voice')
                expect(theme.messages.shelterColors).toHaveProperty('text')
            }
        })

        it('should have valid header style', () => {
            for (const theme of Object.values(serviceThemes)) {
                expect(['gradient', 'light']).toContain(theme.messages.headerStyle)
            }
        })

        it('should have valid shelter style', () => {
            for (const theme of Object.values(serviceThemes)) {
                expect(['classic', 'light']).toContain(theme.messages.shelterStyle)
            }
        })
    })

    describe('getServiceTheme', () => {
        it('should return hinatazaka theme for hinatazaka service IDs', () => {
            expect(getServiceTheme('hinatazaka46')).toBe(serviceThemes.hinatazaka)
            expect(getServiceTheme('Hinatazaka46')).toBe(serviceThemes.hinatazaka)
            expect(getServiceTheme('HINATAZAKA46')).toBe(serviceThemes.hinatazaka)
            expect(getServiceTheme('hinata')).toBe(serviceThemes.hinatazaka)
        })

        it('should return sakurazaka theme for sakurazaka service IDs', () => {
            expect(getServiceTheme('sakurazaka46')).toBe(serviceThemes.sakurazaka)
            expect(getServiceTheme('Sakurazaka46')).toBe(serviceThemes.sakurazaka)
            expect(getServiceTheme('sakura')).toBe(serviceThemes.sakurazaka)
        })

        it('should return nogizaka theme for nogizaka service IDs', () => {
            expect(getServiceTheme('nogizaka46')).toBe(serviceThemes.nogizaka)
            expect(getServiceTheme('Nogizaka46')).toBe(serviceThemes.nogizaka)
            expect(getServiceTheme('nogi')).toBe(serviceThemes.nogizaka)
        })

        it('should return default theme for null service ID', () => {
            expect(getServiceTheme(null)).toBe(serviceThemes.default)
        })

        it('should return default theme for unknown service IDs', () => {
            expect(getServiceTheme('unknown')).toBe(serviceThemes.default)
            expect(getServiceTheme('akb48')).toBe(serviceThemes.default)
            expect(getServiceTheme('')).toBe(serviceThemes.default)
        })
    })

    describe('getServiceThemeCSSVariables', () => {
        it('should return CSS variable mappings', () => {
            const variables = getServiceThemeCSSVariables(serviceThemes.hinatazaka)

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
            const hinataVars = getServiceThemeCSSVariables(serviceThemes.hinatazaka)
            expect(hinataVars['--theme-primary']).toBe(serviceThemes.hinatazaka.primaryColor)

            const sakuraVars = getServiceThemeCSSVariables(serviceThemes.sakurazaka)
            expect(sakuraVars['--theme-primary']).toBe(serviceThemes.sakurazaka.primaryColor)
        })

        it('should map surface colors correctly', () => {
            const vars = getServiceThemeCSSVariables(serviceThemes.nogizaka)
            expect(vars['--theme-bg']).toBe(serviceThemes.nogizaka.surface.background)
            expect(vars['--theme-card']).toBe(serviceThemes.nogizaka.surface.card)
            expect(vars['--theme-glass']).toBe(serviceThemes.nogizaka.surface.glass)
        })

        it('should map text colors correctly', () => {
            const vars = getServiceThemeCSSVariables(serviceThemes.default)
            expect(vars['--theme-text-primary']).toBe(serviceThemes.default.text.primary)
            expect(vars['--theme-text-secondary']).toBe(serviceThemes.default.text.secondary)
            expect(vars['--theme-text-muted']).toBe(serviceThemes.default.text.muted)
        })
    })

    describe('theme consistency', () => {
        it('should have consistent vibe arrays (non-empty strings)', () => {
            for (const theme of Object.values(serviceThemes)) {
                expect(Array.isArray(theme.vibe)).toBe(true)
                expect(theme.vibe.length).toBeGreaterThan(0)
                for (const v of theme.vibe) {
                    expect(typeof v).toBe('string')
                    expect(v.length).toBeGreaterThan(0)
                }
            }
        })

        it('should have valid ambient orb configurations', () => {
            for (const theme of Object.values(serviceThemes)) {
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
