/** Start-anchored schedule; unsettled I/O retains the exclusive slot. */
export class StorageProbeSchedule {
  private timer?: NodeJS.Timeout
  private lastStartedAt: number | null = null
  private active = false
  private enabled = false
  private dueAt: number | null = null

  constructor(
    private intervalSeconds: number,
    private readonly launch: () => void
  ) {}
  enable(): void {
    this.enabled = true
  }
  stop(): void {
    this.enabled = false
    this.clear()
  }
  get nextScheduledAt(): string | null {
    return this.dueAt === null ? null : new Date(this.dueAt).toISOString()
  }
  apply(intervalSeconds: number): void {
    if (intervalSeconds === this.intervalSeconds) return
    this.intervalSeconds = intervalSeconds
    if (!this.active && this.lastStartedAt !== null) this.arm()
  }
  started(): void {
    this.clear()
    this.active = true
    this.lastStartedAt = Date.now()
  }
  settled(): void {
    this.active = false
    this.arm()
  }
  private arm(): void {
    this.clear()
    if (!this.enabled || this.active || this.lastStartedAt === null) return
    this.dueAt = Math.max(Date.now(), this.lastStartedAt + this.intervalSeconds * 1000)
    this.timer = setTimeout(
      () => {
        this.clear()
        this.launch()
      },
      Math.max(1, this.dueAt - Date.now())
    )
    this.timer.unref()
  }
  private clear(): void {
    clearTimeout(this.timer)
    this.dueAt = null
  }
}
