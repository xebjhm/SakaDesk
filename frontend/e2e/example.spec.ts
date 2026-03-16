import { test, expect } from '@playwright/test'

test.describe('ZakaDesk E2E Tests (Test Mode)', () => {
  test('should show authenticated state in test mode', async ({ page }) => {
    await page.goto('/')

    // In test mode, should skip login and show main app
    // Wait for sidebar to load
    await expect(page.locator('text=Test Member')).toBeVisible({ timeout: 10000 })
  })

  test('should display sidebar with test groups', async ({ page }) => {
    await page.goto('/')

    // Should show test member in sidebar
    await expect(page.getByText('Test Member')).toBeVisible()
    await expect(page.getByText('Test Group Chat')).toBeVisible()
  })

  test('should load messages when clicking a conversation', async ({ page }) => {
    await page.goto('/')

    // Click on test member
    await page.getByText('Test Member').click()

    // Should show test messages
    await expect(page.getByText('Hello! This is a test message.')).toBeVisible()
  })

  test('should render message with link as clickable', async ({ page }) => {
    await page.goto('/')

    await page.getByText('Test Member').click()

    // Find the link in the message
    const link = page.getByRole('link', { name: 'https://example.com' })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', 'https://example.com')
  })

  test('should show unread count badge', async ({ page }) => {
    await page.goto('/')

    await page.getByText('Test Member').click()

    // Should show unread count in header
    await expect(page.getByText(/\d+ unread/)).toBeVisible()
  })
})
