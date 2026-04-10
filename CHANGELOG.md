# Changelog

All notable changes to `doordash-cli` will be documented in this file.

- Versions follow [Semantic Versioning](https://semver.org/).
- Release entries are generated from squash-merged conventional commits on `main`.
- Git tags use the `vX.Y.Z` form.
- Historical `doordash-cli-vX.Y.Z` tags are bridged locally during release automation.

See [docs/releasing.md](docs/releasing.md) for the maintainer release flow.

## [0.5.0](https://github.com/LatencyTDH/doordash-cli/compare/v0.4.2...v0.5.0) (2026-04-10)

### Features

* add doctor diagnostics command (rebuilt from origin/main) ([#53](https://github.com/LatencyTDH/doordash-cli/issues/53)) ([964af19](https://github.com/LatencyTDH/doordash-cli/commit/964af19b41fad3dded75c9bc454d03bedaeb52ab))
* add stable automation contract and fixture suite ([#51](https://github.com/LatencyTDH/doordash-cli/issues/51)) ([d9489e6](https://github.com/LatencyTDH/doordash-cli/commit/d9489e6bae06eb599f274655ffc44e361b771c48))
* support same-machine auth reuse and owned session storage ([#52](https://github.com/LatencyTDH/doordash-cli/issues/52)) ([49ab222](https://github.com/LatencyTDH/doordash-cli/commit/49ab222735fc3b56a5425659960085517e14f778))

## [0.4.2](https://github.com/LatencyTDH/doordash-cli/compare/v0.4.1...v0.4.2) (2026-04-10)

### Bug Fixes

* import signed-in linux browser profile state for login reuse ([#40](https://github.com/LatencyTDH/doordash-cli/issues/40)) ([97feddc](https://github.com/LatencyTDH/doordash-cli/commit/97feddc68ce0ebc882737dfad69d5e908f20d250))

## [0.4.1](https://github.com/LatencyTDH/doordash-cli/compare/v0.4.0...v0.4.1) (2026-04-10)

### Bug Fixes

* bound auth-check and restore login completion flow ([#39](https://github.com/LatencyTDH/doordash-cli/issues/39)) ([5166944](https://github.com/LatencyTDH/doordash-cli/commit/51669444dc124e39ece719624c997ab9f46acd93))

## [0.4.0](https://github.com/LatencyTDH/doordash-cli/compare/v0.3.3...v0.4.0) (2026-04-10)

### Features

* reuse attached browser sessions for login bootstrap ([#38](https://github.com/LatencyTDH/doordash-cli/issues/38)) ([dc9410d](https://github.com/LatencyTDH/doordash-cli/commit/dc9410ddce1e72b2dce6b772787c8fb0dfa9683a))

## [0.3.3](https://github.com/LatencyTDH/doordash-cli/compare/v0.3.2...v0.3.3) (2026-04-09)

## [0.3.2](https://github.com/LatencyTDH/doordash-cli/compare/v0.3.1...v0.3.2) (2026-04-09)

### Dependencies

* **deps:** bump @hono/node-server from 1.19.11 to 1.19.13 ([#34](https://github.com/LatencyTDH/doordash-cli/issues/34)) ([60ae01d](https://github.com/LatencyTDH/doordash-cli/commit/60ae01d00e06dc8490cf495013a476fb6aef4964))
* **deps:** bump basic-ftp from 5.2.0 to 5.2.1 ([#35](https://github.com/LatencyTDH/doordash-cli/issues/35)) ([8796dfd](https://github.com/LatencyTDH/doordash-cli/commit/8796dfda69c2615048601858e4617c36e864d1ce))
* **deps:** bump defu from 6.1.4 to 6.1.6 ([#32](https://github.com/LatencyTDH/doordash-cli/issues/32)) ([b1746bc](https://github.com/LatencyTDH/doordash-cli/commit/b1746bc51521f95d373f83ea6cb649e3722bf4b2))
* **deps-dev:** bump handlebars from 4.7.8 to 4.7.9 ([#30](https://github.com/LatencyTDH/doordash-cli/issues/30)) ([0eb650e](https://github.com/LatencyTDH/doordash-cli/commit/0eb650e654b1feff2e764bf9204a0e52db7903fd))
* **deps:** bump hono from 4.12.7 to 4.12.12 ([#33](https://github.com/LatencyTDH/doordash-cli/issues/33)) ([21fa857](https://github.com/LatencyTDH/doordash-cli/commit/21fa8570945909f26669746c73d9279a0931f096))
* **deps:** bump lodash from 4.17.23 to 4.18.1 ([#36](https://github.com/LatencyTDH/doordash-cli/issues/36)) ([82b3fd2](https://github.com/LatencyTDH/doordash-cli/commit/82b3fd27f41a44eab33332c8b12f2da48d098713))
* **deps:** bump path-to-regexp from 8.3.0 to 8.4.0 ([#31](https://github.com/LatencyTDH/doordash-cli/issues/31)) ([b07d074](https://github.com/LatencyTDH/doordash-cli/commit/b07d07443cc8614baf4fbe0fe4b703456329cd67))
* **deps:** bump picomatch from 4.0.3 to 4.0.4 ([#29](https://github.com/LatencyTDH/doordash-cli/issues/29)) ([2c95440](https://github.com/LatencyTDH/doordash-cli/commit/2c95440c4830471ea24690faed29c556f56d2461))

## [0.3.1](https://github.com/LatencyTDH/doordash-cli/compare/v0.3.0...v0.3.1) (2026-03-11)

### Bug Fixes

* keep managed browser session imports quiet ([#28](https://github.com/LatencyTDH/doordash-cli/issues/28)) ([dc25e04](https://github.com/LatencyTDH/doordash-cli/commit/dc25e0444ca63c7af1c2feaa2f32ede54b1c1f98))

## [0.3.0](https://github.com/LatencyTDH/doordash-cli/compare/v0.2.0...v0.3.0) (2026-03-11)

### Features

* rename auth commands to login/logout ([#27](https://github.com/LatencyTDH/doordash-cli/issues/27)) ([f5bf85c](https://github.com/LatencyTDH/doordash-cli/commit/f5bf85c556d23e7cefc95f346777d33fb1021bcc))

### Bug Fixes

* preserve existing-order docs in release-flow cleanup ([#25](https://github.com/LatencyTDH/doordash-cli/issues/25)) ([4789089](https://github.com/LatencyTDH/doordash-cli/commit/4789089dd831b42cd037707e82a0f102988fd830))

## 0.2.0 (2026-03-11)

### Bug Fixes

* bridge legacy release tags during release-it migration ([#22](https://github.com/LatencyTDH/doordash-cli/issues/22)) ([0360d90](https://github.com/LatencyTDH/doordash-cli/commit/0360d90a9f1fe0e42a61cc2a34051d714fd2891d))

## 0.1.0 (2026-03-10)

### Features

* add direct DoorDash consumer API transport ([06b5194](https://github.com/LatencyTDH/doordash-cli/commit/06b5194f72e05547574b169cf9a56311309bb722))
* add read-only existing-order tracking ([#9](https://github.com/LatencyTDH/doordash-cli/issues/9)) ([a4695e1](https://github.com/LatencyTDH/doordash-cli/commit/a4695e16fa7e267e265f5e4f5c3d5585657dc337))
* finish direct address enrollment and standalone nested add-ons ([#2](https://github.com/LatencyTDH/doordash-cli/issues/2)) ([d4a2f6a](https://github.com/LatencyTDH/doordash-cli/commit/d4a2f6a29b7dd407ee4444c78cb6af41f3981bc0))
* ship direct session import and configurable item payloads ([360707c](https://github.com/LatencyTDH/doordash-cli/commit/360707c3504d19e424284eb4ac4ac8f7914e9031))
* streamline install and npm packaging ([#11](https://github.com/LatencyTDH/doordash-cli/issues/11)) ([d6cec89](https://github.com/LatencyTDH/doordash-cli/commit/d6cec89ca5f4f239309ea48052072fc9ca944e5d))

### Bug Fixes

* keep release-please on the pre-v1 track ([7af23fa](https://github.com/LatencyTDH/doordash-cli/commit/7af23fa94301642f84802a791fa6f0b53d60371a))
* make linked cli entrypoints usable ([6cd18e4](https://github.com/LatencyTDH/doordash-cli/commit/6cd18e4a9e8165d60cda5bc064aebb6b99b8bf20))
* pin release-please initial version to 0.1.0 ([a679966](https://github.com/LatencyTDH/doordash-cli/commit/a679966ab51f9693eafecfe7fce9123b862d0aec))
* reset direct cart id when switching stores ([4f0db85](https://github.com/LatencyTDH/doordash-cli/commit/4f0db85de3c1fe554cf4b479b2f225b7f1bf88cf))
* validate cart-safe command surface ([f7bcb6c](https://github.com/LatencyTDH/doordash-cli/commit/f7bcb6cc41e6869de1dcbb3fb20f3e6052156efe))
