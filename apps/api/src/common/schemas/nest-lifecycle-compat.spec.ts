import { Controller, Get, Inject, Injectable, Optional } from '@nestjs/common'
import { Test } from '@nestjs/testing'

@Injectable()
class OptionalBase {
  constructor(@Optional() @Inject('missing') readonly value?: string) {}
}

@Injectable()
class InheritedConstructor extends OptionalBase {}

@Injectable()
class RequiredConstructor extends OptionalBase {
  constructor(@Inject('missing') value: string) {
    super(value)
  }
}

@Controller('conflict')
class DuplicateRoutes {
  @Get()
  first() {
    return 'first'
  }

  @Get()
  second() {
    return 'second'
  }
}

describe('Nest12 lifecycle compatibility', () => {
  it('retains optional flags when the subclass inherits its constructor', async () => {
    const module = await Test.createTestingModule({ providers: [InheritedConstructor] }).compile()
    expect(module.get(InheritedConstructor).value).toBeUndefined()
    await module.close()
  })

  it('requires the dependency when the subclass declares a new constructor', async () => {
    await expect(
      Test.createTestingModule({ providers: [RequiredConstructor] }).compile()
    ).rejects.toThrow('missing')
  })

  it('reports duplicate routes when conflict checking is enabled', async () => {
    const module = await Test.createTestingModule({ controllers: [DuplicateRoutes] }).compile()
    const app = module.createNestApplication({
      logger: false,
      routeConflictPolicy: { duplicate: 'error' },
    })
    try {
      await expect(app.init()).rejects.toThrow(/conflict|duplicate/i)
    } finally {
      await app.close()
    }
  })
})
