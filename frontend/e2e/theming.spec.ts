import { test, expect } from '@playwright/test'
import { buildBigRoom, pinBigRoom, COUNT, TZ, type FixtureMessage } from './fixtures/bigRoom'

// CSS contracts that need real layout (UI health plan H).

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

test.describe('theming', () => {
  let messages: { current: FixtureMessage[] }

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    messages = { current: buildBigRoom() }
  })

  test('an unbreakable run wraps inside its bubble instead of being cut off', async ({ page }) => {
    const last = messages.current[messages.current.length - 1]
    messages.current[messages.current.length - 1] = { ...last, content: `w${'w'.repeat(300)}〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜！！！！！！！！！！！！！！！` }
    await pinBigRoom(page, { messages })
    await page.goto('/')
    await page.getByText('Big Room', { exact: true }).click()
    const text = page.locator(`#msg-${COUNT} [lang="ja"].whitespace-pre-wrap`)
    await expect(text).toBeVisible({ timeout: 10000 })
    const fits = await text.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
    expect(fits).toBe(true)
  })

  test('in forced colours a switch shows on and off, and the selected group is outlined', async ({ page }) => {
    await page.route((url) => url.pathname === '/api/settings', (route) => route.fulfill({ json: {
      output_dir: '/fixture/out', auto_sync_enabled: true, sync_interval_minutes: 15, is_configured: true,
      incoming_call_enabled: true, notifications_enabled: false,
    } }))
    await pinBigRoom(page, { messages })
    await page.emulateMedia({ forcedColors: 'active' })
    await page.goto('/')
    await expect(page.getByText('Big Room', { exact: true })).toBeVisible({ timeout: 10000 })

    const group = page.locator('nav [aria-current="page"]').first()
    expect(await group.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')

    await page.getByTitle('Settings', { exact: true }).click()
    await page.getByText('Settings', { exact: true }).last().click()
    const on = page.locator('[role="switch"][aria-checked="true"]').first()
    const off = page.locator('[role="switch"][aria-checked="false"]').first()
    await expect(on).toBeVisible()
    // Outlines exist only under the forced-colours rules (normal mode draws none), and on/off differ.
    const edge = (l: typeof on) => l.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { style: cs.outlineStyle, colour: cs.outlineColor, offset: cs.outlineOffset }
    })
    const onEdge = await edge(on)
    const offEdge = await edge(off)
    expect(onEdge.style).toBe('solid')
    expect(offEdge.style).toBe('solid')
    expect(onEdge.offset).toBe('-1px')
    expect(onEdge.colour).not.toBe(offEdge.colour)
    // The thumb stays centred: no border shrinks the padding box (5 px top and bottom of a 24 px track).
    expect(await off.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px')
  })

  test('in forced colours every selected state and surface edge is outlined, but not the dark viewer', async ({ page }) => {
    await pinBigRoom(page, { messages })
    await page.emulateMedia({ forcedColors: 'active' })
    await page.goto('/')
    await expect(page.getByText('Big Room', { exact: true })).toBeVisible({ timeout: 10000 })
    const probe = await page.evaluate(() => {
      const host = document.createElement('div')
      host.innerHTML = `
        <button id="p-pressed" aria-pressed="true">x</button>
        <button id="p-unpressed" aria-pressed="false">x</button>
        <div id="p-tab" role="tab" aria-selected="true">x</div>
        <ol><li id="p-step" aria-current="step">x</li><li id="p-nostep" aria-current="false">x</li></ol>
        <div id="p-radio" role="menuitemradio" aria-checked="true">x</div>
        <div id="p-dialog" role="dialog">x</div>
        <div data-surface="dark"><div id="p-dark-dialog" role="dialog">x</div></div>`
      document.body.appendChild(host)
      const read = (id: string) => {
        const cs = getComputedStyle(host.querySelector(`#${id}`) as Element)
        return `${cs.outlineStyle} ${cs.outlineWidth}`
      }
      const out = Object.fromEntries(
        ['p-pressed', 'p-unpressed', 'p-tab', 'p-step', 'p-nostep', 'p-radio', 'p-dialog', 'p-dark-dialog'].map((id) => [id, read(id)]),
      )
      host.remove()
      return out
    })
    expect(probe['p-pressed']).toBe('solid 2px')
    expect(probe['p-tab']).toBe('solid 2px')
    expect(probe['p-step']).toBe('solid 2px')
    expect(probe['p-radio']).toBe('solid 2px')
    expect(probe['p-dialog']).toBe('solid 1px')
    expect(probe['p-unpressed']).not.toMatch(/^solid/)
    expect(probe['p-nostep']).not.toMatch(/^solid/)
    expect(probe['p-dark-dialog']).not.toMatch(/^solid/)
  })

  test('in forced colours selected, focused and selected+focused items draw three distinct rings', async ({ page }) => {
    await pinBigRoom(page, { messages })
    await page.emulateMedia({ forcedColors: 'active' })
    await page.goto('/')
    await expect(page.getByText('Big Room', { exact: true })).toBeVisible({ timeout: 10000 })
    // Same classes as the app's pills: Tailwind's focus utility, plus a selection attribute.
    await page.evaluate(() => {
      const host = document.createElement('div')
      host.innerHTML = `
        <button id="r-sel" aria-pressed="true" class="focus-visible:outline-none">x</button>
        <button id="r-focus" aria-pressed="false" class="focus-visible:outline-none">x</button>
        <button id="r-both" aria-pressed="true" class="focus-visible:outline-none">x</button>`
      document.body.appendChild(host)
    })
    const ring = (id: string) => page.locator(`#${id}`).evaluate((el) => {
      const cs = getComputedStyle(el)
      return `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineOffset}`
    })
    const selected = await ring('r-sel')
    await page.keyboard.press('Tab') // keyboard modality, so .focus() matches :focus-visible
    await page.locator('#r-focus').focus()
    const focused = await ring('r-focus')
    await page.locator('#r-both').focus()
    const both = await ring('r-both')
    expect(selected).toBe('solid 2px -2px')
    expect(focused).toBe('solid 2px 2px')
    expect(both).toBe('double 4px 2px')
  })
})
