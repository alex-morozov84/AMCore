export function withDeadline<T>(
  work: Promise<T>,
  milliseconds: number,
  signal?: AbortController
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.abort()
      reject(new Error('TIMEOUT'))
    }, milliseconds)
    work.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}
