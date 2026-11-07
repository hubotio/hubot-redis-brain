'use strict'

import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import redisBrain, { buildClientOptions } from '../src/RedisBrain.mjs'
import HubotRedis from '../index.mjs'
import { createFakeServer } from './support/fake-redis.mjs'
import { createRobot, settle, waitFor } from './support/robot.mjs'

const ENV_VARS = [
  'REDISTOGO_URL', 'REDISCLOUD_URL', 'BOXEN_REDIS_URL', 'REDIS_URL', 'REDIS_NO_CHECK', 'REDIS_REJECT_UNAUTHORIZED',
  'REDIS_SSL_CA_CERTS', 'REDIS_TLS_INSECURE_SKIP_VERIFY', 'REDIS_IAM_AUTH', 'REDIS_IAM_SCOPE', 'HUBOT_REDIS_PREFIX'
]

const credentialsOf = (options) => {
  assert.equal(options.credentialsProvider?.type, 'async-credentials-provider')
  return options.credentialsProvider.credentials()
}

// starts the brain against the fake server and waits until it has loaded
const boot = async (server, name) => {
  const fake = createRobot(name)
  await redisBrain(fake.robot, server.redis)
  await waitFor(() => fake.brain.autoSave === true)
  return fake
}

describe('redis-brain', () => {
  beforeEach(() => {
    for (const name of ENV_VARS) {
      delete process.env[name]
    }
  })
  afterEach(() => {
    for (const name of ENV_VARS) {
      delete process.env[name]
    }
  })

  it('exports a function', () => {
    assert.equal(typeof HubotRedis, 'function')
  })

  describe('configuration', () => {
    it('defaults to a local plain connection', () => {
      assert.deepEqual(buildClientOptions({}), { url: 'redis://localhost:6379' })
    })

    it('discovers the url from the known environment variables, in order', () => {
      const env = { REDIS_URL: 'redis://c', BOXEN_REDIS_URL: 'redis://b', REDISCLOUD_URL: 'redis://a' }
      assert.equal(buildClientOptions(env).url, 'redis://a')
      assert.equal(buildClientOptions({ REDIS_URL: 'redis://c', BOXEN_REDIS_URL: 'redis://b' }).url, 'redis://b')
      assert.equal(buildClientOptions({ REDISTOGO_URL: 'redis://t', ...env }).url, 'redis://t')
    })

    it('records the url on the robot config and never needs an empty hostname', async () => {
      process.env.REDIS_URL = 'redis://'
      const { robot, logs } = createRobot()
      await redisBrain(robot, createFakeServer().redis)
      assert.equal(robot.config.redisUrl, 'redis://')
      assert.match(logs.info[0], /Discovered redis from REDIS_URL environment variable/)
    })

    it('connects without REDIS_URL set', async () => {
      const { robot, logs } = createRobot()
      await redisBrain(robot, createFakeServer().redis)
      assert.equal(robot.config.redisUrl, 'redis://localhost:6379')
      assert.equal(logs.info[0], 'hubot-redis-brain: Using default redis on localhost:6379')
    })

    it('keeps passwords out of the logs', async () => {
      process.env.REDIS_URL = 'redis://user:hunter2@localhost:6379'
      const { robot, logs } = createRobot()
      await redisBrain(robot, createFakeServer().redis)
      assert.ok(!logs.info.join('\n').includes('hunter2'))
    })

    it('passes the database number through', () => {
      assert.equal(buildClientOptions({ REDIS_URL: 'redis://localhost:6379/1?prefix' }).database, 1)
      assert.equal(buildClientOptions({ REDIS_URL: 'redis://localhost?prefix' }).database, undefined)
      assert.equal(buildClientOptions({ REDIS_URL: 'redis://localhost:6379/?prefix' }).database, undefined)
      assert.equal(buildClientOptions({ REDIS_URL: 'redis://username:test@/var/run/redis.sock?prefix' }).database, undefined)
    })

    it('reads tls options from the environment', () => {
      const options = buildClientOptions({
        REDIS_URL: 'rediss://localhost:6379', REDIS_REJECT_UNAUTHORIZED: 'false', REDIS_NO_CHECK: 'true'
      })
      assert.equal(options.url, 'rediss://localhost:6379')
      assert.equal(options.socket.tls, true)
      assert.equal(options.socket.rejectUnauthorized, false)
      assert.equal(options.no_ready_check, true)
      assert.equal(buildClientOptions({ REDIS_URL: 'rediss://h:6379', REDIS_REJECT_UNAUTHORIZED: 'true' }).socket.rejectUnauthorized, true)
    })

    it('ignores REDIS_REJECT_UNAUTHORIZED for plain connections', () => {
      assert.equal(buildClientOptions({ REDIS_URL: 'redis://h:6379', REDIS_REJECT_UNAUTHORIZED: 'false' }).socket, undefined)
    })

    it('verifies tls for rediss:// without IAM unless told otherwise', () => {
      assert.deepEqual(buildClientOptions({ REDIS_URL: 'rediss://h:6379' }).socket, { tls: true })
      assert.deepEqual(buildClientOptions({ REDIS_URL: 'rediss://h:6379', REDIS_TLS_INSECURE_SKIP_VERIFY: 'true' }).socket, {
        tls: true, rejectUnauthorized: false
      })
    })

    it('uses no tls options for redis:// even with IAM enabled', async () => {
      const options = buildClientOptions({ REDIS_URL: 'redis://valkey:6379/3', REDIS_IAM_AUTH: 'true' }, async () => 'tok')
      assert.equal(options.socket, undefined)
      assert.deepEqual(await credentialsOf(options), { username: 'default', password: 'tok' })
    })

    it('skips tls verification for rediss:// with IAM by default', () => {
      const options = buildClientOptions({ REDIS_URL: 'rediss://10.0.0.1:6379/3', REDIS_IAM_AUTH: 'true' }, async () => 'tok')
      assert.deepEqual(options.socket, { tls: true, rejectUnauthorized: false })
    })

    it('fetches a new token on every credentials call', async () => {
      const tokens = ['one', 'two']
      const options = buildClientOptions({ REDIS_URL: 'redis://h', REDIS_IAM_AUTH: 'true' }, async () => tokens.shift())
      assert.equal((await credentialsOf(options)).password, 'one')
      assert.equal((await credentialsOf(options)).password, 'two')
    })
  })

  describe('prefix', () => {
    const cases = [
      ['redis://localhost:6379/1?prefix-for-redis-key', 'prefix-for-redis-key'],
      ['redis://localhost?prefix-for-redis-key', 'prefix-for-redis-key'],
      ['redis://localhost:6379/?prefix-for-redis-key', 'prefix-for-redis-key'],
      ['redis://username:test@/var/run/redis.sock?prefix-for-redis-key', 'prefix-for-redis-key']
    ]
    for (const [url, prefix] of cases) {
      it(`takes the prefix from the query string of ${url}`, async () => {
        process.env.REDIS_URL = url
        const server = createFakeServer()
        server.seed(`${prefix}:brain:private`, { a: 1 })
        const { brain } = await boot(server)
        assert.equal(brain.get('a'), 1)
      })
    }

    it('falls back to HUBOT_REDIS_PREFIX, then to hubot', async () => {
      process.env.HUBOT_REDIS_PREFIX = 'custom'
      const server = createFakeServer()
      server.seed('custom:brain:private', { a: 1 })
      assert.equal((await boot(server)).brain.get('a'), 1)

      delete process.env.HUBOT_REDIS_PREFIX
      server.seed('hubot:brain:private', { b: 2 })
      assert.equal((await boot(server)).brain.get('b'), 2)
    })
  })

  describe('storage', () => {
    it('loads stored keys and users, then announces itself', async () => {
      const server = createFakeServer()
      server.seed('hubot:brain:private', { greeting: 'hi', nested: { a: 1 } })
      server.seed('hubot:brain:users', { 1: { name: 'ann', room: 'general' } })
      const { robot, brain } = createRobot()
      let connected = 0
      brain.on('connected', () => { connected += 1 })

      await redisBrain(robot, server.redis)
      await waitFor(() => connected > 0)

      assert.equal(brain.autoSave, true)
      assert.equal(brain.get('greeting'), 'hi')
      assert.deepEqual(brain.get('nested'), { a: 1 })
      assert.equal(brain.data.users[1].constructor.name, 'User')
      assert.deepEqual({ id: brain.data.users[1].id, name: brain.data.users[1].name, room: brain.data.users[1].room }, {
        id: '1', name: 'ann', room: 'general'
      })
    })

    it('only writes the fields that changed, and removes deleted ones', async () => {
      const server = createFakeServer()
      server.seed('hubot:brain:private', { keep: 1, change: 1, drop: 1 })
      const { brain } = await boot(server)

      brain.save()
      await settle()
      assert.deepEqual(server.commands, [])

      brain.set('change', 2).set('added', 3).remove('drop')
      brain.save()
      await settle()

      assert.deepEqual(server.commands, [
        { command: 'hSet', key: 'hubot:brain:private', fields: ['change', 'added'] },
        { command: 'hDel', key: 'hubot:brain:private', fields: ['drop'] }
      ])
      assert.deepEqual(server.hash('hubot:brain:private'), { keep: '1', change: '2', added: '3' })
    })

    it('shares changes between instances without overwriting each other', async () => {
      const server = createFakeServer()
      const a = await boot(server)
      const b = await boot(server)
      const remote = []
      b.brain.on('remote', (event) => remote.push(event))

      a.brain.set('from-a', { n: 1 })
      a.brain.save()
      await settle()
      assert.deepEqual(b.brain.get('from-a'), { n: 1 })
      assert.deepEqual(remote.at(-1), { section: 'private', field: 'from-a', deleted: false })

      // b has never touched from-a; its next saves must not undo a's write
      b.brain.set('from-b', 'x')
      b.brain.save()
      b.brain.save()
      await settle()
      assert.equal(a.brain.get('from-b'), 'x')
      assert.deepEqual(server.hash('hubot:brain:private'), { 'from-a': '{"n":1}', 'from-b': '"x"' })

      a.brain.remove('from-b')
      a.brain.save()
      await settle()
      assert.equal(b.brain.get('from-b'), null)
      assert.deepEqual(remote.at(-1), { section: 'private', field: 'from-b', deleted: true })
    })

    it('does not echo remote changes back to redis', async () => {
      const server = createFakeServer()
      const a = await boot(server)
      const b = await boot(server)
      a.brain.set('k', 1)
      a.brain.save()
      await settle()
      server.commands.length = 0

      b.brain.save()
      await settle()
      assert.deepEqual(server.commands, [])
    })

    it('shares users as User objects', async () => {
      const server = createFakeServer()
      const a = await boot(server)
      const b = await boot(server)
      a.brain.data.users[7] = { id: '7', name: 'bob' }
      a.brain.save()
      await settle()
      assert.equal(b.brain.data.users[7].constructor.name, 'User')
      assert.equal(b.brain.data.users[7].name, 'bob')
    })

    it('reconciles with redis after a reconnect', async () => {
      const server = createFakeServer()
      const { brain } = await boot(server)
      server.seed('hubot:brain:private', { missed: 'while-offline' })

      server.clients[0].emit('ready')
      await settle()

      assert.equal(brain.get('missed'), 'while-offline')
    })

    it('flushes pending writes before quitting', async () => {
      const server = createFakeServer()
      const { brain } = await boot(server)
      brain.set('last', 'words')
      brain.save()
      brain.emit('close')
      await settle()
      assert.deepEqual(server.hash('hubot:brain:private'), { last: '"words"' })
      assert.equal(server.clients[0].quit.calls, 1)
    })

    it('does not block loading when redis is unreachable', async () => {
      const server = createFakeServer()
      const { robot, brain } = createRobot()
      const unreachable = {
        createClient: (options) => {
          const client = server.makeClient(options)
          client.connect = () => new Promise(() => {})
          return client
        }
      }

      await redisBrain(robot, unreachable)
      assert.equal(brain.autoSave, false)
    })

    it('reports a refused connection once until redis comes back', async () => {
      const server = createFakeServer()
      const { robot, logs } = createRobot()
      let created
      await redisBrain(robot, {
        createClient: (options) => {
          created = server.makeClient(options)
          created.connect = () => new Promise(() => {})
          return created
        }
      })

      const refused = new Error('connect ECONNREFUSED 127.0.0.1:6379')
      for (let i = 0; i < 3; i++) {
        created.emit('error', refused)
      }
      assert.deepEqual(logs.error, [`hubot-redis-brain: ${refused.message}`])

      created.emit('ready')
      created.emit('error', refused)
      assert.equal(logs.error.length, 2)
    })
  })

  describe('claim', () => {
    it('lets exactly one instance claim a name', async () => {
      const server = createFakeServer()
      const a = await boot(server)
      const b = await boot(server)
      assert.equal(await a.brain.claim('job:1', 5000), true)
      assert.equal(await b.brain.claim('job:1', 5000), false)
      assert.equal(await b.brain.claim('job:2', 5000), true)
    })
  })

  describe('importing a brain stored by earlier versions', () => {
    const blob = { users: { 1: { name: 'ann', room: 'general' } }, _private: { greeting: 'hi', nested: { a: 1 } } }

    it('imports the blob into the hashes once, and leaves it in place', async () => {
      const server = createFakeServer()
      server.seedLegacy('hubot:storage', blob)
      const { brain, logs } = await boot(server)
      await settle()

      assert.equal(brain.get('greeting'), 'hi')
      assert.equal(brain.data.users[1].name, 'ann')
      assert.deepEqual(server.hash('hubot:brain:private'), { greeting: '"hi"', nested: '{"a":1}' })
      assert.equal(JSON.parse(server.hash('hubot:brain:users')[1]).name, 'ann')
      assert.deepEqual(JSON.parse(server.value('hubot:storage')), blob)
      assert.ok(logs.info.some((line) => /Imported the brain from hubot:storage/.test(line)))
    })

    it('gives the other instances what it imported', async () => {
      const server = createFakeServer()
      const a = await boot(server)
      server.seedLegacy('hubot:storage', blob)
      // b starts after a, which found nothing to import
      const b = await boot(server)
      await settle()
      assert.equal(a.brain.get('greeting'), 'hi')
      assert.equal(b.brain.get('greeting'), 'hi')
    })

    it('uses the prefix from the url for the legacy key', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379/1?custom'
      const server = createFakeServer()
      server.seedLegacy('custom:storage', blob)
      const { brain } = await boot(server)
      assert.equal(brain.get('greeting'), 'hi')
    })

    it('does not import when the hashes already hold data', async () => {
      const server = createFakeServer()
      server.seed('hubot:brain:private', { current: true })
      server.seedLegacy('hubot:storage', blob)
      const { brain } = await boot(server)
      assert.equal(brain.get('current'), true)
      assert.equal(brain.get('greeting'), null)
    })

    it('ignores a blob that is not valid JSON', async () => {
      const server = createFakeServer()
      server.makeClient({}).set('hubot:storage', '{nope')
      const { brain, logs } = await boot(server)
      assert.equal(brain.autoSave, true)
      assert.ok(logs.error.some((line) => /isn't valid JSON/.test(line)))
    })

    it('starts empty when there is nothing stored', async () => {
      const { brain } = await boot(createFakeServer())
      assert.deepEqual(brain.data, { users: {}, _private: {} })
    })
  })
})
