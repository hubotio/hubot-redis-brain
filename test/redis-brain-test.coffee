chai = require 'chai'
sinon = require 'sinon'
chai.use require 'sinon-chai'

expect = chai.expect

describe 'redis-brain', ->
  it 'exports a function', ->
    expect(require('../src/redis-brain')).to.be.a('Function')
