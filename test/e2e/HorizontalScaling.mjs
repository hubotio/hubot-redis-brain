'use strict'

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { Robot } from 'hubot'
import { createClient } from 'redis'

const TEST_PREFIX = 'hubot-e2e-scaling'
const REDIS_URL = `redis://localhost:6379?${TEST_PREFIX}`

const clean = async (client) => {
  await client.del(`${TEST_PREFIX}:users`)
  await client.del(`${TEST_PREFIX}:private`)
  await client.del(`${TEST_PREFIX}:storage`)
}

const startRobot = async () => {
  const robot = new Robot('Shell', false, 'hubot')
  await robot.loadAdapter()
  const connected = new Promise(resolve => robot.brain.once('connected', resolve))
  await robot.loadFile(path.resolve('src/'), 'RedisBrain.mjs')
  await robot.run()
  await connected
  return robot
}

describe('horizontal scaling', () => {
  let redisClient

  before(async () => {
    redisClient = createClient({ url: 'redis://localhost:6379' })
    await redisClient.connect()
  })

  after(async () => {
    await clean(redisClient)
    await redisClient.quit()
  })

  it('two instances writing different keys both survive concurrent saves', async () => {
    await clean(redisClient)
    process.env.REDIS_URL = REDIS_URL

    const robotA = await startRobot()
    const robotB = await startRobot()

    // Each instance independently sets its own key in memory
    robotA.brain.set('key-from-a', 'written-by-instance-a')
    robotB.brain.set('key-from-b', 'written-by-instance-b')

    // Both save concurrently — the race condition the old blob format loses
    robotA.brain.save()
    robotB.brain.save()

    // Wait for async pipeline writes to land
    await new Promise(resolve => setTimeout(resolve, 100))

    const stored = await redisClient.hGetAll(`${TEST_PREFIX}:private`)

    assert.ok('key-from-a' in stored, 'instance A key missing — save was overwritten')
    assert.ok('key-from-b' in stored, 'instance B key missing — save was overwritten')
    assert.deepEqual(JSON.parse(stored['key-from-a']), 'written-by-instance-a')
    assert.deepEqual(JSON.parse(stored['key-from-b']), 'written-by-instance-b')

    robotA.shutdown()
    robotB.shutdown()
    delete process.env.REDIS_URL
  })

  it('migrates legacy single-blob storage to hash format on startup', async () => {
    await clean(redisClient)
    process.env.REDIS_URL = REDIS_URL

    // Seed Redis with the old single-blob format
    const legacyData = {
      users: { U1: { id: 'U1', name: 'Alice' } },
      _private: { 'legacy-key': 'legacy-value' }
    }
    await redisClient.set(`${TEST_PREFIX}:storage`, JSON.stringify(legacyData))

    const robot = await startRobot()

    const legacyBlob = await redisClient.get(`${TEST_PREFIX}:storage`)
    assert.equal(legacyBlob, null, 'legacy blob key should be deleted after migration')

    const users = await redisClient.hGetAll(`${TEST_PREFIX}:users`)
    const privateData = await redisClient.hGetAll(`${TEST_PREFIX}:private`)

    assert.ok('U1' in users, 'user U1 should exist in hash format')
    assert.deepEqual(JSON.parse(users.U1), { id: 'U1', name: 'Alice' })
    assert.ok('legacy-key' in privateData, 'private key should exist in hash format')
    assert.deepEqual(JSON.parse(privateData['legacy-key']), 'legacy-value')

    robot.shutdown()
    delete process.env.REDIS_URL
  })

  it('data written by one instance is visible to a new instance on startup', async () => {
    await clean(redisClient)
    process.env.REDIS_URL = REDIS_URL

    const robot1 = await startRobot()
    robot1.brain.set('shared-key', 'written-by-1')
    robot1.brain.save()
    await new Promise(resolve => setTimeout(resolve, 100))
    robot1.shutdown()

    const robot2 = await startRobot()
    assert.deepEqual(
      robot2.brain.get('shared-key'),
      'written-by-1',
      'instance 2 should load the key written by instance 1'
    )

    robot2.shutdown()
    delete process.env.REDIS_URL
  })
})
