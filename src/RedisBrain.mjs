'use strict'

// Description:
//   Persist hubot's brain to redis using granular storage
//
// Configuration:
//   REDISTOGO_URL or REDISCLOUD_URL or BOXEN_REDIS_URL or REDIS_URL.
//     URL format: redis://<host>:<port>[/<brain_prefix>]
//     URL format (UNIX socket): redis://<socketpath>[?<brain_prefix>]
//     If not provided, '<brain_prefix>' will default to 'hubot'.
//   REDIS_NO_CHECK - set this to avoid ready check (for example when using Twemproxy)
//
// Commands:
//   None

import { URL } from 'url'
import Redis from 'redis'
import { EventEmitter } from 'events'
import { Brain } from 'hubot'

class RedisBrain extends Brain {
  constructor (robot, redis = Redis) {
    super(robot)

    this.robot = robot
    this.prefix = this._getPrefix()
    this.client = this._createRedisClient(redis)
    this._connected = false

    // Minimal in-memory data structure - no caching
    this.data = { users: {}, _private: {} }
    this.autoSave = false // We save directly to Redis

    this._setupEventHandlers()
    robot.on('running', () => {
      console.log('bot is running, clearing save interval if any')
      clearInterval(this.saveInterval)
      this.saveInterval = null
    })
  }

  _getPrefix () {
    const redisUrlEnv = this._getRedisEnv()
    const redisUrl = process.env[redisUrlEnv] || 'redis://localhost:6379'

    let info = null
    try {
      info = new URL(redisUrl)
    } catch (err) {
      if (err.code === 'ERR_INVALID_URL') {
        const urlPath = redisUrl.replace(/rediss?:\/{2}:?(.*@)?/, '')
        info = new URL(`redis://${urlPath}`)
      }
    }

    return info.search?.replace('?', '') || 'hubot'
  }

  _createRedisClient (redis) {
    const redisUrlEnv = this._getRedisEnv()
    const redisUrl = process.env[redisUrlEnv] || 'redis://localhost:6379'
    this.robot.config = Object.assign(this.robot.config || {}, { redisUrl })

    if (redisUrlEnv) {
      // Sanitize password in URL for logging
      const sanitizedUrl = (() => {
        try {
          const urlObj = new URL(redisUrl)
          if (urlObj.password) {
            urlObj.password = '*****'
          }
          return urlObj.toString()
        } catch {
          return redisUrl
        }
      })()
      this.robot.logger.info(`hubot-redis-brain: Discovered redis from ${redisUrlEnv} environment variable: ${sanitizedUrl}`)
    } else {
      this.robot.logger.info('hubot-redis-brain: Using default redis on localhost:6379')
    }

    if (process.env.REDIS_NO_CHECK) {
      this.robot.logger.info('Turning off redis ready checks')
    }

    let info = null
    let database = null
    try {
      info = new URL(redisUrl)
      database = Number((info.pathname ? info.pathname.replace('/', '') : undefined) || 0)
    } catch (err) {
      if (err.code === 'ERR_INVALID_URL') {
        const urlPath = redisUrl.replace(/rediss?:\/{2}:?(.*@)?/, '')
        info = new URL(`redis://${urlPath}`)
      }
    }

    let redisOptions = { url: redisUrl }
    if (database) {
      redisOptions = Object.assign(redisOptions || {}, { database })
    }

    let redisSocket = null
    if (info.protocol === 'rediss:') {
      redisSocket = { tls: true }
    }
    if (process.env.REDIS_REJECT_UNAUTHORIZED) {
      redisSocket.rejectUnauthorized = process.env.REDIS_REJECT_UNAUTHORIZED === 'true'
    }
    if (info.auth || process.env.REDIS_NO_CHECK) {
      redisOptions = Object.assign(redisOptions || {}, { no_ready_check: true })
    }
    if (redisSocket) {
      redisOptions = Object.assign(redisOptions || {}, { socket: redisSocket })
    }

    const client = redis.createClient(redisOptions)

    client.on('error', (err) => {
      if (!/ECONNREFUSED/.test(err.message)) {
        this.robot.logger.error(err.stack)
      }
    })

    client.on('connect', () => {
      this.robot.logger.debug('hubot-redis-brain: Successfully connected to Redis')
      this._connected = true
      this.emit('connected')
    })

    if (info.auth) {
      client.auth(info.auth.split(':')[1], (err) => {
        if (err) {
          return this.robot.logger.error('hubot-redis-brain: Failed to authenticate to Redis')
        }
        this.robot.logger.info('hubot-redis-brain: Successfully authenticated to Redis')
      })
    }

    return client
  }

  _setupEventHandlers () {
    this.on('close', async () => {})
  }

  getRobot () {
    return this.robot
  }

  // Direct Redis operations - no memory caching

  get (key) {
    if (!this._connected || !key) return null

    // For brain compatibility, we need to return synchronously
    // This is a limitation of the Brain API - we'll return null and load async
    this.client.hGet(`${this.prefix}:private`, key).then(value => {
      if (value) {
        try {
          const parsed = JSON.parse(value)
          // Store in memory for future sync access
          if (!this.data._private) this.data._private = {}
          this.data._private[key] = parsed
        } catch (err) {
          this.robot.logger.error(`hubot-redis-brain: Error parsing key ${key}: ${err}`)
        }
      }
    }).catch(err => {
      this.robot.logger.error(`hubot-redis-brain: Error getting key ${key}: ${err}`)
    })

    // Return from memory cache if available
    return this.data._private[key] || null
  }

  set (key, value) {
    if (!key) return this

    let pair
    if (key === Object(key)) {
      pair = key
    } else {
      pair = {}
      pair[key] = value
    }

    // Save directly to Redis
    if (this._connected) {
      const pipeline = this.client.multi()
      Object.keys(pair).forEach((k) => {
        pipeline.hSet(`${this.prefix}:private`, k, JSON.stringify(pair[k]))
      })
      pipeline.exec().catch(err => {
        this.robot.logger.error(`hubot-redis-brain: Error setting keys: ${err}`)
      })
    }

    this.emit('loaded', pair) // Emit just what was set
    return this
  }

  remove (key) {
    if (!key || !this._connected) return this

    this.client.hDel(`${this.prefix}:private`, key).catch(err => {
      this.robot.logger.error(`hubot-redis-brain: Error removing key ${key}: ${err}`)
    })

    return this
  }

  // User operations - direct to Redis

  userForId (id, options = {}) {
    if (!id) return null

    const User = this.robot.constructor.User || class User extends EventEmitter {
      constructor (id, options = {}) {
        super()
        this.id = id
        Object.assign(this, options)
      }
    }

    // Check memory first
    let user = this.data.users[id]

    if (!user) {
      // Create new user and load from Redis async
      user = new User(id, options)
      this.data.users[id] = user

      // Try to load from Redis asynchronously to update the user
      if (this._connected) {
        this.client.hGet(`${this.prefix}:users`, id).then(userData => {
          if (userData) {
            const parsed = JSON.parse(userData)
            Object.assign(user, parsed)
            // Update if room changed
            if (options.room && user.room !== options.room) {
              user.room = options.room
              this.client.hSet(`${this.prefix}:users`, id, JSON.stringify(user)).catch(err => {
                this.robot.logger.error(`hubot-redis-brain: Error updating user ${id}: ${err}`)
              })
            }
          } else {
            // Save new user to Redis
            this.client.hSet(`${this.prefix}:users`, id, JSON.stringify(user)).catch(err => {
              this.robot.logger.error(`hubot-redis-brain: Error saving new user ${id}: ${err}`)
            })
          }
        }).catch(err => {
          this.robot.logger.error(`hubot-redis-brain: Error loading user ${id}: ${err}`)
          // Save new user to Redis as fallback
          this.client.hSet(`${this.prefix}:users`, id, JSON.stringify(user)).catch(saveErr => {
            this.robot.logger.error(`hubot-redis-brain: Error saving fallback user ${id}: ${saveErr}`)
          })
        })
      }
    } else if (options.room && user.room !== options.room) {
      // Update existing user's room
      user.room = options.room
      if (this._connected) {
        this.client.hSet(`${this.prefix}:users`, id, JSON.stringify(user)).catch(err => {
          this.robot.logger.error(`hubot-redis-brain: Error updating user room ${id}: ${err}`)
        })
      }
    }

    return user
  }

  userForName (name) {
    if (!name) return null

    const lowerName = name.toLowerCase()

    // Check memory first
    for (const userId in this.data.users) {
      const user = this.data.users[userId]
      if (user.name && user.name.toString().toLowerCase() === lowerName) {
        return user
      }
    }

    // Load from Redis in background for future requests
    if (this._connected) {
      this.client.hGetAll(`${this.prefix}:users`).then(users => {
        for (const [id, userData] of Object.entries(users)) {
          if (!this.data.users[id]) {
            try {
              const User = this.robot.constructor.User || class User extends EventEmitter {
                constructor (id, options = {}) {
                  super()
                  this.id = id
                  Object.assign(this, options)
                }
              }
              this.data.users[id] = new User(id, JSON.parse(userData))
            } catch (err) {
              this.robot.logger.error(`hubot-redis-brain: Error parsing user ${id}: ${err}`)
            }
          }
        }
      }).catch(err => {
        this.robot.logger.error(`hubot-redis-brain: Error loading users for name search: ${err}`)
      })
    }

    return null
  }

  usersForRawFuzzyName (fuzzyName) {
    if (!fuzzyName) return []

    const lowerFuzzyName = fuzzyName.toLowerCase()
    const results = []

    // Search in memory
    for (const userId in this.data.users) {
      const user = this.data.users[userId]
      if (user.name && user.name.toLowerCase().lastIndexOf(lowerFuzzyName, 0) === 0) {
        results.push(user)
      }
    }

    // Load from Redis in background for future requests
    if (this._connected) {
      this.client.hGetAll(`${this.prefix}:users`).then(users => {
        for (const [id, userData] of Object.entries(users)) {
          if (!this.data.users[id]) {
            try {
              const User = this.robot.constructor.User || class User extends EventEmitter {
                constructor (id, options = {}) {
                  super()
                  this.id = id
                  Object.assign(this, options)
                }
              }
              this.data.users[id] = new User(id, JSON.parse(userData))
            } catch (err) {
              this.robot.logger.error(`hubot-redis-brain: Error parsing user ${id}: ${err}`)
            }
          }
        }
      }).catch(err => {
        this.robot.logger.error(`hubot-redis-brain: Error loading users for fuzzy search: ${err}`)
      })
    }

    return results
  }

  usersForFuzzyName (fuzzyName) {
    const matchedUsers = this.usersForRawFuzzyName(fuzzyName)
    const lowerFuzzyName = fuzzyName.toLowerCase()
    const exactMatches = matchedUsers.filter(user =>
      user.name && user.name.toLowerCase() === lowerFuzzyName
    )

    return exactMatches.length > 0 ? exactMatches : matchedUsers
  }

  // Return users object for synchronous access
  users () {
    return this.data.users
  }

  // Batch operations for Slack adapter efficiency
  async loadAllUsers () {
    if (!this._connected) return {}

    const User = this.robot.constructor.User || class User extends EventEmitter {
      constructor (id, options = {}) {
        super()
        this.id = id
        Object.assign(this, options)
      }
    }

    try {
      const users = await this.client.hGetAll(`${this.prefix}:users`)
      const userObjects = {}

      for (const [id, userData] of Object.entries(users)) {
        userObjects[id] = new User(id, JSON.parse(userData))
      }

      this.robot.logger.info(`hubot-redis-brain: Retrieved ${Object.keys(userObjects).length} users from Redis`)
      return userObjects
    } catch (err) {
      this.robot.logger.error(`hubot-redis-brain: Error loading all users: ${err}`)
      return {}
    }
  }

  async saveUser (userId, userData) {
    if (!this._connected) return

    try {
      await this.client.hSet(`${this.prefix}:users`, userId, JSON.stringify(userData))
    } catch (err) {
      this.robot.logger.error(`hubot-redis-brain: Error saving user ${userId}: ${err}`)
    }
  }

  // Legacy compatibility methods
  mergeData (data) {
    this.emit('loaded', data)
  }

  save () {
    // No-op since we save directly to Redis
    this.emit('save', {})
  }

  setAutoSave (enabled) {
    this.autoSave = enabled
  }

  resetSaveInterval (seconds) {
    // No-op for Redis-only implementation
  }

  close () {
    if (super.close) super.close()
    if (this.saveInterval) {
      clearInterval(this.saveInterval)
    }
    this.save()
    if (this.client) {
      if (this.client.isOpen) {
        this.client.disconnect().then(() => {
          this.client = null
        }).catch(err => this.robot.logger.error(`hubot-redis-brain: Error disconnecting from Redis: ${err}`))
      }
    }
    this.emit('close')
    this.removeAllListeners()
  }

  async connect () {
    await this.client.connect()
  }

  _getRedisEnv () {
    if (process.env.REDISTOGO_URL) return 'REDISTOGO_URL'
    if (process.env.REDISCLOUD_URL) return 'REDISCLOUD_URL'
    if (process.env.BOXEN_REDIS_URL) return 'BOXEN_REDIS_URL'
    if (process.env.REDIS_URL) return 'REDIS_URL'
  }
}

// Factory function to maintain backward compatibility
export default async (robot, redis = Redis) => {
  const redisBrain = new RedisBrain(robot, redis)

  // new Brain is created in Robot constructor and listens for 'running' event to reset save interval.
  // So we need to close it when the bot starts running, otherwise, a reference to it is remains in the robot.on('running' ...) closure :(
  const oldBrain = robot.brain
  robot.on('running', () => {
    if (oldBrain && oldBrain.close) {
      oldBrain.close()
    }
  })

  // Replace robot's brain with Redis brain
  robot.brain = redisBrain

  // Connect to Redis
  try {
    await redisBrain.connect()
  } catch (err) {
    robot.logger.error(`hubot-redis-brain: Connection failed: ${err}`)
  }

  return redisBrain
}

export { RedisBrain }
