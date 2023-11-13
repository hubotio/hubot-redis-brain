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
    robot.brain.on('connected', () => {
      assert.ok(true)
    })
    await robot.loadFile(path.resolve('src/'), 'RedisBrain.mjs')
    await robot.run()
    robot.shutdown()
  })
})
