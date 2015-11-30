# hubot-redis-brain

A hubot script to persist hubot's brain using redis

See [`src/redis-brain.coffee`](src/redis-brain.coffee) for full documentation.

## Installation

In hubot project repo, run:

`npm install hubot-redis-brain --save`

Then add **hubot-redis-brain** to your `external-scripts.json`:

```json
[
  "hubot-redis-brain"
]
```

## Configuration

hubot-redis-brain requires a redis server to work. 
It can be set up with `REDIS_URL` or `REDIS_PARAMS` for more options.

When you use `REDIS_PARAMS`, all the options in [redis.createClient](https://github.com/NodeRedis/node_redis/tree/36429d1687a4e13760580fdfdf6318f3e3998b79#rediscreateclient) are available.
(i.e. UNIX sockets and a specific DB can be used).
Ex: 
  *  `REDIS_PARAMS='{"createClient":{"path":"/tmp/redis.sock"},"db":2}'` connect to the unix socket `/tmp/redis.sock` andd use DB 2 in redis. 
  *  `REDIS_PARAMS='{"createClient":{"host":"myredis.example.com","port":"16370","auth_pass":"123"},"prefix":"that-bot"}'` connect to myredis.example.com:16370 authenticating with password "123" and store in `that-bot:storage` 

When you use `REDIS_URL`, the following attributes can be set:

* authentication
* hostname
* port
* key prefix

For example, `export REDIS_URL=redis://passwd@192.168.0.1:16379/prefix` would
authenticate with `password`, connecting to 192.168.0.1 on port 16379, and store
data using the `prefix:storage` key.

The default is on localhost, port 6379 (i.e. the redis default).

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
