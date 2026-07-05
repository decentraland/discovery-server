// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment

import { createRunner, createLocalFetchComponent } from '@dcl/test-helpers'
import { main } from '../src/service'
import type { TestComponents } from '../src/types'
import { initComponents as originalInitComponents } from '../src/components'

/**
 * Behaves like Jest's "describe": it creates a whole new program and components
 * to run an isolated test. State is persistent within the steps of the test.
 */
export const test = createRunner<TestComponents>({
  main,
  initComponents
})

async function initComponents(): Promise<TestComponents> {
  const components = await originalInitComponents()
  const { config } = components

  return {
    ...components,
    localFetch: await createLocalFetchComponent(config)
  }
}
