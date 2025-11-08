// Checks that the latest run of the CI workflow for this commit succeeded
// Writes `result=true|false` to GITHUB_OUTPUT

const token = process.env.GITHUB_TOKEN
const repoFull = process.env.GITHUB_REPOSITORY || ''
const sha = process.env.GITHUB_SHA || ''
const outputPath = process.env.GITHUB_OUTPUT

if (!token) {
  console.log('no GITHUB_TOKEN provided')
  if (outputPath) {
    const fs = await import('node:fs/promises')
    await fs.appendFile(outputPath, 'result=false\n')
  }
  process.exit(0)
}

const [owner, repo] = repoFull.split('/')

const api = 'https://api.github.com'
const workflowId = process.env.WORKFLOW_FILE || 'ci-pipeline.yml'
const branch = process.env.BRANCH || process.env.GITHUB_REF_NAME || 'main'

const headers = {
  'authorization': `Bearer ${token}`,
  'accept': 'application/vnd.github+json'
}

const url = `${api}/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?per_page=50&branch=${encodeURIComponent(branch)}`

let ok = false

try {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`github api ${res.status}`)
  const data = await res.json()
  const run = (data.workflow_runs || []).find(r => r.head_sha === sha)
  if (!run) {
    console.log(`no CI run found for ${sha} on ${branch}`)
  } else if (run.status !== 'completed' || run.conclusion !== 'success') {
    console.log(`CI run not successful on ${branch}: status=${run.status} conclusion=${run.conclusion}`)
  } else {
    ok = true
    console.log(`${workflowId} success for this commit on ${branch}`)
  }
} catch (e) {
  console.log(`error checking ${workflowId} status on ${branch}: ${e.message}`)
}

if (outputPath) {
  const fs = await import('node:fs/promises')
  await fs.appendFile(outputPath, `result=${ok ? 'true' : 'false'}\n`)
}
