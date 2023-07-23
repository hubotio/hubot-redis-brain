'use strict'

/* global describe, it */
/* eslint-disable no-unused-expressions */
const shell = require('hubot/src/adapters/shell')
const Adapter = require('hubot/src/adapter')
const redisBrain = require('../src/redis-brain.js')
const EventEmitter = require('events')

const chai = require('chai')
const sinon = require('sinon')
const Hubot = require('hubot')

const expect = chai.expect
const Robot = Hubot.Robot

chai.use(require('sinon-chai'))

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

// The mock-adapter-v3 has old dependencies with security issues, so don't use that.
// Instead, we'll use the shell adapter and mock the use() method because the current version of Hubot
// doesn't have a way to specify an adapter via a path.

shell.use = robot => {
  return new Adapter()
}

describe('redis-brain', () => {
  it('exports a function', () => {
    expect(require('../index')).to.be.a('Function')
  })

  it('Hostname should never be empty', () => {
    process.env.REDIS_URL = 'redis://'
    const robot = new Robot(null, 'shell', false, 'hubot')
    sinon.spy(robot.logger, 'info')
    redisBrain(robot, {
      createClient: (options) => {
        return new RedisMock()
      }
    })
    robot.run()
    expect(robot.logger.info).to.have.been.calledWith('hubot-redis-brain: Discovered redis from REDIS_URL environment variable: redis://')
    robot.shutdown()
    sinon.restore()
    delete process.env.REDIS_URL
  })

  it('Connect to redis without setting the REDIS_URL environment variable', () => {
    delete process.env.REDIS_URL
    const robot = new Robot(null, 'shell', false, 'hubot')
    sinon.spy(robot.logger, 'info')
    redisBrain(robot, {
      createClient: (options) => {
        return new RedisMock()
      }
    })
    robot.run()
    expect(robot.logger.info).to.have.been.calledWith('hubot-redis-brain: Using default redis on localhost:6379')
    robot.shutdown()
    sinon.restore()
  })

  it('Connect vis SSL: Check that the options are set by environment variables', () => {
    shell.use = robot => {
      return new Adapter()
    }
    const robot = new Robot(null, 'shell', false, 'hubot')
    process.env.REDIS_URL = 'rediss://localhost:6379'
    process.env.REDIS_REJECT_UNAUTHORIZED = 'false'
    process.env.REDIS_NO_CHECK = 'true'
    redisBrain(robot, {
      createClient: (options) => {
        expect(options.url).to.equal(process.env.REDIS_URL)
        expect(options.socket.tls).to.be.true
        expect(options.no_ready_check).to.be.true
        expect(options.socket.rejectUnauthorized).to.be.false
        return new RedisMock()
      }
    })
    robot.run()
    robot.shutdown()
    delete process.env.REDIS_URL
    delete process.env.REDIS_REJECT_UNAUTHORIZED
    delete process.env.REDIS_NO_CHECK
  })

  it('Setting the prefix with redis://localhost:6379/prefix-for-redis-key', () => {
    process.env.REDIS_URL = 'redis://localhost:6379/prefix-for-redis-key'
    const robot = new Robot(null, 'shell', false, 'hubot')
    const delegate = {
      data: {},
      async get (key) {
        expect(key).to.equal('prefix-for-redis-key:storage')
        robot.shutdown()
        delete process.env.REDIS_URL
        return this.data[key]
      }
    }
    redisBrain(robot, {
      createClient: (options) => {
        return new RedisMock(delegate)
      }
    })
    robot.run()
  })

  it('Setting the prefix in the query string redis://:password@/var/run/redis.sock?prefix-for-redis-key', () => {
    process.env.REDIS_URL = 'redis://username:test@/var/run/redis.sock?prefix-for-redis-key'
    const robot = new Robot(null, 'shell', false, 'hubot')
    const delegate = {
      data: {},
      async get (key) {
        expect(key).to.equal('prefix-for-redis-key:storage')
        robot.shutdown()
        delete process.env.REDIS_URL
        return this.data[key]
      }
    }
    redisBrain(robot, {
      createClient: (options) => {
        return new RedisMock(delegate)
      }
    })
    robot.run()
  })
})
