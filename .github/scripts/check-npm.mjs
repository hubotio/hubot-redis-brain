import fs from 'node:fs/promises'
import path from 'node:path'

const outputPath = process.env.GITHUB_OUTPUT

const readPackageJson = async () => {
  const pkgPath = path.join(process.cwd(), 'package.json')
  const json = await fs.readFile(pkgPath, 'utf8')
  const pkg = JSON.parse(json)
  return { pkgPath, pkg }
}

const existsOnNpm = async (name, version) => {
  const encoded = encodeURIComponent(name)
  const url = `https://registry.npmjs.org/${encoded}`
  try {
    const res = await fetch(url)
    if (!res.ok) return false
    const data = await res.json()
    const versions = data && data.versions ? Object.keys(data.versions) : []
    return versions.includes(version)
  } catch (e) {
    return false
  }
}

const main = async () => {
  const { pkg } = await readPackageJson()
  const name = pkg.name
  const version = pkg.version
  if (!name || !version) {
    console.log('package.json missing name or version')
    if (outputPath) await fs.appendFile(outputPath, 'exists=false\n')
    return
  }

  const exists = await existsOnNpm(name, version)
  console.log(`npm version check: ${name}@${version} ${exists ? 'exists' : 'missing'}`)
  if (outputPath) await fs.appendFile(outputPath, `exists=${exists ? 'true' : 'false'}\n`)
}

await main()
