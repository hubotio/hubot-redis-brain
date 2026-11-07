'use strict'

// Description:
//   Persist hubot's brain to redis (or valkey), safely shared by several hubot instances
//
// Configuration:
//   REDISTOGO_URL or REDISCLOUD_URL or BOXEN_REDIS_URL or REDIS_URL.
//     URL format: redis[s]://<host>:<port>[/<db>][?<brain_prefix>]
//     URL format (UNIX socket): redis://<socketpath>[?<brain_prefix>]
//     If not provided, '<brain_prefix>' will default to HUBOT_REDIS_PREFIX, then to 'hubot'.
//   HUBOT_REDIS_PREFIX - key prefix the brain is stored under when the URL doesn't carry one, default 'hubot'
//   REDIS_NO_CHECK - set this to avoid ready check (for example when using Twemproxy)
//   REDIS_REJECT_UNAUTHORIZED - 'true' or 'false', whether a rediss:// connection verifies the server's certificate
//   REDIS_SSL_CA_CERTS - path to a PEM CA bundle used to verify the server's certificate
//   REDIS_TLS_INSECURE_SKIP_VERIFY - set to 'true' to skip server certificate verification (also the default when
//     REDIS_IAM_AUTH is on, because Memorystore uses a per-instance CA, unless REDIS_SSL_CA_CERTS is set)
//   REDIS_IAM_AUTH - set to 'true' to authenticate with a GCP IAM access token (Memorystore IAM_AUTH, which requires a
//     rediss:// URL on GCP). Uses Application Default Credentials and needs the optional `google-auth-library`
//     package; leave unset for local/unauthenticated redis.
//   REDIS_IAM_SCOPE - OAuth scope for the IAM token, default https://www.googleapis.com/auth/cloud-platform
//
// Commands:
//   None
//
// Notes:
//   Rather than one JSON blob that every instance overwrites in full, the brain is stored as two redis hashes
//   (`<prefix>:brain:private` and `<prefix>:brain:users`) with one field per brain key / user. Each save writes only
//   the fields this instance changed, and publishes a notice on `<prefix>:brain:events` so the other instances re-read
//   just those fields. Concurrent writes to the *same* key are still last-writer-wins.
//
//   Brains stored by earlier versions as a single blob under `<prefix>:storage` are imported the first time the hashes
//   turn out to be empty. The old key is left in place, so rolling back to an earlier version still finds its data
//   (changes made since the import are not copied back, though).
//
//   Other scripts can use two additions on robot.brain:
//     - the 'remote' event, emitted as ({ section, field, deleted }) after another instance changed a field
//       (`section` is 'private' for brain.get/set keys, or 'users')
//     - brain.claim(name, ttlMs), resolving true for exactly one instance per name until the ttl expires

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { User } from 'hubot'
import Redis from 'redis'

const IAM_USERNAME = 'default'
const DEFAULT_IAM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const SECTIONS = { private: '_private', users: 'users' }
const SECTION_NAMES = Object.keys(SECTIONS)

const errorMessage = (err) => (err instanceof Error ? err.message : String(err))

// node-redis calls this on every (re)connect. Memorystore drops connections when the token they authenticated with
// expires, so the reconnect picks up a fresh one; GoogleAuth caches and refreshes tokens itself.
export const iamCredentialsProvider = (getToken) => ({
  type: 'async-credentials-provider',
  credentials: async () => ({ username: IAM_USERNAME, password: await getToken() })
})

const googleTokenGetter = (scope) => {
  let auth
  return async () => {
    if (!auth) {
      let GoogleAuth
      try {
        ({ GoogleAuth } = await import('google-auth-library'))
      } catch (err) {
        throw new Error(`REDIS_IAM_AUTH needs the optional google-auth-library package: ${errorMessage(err)}`)
      }
      auth = new GoogleAuth({ scopes: [scope] })
    }
    const token = await auth.getAccessToken()
    if (!token) {
      throw new Error('Failed to obtain a GCP IAM access token for redis')
    }
    return token
  }
}

export const getRedisEnv = (env = process.env) => {
  return ['REDISTOGO_URL', 'REDISCLOUD_URL', 'BOXEN_REDIS_URL', 'REDIS_URL'].find((name) => env[name])
}

// Splits a redis url into what we need from it: the brain prefix and the database number. The prefix rides on the
// query string, which is also how UNIX socket urls (that URL can't always parse) carry it.
const parseRedisUrl = (redisUrl) => {
  let info = null
  let database = null
  try {
    info = new URL(redisUrl)
    database = Number((info.pathname ? info.pathname.replace('/', '') : undefined) || 0)
  } catch (err) {
    if (err.code !== 'ERR_INVALID_URL') {
      throw err
    }
    const urlPath = redisUrl.replace(/rediss?:\/{2}:?(.*@)?/, '')
    info = new URL(`redis://${urlPath}`)
  }
  return { info, database, prefix: info.search?.replace('?', '') || '' }
}

export const buildClientOptions = (env = process.env, getToken) => {
  const redisUrl = env[getRedisEnv(env)] || 'redis://localhost:6379'
  const { info, database } = parseRedisUrl(redisUrl)
  const iamAuth = (env.REDIS_IAM_AUTH || '').toLowerCase() === 'true'
  const options = { url: redisUrl }

  if (database) {
    options.database = database
  }

  if (info.protocol === 'rediss:') {
    const socket = { tls: true }
    if (env.REDIS_SSL_CA_CERTS) {
      socket.ca = readFileSync(env.REDIS_SSL_CA_CERTS)
    } else if (env.REDIS_REJECT_UNAUTHORIZED != null) {
      socket.rejectUnauthorized = env.REDIS_REJECT_UNAUTHORIZED === 'true'
    } else if ((env.REDIS_TLS_INSECURE_SKIP_VERIFY ?? String(iamAuth)).toLowerCase() === 'true') {
      socket.rejectUnauthorized = false
    }
    options.socket = socket
  }

  if (env.REDIS_NO_CHECK) {
    options.no_ready_check = true
  }

  if (iamAuth) {
    options.credentialsProvider = iamCredentialsProvider(getToken ?? googleTokenGetter(env.REDIS_IAM_SCOPE || DEFAULT_IAM_SCOPE))
  }
  return options
}

// Hides the password in a url so it can be logged
const sanitizeUrl = (redisUrl) => {
  try {
    const urlObj = new URL(redisUrl)
    if (urlObj.password) {
      urlObj.password = '*****'
    }
    return urlObj.toString()
  } catch {
    return redisUrl
  }
}

export default async (robot, redis = Redis) => {
  const redisUrlEnv = getRedisEnv()
  const redisUrl = process.env[redisUrlEnv] || 'redis://localhost:6379'
  robot.config = Object.assign(robot.config || {}, { redisUrl })
  if (redisUrlEnv) {
    robot.logger.info(`hubot-redis-brain: Discovered redis from ${redisUrlEnv} environment variable: ${sanitizeUrl(redisUrl)}`)
  } else {
    robot.logger.info('hubot-redis-brain: Using default redis on localhost:6379')
  }
  if (process.env.REDIS_NO_CHECK) {
    robot.logger.info('hubot-redis-brain: Turning off redis ready checks')
  }

  const prefix = parseRedisUrl(redisUrl).prefix || process.env.HUBOT_REDIS_PREFIX || 'hubot'
  const hashKey = (section) => `${prefix}:brain:${section}`
  const legacyKey = `${prefix}:storage`
  const channel = `${prefix}:brain:events`
  const instanceId = randomUUID()

  const client = redis.createClient(buildClientOptions())
  const subscriber = client.duplicate()
  // the brain only autosaves once the stored data has been merged in, so we never overwrite it with an empty one
  robot.brain.setAutoSave(false)

  // a down redis makes every retry fail the same way, so only say so once until it comes back
  let reportedRefusal = false
  for (const c of [client, subscriber]) {
    c.on('error', (err) => {
      if (/ECONNREFUSED/.test(err.message)) {
        if (reportedRefusal) {
          return
        }
        reportedRefusal = true
      }
      robot.logger.error(`hubot-redis-brain: ${err.message}`)
    })
  }

  // What this instance believes redis holds, per section: field -> serialized value. Saves diff against it, and
  // remote changes update it, so we never write back something we only just read.
  const known = { private: new Map(), users: new Map() }
  const target = (section) => robot.brain.data[SECTIONS[section]]

  const serialize = (section) => {
    const current = new Map()
    for (const [field, value] of Object.entries(target(section) ?? {})) {
      if (value != null) {
        current.set(field, JSON.stringify(value))
      }
    }
    return current
  }

  const revive = (section, field, value) => (section === 'users' ? new User(field, value) : value)

  // Writes and remote updates share one queue so `known` is never touched by two things at once.
  let queue = Promise.resolve()
  const enqueue = (task) => {
    queue = queue.then(task).catch((err) => robot.logger.error(`hubot-redis-brain: ${errorMessage(err)}`))
    return queue
  }

  let started = false
  let markStarted = () => {}
  const startedPromise = new Promise((resolve) => {
    markStarted = resolve
  })

  const save = async () => {
    if (!started) {
      return
    }
    const multi = client.multi()
    const notice = {}
    const written = []
    for (const section of SECTION_NAMES) {
      const current = serialize(section)
      const changed = [...current].filter(([field, value]) => known[section].get(field) !== value)
      const gone = [...known[section].keys()].filter((field) => !current.has(field))
      if (changed.length > 0) {
        multi.hSet(hashKey(section), Object.fromEntries(changed))
      }
      if (gone.length > 0) {
        multi.hDel(hashKey(section), gone)
      }
      if (changed.length + gone.length > 0) {
        notice[section] = [...changed.map(([field]) => field), ...gone]
        written.push({ section, changed, gone })
      }
    }
    if (written.length === 0) {
      return
    }
    multi.publish(channel, JSON.stringify({ origin: instanceId, changes: notice }))
    await multi.exec()
    // only record what we wrote: a remote update may have changed other fields while the write was in flight
    for (const { section, changed, gone } of written) {
      for (const [field, value] of changed) {
        known[section].set(field, value)
      }
      for (const field of gone) {
        known[section].delete(field)
      }
    }
  }

  // Brings the brain in line with redis for the given fields (or everything, if none are given).
  const pull = async (changes, { initial = false } = {}) => {
    for (const section of SECTION_NAMES) {
      let fields = changes?.[section]
      let values
      if (fields) {
        values = await client.hmGet(hashKey(section), fields)
      } else {
        const all = await client.hGetAll(hashKey(section))
        fields = [...new Set([...Object.keys(all), ...known[section].keys()])]
        values = fields.map((field) => all[field] ?? null)
      }
      fields.forEach((field, i) => {
        const raw = values[i]
        if (raw === known[section].get(field) || (raw == null && !known[section].has(field))) {
          return
        }
        if (raw == null) {
          delete target(section)[field]
          known[section].delete(field)
        } else {
          target(section)[field] = revive(section, field, JSON.parse(raw))
          known[section].set(field, raw)
        }
        if (!initial) {
          robot.brain.emit('remote', { section, field, deleted: raw == null })
        }
      })
    }
  }

  // Data stored by earlier versions: the whole brain as one JSON blob. Only used when the hashes hold nothing.
  const readLegacy = async () => {
    const raw = await client.get(legacyKey)
    if (!raw) {
      return null
    }
    try {
      return JSON.parse(raw.toString())
    } catch (err) {
      robot.logger.error(`hubot-redis-brain: ignoring ${legacyKey}, it isn't valid JSON: ${errorMessage(err)}`)
      return null
    }
  }

  const onMessage = (message) => {
    startedPromise.then(() =>
      enqueue(async () => {
        const { origin, changes } = JSON.parse(message)
        if (origin !== instanceId) {
          await pull(changes)
        }
      })
    )
  }

  robot.brain.on('save', () => {
    enqueue(save)
  })

  robot.brain.on('close', async () => {
    await queue
    await Promise.allSettled([client.quit(), subscriber.quit()])
  })

  robot.brain.claim = async (name, ttlMs) => {
    try {
      const reply = await client.set(`${prefix}:lock:${name}`, instanceId, { condition: 'NX', expiration: { type: 'PX', value: ttlMs } })
      return reply === 'OK'
    } catch (err) {
      // better a duplicate run than a silently skipped one
      robot.logger.error(`hubot-redis-brain: unable to claim ${name}, assuming we may proceed: ${errorMessage(err)}`)
      return true
    }
  }

  // after a reconnect we may have missed notices, so reconcile with everything redis holds
  client.on('ready', () => {
    reportedRefusal = false
    robot.logger.debug('hubot-redis-brain: Successfully connected to Redis')
    if (started) {
      enqueue(() => pull())
    }
  })

  const start = async () => {
    await Promise.all([client.connect(), subscriber.connect()])
    // subscribe before the initial read so no change can slip between the two
    await subscriber.subscribe(channel, onMessage)
    await pull(undefined, { initial: true })
    const stored = known.private.size + known.users.size
    const legacy = stored === 0 ? await readLegacy() : null
    robot.logger.info(`hubot-redis-brain: Data for ${prefix} brain retrieved from Redis (${known.private.size} keys, ${known.users.size} users)`)
    robot.brain.mergeData(legacy ?? {})
    started = true
    markStarted()
    if (legacy) {
      // the hashes are empty, so this writes everything we just imported
      await enqueue(save)
      robot.logger.info(`hubot-redis-brain: Imported the brain from ${legacyKey} (left in place); it now lives in ${hashKey('private')} and ${hashKey('users')}`)
    }
    robot.brain.setAutoSave(true)
    robot.brain.emit('connected')
  }

  // not awaited: the client retries forever, and an unreachable redis shouldn't block loading the other scripts
  start().catch((err) => robot.logger.error(`hubot-redis-brain: Unable to get data from Redis: ${errorMessage(err)}`))
}
