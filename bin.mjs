#!/usr/bin/env node

import('./src/main.mjs')
  .then(async mod => await mod.run())
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
