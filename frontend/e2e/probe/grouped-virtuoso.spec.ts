import { test, expect, type Page } from '@playwright/test'

// Pins how react-virtuoso's GroupedVirtuoso reports ranges and places rows under its
// sticky group header. The D2a chat timeline relies on these facts; a library upgrade
// that changes one fails here first. Probe list: 200 groups x 10 rows (60 px), headers
// 40 px, a 600 px viewport (src/features/messages/timeline/TimelineProbe.tsx).

interface Geometry { headerBottom: number | null; headerText: string | null; rowTop: number | null }

async function open(page: Page, initial?: number) {
  await page.goto(`/?view=timeline-probe${initial === undefined ? '' : `&initial=${initial}`}`)
  await expect(page.locator('[id^="row-"]').first()).toBeVisible({ timeout: 15000 })
}

function geometry(page: Page, rowId: string): Promise<Geometry> {
  return page.evaluate((id) => {
    const scroller = document.querySelector<HTMLElement>('[data-virtuoso-scroller]')!
    const header = scroller.querySelector<HTMLElement>('[data-testid="virtuoso-top-item-list"]')
    const row = document.getElementById(id)
    return {
      headerBottom: header ? header.getBoundingClientRect().bottom : null,
      headerText: header?.textContent ?? null,
      rowTop: row ? row.getBoundingClientRect().top : null,
    }
  }, rowId)
}

/** Distance of the row's top below the sticky header's bottom (null until both exist). */
async function belowHeader(page: Page, rowId: string): Promise<number | null> {
  const g = await geometry(page, rowId)
  return g.rowTop === null || g.headerBottom === null ? null : Math.round(g.rowTop - g.headerBottom)
}

function scrollTo(page: Page, location: Record<string, unknown>) {
  return page.evaluate((loc) => (window as unknown as { __probe: { scrollToIndex: (l: unknown) => void } }).__probe.scrollToIndex(loc), location)
}

function lastRange(page: Page): Promise<{ startIndex: number; endIndex: number }> {
  return page.evaluate(() => {
    const ranges = (window as unknown as { __probe: { ranges: { startIndex: number; endIndex: number }[] } }).__probe.ranges
    return ranges[ranges.length - 1]
  })
}

test.describe('GroupedVirtuoso 4.18 semantics', () => {
  test('1: the sticky group header lives inside the scroller', async ({ page }) => {
    await open(page)
    const g = await geometry(page, 'row-0')
    expect(g.headerBottom).not.toBeNull()
    expect(g.headerText).toBe('Group 0')
  })

  test('2+3: scrollToIndex uses item indices, lands below the header; ranges are item indices', async ({ page }) => {
    await open(page)
    await scrollTo(page, { index: 1005, align: 'start', behavior: 'auto' })
    await expect.poll(() => belowHeader(page, 'row-1005'), { timeout: 3000 }).toBe(0)
    expect((await geometry(page, 'row-1005')).headerText).toBe('Group 100')
    await expect.poll(async () => (await lastRange(page)).startIndex, { timeout: 3000 }).toBeGreaterThanOrEqual(1004)
    const range = await lastRange(page)
    expect(range.startIndex).toBeLessThanOrEqual(1005)
    expect(range.endIndex).toBeGreaterThan(1005)
    expect(range.endIndex).toBeLessThan(2000)
  })

  test('4: scrollToIndex({groupIndex}) lands the group\'s first row below its own header', async ({ page }) => {
    await open(page)
    await scrollTo(page, { groupIndex: 50, align: 'start', behavior: 'auto' })
    await expect.poll(() => belowHeader(page, 'row-500'), { timeout: 3000 }).toBe(0)
    expect((await geometry(page, 'row-500')).headerText).toBe('Group 50')
  })

  test('5: a numeric initialTopMostItemIndex is an item index', async ({ page }) => {
    await open(page, 1005)
    await expect.poll(() => belowHeader(page, 'row-1005'), { timeout: 3000 }).toBe(0)
  })

  test('6: offset shifts the landing by -offset px', async ({ page }) => {
    await open(page)
    await scrollTo(page, { index: 1005, align: 'start', behavior: 'auto', offset: -300 })
    await expect.poll(() => belowHeader(page, 'row-1005'), { timeout: 3000 }).toBe(300)
  })
})
