'use strict'

/* global describe, it */

const chai = require('chai')
chai.use(require('sinon-chai'))

const { expect } = chai

describe('redis-brain', () =>
  it('exports a function', () => expect(require('../src/redis-brain')).to.be.a('Function'))
)
