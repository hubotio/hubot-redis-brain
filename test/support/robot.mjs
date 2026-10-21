'use strict'

import { Robot } from 'hubot'

// A real hubot robot (never run, so no timers), with its logger captured so tests can read what was logged.
export const createRobot = (name = 'hubot') => {
  const robot = new Robot(null, false, name)
  const logs = { error: [], warn: [], info: [], debug: [] }
  robot.logger = {
    error: (m) => logs.error.push(String(m)),
    warn: (m) => logs.warn.push(String(m)),
    info: (m) => logs.info.push(String(m)),
    debug: (m) => logs.debug.push(String(m))
  }
  return { robot, brain: robot.brain, logs }
}

// brain saves are queued, so wait for the writes to land before looking at redis or other instances
export const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

export const waitFor = async (condition, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
