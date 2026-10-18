#!/usr/bin/env bun
import { main } from "../src/cli/index.ts";

const code = await main(Bun.argv);
process.exit(code);
