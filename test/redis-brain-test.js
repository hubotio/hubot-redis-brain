'use strict'

/* global describe, it */

const chai = require('chai')
const expect = chai.expect

chai.use(require('sinon-chai'))

describe('redis-brain', () => {
  it('exports a function', () => {
    expect(require('../src/redis-brain')).to.be.a('Function')
  })
})
