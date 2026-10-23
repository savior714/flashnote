// Source modules in this package import each other without a file extension.
// Vite resolves those specifiers, but `node --test` — the command the package's
// own `check` script runs — does not, so a source module with a relative import
// cannot be loaded by a test as written.
//
// Importing this module from a test installs a resolver that maps those
// specifiers onto the `.ts` files on disk. The source keeps the package's
// import convention and the test still loads the real module. It is test
// infrastructure only: nothing in the application imports it.

import { registerHooks } from 'node:module'

type ResolverGuard = { __flashnoteNoExtensionResolverInstalled?: boolean }

const guard = globalThis as ResolverGuard

if (!guard.__flashnoteNoExtensionResolverInstalled) {
  guard.__flashnoteNoExtensionResolverInstalled = true
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        specifier.startsWith('.') &&
        !/\.[cm]?[jt]sx?$/.test(specifier) &&
        context.parentURL?.startsWith('file:')
      ) {
        const target = new URL(`${specifier}.ts`, context.parentURL)
        return nextResolve(target.href, context)
      }
      return nextResolve(specifier, context)
    },
  })
}
