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
    this.delegate = delegate
  }

  async connect () {
    this.emit('connect')
  }

  async get (key) {
    if (this.delegate?.get) return this.delegate.get(key)
    return this.data[key]
  }

  async set (key, value) {
    if (this.delegate?.set) return this.delegate.set(key)
    this.data[key] = value
  }

  quit () {
    if (this.delegate?.quit) return this.delegate.quit()
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
    redisBrain(robot, {
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
      async get (key) {
        assert.deepEqual(key, 'prefix-for-redis-key:storage')
        robot.shutdown()
        delete process.env.REDIS_URL
        return this.data[key]
      }
    }
    redisBrain(robot, {
      createClient: (options) => {
        assert.deepEqual(options.database, 1)
        return new RedisMock(delegate)
      }
    })
    await robot.run()
  })

  it('Setting the prefix with no database number specified redis://localhost?prefix-for-redis-key', async () => {
    process.env.REDIS_URL = 'redis://localhost?prefix-for-redis-key'
    const robot = new Robot('Shell', false, 'hubot')
    await robot.loadAdapter()
    const delegate = {
      data: {},
      async get (key) {
        assert.deepEqual(key, 'prefix-for-redis-key:storage')
        robot.shutdown()
        delete process.env.REDIS_URL
        return this.data[key]
      }
    }
    redisBrain(robot, {
      createClient: (options) => {
        assert.deepEqual(options.database, undefined)
        return new RedisMock(delegate)
      }
    })
    await robot.run()
  })

  it('Setting the prefix with no database number specified and a trailing slash redis://localhost:6379/?prefix-for-redis-key', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379/?prefix-for-redis-key'
    const robot = new Robot('Shell', false, 'hubot')
    await robot.loadAdapter()
    const delegate = {
      data: {},
      async get (key) {
        assert.deepEqual(key, 'prefix-for-redis-key:storage')
        robot.shutdown()
        delete process.env.REDIS_URL
        return this.data[key]
      }
    }
    redisBrain(robot, {
      createClient: (options) => {
        assert.deepEqual(options.database, undefined)
        return new RedisMock(delegate)
      }
    })
    await robot.run()
  })

  it('Setting the prefix in the query string redis://:password@/var/run/redis.sock?prefix-for-redis-key', async () => {
    process.env.REDIS_URL = 'redis://username:test@/var/run/redis.sock?prefix-for-redis-key'
    const robot = new Robot('Shell', false, 'hubot')
    await robot.loadAdapter()
    const delegate = {
      data: {},
      async get (key) {
        assert.deepEqual(key, 'prefix-for-redis-key:storage')
        robot.shutdown()
        delete process.env.REDIS_URL
        return this.data[key]
      }
    }
    redisBrain(robot, {
      createClient: (options) => {
        assert.deepEqual(options.database, undefined)
        return new RedisMock(delegate)
      }
    })
    await robot.run()
  })
})
