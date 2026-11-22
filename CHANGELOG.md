# Changelog

## [2.0.0](https://github.com/PyModel/antigravity-mcp/compare/v1.0.0...v2.0.0) (2026-11-22)


### ⚠ BREAKING CHANGES

* an unrecognised value for any AGY_* environment variable now stops the server instead of falling back to a default, and AGY_SKIP_PERMISSIONS / AGY_SANDBOX honour every documented boolean spelling rather than only "false" / "true". The conversation-cache fallback is gone: follow_up requires a session id the bridge itself returned. A run that asks for --mode plan or --sandbox on an agy build lacking the flag now fails instead of running unrestricted.
* the default model and built-in routing chains now target Gemini 3.7 Flash; setups pinned to agy listings without 3.7 models will fall back differently.

### Features

* add adversarial_review delegation tool ([67898c9](https://github.com/PyModel/antigravity-mcp/commit/67898c9c651d10ae2d5e3ca3338795d9538b7722))
* add AGY_ON_FAILURE strict mode ([12f25db](https://github.com/PyModel/antigravity-mcp/commit/12f25db504231d45558c4a54d403b26989456ba4))
* add analyze_files delegation tool ([816c2cc](https://github.com/PyModel/antigravity-mcp/commit/816c2ccbdf51d5f78f4c899e5d8b9cd64d774f1b))
* add config type for agy delegation ([d3eaabb](https://github.com/PyModel/antigravity-mcp/commit/d3eaabb8a5a41a9dec105531698c7e2e27783994))
* add deep_search delegation tool ([0d777f9](https://github.com/PyModel/antigravity-mcp/commit/0d777f97da352bfb3c76fb2c8834e6b02f3383d3))
* add follow_up session continuation tool ([a7ae51b](https://github.com/PyModel/antigravity-mcp/commit/a7ae51b15b933b7173ac6f75260410ac9939335a))
* add Gemini 4 routing and harden delegation ([#57](https://github.com/PyModel/antigravity-mcp/issues/57)) ([4529ab6](https://github.com/PyModel/antigravity-mcp/commit/4529ab614b09a51a75ee7f04b56907fdf82463b6))
* add quota duration parsing helpers ([6b58baa](https://github.com/PyModel/antigravity-mcp/commit/6b58baad68fbbf4be8871cecb91d2757a02e5fc8))
* add raw delegate tool ([b2af0a5](https://github.com/PyModel/antigravity-mcp/commit/b2af0a5e0fd170383f10ade5206fdf15cd03728e))
* add shared prompt rules and path resolution ([25c45d7](https://github.com/PyModel/antigravity-mcp/commit/25c45d7713a63d9d2ce2ca4035190b4fd2c0acf5))
* add stdio entry point ([79ce43f](https://github.com/PyModel/antigravity-mcp/commit/79ce43f347545f3f06471350cc2688a8d2f45f21))
* add tool response types ([7894761](https://github.com/PyModel/antigravity-mcp/commit/7894761d590fbdfb0db15223b26d3620d2245970))
* add typed quota exhaustion error ([1e7a895](https://github.com/PyModel/antigravity-mcp/commit/1e7a895da35f3d6a8567cbdd8fe2abfe542f56df))
* add web_lookup delegation tool ([8c17d8a](https://github.com/PyModel/antigravity-mcp/commit/8c17d8a056e6e0c5192da42b0e8130dfcaa41245))
* annotate results with model and session metadata ([e92971d](https://github.com/PyModel/antigravity-mcp/commit/e92971db8b4cd5466963de2878295c24f6583132))
* apply timeout precedence and conversation bypass ([07ee204](https://github.com/PyModel/antigravity-mcp/commit/07ee204f46c18141bb125711974c65831af1c5fc))
* ask the model once, lead with Gemini Flash High, fix effort for agy 1.2.1 ([#31](https://github.com/PyModel/antigravity-mcp/issues/31)) ([0ca41c5](https://github.com/PyModel/antigravity-mcp/commit/0ca41c582fe35c0778063be8edd112ab9399f456))
* build agy cli argument vector ([cfa6d81](https://github.com/PyModel/antigravity-mcp/commit/cfa6d814a2d976054e77a1b42d32984acb0a713a))
* cache the agy models listing ([e9342d9](https://github.com/PyModel/antigravity-mcp/commit/e9342d977ef089bbd6f7c7ecc5d9dfa0ca34da26))
* cancel runs on client abort ([367ae98](https://github.com/PyModel/antigravity-mcp/commit/367ae9840d051610171c06cac3fd06ed3d97b83d))
* capture session ids for follow-up ([94b9ab2](https://github.com/PyModel/antigravity-mcp/commit/94b9ab2ae8a6ff3c6c7f6f07f934176675475e32))
* close child stdin to avoid EOF hangs ([82683e1](https://github.com/PyModel/antigravity-mcp/commit/82683e1afe289388dc3fa86a7a2cfe966e0d53a0))
* create per-tool delegation handler ([e85aec6](https://github.com/PyModel/antigravity-mcp/commit/e85aec67c45d698603e15c99837c991854a9652c))
* dedupe concurrent listing fetches ([fbcaed9](https://github.com/PyModel/antigravity-mcp/commit/fbcaed905b67fc90d0c85c92f1ed63ce62ee88a1))
* default to Gemini 3.7 Flash (High) across all tool chains ([#17](https://github.com/PyModel/antigravity-mcp/issues/17)) ([a27c4cb](https://github.com/PyModel/antigravity-mcp/commit/a27c4cbcede6ae106f9f9b4afadd9d9252a8d1c8))
* detect quota exhaustion from the run log ([0180d96](https://github.com/PyModel/antigravity-mcp/commit/0180d967f92da7d2c502dbff2ec08e840b38b344))
* detect quota exhaustion in agy logs ([2c8a516](https://github.com/PyModel/antigravity-mcp/commit/2c8a51663559d88b9d4064824522f83a808dd4e4))
* enforce hard runtime deadline and kill policy ([33a320a](https://github.com/PyModel/antigravity-mcp/commit/33a320af93773a777336b0a21fca835b87a783b9))
* enforce read-only runs with the macOS sandbox ([#39](https://github.com/PyModel/antigravity-mcp/issues/39)) ([29f5b5c](https://github.com/PyModel/antigravity-mcp/commit/29f5b5c8d5f4343d1cab33c774f8deda359e64a2))
* expose single-model resolution convenience ([ecbe51e](https://github.com/PyModel/antigravity-mcp/commit/ecbe51e8c992e096bb6e57974e7f186ff3aa1124))
* fail over between models on quota exhaustion ([c5b4b85](https://github.com/PyModel/antigravity-mcp/commit/c5b4b85895ea96c13ab2afacb6698230fd38c19f))
* harden the bridge and ship the delegate skill in the package ([#34](https://github.com/PyModel/antigravity-mcp/issues/34)) ([3f049c2](https://github.com/PyModel/antigravity-mcp/commit/3f049c207e5d28bd1d4ddea527a329ab075ed087))
* load runtime config from environment ([48b533a](https://github.com/PyModel/antigravity-mcp/commit/48b533a754a51d9d4dd0b5c8573beafec67e1b6a))
* parse tab-separated agy models listing ([9e8a365](https://github.com/PyModel/antigravity-mcp/commit/9e8a3656aaa4022693aa4557af1ac34739e42c7c))
* provide default runner dependencies ([cb293e2](https://github.com/PyModel/antigravity-mcp/commit/cb293e238698e44bb8dd862bef5c1b44cdc88a14))
* rebrand as Antigravity MCP for coding agents ([#59](https://github.com/PyModel/antigravity-mcp/issues/59)) ([92b1335](https://github.com/PyModel/antigravity-mcp/commit/92b1335057bc9d7047deef2e476fb29bf6baa5d4))
* resolve model chains in preference order ([f1985d0](https://github.com/PyModel/antigravity-mcp/commit/f1985d0de946277f11105b745cdff18ab50dbf0a))
* run agy to completion with error mapping ([f601990](https://github.com/PyModel/antigravity-mcp/commit/f601990f759c83369a1f37008c08212b592b972b))
* scaffold runner types ([ff36c41](https://github.com/PyModel/antigravity-mcp/commit/ff36c41cd8fdc7af70097bc3153fa9472921438b))
* scaffold tool definition shape ([c61c0ab](https://github.com/PyModel/antigravity-mcp/commit/c61c0abff422c329dee8c421f659ab3968651a05))
* spawn agy as a detached process group ([b63dc12](https://github.com/PyModel/antigravity-mcp/commit/b63dc129ead579ff8204a63ac6eac2711a14b1c0))
* support per-tool timeout overrides ([34cfd7a](https://github.com/PyModel/antigravity-mcp/commit/34cfd7a9d54f817ea748ff278d3206e3c2dee6ff))
* track per-model cooldowns for failover ([4793f13](https://github.com/PyModel/antigravity-mcp/commit/4793f1342514aa3c9338a2e04a270568559fce33))
* truncate oversized agy output ([cd207e8](https://github.com/PyModel/antigravity-mcp/commit/cd207e8b25088ef04b7d449854c9e79618317abf))
* wire tools into an MCP server ([84b49f6](https://github.com/PyModel/antigravity-mcp/commit/84b49f6fc481133412f4dee288fc48c5e1e5e46a))


### Bug Fixes

* align skill names and links with Antigravity MCP ([#60](https://github.com/PyModel/antigravity-mcp/issues/60)) ([e6f6713](https://github.com/PyModel/antigravity-mcp/commit/e6f6713dfc7ecf63473e00c7b3db2c6a01590e79))
* fingerprint ignored files and build with esbuild alone ([#38](https://github.com/PyModel/antigravity-mcp/issues/38)) ([5838e36](https://github.com/PyModel/antigravity-mcp/commit/5838e3620ca2f8fe63f009d30ac2b18f221bbbed))
* harden the bridge against edge cases found by an end-to-end audit ([#37](https://github.com/PyModel/antigravity-mcp/issues/37)) ([6cbf208](https://github.com/PyModel/antigravity-mcp/commit/6cbf2084a346515c40e7a1e620e9a1a70c74c645))
* keep the advertised version out of the bundled package.json ([#7](https://github.com/PyModel/antigravity-mcp/issues/7)) ([20735f4](https://github.com/PyModel/antigravity-mcp/commit/20735f484be9e1b4b226029609428035434674d6))
* publish a working install command and stop the version drifting ([#35](https://github.com/PyModel/antigravity-mcp/issues/35)) ([01547b8](https://github.com/PyModel/antigravity-mcp/commit/01547b83192ad0574a27b322377f381ef99e0b79))
* readme ([#19](https://github.com/PyModel/antigravity-mcp/issues/19)) ([d794b72](https://github.com/PyModel/antigravity-mcp/commit/d794b72ab66d1b4b0754f6ef874f6ccf2c7c5867))
* readme ([#20](https://github.com/PyModel/antigravity-mcp/issues/20)) ([6dcc97a](https://github.com/PyModel/antigravity-mcp/commit/6dcc97a2716272012a159a6bb9468bd71604c46d))
* readme ([#21](https://github.com/PyModel/antigravity-mcp/issues/21)) ([f1b3093](https://github.com/PyModel/antigravity-mcp/commit/f1b30933bd8ac975049cd9a8aafb762f1d8e617e))
* readme ([#22](https://github.com/PyModel/antigravity-mcp/issues/22)) ([2930936](https://github.com/PyModel/antigravity-mcp/commit/2930936a178e5caff590fd8595839249f9492775))
* report a follow_up that agy answered from a new conversation ([#36](https://github.com/PyModel/antigravity-mcp/issues/36)) ([bfb4dcf](https://github.com/PyModel/antigravity-mcp/commit/bfb4dcf167f5b7c055770098bfeee5b96e00fd22))

## [1.0.0](https://github.com/PyModel/antigravity-mcp/compare/v0.1.0...v1.0.0) (2026-11-22)


### ⚠ BREAKING CHANGES

* an unrecognised value for any AGY_* environment variable now stops the server instead of falling back to a default, and AGY_SKIP_PERMISSIONS / AGY_SANDBOX honour every documented boolean spelling rather than only "false" / "true". The conversation-cache fallback is gone: follow_up requires a session id the bridge itself returned. A run that asks for --mode plan or --sandbox on an agy build lacking the flag now fails instead of running unrestricted.
* the default model and built-in routing chains now target Gemini 3.7 Flash; setups pinned to agy listings without 3.7 models will fall back differently.

### Features

* add adversarial_review delegation tool ([67898c9](https://github.com/PyModel/antigravity-mcp/commit/67898c9c651d10ae2d5e3ca3338795d9538b7722))
* add AGY_ON_FAILURE strict mode ([12f25db](https://github.com/PyModel/antigravity-mcp/commit/12f25db504231d45558c4a54d403b26989456ba4))
* add analyze_files delegation tool ([816c2cc](https://github.com/PyModel/antigravity-mcp/commit/816c2ccbdf51d5f78f4c899e5d8b9cd64d774f1b))
* add config type for agy delegation ([d3eaabb](https://github.com/PyModel/antigravity-mcp/commit/d3eaabb8a5a41a9dec105531698c7e2e27783994))
* add deep_search delegation tool ([0d777f9](https://github.com/PyModel/antigravity-mcp/commit/0d777f97da352bfb3c76fb2c8834e6b02f3383d3))
* add follow_up session continuation tool ([a7ae51b](https://github.com/PyModel/antigravity-mcp/commit/a7ae51b15b933b7173ac6f75260410ac9939335a))
* add Gemini 4 routing and harden delegation ([#57](https://github.com/PyModel/antigravity-mcp/issues/57)) ([4529ab6](https://github.com/PyModel/antigravity-mcp/commit/4529ab614b09a51a75ee7f04b56907fdf82463b6))
* add quota duration parsing helpers ([6b58baa](https://github.com/PyModel/antigravity-mcp/commit/6b58baad68fbbf4be8871cecb91d2757a02e5fc8))
* add raw delegate tool ([b2af0a5](https://github.com/PyModel/antigravity-mcp/commit/b2af0a5e0fd170383f10ade5206fdf15cd03728e))
* add shared prompt rules and path resolution ([25c45d7](https://github.com/PyModel/antigravity-mcp/commit/25c45d7713a63d9d2ce2ca4035190b4fd2c0acf5))
* add stdio entry point ([79ce43f](https://github.com/PyModel/antigravity-mcp/commit/79ce43f347545f3f06471350cc2688a8d2f45f21))
* add tool response types ([7894761](https://github.com/PyModel/antigravity-mcp/commit/7894761d590fbdfb0db15223b26d3620d2245970))
* add typed quota exhaustion error ([1e7a895](https://github.com/PyModel/antigravity-mcp/commit/1e7a895da35f3d6a8567cbdd8fe2abfe542f56df))
* add web_lookup delegation tool ([8c17d8a](https://github.com/PyModel/antigravity-mcp/commit/8c17d8a056e6e0c5192da42b0e8130dfcaa41245))
* annotate results with model and session metadata ([e92971d](https://github.com/PyModel/antigravity-mcp/commit/e92971db8b4cd5466963de2878295c24f6583132))
* apply timeout precedence and conversation bypass ([07ee204](https://github.com/PyModel/antigravity-mcp/commit/07ee204f46c18141bb125711974c65831af1c5fc))
* ask the model once, lead with Gemini Flash High, fix effort for agy 1.2.1 ([#31](https://github.com/PyModel/antigravity-mcp/issues/31)) ([0ca41c5](https://github.com/PyModel/antigravity-mcp/commit/0ca41c582fe35c0778063be8edd112ab9399f456))
* build agy cli argument vector ([cfa6d81](https://github.com/PyModel/antigravity-mcp/commit/cfa6d814a2d976054e77a1b42d32984acb0a713a))
* cache the agy models listing ([e9342d9](https://github.com/PyModel/antigravity-mcp/commit/e9342d977ef089bbd6f7c7ecc5d9dfa0ca34da26))
* cancel runs on client abort ([367ae98](https://github.com/PyModel/antigravity-mcp/commit/367ae9840d051610171c06cac3fd06ed3d97b83d))
* capture session ids for follow-up ([94b9ab2](https://github.com/PyModel/antigravity-mcp/commit/94b9ab2ae8a6ff3c6c7f6f07f934176675475e32))
* close child stdin to avoid EOF hangs ([82683e1](https://github.com/PyModel/antigravity-mcp/commit/82683e1afe289388dc3fa86a7a2cfe966e0d53a0))
* create per-tool delegation handler ([e85aec6](https://github.com/PyModel/antigravity-mcp/commit/e85aec67c45d698603e15c99837c991854a9652c))
* dedupe concurrent listing fetches ([fbcaed9](https://github.com/PyModel/antigravity-mcp/commit/fbcaed905b67fc90d0c85c92f1ed63ce62ee88a1))
* default to Gemini 3.7 Flash (High) across all tool chains ([#17](https://github.com/PyModel/antigravity-mcp/issues/17)) ([a27c4cb](https://github.com/PyModel/antigravity-mcp/commit/a27c4cbcede6ae106f9f9b4afadd9d9252a8d1c8))
* detect quota exhaustion from the run log ([0180d96](https://github.com/PyModel/antigravity-mcp/commit/0180d967f92da7d2c502dbff2ec08e840b38b344))
* detect quota exhaustion in agy logs ([2c8a516](https://github.com/PyModel/antigravity-mcp/commit/2c8a51663559d88b9d4064824522f83a808dd4e4))
* enforce hard runtime deadline and kill policy ([33a320a](https://github.com/PyModel/antigravity-mcp/commit/33a320af93773a777336b0a21fca835b87a783b9))
* enforce read-only runs with the macOS sandbox ([#39](https://github.com/PyModel/antigravity-mcp/issues/39)) ([29f5b5c](https://github.com/PyModel/antigravity-mcp/commit/29f5b5c8d5f4343d1cab33c774f8deda359e64a2))
* expose single-model resolution convenience ([ecbe51e](https://github.com/PyModel/antigravity-mcp/commit/ecbe51e8c992e096bb6e57974e7f186ff3aa1124))
* fail over between models on quota exhaustion ([c5b4b85](https://github.com/PyModel/antigravity-mcp/commit/c5b4b85895ea96c13ab2afacb6698230fd38c19f))
* harden the bridge and ship the delegate skill in the package ([#34](https://github.com/PyModel/antigravity-mcp/issues/34)) ([3f049c2](https://github.com/PyModel/antigravity-mcp/commit/3f049c207e5d28bd1d4ddea527a329ab075ed087))
* load runtime config from environment ([48b533a](https://github.com/PyModel/antigravity-mcp/commit/48b533a754a51d9d4dd0b5c8573beafec67e1b6a))
* parse tab-separated agy models listing ([9e8a365](https://github.com/PyModel/antigravity-mcp/commit/9e8a3656aaa4022693aa4557af1ac34739e42c7c))
* provide default runner dependencies ([cb293e2](https://github.com/PyModel/antigravity-mcp/commit/cb293e238698e44bb8dd862bef5c1b44cdc88a14))
* rebrand as Antigravity MCP for coding agents ([#59](https://github.com/PyModel/antigravity-mcp/issues/59)) ([92b1335](https://github.com/PyModel/antigravity-mcp/commit/92b1335057bc9d7047deef2e476fb29bf6baa5d4))
* resolve model chains in preference order ([f1985d0](https://github.com/PyModel/antigravity-mcp/commit/f1985d0de946277f11105b745cdff18ab50dbf0a))
* run agy to completion with error mapping ([f601990](https://github.com/PyModel/antigravity-mcp/commit/f601990f759c83369a1f37008c08212b592b972b))
* scaffold runner types ([ff36c41](https://github.com/PyModel/antigravity-mcp/commit/ff36c41cd8fdc7af70097bc3153fa9472921438b))
* scaffold tool definition shape ([c61c0ab](https://github.com/PyModel/antigravity-mcp/commit/c61c0abff422c329dee8c421f659ab3968651a05))
* spawn agy as a detached process group ([b63dc12](https://github.com/PyModel/antigravity-mcp/commit/b63dc129ead579ff8204a63ac6eac2711a14b1c0))
* support per-tool timeout overrides ([34cfd7a](https://github.com/PyModel/antigravity-mcp/commit/34cfd7a9d54f817ea748ff278d3206e3c2dee6ff))
* track per-model cooldowns for failover ([4793f13](https://github.com/PyModel/antigravity-mcp/commit/4793f1342514aa3c9338a2e04a270568559fce33))
* truncate oversized agy output ([cd207e8](https://github.com/PyModel/antigravity-mcp/commit/cd207e8b25088ef04b7d449854c9e79618317abf))
* wire tools into an MCP server ([84b49f6](https://github.com/PyModel/antigravity-mcp/commit/84b49f6fc481133412f4dee288fc48c5e1e5e46a))


### Bug Fixes

* align skill names and links with Antigravity MCP ([#60](https://github.com/PyModel/antigravity-mcp/issues/60)) ([e6f6713](https://github.com/PyModel/antigravity-mcp/commit/e6f6713dfc7ecf63473e00c7b3db2c6a01590e79))
* fingerprint ignored files and build with esbuild alone ([#38](https://github.com/PyModel/antigravity-mcp/issues/38)) ([5838e36](https://github.com/PyModel/antigravity-mcp/commit/5838e3620ca2f8fe63f009d30ac2b18f221bbbed))
* harden the bridge against edge cases found by an end-to-end audit ([#37](https://github.com/PyModel/antigravity-mcp/issues/37)) ([6cbf208](https://github.com/PyModel/antigravity-mcp/commit/6cbf2084a346515c40e7a1e620e9a1a70c74c645))
* keep the advertised version out of the bundled package.json ([#7](https://github.com/PyModel/antigravity-mcp/issues/7)) ([20735f4](https://github.com/PyModel/antigravity-mcp/commit/20735f484be9e1b4b226029609428035434674d6))
* publish a working install command and stop the version drifting ([#35](https://github.com/PyModel/antigravity-mcp/issues/35)) ([01547b8](https://github.com/PyModel/antigravity-mcp/commit/01547b83192ad0574a27b322377f381ef99e0b79))
* readme ([#19](https://github.com/PyModel/antigravity-mcp/issues/19)) ([d794b72](https://github.com/PyModel/antigravity-mcp/commit/d794b72ab66d1b4b0754f6ef874f6ccf2c7c5867))
* readme ([#20](https://github.com/PyModel/antigravity-mcp/issues/20)) ([6dcc97a](https://github.com/PyModel/antigravity-mcp/commit/6dcc97a2716272012a159a6bb9468bd71604c46d))
* readme ([#21](https://github.com/PyModel/antigravity-mcp/issues/21)) ([f1b3093](https://github.com/PyModel/antigravity-mcp/commit/f1b30933bd8ac975049cd9a8aafb762f1d8e617e))
* readme ([#22](https://github.com/PyModel/antigravity-mcp/issues/22)) ([2930936](https://github.com/PyModel/antigravity-mcp/commit/2930936a178e5caff590fd8595839249f9492775))
* report a follow_up that agy answered from a new conversation ([#36](https://github.com/PyModel/antigravity-mcp/issues/36)) ([bfb4dcf](https://github.com/PyModel/antigravity-mcp/commit/bfb4dcf167f5b7c055770098bfeee5b96e00fd22))
