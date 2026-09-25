import { AdminController } from './admin.controller'

describe('AdminController', () => {
  it('returns no application data from the Operations Console access probe', () => {
    const controller = new AdminController({} as never, {} as never, {} as never)

    expect(controller.checkAccess()).toBeUndefined()
  })
})
