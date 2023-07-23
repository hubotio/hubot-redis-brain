'use strict'

/* global describe, it */
/* eslint-disable no-unused-expressions */
const shell = require('hubot/src/adapters/shell')
const Adapter = require('hubot/src/adapter')

const path = require('path')

const chai = require('chai')
const sinon = require('sinon')
const Hubot = require('hubot')

const expect = chai.expect
const Robot = Hubot.Robot

chai.use(require('sinon-chai'))

describe('e2e', () => {
  it('connects to redis', done => {
    shell.use = robot => {
      return new Adapter()
    }

    const robot = new Robot(null, 'shell', false, 'hubot')
    sinon.spy(robot.logger, 'debug')
    robot.brain.on('loaded', actual => {
      const expected = { users: {}, _private: {} }
      expect(actual).to.deep.equal(expected)
    })
    robot.brain.on('connected', () => {
      expect(robot.logger.debug).to.have.been.calledWith('hubot-redis-brain: Successfully connected to Redis')
      robot.shutdown()
      done()
    })
    robot.loadFile(path.resolve('src/'), 'redis-brain.js')
    robot.run()
  })
})
