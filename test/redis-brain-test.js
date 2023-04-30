'use strict'

/* global describe, it */
/* eslint-disable no-unused-expressions */
const Redis = require('redis')
const shell = require('hubot/src/adapters/shell')
const Adapter = require('hubot/src/adapter')

const path = require('path')

const chai = require('chai')
const sinon = require('sinon')
const Hubot = require('hubot')

const expect = chai.expect
const Robot = Hubot.Robot

chai.use(require('sinon-chai'))

describe('redis-brain', () => {
  it('exports a function', () => {
    expect(require('../index')).to.be.a('Function')
  })

  it('connects to redis', () => {
    // The mock-adapter-v3 has old dependencies with security issues, so don't use that.
    // Instead, we'll use the shell adapter and mock the use() method because the current version of Hubot
    // doesn't have a way to specify an adapter via a path.

    shell.use = robot => {
      return new Adapter()
    }

    const robot = new Robot(null, 'shell', false, 'hubot')

    sinon.spy(Redis, 'createClient')
    sinon.spy(robot.logger, 'info')

    robot.loadFile(path.resolve('src/'), 'redis-brain.js')
    robot.run()

    expect(Redis.createClient).to.have.been.calledOnce
    expect(Redis.createClient).to.have.been.calledWith('6379', 'localhost')
    expect(robot.logger.info).to.have.been.calledWith('hubot-redis-brain: Using default redis on localhost:6379')

    robot.shutdown()
  })
})
