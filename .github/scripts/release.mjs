import { exec as cpExec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'

const exec = promisify(cpExec)

const run = async (cmd, opts = {}) => {
  try {
    const { stdout } = await exec(cmd, { ...opts })
    return stdout.trim()
  } catch (err) {
    return ''
  }
}

const ensureGitUser = async () => {
  await run("git config user.name 'github-actions[bot]'")
  await run("git config user.email '41898282+github-actions[bot]@users.noreply.github.com'")
}

const getLastTag = async () => {
  const tag = await run('git describe --tags --abbrev=0')
  return tag || ''
}

const getCommitBlocks = async range => {
  const logCmd = range
    ? `git log ${range} --pretty=format:%s%n%b%n==END==`
    : 'git log --pretty=format:%s%n%b%n==END=='
  const out = await run(logCmd)
  if (!out) return []
  return out
    .split('==END==')
    .map(s => s.trim())
    .filter(Boolean)
}

const determineBump = commits => {
  let hasBreaking = false
  let hasFeat = false
  let hasFix = false
  let hasChore = false

  const typeBang = /^([a-z]+)(\([^)]*\))?!:/i
  const feat = /^feat(\([^)]*\))?:/i
  const fix = /^fix(\([^)]*\))?:/i
  const chore = /^chore(\([^)]*\))?:/i

  for (const block of commits) {
    const lines = block.split('\n')
    const subject = (lines.shift() || '').trim()
    const body = lines.join('\n')

    if (typeBang.test(subject)) hasBreaking = true
    if (/BREAKING CHANGE/i.test(body)) hasBreaking = true

    if (feat.test(subject)) hasFeat = true
    if (fix.test(subject)) hasFix = true
    if (chore.test(subject)) hasChore = true
  }

  if (hasBreaking) return 'major'
  if (hasFeat) return 'minor'
  if (hasFix || hasChore) return 'patch'
  return 'none'
}

const parseVersion = v => {
  const cleaned = String(v || '0.0.0').replace(/^v/, '')
  const [maj, min, pat] = cleaned.split('.').map(n => parseInt(n || '0', 10))
  return [isNaN(maj) ? 0 : maj, isNaN(min) ? 0 : min, isNaN(pat) ? 0 : pat]
}

const incVersion = (version, level) => {
  let [maj, min, pat] = parseVersion(version)
  if (level === 'major') {
    maj += 1
    min = 0
    pat = 0
  } else if (level === 'minor') {
    min += 1
    pat = 0
  } else if (level === 'patch') {
    pat += 1
  }
  return `${maj}.${min}.${pat}`
}

const readPackageJson = async () => {
  const pkgPath = path.join(process.cwd(), 'package.json')
  const json = await fs.readFile(pkgPath, 'utf8')
  const pkg = JSON.parse(json)
  return { pkgPath, pkg }
}

const writePackageJson = async (pkgPath, pkg) => {
  const json = JSON.stringify(pkg, null, 2) + '\n'
  await fs.writeFile(pkgPath, json, 'utf8')
}

const main = async () => {
  const isDryRun = process.argv.includes('--dry-run') || ['1', 'true', 'yes'].includes(String(process.env.DRY_RUN || '').toLowerCase())

  await ensureGitUser()
  await run('git fetch --tags --force')

  const lastTag = await getLastTag()
  if (!lastTag) {
    console.log('no existing tag found — skipping release to avoid scanning entire history. create an initial baseline tag like v0.0.0')
    if (process.env.GITHUB_OUTPUT) {
      await fs.appendFile(process.env.GITHUB_OUTPUT, 'released=false\n')
    }
    return
  }

  const range = `${lastTag}..HEAD`
  const commits = await getCommitBlocks(range)

  if (commits.length === 0) {
    console.log(`no commits found since ${lastTag || 'beginning'} — nothing to release`)
    if (process.env.GITHUB_OUTPUT) {
      await fs.appendFile(process.env.GITHUB_OUTPUT, 'released=false\n')
    }
    return
  }

  const bump = determineBump(commits)
  if (bump === 'none') {
    console.log('no conventional commits requiring a release — exiting')
    if (process.env.GITHUB_OUTPUT) {
      await fs.appendFile(process.env.GITHUB_OUTPUT, 'released=false\n')
    }
    return
  }

  const { pkgPath, pkg } = await readPackageJson()
  const baseVersion = lastTag.replace(/^v/, '')
  const newVersion = incVersion(baseVersion, bump)
  const newTag = `v${newVersion}`

  if (lastTag && lastTag.replace(/^v/, '') === newVersion) {
    console.log(`computed version ${newVersion} equals last tag ${lastTag} — nothing to do`)
    if (process.env.GITHUB_OUTPUT) {
      await fs.appendFile(process.env.GITHUB_OUTPUT, 'released=false\n')
    }
    return
  }

  // do not recreate an existing tag
  const tagExists = (await run(`git tag -l ${newTag}`)).trim() === newTag
  if (tagExists) {
    console.log(`tag ${newTag} already exists — skipping`)
    if (process.env.GITHUB_OUTPUT) {
      await fs.appendFile(process.env.GITHUB_OUTPUT, 'released=false\n')
    }
    return
  }

  if (isDryRun) {
    const currentPkgVersion = pkg.version || 'unknown'
    console.log('[dry-run] last tag:', lastTag)
    console.log('[dry-run] bump type:', bump)
    console.log('[dry-run] package.json current version:', currentPkgVersion)
    console.log('[dry-run] would set package.json version to:', newVersion)
    console.log('[dry-run] would create tag:', newTag)
    console.log('[dry-run] would commit with message:', `chore(release): v${newVersion} [skip ci]`)
    if (process.env.GITHUB_OUTPUT) {
      await fs.appendFile(process.env.GITHUB_OUTPUT, 'released=false\n')
    }
    return
  }

  pkg.version = newVersion
  await writePackageJson(pkgPath, pkg)

  await run('git add package.json')
  const commitMsg = `chore(release): v${newVersion} [skip ci]`
  await run(`git commit -m "${commitMsg}"`)

  await run(`git tag -a ${newTag} -m "release ${newTag}"`)

  const branch = await run('git rev-parse --abbrev-ref HEAD')
  await run(`git push origin ${branch}`)
  await run(`git push origin ${newTag}`)

  console.log(`released ${newTag} from base ${lastTag} and pushed changes`)
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, 'released=true\n')
  }
}

await main()
