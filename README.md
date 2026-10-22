![Build Status](https://github.com/hubotio/hubot-redis-brain/actions/workflows/pipeline.yml/badge.svg)

Note: The build is failing because I don't have access to this organization to update the NPM_TOKEN; nor do I have access to the NPM package on npmjs to create a new NPM_TOKEN. If you want to use the latest version of this module, you can `npm i hubotio/hubot-redis-brain#main` install it from the GitHub repo directly, instead of the npm registry.

![E2E Tests](https://github.com/hubotio/hubot-redis-brain/actions/workflows/e2e.yml/badge.svg)

# hubot-redis-brain

A hubot script to persist hubot's brain using redis

See [`src/RedisBrain.mjs`](src/RedisBrain.mjs) for full documentation.

## Installation

In hubot project repo, run:

`npm install hubot-redis-brain --save`

Then add **hubot-redis-brain** to your `external-scripts.json`:

```json
[
  "hubot-redis-brain"
]
```

## How the brain is stored

The brain is kept in two redis hashes, `<prefix>:brain:private` (everything set with `robot.brain.set`) and
`<prefix>:brain:users`, with one field per brain key or user. A save only writes the fields that changed and publishes
a notice on `<prefix>:brain:events`, so any number of hubot instances can share one redis: they pick up each other's
changes and no instance overwrites the whole brain. Writes to the *same* key by two instances are last-writer-wins.

Scripts get two additions on `robot.brain`:

* the `remote` event, emitted as `({ section, field, deleted })` after another instance changed a field
* `brain.claim(name, ttlMs)`, resolving `true` for exactly one instance per name until the ttl expires (handy for
  scheduled work that every instance would otherwise run)

### Upgrading from earlier versions

Earlier versions stored the whole brain as one JSON string at `<prefix>:storage`. The first time this version starts
with empty hashes it imports that string, and leaves it where it is, so rolling back still finds your data (anything
saved since the upgrade is not copied back). If several instances start at the very same moment they may each import;
the result is the same.

## Configuration

hubot-redis-brain requires a redis server to work. It uses the `REDIS_URL` environment variable for determining
where to connect to. The default is on localhost, port 6379 (ie the redis default).

The following attributes can be set using the `REDIS_URL`

* authentication
* hostname
* port
* key prefix

For example, `export REDIS_URL=redis://:password@192.168.0.1:16379/prefix` would
authenticate with `password`, connecting to `192.168.0.1` on port `16379`, and store
data using the `prefix:storage` key.

If the url carries no prefix, `HUBOT_REDIS_PREFIX` is used, then `hubot`.

For a UNIX domain socket, `export REDIS_URL=redis://:password@/var/run/redis.sock?prefix` would authenticate with `password`, connecting to `/var/run/redis.sock`, and store data using the `prefix:storage` key.

### TLS

For a `rediss://` url, `REDIS_REJECT_UNAUTHORIZED=false` skips verification of the server's certificate,
`REDIS_TLS_INSECURE_SKIP_VERIFY=true` does the same, and `REDIS_SSL_CA_CERTS` points at a PEM bundle to verify against.

### Google Cloud Memorystore (IAM auth)

Set `REDIS_IAM_AUTH=true` (with a `rediss://` url) to authenticate with a GCP IAM access token, fetched with
Application Default Credentials and refreshed on every reconnect. This needs the optional peer dependency
`google-auth-library` (`npm install google-auth-library`); nothing else needs it. `REDIS_IAM_SCOPE` overrides the
token scope. Memorystore uses a per-instance CA, so verification is skipped by default in this mode unless
`REDIS_SSL_CA_CERTS` is set.

### Installing your own

If you need to install and
run your own, most package managers have a package for redis:

* Mac OS X with homebrew: `brew install redis`
* Ubuntu/Debian with apt: `apt-get install redis-server`
* Compile from source: http://redis.io/topics/quickstart

### Boxen

If you are using [boxen](https://boxen.github.com/) to manage your environment,
hubot-redis-brain will automatically use the boxen-managed redis (ie by using `BOXEN_REDIS_URL`).

### Heroku

If you are deploying on [Heroku](https://www.heroku.com/), you can add the
Redis Cloud or Redis To Go addon to have automatically configure itself to use it:

* [Redis Cloud](https://addons.heroku.com/rediscloud)
* [Redis To Go](https://addons.heroku.com/redistogo)


Other redis addons would need to be configured using `REDIS_URL` until support
is added to hubot-redis-brain (or hubot-redis-brain needs to be updated to look
  for the environment variable the service uses)

### Redis Twemproxy

If you are using [Twemproxy](https://github.com/twitter/twemproxy) to cluster redis,
you need to turn off the redis ready check which uses the unsupported INFO cmd.

`REDIS_NO_CHECK = 1`
