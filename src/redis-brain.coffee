# Description:
#   Persist hubot's brain to redis
#
# Configuration:
#   REDISTOGO_URL or REDISCLOUD_URL or BOXEN_REDIS_URL or REDIS_URL.
#   URL format: redis://<host>:<port>[/<brain_prefix>]
#   If not provided, '<brain_prefix>' will default to 'hubot'.
#
# Commands:
#   None

Url   = require "url"
Redis = require "redis"

module.exports = (robot) ->
  prefix = "hubot"
  if process.env.REDIS_PARAMS
    try
      params = JSON.parse process.env.REDIS_PARAMS
    catch err
      robot.logger.error "hubot-redis-brain: REDIS_PARAMS is not a valid JSON"
      throw err
    if !params.createClient 
      robot.logger.error "hubot-redis-brain: in REDIS_PARAMS, createClient is mandatory"
      throw new Error "missing createClient in REDIS_PARAMS" 
    robot.logger.info "hubot-redis-brain: Using parameters in REDIS_PARAMS"
    if params.prefix
      prefix = params.prefix + ""
    client = Redis.createClient(params.createClient);
    client.on "connect", ->
      robot.logger.debug "hubot-redis-brain: Successfully connected to Redis"
      getData() if not params.db     
    if params.db
      db = params.db
      client.select db, (err, reply) ->
        if err
          robot.logger.error "hubot-redis-brain: Failed to select db #{db} in Redis"
        else
          robot.logger.info "hubot-redis-brain: Successfully selected db #{db}"
          getData()      
  else  
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
  
  
    info   = Url.parse redisUrl, true
    client = if info.auth then Redis.createClient(info.port, info.hostname, {no_ready_check: true}) else Redis.createClient(info.port, info.hostname)
    prefix = info.path?.replace('/', '') or 'hubot'

    if info.auth
      client.auth info.auth.split(":")[1], (err) ->
        if err
          robot.logger.error "hubot-redis-brain: Failed to authenticate to Redis"
        else
          robot.logger.info "hubot-redis-brain: Successfully authenticated to Redis"
          getData()
    client.on "connect", ->
      robot.logger.debug "hubot-redis-brain: Successfully connected to Redis"
      getData() if not info.auth


  robot.brain.setAutoSave false

  getData = ->
    client.get "#{prefix}:storage", (err, reply) ->
      if err
        throw err
      else if reply
        robot.logger.info "hubot-redis-brain: Data for #{prefix} brain retrieved from Redis"
        robot.brain.mergeData JSON.parse(reply.toString())
      else
        robot.logger.info "hubot-redis-brain: Initializing new data for #{prefix} brain"
        robot.brain.mergeData {}

      robot.brain.setAutoSave true

  client.on "error", (err) ->
    if /ECONNREFUSED/.test err.message

    else
      robot.logger.error err.stack

  robot.brain.on 'save', (data = {}) ->
    client.set "#{prefix}:storage", JSON.stringify data

  robot.brain.on 'close', ->
    client.quit()
