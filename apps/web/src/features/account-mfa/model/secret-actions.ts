import 'client-only'

export async function copyMfaSecret(value: string | undefined) {
  if (!value) return false
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

export function downloadMfaCodes(codes: string[]) {
  let url: string | undefined
  const link = document.createElement('a')
  try {
    url = URL.createObjectURL(new Blob([codes.join('\n') + '\n'], { type: 'text/plain' }))
    link.href = url
    link.download = 'amcore-backup-codes.txt'
    document.body.append(link)
    link.click()
    return true
  } catch {
    return false
  } finally {
    link.remove()
    if (url) URL.revokeObjectURL(url)
  }
}
