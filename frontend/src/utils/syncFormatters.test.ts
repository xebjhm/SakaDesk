import { describe, it, expect } from 'vitest'
import type { SyncProgress } from '../features/messages/MessagesFeature'
import {
    formatSyncTime,
    formatSyncSpeed,
    getSyncPhaseName,
    getSyncUnitLabel,
} from './syncFormatters'

const mockT = (key: string): string => key

const makeSyncProgress = (overrides: Partial<SyncProgress> = {}): SyncProgress => ({
    state: 'running',
    ...overrides,
})

describe('syncFormatters', () => {
    describe('formatSyncTime', () => {
        it('should return 00:00 for undefined', () => {
            expect(formatSyncTime(undefined)).toBe('00:00')
        })

        it('should return 00:00 for 0', () => {
            expect(formatSyncTime(0)).toBe('00:00')
        })

        it('should return 00:00 for negative values', () => {
            expect(formatSyncTime(-5)).toBe('00:00')
        })

        it('should format seconds under a minute as MM:SS', () => {
            expect(formatSyncTime(45)).toBe('00:45')
        })

        it('should format minutes and seconds as MM:SS', () => {
            expect(formatSyncTime(65)).toBe('01:05')
        })

        it('should format hours as H:MM:SS', () => {
            expect(formatSyncTime(3661)).toBe('1:01:01')
        })

        it('should pad minutes and seconds in H:MM:SS format', () => {
            expect(formatSyncTime(3600)).toBe('1:00:00')
        })
    })

    describe('formatSyncSpeed', () => {
        it('should return empty string for null', () => {
            expect(formatSyncSpeed(null, 'files')).toBe('')
        })

        it('should return empty string for undefined', () => {
            expect(formatSyncSpeed(undefined, 'files')).toBe('')
        })

        it('should return empty string for 0', () => {
            expect(formatSyncSpeed(0, 'files')).toBe('')
        })

        it('should return empty string for negative values', () => {
            expect(formatSyncSpeed(-1, 'files')).toBe('')
        })

        it('should use 2 decimal places when speed < 10', () => {
            expect(formatSyncSpeed(5.678, 'files')).toBe('5.68 files/s')
        })

        it('should use 1 decimal place when speed >= 10', () => {
            expect(formatSyncSpeed(12.345, 'files')).toBe('12.3 files/s')
        })

        it('should use the provided unit string', () => {
            expect(formatSyncSpeed(3.5, 'msgs')).toBe('3.50 msgs/s')
        })
    })

    describe('getSyncPhaseName', () => {
        it('should return localized name for known phases', () => {
            expect(getSyncPhaseName(makeSyncProgress({ phase: 'scanning' }), mockT)).toBe(
                'sync.phaseScanning',
            )
            expect(getSyncPhaseName(makeSyncProgress({ phase: 'discovering' }), mockT)).toBe(
                'sync.phaseDiscovering',
            )
            expect(getSyncPhaseName(makeSyncProgress({ phase: 'syncing' }), mockT)).toBe(
                'sync.phaseSyncing',
            )
            expect(getSyncPhaseName(makeSyncProgress({ phase: 'downloading' }), mockT)).toBe(
                'sync.phaseDownloading',
            )
        })

        it('should fall back to phase_name for unknown phases', () => {
            expect(
                getSyncPhaseName(
                    makeSyncProgress({ phase: 'unknown', phase_name: 'Custom Phase' }),
                    mockT,
                ),
            ).toBe('Custom Phase')
        })

        it('should fall back to sync.starting when no phase or phase_name', () => {
            expect(getSyncPhaseName(makeSyncProgress({}), mockT)).toBe('sync.starting')
        })

        it('should fall back to sync.starting when phase is empty string', () => {
            expect(getSyncPhaseName(makeSyncProgress({ phase: '' }), mockT)).toBe('sync.starting')
        })
    })

    describe('getSyncUnitLabel', () => {
        it('should return sync.members for phase_number 2', () => {
            expect(getSyncUnitLabel(makeSyncProgress({ phase_number: 2 }), mockT)).toBe(
                'sync.members',
            )
        })

        it('should return sync.files for phase_number 3', () => {
            expect(getSyncUnitLabel(makeSyncProgress({ phase_number: 3 }), mockT)).toBe(
                'sync.files',
            )
        })

        it('should return sync.items for phase_number 1', () => {
            expect(getSyncUnitLabel(makeSyncProgress({ phase_number: 1 }), mockT)).toBe(
                'sync.items',
            )
        })

        it('should return sync.items when phase_number is undefined', () => {
            expect(getSyncUnitLabel(makeSyncProgress({}), mockT)).toBe('sync.items')
        })
    })
})
