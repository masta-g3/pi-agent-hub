# Papercuts

- The repository has no non-disruptive focused-test command. `node --import tsx` is unavailable, while `npm test` rebuilds linked `dist`. A temporary `tsc --outDir` works for focused tests, but CLI integration tests still resolve `dist/cli.js` in the checkout and fail unless the normal build has run. A documented focused-test helper would make safe validation clearer.
