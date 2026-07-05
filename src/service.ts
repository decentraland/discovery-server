import { Lifecycle } from '@well-known-components/interfaces'
import type { AppComponents, GlobalContext, TestComponents } from './types'
import { setupRouter } from './controllers/routes'

// this function wires the business logic (adapters & controllers) with the components (ports)
export async function main(program: Lifecycle.EntryPointParameters<AppComponents | TestComponents>) {
  const { components, startComponents } = program

  const globalContext: GlobalContext = { components }

  const router = await setupRouter(globalContext)
  components.httpServer.use(router.middleware())
  components.httpServer.use(router.allowedMethods())
  components.httpServer.setContext(globalContext)

  // start ports: db, listeners, synchronizations, etc
  await startComponents()
}
