# hubot-redis-brain

A Hubot script that persists the brain to Redis using hash tables, enabling horizontal scaling across multiple Hubot instances.

## Overview

The original `hubot-redis-brain` serializes the entire brain as a single JSON blob and writes it to one Redis key on every autosave. With multiple instances running, this causes data loss: the last writer overwrites every change made by other instances.

This fork stores each user and each private key as a separate field in a Redis hash (`HSET`). Two instances writing different fields to the same hash do not conflict. The only remaining conflict is two instances writing the **same field** simultaneously — an inherent Redis limitation without distributed locking, and rare in practice.

The public API is unchanged: same exported function, same environment variables, same `robot.brain` interface. Existing installations migrate automatically on first startup.

---

## Installation

```sh
npm install joeyguerra/hubot-redis-brain#main
```

Add to `external-scripts.json`:

```json
["hubot-redis-brain"]
```

Set the Redis connection URL:

```sh
export REDIS_URL=redis://localhost:6379
```

**Peer dependency**: Hubot `>= 14`, Node.js `>= 18`.

---

## Design

### Storage format

Data lives in two Redis hash keys under a configurable prefix (default: `hubot`):

| Key | Contents |
| --- | --- |
| `prefix:users` | One field per user ID; value is JSON-encoded user object |
| `prefix:private` | One field per brain key set via `robot.brain.set()`; value is JSON-encoded |

Each `HSET` call touches exactly one field. Two instances writing different fields do not conflict.

### Save behaviour

Hubot's autosave emits a `save` event with the full in-memory brain. The `save` handler writes every user and every private key into their respective Redis hashes via a pipelined `MULTI`/`EXEC`. Because each field is written independently, a concurrent save from another instance only overwrites fields it actually changed — not the whole dataset.

### Startup and migration

On connect, `getData()` runs:

1. **Migration check** — calls `GET prefix:storage`. If a legacy blob exists, every user and private key inside it is written to hash format via pipeline, then the legacy key is deleted.
2. **Load** — calls `HGETALL prefix:users` and `HGETALL prefix:private` in parallel, deserializes both, and calls `robot.brain.mergeData()`.
3. Emits `connected` on `robot.brain` and re-enables autosave.

Migration is safe against a live Redis: hashes are written before the legacy key is deleted, so a crash mid-migration leaves both formats present and the next startup repeats the migration harmlessly.

### Known limitations

- **Field-level conflicts**: if two instances update the same user or private key simultaneously, last writer wins (standard Redis semantics).
- **Deletions**: `robot.brain.remove()` removes a key from memory but does not issue `HDEL` to Redis. The key is gone from future saves but remains in Redis until manually deleted.

---

## Hosting examples

### Google Cloud (Cloud Run + Memorystore)

Cloud Run scales Hubot horizontally; Cloud Memorystore provides managed Redis over a VPC.

**Prerequisites**
- A VPC with a Serverless VPC Access connector
- A Cloud Memorystore Redis instance on that VPC

**Deploy**

```sh
gcloud run deploy hubot \
  --image gcr.io/YOUR_PROJECT/hubot:latest \
  --region us-central1 \
  --min-instances 1 \
  --max-instances 5 \
  --vpc-connector projects/YOUR_PROJECT/locations/us-central1/connectors/YOUR_CONNECTOR \
  --set-env-vars REDIS_URL=redis://MEMORYSTORE_IP:6379
```

Pass secrets (Slack token, etc.) via `--set-secrets` referencing Secret Manager. Set `--min-instances 1` to avoid cold-start delays on a chat bot.

---

### Heroku

Heroku's Redis add-ons set `REDIS_URL` automatically — no extra configuration needed.

```sh
heroku addons:create heroku-redis:mini -a your-app
heroku config:set HUBOT_SLACK_TOKEN=xoxb-...
git push heroku main
heroku ps:scale web=2
```

Both dynos share the same `REDIS_URL` and use hash-table storage without further configuration.

---

### Fly.io

Pair Fly.io with Upstash Redis (free tier, global replication).

```sh
fly secrets set REDIS_URL=rediss://default:PASSWORD@global-redis.upstash.io:6379
fly deploy
fly scale count 2
```

Upstash uses TLS; `rediss://` (double-s) enables it automatically.

```toml
# fly.toml
[[services]]
  internal_port = 8080
  min_machines_running = 1
```

---

### Docker Compose (self-hosted)

```yaml
services:
  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes

  hubot:
    image: your-hubot:latest
    environment:
      REDIS_URL: redis://redis:6379
      HUBOT_SLACK_TOKEN: xoxb-...
    depends_on:
      - redis
    deploy:
      replicas: 2

volumes:
  redis-data:
```

```sh
docker compose up --scale hubot=2
```

`--appendonly yes` persists Redis data to the mounted volume so brain state survives container restarts.

---

## Redis URL reference

### Format

```
redis[s]://[username:password@]host[:port][/database][?prefix]
```

| Part | Example | Notes |
| --- | --- | --- |
| Scheme | `redis://` or `rediss://` | Double-s enables TLS |
| Auth | `:password@` or `user:password@` | Password-only is common for Redis Cloud |
| Host | `localhost` or `/var/run/redis.sock` | Absolute path = UNIX socket |
| Port | `:6379` | Defaults to 6379 |
| Database | `/1` | Selects Redis database number |
| Prefix | `?mybot` | Key prefix; defaults to `hubot` |

**Examples**

```sh
# Default local Redis
REDIS_URL=redis://localhost:6379

# Password auth, custom prefix
REDIS_URL=redis://:s3cr3t@redis.example.com:6379?mybot

# TLS (Upstash, Heroku Redis Premium)
REDIS_URL=rediss://default:token@host.upstash.io:6379

# UNIX socket with prefix
REDIS_URL=redis://user:pass@/var/run/redis.sock?mybot

# Database 2, prefix "staging"
REDIS_URL=redis://localhost:6379/2?staging
```

### Environment variables

Checked in order; first one set wins:

| Variable | Typical provider |
| --- | --- |
| `REDISTOGO_URL` | Redis To Go (Heroku add-on) |
| `REDISCLOUD_URL` | Redis Cloud (Heroku add-on) |
| `BOXEN_REDIS_URL` | Boxen-managed dev environment |
| `REDIS_URL` | Everything else |

### Additional options

| Variable | Effect |
| --- | --- |
| `REDIS_NO_CHECK=1` | Disables the Redis ready check. Required for Twemproxy, which does not support `INFO`. |
| `REDIS_REJECT_UNAUTHORIZED=false` | Disables TLS certificate verification. Useful for self-signed certs in development. |
