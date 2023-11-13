'use strict'

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export default (robot) => {
  const scriptsPath = path.resolve(__dirname, 'src')
  robot.loadFile(scriptsPath, 'RedisBrain.mjs')
}
