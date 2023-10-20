'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const Robot = require('hubot/src/robot.js')
describe('e2e', () => {
  it('connects to redis', async () => {
    const robot = new Robot('shell', false, 'hubot')
    await robot.loadAdapter()
    robot.brain.on('loaded', actual => {
      const expected = { users: {}, _private: {} }
      assert.deepEqual(actual, expected)
    })
    robot.brain.on('connected', () => {
      assert.ok(true)
    })
    await robot.loadFile(path.resolve('src/'), 'redis-brain.js')
    await robot.run()
    robot.shutdown()
  })
})
