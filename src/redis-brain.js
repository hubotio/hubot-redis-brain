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

const URL = require('url').URL
const Redis = require('redis')

module.exports = function (robot, redis = Redis) {
  const redisUrlEnv = getRedisEnv()
  const redisUrl = process.env[redisUrlEnv] || 'redis://localhost:6379'
  robot.config = Object.assign(robot.config || {}, { redisUrl })
  if (redisUrlEnv) {
    robot.logger.info(`hubot-redis-brain: Discovered redis from ${redisUrlEnv} environment variable: ${redisUrl}`)
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

  const getData = () => {
    client.get(`${prefix}:storage`).then((reply) => {
      if (reply) {
        robot.logger.info(`hubot-redis-brain: Data for ${prefix} brain retrieved from Redis`)
        robot.brain.mergeData(JSON.parse(reply.toString()))
        robot.brain.emit('connected')
      } else {
        robot.logger.info(`hubot-redis-brain: Initializing new data for ${prefix} brain`)
        robot.brain.mergeData({})
        robot.brain.emit('connected')
      }

      robot.brain.setAutoSave(true)
    }).catch(err => {
      robot.logger.error(`hubot-redis-brain: Unable to get data from Redis: ${err}`)
    })
  }

  if (info.auth) {
    client.auth(info.auth.split(':')[1], function (err) {
      if (err) {
        return robot.logger.error('hubot-redis-brain: Failed to authenticate to Redis')
      }

      robot.logger.info('hubot-redis-brain: Successfully authenticated to Redis')
      getData()
    })
  }

  client.on('error', function (err) {
    if (!/ECONNREFUSED/.test(err.message)) {
      robot.logger.error(err.stack)
    }
  })

  client.on('connect', function () {
    robot.logger.debug('hubot-redis-brain: Successfully connected to Redis')
    if (!info.auth) { getData() }
  })

  robot.brain.on('save', (data) => {
    if (!data) {
      data = {}
    }
    client.set(`${prefix}:storage`, JSON.stringify(data))
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
