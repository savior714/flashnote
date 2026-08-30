import { expect, test } from '@playwright/test'

test('folder create and collapse use real Go bindings without a native window', async ({ page }) => {
  const folderName = `Headless folder ${Date.now()}`

  await page.goto('/')

  const createButton = page.getByRole('button', { name: 'Create' })
  await expect(createButton).toBeEnabled()
  await createButton.click()
  await page.getByRole('button', { name: 'New folder' }).click()

  const folderNameInput = page.getByRole('textbox', { name: 'Folder name' })
  await folderNameInput.fill(folderName)
  await folderNameInput.press('Enter')

  const folderButton = page.getByRole('button', { name: folderName, exact: true })
  await expect(folderButton).toBeVisible()
  await expect(folderButton).toHaveAttribute('aria-expanded', 'true')

  await folderButton.locator('.folder-disclosure').click()
  await expect(folderButton).toHaveAttribute('aria-expanded', 'false')

  await folderButton.locator('.folder-disclosure').click()
  await expect(folderButton).toHaveAttribute('aria-expanded', 'true')

  await page.reload()
  await expect(page.getByRole('button', { name: folderName, exact: true })).toBeVisible()
})
