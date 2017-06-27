const fs = require('fs')
const path = require('path')

module.exports = function (robot, scripts) {
  const scriptsPath = path.resolve(__dirname, 'src')
  if (isDirSync(scriptsPath)) {
    return (() => {
      const result = []
      for (let script of fs.readdirSync(scriptsPath)) {
        if ((scripts != null) && !scripts.includes('*')) {
          if (scripts.includes(script)) { result.push(robot.loadFile(scriptsPath, script)) } else {
            result.push(undefined)
          }
        } else {
          result.push(robot.loadFile(scriptsPath, script))
        }
      }
      return result
    })()
  }
}

function isDirSync (aPath) {
  try {
    return fs.statSync(aPath).isDirectory()
  } catch (e) {
    if (e.code === 'ENOENT') {
      return false
    } else {
      throw e
    }
  }
}
