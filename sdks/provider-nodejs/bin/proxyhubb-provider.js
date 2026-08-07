#!/usr/bin/env node
"use strict";

const { main } = require("../lib/index.js");

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err.message || err);
    process.exit(1);
  }
);
