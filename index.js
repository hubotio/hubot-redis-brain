'use strict'

const path = require('path')

module.exports = function (robot, scripts) {
  const scriptsPath = path.resolve(__dirname, 'src')
  robot.loadFile(scriptsPath, 'redis-brain.js')
}
