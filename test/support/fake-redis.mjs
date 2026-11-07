'use strict'

import { EventEmitter } from 'node:events'

// An in-memory stand-in for the slice of redis the brain uses. Every client made by one server shares its
// data and pub/sub, so two "hubot instances" can talk to each other like they would through a real redis.
export const createFakeServer = () => {
  const hashes = new Map()
  const values = new Map()
  const channels = new Map()
  const commands = []
  const clients = []

  const hash = (key) => {
    let existing = hashes.get(key)
    if (!existing) {
      existing = new Map()
      hashes.set(key, existing)
    }
    return existing
  }

  const makeClient = (options) => {
    const run = {
      hSet: async (key, fields) => {
        commands.push({ command: 'hSet', key, fields: Object.keys(fields) })
        for (const [field, value] of Object.entries(fields)) {
          hash(key).set(field, value)
        }
      },
      hDel: async (key, fields) => {
        commands.push({ command: 'hDel', key, fields })
        for (const field of fields) {
          hash(key).delete(field)
        }
      },
      publish: async (channel, message) => {
        for (const listener of channels.get(channel) ?? []) {
          queueMicrotask(() => listener(message))
        }
      }
    }
    const quit = Object.assign(async () => {
      quit.calls += 1
    }, { calls: 0 })
    const client = Object.assign(new EventEmitter(), run, {
      options,
      connect: async () => {
        client.emit('ready')
      },
      quit,
      duplicate: () => makeClient(options),
      subscribe: async (channel, listener) => {
        channels.set(channel, (channels.get(channel) ?? new Set()).add(listener))
      },
      hGetAll: async (key) => Object.fromEntries(hash(key)),
      hmGet: async (key, fields) => fields.map((field) => hash(key).get(field) ?? null),
      get: async (key) => values.get(key) ?? null,
      set: async (key, value, { condition } = {}) => {
        if (condition === 'NX' && values.has(key)) {
          return null
        }
        values.set(key, value)
        return 'OK'
      },
      multi: () => {
        const queued = []
        const chain = {
          hSet: (...args) => {
            queued.push(() => run.hSet(...args))
            return chain
          },
          hDel: (...args) => {
            queued.push(() => run.hDel(...args))
            return chain
          },
          publish: (...args) => {
            queued.push(() => run.publish(...args))
            return chain
          },
          exec: async () => {
            for (const op of queued) {
              await op()
            }
          }
        }
        return chain
      }
    })
    clients.push(client)
    return client
  }

  return {
    makeClient,
    clients,
    commands,
    // the module is handed this in place of the `redis` package
    redis: { createClient: makeClient },
    hash: (key) => Object.fromEntries(hash(key)),
    seed: (key, fields) => {
      for (const [field, value] of Object.entries(fields)) {
        hash(key).set(field, JSON.stringify(value))
      }
    },
    // what versions before the segmented brain stored: the whole brain as one JSON string
    seedLegacy: (key, data) => values.set(key, JSON.stringify(data)),
    value: (key) => values.get(key)
  }
}
