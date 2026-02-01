import { Controller, Get } from '@nestjs/common'

interface HealthResponse {
  status: 'ok' | 'error'
  timestamp: string
  version: string
  uptime: number
}

@Controller('health')
export class HealthController {
  private readonly startTime = Date.now()

  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.0.1',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    }
  }
}
