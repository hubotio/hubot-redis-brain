'use strict'

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Robot, Adapter } from 'hubot'
import Shell from 'hubot/src/adapters/Shell.mjs'
import redisBrain from '../src/RedisBrain.mjs'
import EventEmitter from 'events'
import HubotRedis from '../index.mjs'

class RedisMock extends EventEmitter {
  constructor (delegate) {
    super()
    this.data = {}
    this.hashes = {}
    this.delegate = delegate
    this.isOpen = false
  }

  async connect () {
    this.isOpen = true
    this.emit('connect')
  }

  async get (key) {
    if (this.delegate?.get) return this.delegate.get(key)
    return this.data[key]
  }

  async set (key, value) {
    if (this.delegate?.set) return this.delegate.set(key, value)
    this.data[key] = value
  }

  async hGet (hash, field) {
    if (this.delegate?.hGet) return this.delegate.hGet(hash, field)
    return this.hashes[hash]?.[field]
  }

  async hSet (hash, field, value) {
    if (this.delegate?.hSet) return this.delegate.hSet(hash, field, value)
    if (!this.hashes[hash]) this.hashes[hash] = {}
    this.hashes[hash][field] = value
  }

  async hGetAll (hash) {
    if (this.delegate?.hGetAll) return this.delegate.hGetAll(hash)
    return this.hashes[hash] || {}
  }

  async hDel (hash, field) {
    if (this.delegate?.hDel) return this.delegate.hDel(hash, field)
    if (this.hashes[hash]) {
      delete this.hashes[hash][field]
    }
  }

  async hExists (hash, field) {
    if (this.delegate?.hExists) return this.delegate.hExists(hash, field)
    return this.hashes[hash] && field in this.hashes[hash]
  }

  async hKeys (hash) {
    if (this.delegate?.hKeys) return this.delegate.hKeys(hash)
    return Object.keys(this.hashes[hash] || {})
  }

  multi () {
    const operations = []
    return {
      hSet: (hash, field, value) => {
        operations.push(['hSet', hash, field, value])
        return this
      },
      exec: async () => {
        for (const [op, hash, field, value] of operations) {
          if (op === 'hSet') {
            await this.hSet(hash, field, value)
          }
        }
        return operations.map(() => [null, 'OK'])
      }
    }
  }

  async disconnect () {
    this.isOpen = false
    if (this.delegate?.disconnect) return await this.delegate.disconnect()
    return new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('redis-brain', () => {
  it('exports a function', () => {
    assert.equal(typeof HubotRedis, 'function')
  })

  it('Hostname should never be empty', async () => {
    process.env.REDIS_URL = 'redis://'
    const robot = new Robot('Shell', false, 'hubot')
    await robot.loadAdapter()
    await redisBrain(robot, {
      createClient: (options) => {
        return new RedisMock()
      }
    })
    await robot.run()
    assert.deepEqual(robot.config.redisUrl, process.env.REDIS_URL)
    robot.shutdown()
    delete process.env.REDIS_URL
  })

  it('Connect to redis without setting the REDIS_URL environment variable', async () => {
    delete process.env.REDIS_URL
    const robot = new Robot('Shell', false, 'hubot')
    await robot.loadAdapter()
    redisBrain(robot, {
      createClient: (options) => {
        return new RedisMock()
      }
    })
    await robot.run()
    assert.deepEqual(robot.config.redisUrl, 'redis://localhost:6379')
    robot.shutdown()
  })

  it('Connect vis SSL: Check that the options are set by environment variables', async () => {
    Shell.use = robot => {
      return new Adapter()
    }
    const robot = new Robot('Shell', false, 'hubot')
    await robot.loadAdapter()
    process.env.REDIS_URL = 'rediss://localhost:6379'
    process.env.REDIS_REJECT_UNAUTHORIZED = 'false'
    process.env.REDIS_NO_CHECK = 'true'
    redisBrain(robot, {
      createClient: (options) => {
        assert.deepEqual(options.url, process.env.REDIS_URL)
        assert.deepEqual(options.socket.tls, true)
        assert.deepEqual(options.no_ready_check, true)
        assert.deepEqual(options.socket.rejectUnauthorized, false)
        return new RedisMock()
      }
    })
    await robot.run()
    robot.shutdown()
    delete process.env.REDIS_URL
    delete process.env.REDIS_REJECT_UNAUTHORIZED
    delete process.env.REDIS_NO_CHECK
  })

  it('Setting the prefix with redis://localhost:6379/1?prefix-for-redis-key', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379/1?prefix-for-redis-key'
    const robot = new Robot('Shell', false, 'hubot')
    await robot.loadAdapter()
    const delegate = {
      data: {},
      hashes: {},
      async hGet (hash, field) {
        // Check that we're using the correct prefix for hash keys
        assert.ok(hash.startsWith('prefix-for-redis-key:'))
        robot.shutdown()
        delete process.env.REDIS_URL
        return this.hashes[hash]?.[field]
      }
    }
    redisBrain(robot, {
      createClient: (options) => {
        assert.deepEqual(options.database, 1)
        return new RedisMock(delegate)
      }
    })
    await robot.run()

    // Trigger a read operation to test the prefix
    robot.brain.get('test-key')
  })

  it('Setting the prefix with no database number specified redis://localhost?prefix-for-redis-key', async () => {
    process.env.REDIS_URL = 'redis://localhost?prefix-for-redis-key'
    const robot = new Robot('Shell', false, 'hubot')
    await robot.loadAdapter()
    const delegate = {
      data: {},
      hashes: {},
      async hGet (hash, field) {
        // Check that we're using the correct prefix for hash keys
        assert.ok(hash.startsWith('prefix-for-redis-key:'))
        robot.shutdown()
        delete process.env.REDIS_URL
        return this.hashes[hash]?.[field]
      }
    }
    redisBrain(robot, {
      createClient: (options) => {
        assert.deepEqual(options.database, undefined)
        return new RedisMock(delegate)
      }
    })
    await robot.run()

    // Trigger a read operation to test the prefix
    robot.brain.get('test-key')
  })

  it('Setting the prefix with no database number specified and a trailing slash redis://localhost:6379/?prefix-for-redis-key', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379/?prefix-for-redis-key'
    const robot = new Robot('Shell', false, 'hubot')
    await robot.loadAdapter()
    const delegate = {
      data: {},
      hashes: {},
      async hGet (hash, field) {
        // Check that we're using the correct prefix for hash keys
        assert.ok(hash.startsWith('prefix-for-redis-key:'))
        robot.shutdown()
        delete process.env.REDIS_URL
        return this.hashes[hash]?.[field]
      }
    }
    redisBrain(robot, {
      createClient: (options) => {
        assert.deepEqual(options.database, undefined)
        return new RedisMock(delegate)
      }
    })
    await robot.run()

    // Trigger a read operation to test the prefix
    robot.brain.get('test-key')
  })

  it('Setting the prefix in the query string redis://:password@/var/run/redis.sock?prefix-for-redis-key', async () => {
    process.env.REDIS_URL = 'redis://username:test@/var/run/redis.sock?prefix-for-redis-key'
    const robot = new Robot('Shell', false, 'hubot')
    await robot.loadAdapter()
    const delegate = {
      data: {},
      hashes: {},
      async hGet (hash, field) {
        // Check that we're using the correct prefix for hash keys
        assert.ok(hash.startsWith('prefix-for-redis-key:'))
        robot.shutdown()
        delete process.env.REDIS_URL
        return this.hashes[hash]?.[field]
      }
    }
    redisBrain(robot, {
      createClient: (options) => {
        assert.deepEqual(options.database, undefined)
        return new RedisMock(delegate)
      }
    })
    await robot.run()

    // Trigger a read operation to test the prefix
    robot.brain.get('test-key')
  })

  it('should handle user operations with Redis-only storage', async () => {
    const robot = new Robot('Shell', false, 'hubot')
    await robot.loadAdapter()

    let storedUserData = null
    const delegate = {
      hashes: {},
      async hSet (hash, field, value) {
        if (hash.includes(':users')) {
          storedUserData = { hash, field, value: JSON.parse(value) }
        }
        if (!this.hashes[hash]) this.hashes[hash] = {}
        this.hashes[hash][field] = value
      },
      async hGet (hash, field) {
        return this.hashes[hash]?.[field]
      },
      async hGetAll (hash) {
        return this.hashes[hash] || {}
      }
    }

    redisBrain(robot, {
      createClient: () => new RedisMock(delegate)
    })

    await robot.run()

    // Test user creation
    const user = robot.brain.userForId('123', { name: 'Test User', room: 'test-room' })

    assert.equal(user.id, '123')
    assert.equal(user.name, 'Test User')
    assert.equal(user.room, 'test-room')

    // Wait a bit for async Redis operations to complete
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify user was stored in Redis
    assert.ok(storedUserData)
    assert.ok(storedUserData.hash.includes(':users'))
    assert.equal(storedUserData.field, '123')
    assert.equal(storedUserData.value.id, '123')
    assert.equal(storedUserData.value.name, 'Test User')

    robot.shutdown()
  })

  it('should handle private data storage with Redis hashes', async () => {
    const robot = new Robot('Shell', false, 'hubot')
    await robot.loadAdapter()

    let storedPrivateData = null
    const delegate = {
      hashes: {},
      async hSet (hash, field, value) {
        if (hash.includes(':private')) {
          storedPrivateData = { hash, field, value }
        }
        if (!this.hashes[hash]) this.hashes[hash] = {}
        this.hashes[hash][field] = value
      },
      async hGet (hash, field) {
        return this.hashes[hash]?.[field]
      }
    }

    redisBrain(robot, {
      createClient: () => new RedisMock(delegate)
    })

    await robot.run()

    // Test private data storage
    robot.brain.set('test-key', { data: 'test-value' })

    // Wait a bit for async Redis operations to complete
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify data was stored in Redis
    assert.ok(storedPrivateData)
    assert.ok(storedPrivateData.hash.includes(':private'))
    assert.equal(storedPrivateData.field, 'test-key')

    // Test retrieval (this will be from memory cache initially)
    const retrieved = robot.brain.get('test-key')
    assert.equal(retrieved, null) // Will be null initially until async load completes

    robot.shutdown()
  })
})
