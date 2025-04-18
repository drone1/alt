// Mocha configuration file
module.exports = {
  require: 'test/mocha.setup.js',
  spec: 'test/**/*.test.js',
  'node-option': [
    'experimental-vm-modules',
    'no-warnings'
  ],
  timeout: 10000,
  recursive: true,
  parallel: false,
  color: true
}
