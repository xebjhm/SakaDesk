import { test, expect, type Page } from '@playwright/test'
import { buildBigRoom, isRowInViewport, pinBigRoom, COUNT, TZ, type FixtureMessage } from './fixtures/bigRoom'

// Locks the chat dialogs and menus before D2c restyles them (open, close and the key flows).
// They must pass on the code before D2c and after every D2c task. Menu items are found by
// their text and dialogs by role + name (or heading) so the same selectors hold before and after.

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

async function openBigRoom(page: Page) {
  await page.goto('/')
  await page.getByText('Big Room', { exact: true }).click()
  await expect(page.locator(`#msg-${COUNT}`)).toBeVisible({ timeout: 10000 })
}

async function openChatMenuItem(page: Page, text: string) {
  await page.getByTitle('More options').click()
  await page.getByText(text, { exact: true }).click()
}

test.describe('chat dialogs', () => {
  let messages: { current: FixtureMessage[] }

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    messages = { current: buildBigRoom() }
    await pinBigRoom(page, { messages })
  })

  test('date search opens from the chat menu and Escape closes it', async ({ page }) => {
    await openBigRoom(page)
    await openChatMenuItem(page, 'Date Search')
    const dialog = page.getByRole('dialog', { name: 'Date Search' })
    await expect(dialog.getByRole('button', { name: 'Previous month' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  test('a gallery photo opens the viewer, Escape closes only the viewer, the time jumps to the message', async ({ page }) => {
    await openBigRoom(page)
    await openChatMenuItem(page, 'Media')
    const gallery = page.getByRole('dialog', { name: 'Media' })
    const thumbs = gallery.locator('button:has(img)')
    await expect(thumbs).toHaveCount(3)

    await thumbs.first().click()
    await expect(page.getByTitle('Jump to message')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTitle('Jump to message')).toHaveCount(0)
    await expect(gallery).toBeVisible()

    // Newest first: the first thumbnail is message 4990.
    await thumbs.first().click()
    await page.getByTitle('Jump to message').click()
    await expect(gallery).toHaveCount(0)
    await expect.poll(() => isRowInViewport(page, 4990)).toBe(true)
  })

  test('a message favourited from its context menu shows in Favorites', async ({ page }) => {
    await page.route('**/api/favorites/**', (route) => route.fulfill({ json: { success: true } }))
    await openBigRoom(page)
    await page.locator(`#msg-${COUNT}`).getByText(`Message ${COUNT}`).click({ button: 'right' })
    await page.getByText('Add to favorites', { exact: true }).click()
    await openChatMenuItem(page, 'Favorites')
    const dialog = page.getByRole('dialog', { name: 'Favorites' })
    await expect(dialog.getByText(`Message ${COUNT}`, { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  test('a background preset colours the chat and Done closes the dialog', async ({ page }) => {
    await openBigRoom(page)
    await openChatMenuItem(page, 'Background')
    const dialog = page.getByRole('dialog', { name: 'Background' })
    await dialog.getByTitle('#FEE2E2').click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toHaveCount(0)
    // The chat's background layer (the -z-10 div behind the timeline) takes the preset.
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('div.-z-10')].some(
            (d) => d.style.backgroundColor === 'rgb(254, 226, 226)',
          ),
        ),
      )
      .toBe(true)
  })

  test('the member avatar opens the profile card and Escape closes it', async ({ page }) => {
    await openBigRoom(page)
    await page.locator(`#msg-${COUNT}`).getByRole('button', { name: 'Big Room' }).first().click()
    const card = page.getByRole('dialog', { name: 'Big Room' })
    await expect(card.getByText('128', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(card).toHaveCount(0)
  })

  test('the sent letters dialog opens from the chat menu', async ({ page }) => {
    await openBigRoom(page)
    await openChatMenuItem(page, 'Sent Letters')
    const dialog = page.getByRole('dialog', { name: 'Sent Letters' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })
})

test.describe('reveal all', () => {
  test('a long press on an unread message asks to reveal all; Confirm reveals them', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    await pinBigRoom(page, { messages: { current: buildBigRoom() }, lastReadId: COUNT - 3 })
    await openBigRoom(page)
    const shelter = page.locator(`#msg-${COUNT}`).getByTestId('unread-shelter')
    const box = (await shelter.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    // The long press (600 ms) opens the confirm while the button is held.
    await expect(page.getByRole('heading', { name: 'Reveal All Messages?' })).toBeVisible()
    await page.mouse.up()
    await page.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Reveal All Messages?' })).toHaveCount(0)
    await expect(page.getByTestId('unread-shelter')).toHaveCount(0)
  })
})
