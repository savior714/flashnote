export async function waitForSaveFlush(
  flushPromise: Promise<boolean>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<boolean> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      flushPromise,
      new Promise<boolean>((resolve) => {
        timeoutHandle = setTimeout(() => {
          onTimeout()
          resolve(false)
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle)
    }
  }
}
