# Description:
#   Persist hubot's brain to redis
#
# Configuration:
#   REDISTOGO_URL or REDISCLOUD_URL or BOXEN_REDIS_URL or REDIS_URL.
#     URL format: redis://<host>:<port>[/<brain_prefix>]
#     URL format (UNIX socket): redis://<socketpath>[?<brain_prefix>]
#     If not provided, '<brain_prefix>' will default to 'hubot'.
#   REDIS_NO_CHECK - set this to avoid ready check (for exampel when using Twemproxy)
#
# Commands:
#   None

Url   = require "url"
Redis = require "redis"

module.exports = (robot) ->
  redisUrl = if process.env.REDISTOGO_URL?
               redisUrlEnv = "REDISTOGO_URL"
               process.env.REDISTOGO_URL
             else if process.env.REDISCLOUD_URL?
               redisUrlEnv = "REDISCLOUD_URL"
               process.env.REDISCLOUD_URL
             else if process.env.BOXEN_REDIS_URL?
               redisUrlEnv = "BOXEN_REDIS_URL"
               process.env.BOXEN_REDIS_URL
             else if process.env.REDIS_URL?
               redisUrlEnv = "REDIS_URL"
               process.env.REDIS_URL
             else
               'redis://localhost:6379'

  if redisUrlEnv?
    robot.logger.info "hubot-redis-brain: Discovered redis from #{redisUrlEnv} environment variable"
  else
    robot.logger.info "hubot-redis-brain: Using default redis on localhost:6379"

  if process.env.REDIS_NO_CHECK?
    robot.logger.info "Turning off redis ready checks"

  info = Url.parse  redisUrl, true
  if info.hostname == ''
    client = Redis.createClient(info.pathname)
    prefix = info.query?.toString() or 'hubot'
  else
    client = if info.auth or process.env.REDIS_NO_CHECK?
              Redis.createClient(info.port, info.hostname, {no_ready_check: true})
            else
              Redis.createClient(info.port, info.hostname)
    prefix = info.path?.replace('/', '') or 'hubot'

  robot.brain.setAutoSave false

  getData = ->
    client.get "#{prefix}:storage", (err, reply) ->
      if err
        throw err
      else if reply
        robot.logger.info "hubot-redis-brain: Data for #{prefix} brain retrieved from Redis"
        robot.brain.mergeData JSON.parse(reply.toString())
        robot.brain.emit 'connected'
      else
        robot.logger.info "hubot-redis-brain: Initializing new data for #{prefix} brain"
        robot.brain.mergeData {}
        robot.brain.emit 'connected'

      robot.brain.setAutoSave true

  if info.auth
    client.auth info.auth.split(":")[1], (err) ->
      if err
        robot.logger.error "hubot-redis-brain: Failed to authenticate to Redis"
      else
        robot.logger.info "hubot-redis-brain: Successfully authenticated to Redis"
        getData()

  client.on "error", (err) ->
    if /ECONNREFUSED/.test err.message

    else
      robot.logger.error err.stack

  client.on "connect", ->
    robot.logger.debug "hubot-redis-brain: Successfully connected to Redis"
    getData() if not info.auth

  robot.brain.on 'save', (data = {}) ->
    client.set "#{prefix}:storage", JSON.stringify data

  robot.brain.on 'close', ->
    client.quit()
