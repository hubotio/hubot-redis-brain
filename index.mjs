'use strict'

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export default async (robot) => {
  const scriptsPath = path.resolve(__dirname, 'scripts')
  await robot.loadFile(scriptsPath, 'RedisBrain.mjs')
}
