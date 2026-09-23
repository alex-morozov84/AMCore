try {
  const { renderReport } = await import('./code-size/report.mjs')
  console.log(renderReport(process.cwd()))
} catch (error) {
  console.error(`size report unavailable: ${error.message}`)
}
