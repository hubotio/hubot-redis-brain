'use strict'

/* global describe, it */
/* eslint-disable no-unused-expressions */

const path = require('path')

const chai = require('chai')
const sinon = require('sinon')
const Hubot = require('hubot')
const proxyquire = require('proxyquire').noCallThru()

const expect = chai.expect
const RedisClientMock = {
  get: function () {},
  set: function () {},
  on: function () {},
  auth: function () {},
  quit: function () {}
}
const RedisMock = {
  createClient: () => RedisClientMock
}
proxyquire('../src/redis-brain', {
  redis: RedisMock
})

const Robot = Hubot.Robot

chai.use(require('sinon-chai'))

describe('redis-brain', () => {
  it('exports a function', () => {
    expect(require('../index')).to.be.a('Function')
  })

  it('connects to redis', () => {
    const robot = new Robot(null, 'mock-adapter-v3', false, 'hubot')

    sinon.spy(RedisMock, 'createClient')
    sinon.spy(robot.logger, 'info')

    robot.loadFile(path.resolve('src/'), 'redis-brain.js')
    robot.run()

    expect(RedisMock.createClient).to.have.been.calledOnce
    expect(RedisMock.createClient).to.have.been.calledWith('6379', 'localhost')
    expect(robot.logger.info).to.have.been.calledWith('hubot-redis-brain: Using default redis on localhost:6379')

    robot.shutdown()
  })
})
