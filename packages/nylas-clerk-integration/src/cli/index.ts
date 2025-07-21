#!/usr/bin/env node

import { Command } from "commander"
import { setupCommand } from "./commands/setup.js"
import { VERSION } from "../index.js"

const program = new Command()

program
  .name("nylas-clerk-integration")
  .description("CLI for setting up Nylas with Clerk OAuth applications")
  .version(VERSION)

// Add commands
program.addCommand(setupCommand)

// Parse arguments
program.parse(process.argv) 