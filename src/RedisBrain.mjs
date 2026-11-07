'use strict'

// Description:
//   Persist hubot's brain to redis
//
// Configuration:
//   REDISTOGO_URL or REDISCLOUD_URL or BOXEN_REDIS_URL or REDIS_URL.
//     URL format: redis://<host>:<port>[/<brain_prefix>]
//     URL format (UNIX socket): redis://<socketpath>[?<brain_prefix>]
//     If not provided, '<brain_prefix>' will default to 'hubot'.
//   REDIS_NO_CHECK - set this to avoid ready check (for exampel when using Twemproxy)
//
// Commands:
//   None

import { URL } from 'url'
import Redis from 'redis'

export default (robot, redis = Redis) => {
  const redisUrlEnv = getRedisEnv()
  const redisUrl = process.env[redisUrlEnv] || 'redis://localhost:6379'
  robot.config = Object.assign(robot.config || {}, { redisUrl })
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
    robot.logger.info(`hubot-redis-brain: Discovered redis from ${redisUrlEnv} environment variable: ${sanitizedUrl}`)
  } else {
    robot.logger.info('hubot-redis-brain: Using default redis on localhost:6379')
  }

  if (process.env.REDIS_NO_CHECK) {
    robot.logger.info('Turning off redis ready checks')
  }

  let info = null
  let prefix = ''
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
  prefix = info.search?.replace('?', '') || 'hubot'

  let redisOptions = {
    url: redisUrl
  }

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

  robot.brain.setAutoSave(false)

  const getData = async () => {
    // Migrate legacy single-blob storage to hash format
    const legacy = await client.get(`${prefix}:storage`)
    if (legacy) {
      robot.logger.info(`hubot-redis-brain: Migrating legacy storage to hash format for ${prefix} brain`)
      const legacyData = JSON.parse(legacy.toString())

      if (legacyData.users && Object.keys(legacyData.users).length > 0) {
        const pipeline = client.multi()
        for (const [id, user] of Object.entries(legacyData.users)) {
          pipeline.hSet(`${prefix}:users`, id, JSON.stringify(user))
        }
        await pipeline.exec()
      }

      if (legacyData._private && Object.keys(legacyData._private).length > 0) {
        const pipeline = client.multi()
        for (const [key, value] of Object.entries(legacyData._private)) {
          pipeline.hSet(`${prefix}:private`, key, JSON.stringify(value))
        }
        await pipeline.exec()
      }

      await client.del(`${prefix}:storage`)
      robot.logger.info(`hubot-redis-brain: Migration complete for ${prefix} brain`)
    }

    const [rawUsers, rawPrivate] = await Promise.all([
      client.hGetAll(`${prefix}:users`),
      client.hGetAll(`${prefix}:private`)
    ])

    const data = { users: {}, _private: {} }

    for (const [id, userData] of Object.entries(rawUsers || {})) {
      try {
        data.users[id] = JSON.parse(userData)
      } catch (err) {
        robot.logger.error(`hubot-redis-brain: Error parsing user ${id}: ${err}`)
      }
    }

    for (const [key, value] of Object.entries(rawPrivate || {})) {
      try {
        data._private[key] = JSON.parse(value)
      } catch (err) {
        robot.logger.error(`hubot-redis-brain: Error parsing key ${key}: ${err}`)
      }
    }

    if (legacy || Object.keys(rawUsers || {}).length > 0 || Object.keys(rawPrivate || {}).length > 0) {
      robot.logger.info(`hubot-redis-brain: Data for ${prefix} brain retrieved from Redis`)
    } else {
      robot.logger.info(`hubot-redis-brain: Initializing new data for ${prefix} brain`)
    }

    robot.brain.mergeData(data)
    robot.brain.emit('connected')
    robot.brain.setAutoSave(true)
  }

  if (info.auth) {
    client.auth(info.auth.split(':')[1], function (err) {
      if (err) {
        return robot.logger.error('hubot-redis-brain: Failed to authenticate to Redis')
      }

      robot.logger.info('hubot-redis-brain: Successfully authenticated to Redis')
      getData().catch(err => robot.logger.error(`hubot-redis-brain: Unable to load data from Redis: ${err}`))
    })
  }

  client.on('error', function (err) {
    if (!/ECONNREFUSED/.test(err.message)) {
      robot.logger.error(err.stack)
    }
  })

  client.on('connect', function () {
    robot.logger.debug('hubot-redis-brain: Successfully connected to Redis')
    if (!info.auth) { getData().catch(err => robot.logger.error(`hubot-redis-brain: Unable to load data from Redis: ${err}`)) }
  })

  robot.brain.on('save', (data) => {
    if (!data) return

    const users = data.users || {}
    const privateData = data._private || {}

    if (Object.keys(users).length > 0) {
      const pipeline = client.multi()
      for (const [id, user] of Object.entries(users)) {
        pipeline.hSet(`${prefix}:users`, id, JSON.stringify(user))
      }
      pipeline.exec().catch(err => {
        robot.logger.error(`hubot-redis-brain: Unable to save users to Redis: ${err}`)
      })
    }

    if (Object.keys(privateData).length > 0) {
      const pipeline = client.multi()
      for (const [key, value] of Object.entries(privateData)) {
        pipeline.hSet(`${prefix}:private`, key, JSON.stringify(value))
      }
      pipeline.exec().catch(err => {
        robot.logger.error(`hubot-redis-brain: Unable to save private data to Redis: ${err}`)
      })
    }
  })

  robot.brain.on('close', () => client.quit())
  client.connect().then(() => {}).catch(robot.logger.error)
}

function getRedisEnv () {
  if (process.env.REDISTOGO_URL) {
    return 'REDISTOGO_URL'
  }

  if (process.env.REDISCLOUD_URL) {
    return 'REDISCLOUD_URL'
  }

  if (process.env.BOXEN_REDIS_URL) {
    return 'BOXEN_REDIS_URL'
  }

  if (process.env.REDIS_URL) {
    return 'REDIS_URL'
  }
}
