'use strict'

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { Robot } from 'hubot'

describe('e2e', () => {
  it('connects to redis', async () => {
    const robot = new Robot('Shell', false, 'hubot')
    await robot.loadAdapter()
    robot.brain.on('loaded', actual => {
      const expected = { users: {}, _private: {} }
      assert.deepEqual(actual, expected)
    })
    const connected = new Promise(resolve => robot.brain.once('connected', resolve))
    await robot.loadFile(path.resolve('src/'), 'RedisBrain.mjs')
    await robot.run()
    await connected
    robot.shutdown()
  })
})
