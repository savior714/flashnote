import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const settingsDialogSource = readFileSync(
  new URL('../src/lib/SettingsDialog.svelte', import.meta.url),
  'utf8',
)

/**
 * The settings sections are the body's only children.
 *
 * `settingsAcceptance` judges the settings surface by counting the direct
 * children of `.settings-body` and reading their section titles, so a footer
 * element inside that container changes the meaning of the count. The build
 * provenance line is presentation for the whole dialog, not a settings section,
 * so it belongs beside the body.
 */
test('the settings body holds exactly the four settings sections', () => {
  const bodyStart = settingsDialogSource.indexOf('<div class="settings-body">')
  assert.ok(bodyStart >= 0, '.settings-body is present in the settings dialog')

  // Everything after the body's closing tag is outside the container.
  const afterBodyStart = settingsDialogSource.indexOf('</section>\n    </div>', bodyStart)
  assert.ok(afterBodyStart >= 0, 'the settings body is closed in the dialog markup')

  const bodyContent = settingsDialogSource.slice(bodyStart, afterBodyStart)

  const sectionCount = bodyContent.match(/<section class="settings-section"/g)?.length ?? 0
  assert.equal(sectionCount, 4, `expected exactly 4 settings sections, got ${sectionCount}`)

  const footerCount = bodyContent.match(/<p class="settings-build"/g)?.length ?? 0
  assert.equal(
    footerCount,
    0,
    'the build-provenance footer must not be a child of .settings-body',
  )

  const dialogContent = settingsDialogSource.slice(bodyStart)
  assert.ok(
    dialogContent.includes('<p class="settings-build"'),
    'the build-provenance footer is still rendered in the dialog',
  )
})

test('the four settings section titles keep their fixed order', () => {
  const titles = [
    ...settingsDialogSource.matchAll(
      /<h3 id="[a-z]+-heading" class="settings-section-title">\{messages\.settingsPage\.(\w+)\}<\/h3>/g,
    ),
  ].map((match) => match[1])

  assert.deepEqual(titles, ['language', 'appearance', 'editor', 'data'])
})
