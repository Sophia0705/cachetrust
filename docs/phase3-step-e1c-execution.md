# Phase 3 Step E-1C — Nondeterminism Diagnostic Execution

Date: 2026-11-10 (Asia/Seoul)

## 결론

**E-1C status: EXECUTION ABORTED / DIAGNOSTIC INCOMPLETE.**

Baseline A build invocation은 1회 시작됐지만 controller result, stdout/stderr와 Turbo summary가
남기 전에 orchestration call이 중단됐다. Registry `dist`는 일부만 생성됐고 shadcn `dist`는
생성되지 않았다. 따라서 두 task의 실제 MISS를 확인할 수 없으며 baseline A는 유효한 clean
baseline이 아니다. 승인 계약에 따라 자동 재시도하지 않았고 baseline B build도 시작하지
않았다.

기존 E-1 판정은 계속 **INCONCLUSIVE / NONDETERMINISTIC_BASELINE**이다. E2/E3는 계속
**NO-GO**다. 이번 결과는 Turborepo 또는 shadcn/ui의 기능 오류 증거가 아니다.

## 시작 상태와 승인 계약

- CacheTrust branch는 clean 상태였고 HEAD는
  `7b9c7dbe0e15a0f3c99a7395c4b90e16762450d0`이었다.
- Target source는 `shadcn-ui/ui`
  `8ab27715521cbd4f87ae6886cd989cbb678f6de7`, Git-clean이었다.
- Lockfile SHA-256은
  `095aa7494a673e4b15b963a3263bcbc1d025176b00f97406aa61c9893827b862`였다.
- 고정 toolchain은 Node 24.19.0, pnpm 10.33.4, Turbo 2.9.18,
  TypeScript 5.9.2였다.
- 실행 root는 `C:\ct-e1c\run-001`, install/build timeout은 각각 300,000ms였다.
- Build budget은 최대 2회, sequential only, automatic retry 0이었다.
- Normalization, E1 re-verification, E2, E3는 실행 범위 밖이었다.
- 설계 문서의 unresolved `TO VERIFY` 항목은 없었다.

## Preflight와 자원 gate

| Gate | Observation | Result |
| --- | --- | --- |
| Available RAM 1 | 4.576GiB at `2026-11-10T06:49:57.5080138+09:00` | PASS |
| Available RAM 2 | 4.238GiB at `2026-11-10T06:50:07.6659876+09:00` | PASS |
| Interval | 10.158 seconds | PASS |
| Initial C: free | 161.494GiB | PASS, threshold 8GiB |
| Execution root | absent before preparation | PASS |
| Source symlink/submodule | none | PASS |
| A/B source tree | 6,411 files, 52,236,209 bytes each | PASS |
| A/B source manifest | both `3bd91cde2cb5da71cf7e9e406073bcd1271cc9839c861799f660551c20ee9fbd` | PASS |
| Source archive | `9cc5d755c1f67e3629c15a687955d929418fd697c761ad01c42294d748b70f05` | PASS |

두 workspace는 같은 pinned Git archive를 서로 다른 directory에 추출했고 `node_modules`,
`dist`, `.turbo` 또는 Turbo cache를 공유하지 않았다. pnpm immutable store/cache content의
재사용만 허용했다.

Process-tree peak RAM은 측정하지 못했으며 `NOT MEASURED`다. 측정값을 추정하지 않는다.

## Diagnostic helper

Production code와 분리된 다음 도구만 `evidence/phase3-step-e1c/tools/`에 추가했다.

| Tool | SHA-256 |
| --- | --- |
| `chunk-graph.mjs` | `47822f163aebb086f8c484de7526852d3940d96db250b8c8eb586c3cb59b9a77` |
| `chunk-graph.test.mjs` | `449e9e301441d95b0dc076fc635b54e1b5531f44cb3ba704dff66d0db9bef66e` |
| `command-runner.mjs` | `cbfc621e9c72419d0e742f8c79494eca3a3e2b33d09c62850af841901e9741e1` |
| `tree-manifest.mjs` | `9aa73e9e31488681716c437c0167ab2d826cb643b25c6470172e55671899ef3a` |

Chunk helper interface는 다음과 같다.

```text
node chunk-graph.mjs --root <absolute-dist-root> --output <absolute-json-path>
```

Baseline A의 Node 24.19.0 / TypeScript 5.9.2 환경에서 synthetic fixture test를 실행했다.
Renamed chunk, changed import, missing reference, input non-modification 검사가 모두 PASS였다.
Helper는 원본 output을 수정하지 않고 AST에서 import/export/dynamic-import edge를 추출한다.
Source map은 upstream 설정에서 비활성화돼 생성되지 않았다.

## Frozen install과 task graph

두 workspace에서 다음 argv 의미의 frozen install을 한 번씩 실행했다.

```text
%ComSpec% /d /c call "C:\Program Files\nodejs\corepack.cmd"
  pnpm@10.33.4 install --frozen-lockfile
```

| Workspace | Exit | Timeout | Duration | Lockfile after install |
| --- | ---: | --- | ---: | --- |
| baseline A | 0 | false | 99.425s | unchanged |
| baseline B | 0 | false | 95.957s | unchanged |

두 workspace 모두 packageManager `pnpm@10.33.4`, Turbo 2.9.18, TypeScript 5.9.2를
확인했고 build 전 두 `dist` root는 없었다.

Baseline A에서 다음 dry-run을 한 번 실행했다. Task는 실행되지 않았다.

```text
"C:\Program Files\nodejs\node.exe" node_modules/turbo/bin/turbo
  run build --filter shadcn... --dry=json --no-color
```

Dry-run은 exit 0, timeout false, 4.232초였다. 정확히 두 task를 보고했고 graph는
`@shadcn/registry#build -> shadcn#build`였다. 두 task 모두 승인된 outputs
`dist/**`, `.next/**`, `public/r/styles/**`, `styles/**`와 exclusion `.next/cache/**`를
보고했다.

## Build invocation과 중단 지점

Baseline A의 cache directory가 새로 생성된 empty directory임을 확인한 후 다음 command를
시작했다.

```text
"C:\Program Files\nodejs\node.exe" node_modules/turbo/bin/turbo
  run build --filter shadcn...
  --cache=local:rw
  --cache-dir C:\ct-e1c\run-001\cache\baseline-a
  --summarize --ui=stream --no-color --concurrency 1
```

이것이 이번 실험의 유일한 build invocation이다. Orchestration tool call은 `aborted`로
반환됐고 이후 다음 상태를 직접 확인했다.

- controller `build-result.json`: 없음;
- captured build stdout/stderr: 없음;
- `.turbo/runs` summary: 없음;
- baseline A Turbo cache files: 0;
- registry `dist`: 존재하지만 불완전;
- shadcn `dist`: 없음;
- 관련 Turbo/build process: 확인 시 이미 없음.

원인은 확정되지 않았다. Turbo task 자체가 어떤 exit code로 끝났는지, registry task가
완료됐는지, cache status가 MISS였는지는 증명할 수 없다. 파일 생성 시각과 partial output은
build가 실제로 시작됐다는 사실만 지지한다. 이 상태를 build task 실패나 upstream bug로
분류하지 않는다.

승인된 stop condition에 따라 baseline A를 다시 실행하지 않았으며 baseline B build도
시작하지 않았다.

## Preserved partial output

Baseline A registry partial output을 원래 상대 path와 raw bytes 그대로 보존했다.

| Item | Value |
| --- | --- |
| Files | 163 |
| Bytes | 338,845 |
| Raw manifest SHA-256 | `ebb04f24e70035d985a70a865cf2021bea0b1425aae7c808fdcde47921d343e7` |
| Reparse points | 0 |
| Preserved-copy hash match | true |
| Chunk graph nodes | 163 |
| Chunk graph edges | 1,570 |

정상 E-1A registry output은 252개 파일이었으므로 이 tree는 완전한 baseline으로 사용할 수
없다. Shadcn output이 없고 baseline B build도 없으므로 raw A/B fingerprint, chunk graph,
workspace-path, timestamp, ordering 또는 executable-JavaScript 차이 분석은 수행할 수 없다.
Partial graph 구조만으로 기능 동등성을 주장하지 않는다.

## 환경과 보안

Install/build 환경의 공개값은 `CI=true`, `FORCE_COLOR=0`, `NO_COLOR=1`,
`NODE_ENV=production`, `PUPPETEER_SKIP_DOWNLOAD=true`였다. Credential, proxy, build URL,
`npm_config_user_agent`와 Turbo remote-cache 변수는 명시적으로 빈 값으로 override했다.

Evidence에는 전체 process environment, secret 원문 또는 secret hash를 저장하지 않았다.
Turbo dry-run에 나타난 credential 변수는 이름과 빈 값뿐이다. 개인 absolute path는 durable
report에서 제외했다.

## Storage와 cleanup

Repository에 보존한 evidence는 final metadata/hash 생성 전 963,694바이트로 32MiB cap
안에 있었다.

임시 root를 일반 logical file-size walk로 측정하면 17,077,483,682바이트(약 15.905GiB)다.
이 값은 pnpm hardlink를 경로마다 중복 계산한다. 반면 host C: free space는 시작
161.494GiB, install 후 163.023GiB, partial capture 후 162.834GiB로 unrelated host activity의
영향을 받아 실제 experiment physical allocation을 증명하지 못한다. 따라서 승인된 6GiB
temporary cap 준수는 **NOT DEMONSTRATED**다.

이 storage conflict가 확인된 뒤 추가 copy/분석을 중단했다. Evidence integrity 확인 전
삭제 금지 계약과 physical-size 불확실성 때문에 `C:\ct-e1c\run-001`은 정리하지 않고
보존했다. 삭제 또는 추가 실행에는 별도 승인과 storage 측정 계약 수정이 필요하다.

## Confirmed findings와 미해결 사항

확인된 사실:

- 두 source snapshot과 lockfile은 동일했다.
- 두 frozen install과 dry-run은 성공했다.
- Helper synthetic validation은 통과했다.
- Baseline A build는 시작됐지만 진단에 필요한 결과가 남기 전에 중단됐다.
- Partial registry bytes는 보존 copy와 hash가 일치한다.
- Retry는 0회이고 baseline B build는 0회다.

미해결:

- Baseline A controller result가 남지 않은 정확한 원인;
- 두 task의 실제 MISS/HIT와 task 성공 여부;
- 원래 61개 nondeterministic difference의 root cause;
- Temporary root의 실제 physical allocated size와 6GiB cap 준수 여부.

## Evidence와 무결성

- `evidence/phase3-step-e1c/run-001/`: 실행, install, dry-run, partial output와 분석 evidence;
- `evidence/phase3-step-e1c/tools/`: 고정 helper와 test;
- `evidence/phase3-step-e1c/hashes.sha256`: 모든 새 E-1C evidence의 SHA-256.

기존 E-1/E-1A/E-1B evidence는 변경하거나 덮어쓰지 않았다. Hash 목록 생성 후 모든
항목을 다시 검증한다.

## 권고 다음 조치

현재 상태는 **NO-GO for another diagnostic execution**이다. 먼저 다음 두 문제를 별도
승인으로 해결해야 한다.

1. Hardlink-aware physical allocation 측정 방식과 6GiB cap 의미를 명확히 한다.
2. Controller interruption 원인을 분석하고, build를 재실행하지 않는 상태에서 command
   lifecycle/evidence flush 경계를 검토한다.

그 후에도 새 build retry는 별도 명시적 승인이 필요하다. E1/E2/E3는 시작하지 않는다.
