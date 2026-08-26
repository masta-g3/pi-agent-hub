# Papercuts

- The configured `smoke` subagent had no shell/process tool, so it could not perform the required compiled functional test. A `scout` subagent could run the same temporary-build validation successfully. The harness should expose a shell-capable functional-testing agent or document which installed agent supports process execution.
