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

const Url = require('url')
const Redis = require('redis')

module.exports = function (robot) {
  let client, prefix, redisUrlEnv
  const redisUrl = (() => {
    if (process.env.REDISTOGO_URL != null) {
      redisUrlEnv = 'REDISTOGO_URL'
      return process.env.REDISTOGO_URL
    } else if (process.env.REDISCLOUD_URL != null) {
      redisUrlEnv = 'REDISCLOUD_URL'
      return process.env.REDISCLOUD_URL
    } else if (process.env.BOXEN_REDIS_URL != null) {
      redisUrlEnv = 'BOXEN_REDIS_URL'
      return process.env.BOXEN_REDIS_URL
    } else if (process.env.REDIS_URL != null) {
      redisUrlEnv = 'REDIS_URL'
      return process.env.REDIS_URL
    } else {
      return 'redis://localhost:6379'
    }
  })()

  if (redisUrlEnv != null) {
    robot.logger.info(`hubot-redis-brain: Discovered redis from ${redisUrlEnv} environment variable`)
  } else {
    robot.logger.info('hubot-redis-brain: Using default redis on localhost:6379')
  }

  if (process.env.REDIS_NO_CHECK != null) {
    robot.logger.info('Turning off redis ready checks')
  }

  const info = Url.parse(redisUrl, true)
  if (info.hostname === '') {
    client = Redis.createClient(info.pathname)
    prefix = (info.query != null ? info.query.toString() : undefined) || 'hubot'
  } else {
    client = info.auth || (process.env.REDIS_NO_CHECK != null)
              ? Redis.createClient(info.port, info.hostname, {no_ready_check: true})
            : Redis.createClient(info.port, info.hostname)
    prefix = (info.path != null ? info.path.replace('/', '') : undefined) || 'hubot'
  }

  robot.brain.setAutoSave(false)

  const getData = () =>
    client.get(`${prefix}:storage`, function (err, reply) {
      if (err) {
        throw err
      } else if (reply) {
        robot.logger.info(`hubot-redis-brain: Data for ${prefix} brain retrieved from Redis`)
        robot.brain.mergeData(JSON.parse(reply.toString()))
        robot.brain.emit('connected')
      } else {
        robot.logger.info(`hubot-redis-brain: Initializing new data for ${prefix} brain`)
        robot.brain.mergeData({})
        robot.brain.emit('connected')
      }

      return robot.brain.setAutoSave(true)
    })

  if (info.auth) {
    client.auth(info.auth.split(':')[1], function (err) {
      if (err) {
        return robot.logger.error('hubot-redis-brain: Failed to authenticate to Redis')
      } else {
        robot.logger.info('hubot-redis-brain: Successfully authenticated to Redis')
        return getData()
      }
    })
  }

  client.on('error', function (err) {
    if (/ECONNREFUSED/.test(err.message)) {

    } else {
      return robot.logger.error(err.stack)
    }
  })

  client.on('connect', function () {
    robot.logger.debug('hubot-redis-brain: Successfully connected to Redis')
    if (!info.auth) { return getData() }
  })

  robot.brain.on('save', (data = {}) => client.set(`${prefix}:storage`, JSON.stringify(data)))

  return robot.brain.on('close', () => client.quit())
}
