#!/usr/bin/env node
import { runCommand, commandError } from './commands.js';
runCommand(process.argv.slice(2))
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(commandError(error));
    process.exitCode = 1;
  });
