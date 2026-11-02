# Contributing

Frame Studio is an early beta focused on one workflow: turning website screen recordings into polished, muted social videos.

## Report a bug

Open an issue with Windows version, Frame Studio version, source video resolution/codec/frame rate if known, steps to reproduce, and expected versus actual behavior. A small recording helps when you can share it. Remove private or client information first.

For a feature proposal, describe the task it would make easier. Small improvements to editing, accessibility, export reliability, and documentation are especially useful. Please discuss major changes before spending a lot of time implementing them.

## Run locally

Use Node.js 22.12 or newer and npm. Clone this repository, run `npm ci`, `npm run setup:engine` on Windows, then `npm start`. If npm blocks Electron's download script, run `node node_modules/electron/install.js`.

`npm test` covers project math and local persistence. `npm run test:setup` checks engine setup invariants. The Electron suites are `npm run test:app`, `npm run test:features`, and `npm run test:regressions`; they use isolated temporary user-data directories. See [development notes](docs/DEVELOPMENT.md) for packaging and architecture.

Keep PRs focused, explain the behavior change, and mention the checks you ran. Do not commit user recordings, `.frame` files, recovery data, credentials, `node_modules`, or built executables. Contributions are made under this repository's MIT license.
