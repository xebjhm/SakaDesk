import { describe, it, expect } from 'vitest'
import {
    serviceThemes,
    getServiceTheme,
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

        it('keeps only the fields the app still reads', () => {
            for (const theme of Object.values(serviceThemes)) {
                expect(Object.keys(theme).sort()).toEqual(['accentColor', 'id', 'messages', 'name', 'nameJp', 'primaryColor', 'secondaryColor'])
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
})
