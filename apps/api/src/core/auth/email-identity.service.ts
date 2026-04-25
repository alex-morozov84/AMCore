import { Injectable } from '@nestjs/common'

@Injectable()
export class EmailIdentityService {
  normalizeForStorage(email: string): string {
    return email.trim()
  }

  canonicalize(email: string): string {
    return this.normalizeForStorage(email).toLowerCase()
  }
}
