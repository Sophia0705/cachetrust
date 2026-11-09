# Phase 3 Step E-1C — Nondeterminism Diagnostic Experiment Design

## 상태

**DESIGN COMPLETE / EXECUTION NOT AUTHORIZED**

이 문서는 Phase 3 E-1에서 관찰된 clean-build nondeterminism의 원인을 찾기 위한 후속
진단 실험만 설계한다. 실험은 실행하지 않았으며 E-1 판정은 계속
`INCONCLUSIVE / NONDETERMINISTIC_BASELINE`이다. E2/E3는 계속 **NO-GO**다.

## 목적과 기존 증거

대상은 `shadcn-ui/ui` commit
`8ab27715521cbd4f87ae6886cd989cbb678f6de7`이며 고정 toolchain은 pnpm 10.33.4,
Turbo 2.9.18이다. 선택 task는 `@shadcn/registry#build`와 `shadcn#build`다.

확인된 사실은 다음과 같다.

- E-1의 두 clean baseline에서 두 task 모두 실제 MISS였다.
- cache population은 MISS였고 동일 입력 재실행은 실제 local HIT였다.
- baseline A/B의 raw manifest는 각각 270개 파일이었지만 61개 경로가 달랐다.
  구성은 content 37개, A-only 12개, B-only 12개였다.
- 51개 차이는 실행 JavaScript와 직접 관련됐다. 해시 chunk의 같은 바이트 수만으로
  기능 동등성을 입증할 수 없었다.
- E-1A에서 측정한 한 build의 두 `dist` 합계는 873,323바이트였다(registry 665,485,
  shadcn 207,838). 한 설치 workspace는 약 1.35GB까지 증가했다.
- E-1의 원본 baseline workspace는 정리돼 path/size/SHA-256 manifest만 남았고 실제 파일
  바이트와 bundler graph는 남지 않았다.
- 고정 source의 tsup 설정은 registry의 다수 glob entry와 shared chunks, shadcn의 8개
  entry, ESM, minification, tree shaking, declarations, `sourcemap: false`를 사용한다.
- 승인된 normalization은 없다.

Turbo task graph와 bundler chunk graph는 서로 다른 증거다. 전자는 task 의존성과 cache
관찰에만 사용하고, 후자는 보존된 JavaScript에서 별도로 복원한다.

## 명시적 가설

| ID | 가설 | 현재 상태 |
| --- | --- | --- |
| H1 | workspace 절대 경로나 경로 길이가 출력에 포함되거나 bundler 동작을 바꾼다 | 직접 증거 없음 |
| H2 | timestamp 또는 build-time metadata가 출력에 삽입된다 | 직접 증거 없음 |
| H3 | 명시 또는 ambient 환경 차이가 출력에 영향을 준다 | E-1은 override가 같았지만 전체 build 환경 증거는 제한적 |
| H4 | entry 발견 순서, module traversal 또는 minifier 순서가 chunk ID/내용을 바꾼다 | 61개 차이 형태와 양립하지만 미입증 |
| H5 | 두 build의 실제 bundler/module graph가 다르다 | graph 미보존으로 미확인 |
| H6 | 같은 역할로 보이는 chunk에도 실제 JavaScript 로직 차이가 있다 | 원본 byte diff 부재로 미확인 |
| H7 | 위 항목 외의 filesystem, locale 또는 tool 내부 nondeterminism이다 | 배제할 증거 없음 |

## 실험 불변조건

- 독립된 짧은 Windows 경로 아래 baseline A/B workspace와 Turbo cache를 각각 만든다.
- 두 workspace는 같은 pinned Git archive에서 생성하되 파일과 `node_modules`를 공유하지
  않는다. pnpm의 immutable content-addressed store 공유만 허용한다.
- install과 build는 동일한 정제 환경을 사용한다.
- 각 workspace에서 frozen install 1회, Turbo build 1회만 수행한다.
- build는 A 다음 B 순서로만 실행하며 동시 실행하지 않는다.
- 각 Turbo cache는 실행 전에 존재하지 않거나 완전히 비어 있어야 한다.
- remote cache를 비활성화한다.
- source, lockfile, tsup/Turbo 설정은 수정하지 않는다.
- build output은 rename, rewrite, normalization 또는 압축 없이 원래 상대 경로와 byte를
  보존한다.
- 자동 재시도는 없다. 계획된 build invocation 상한은 총 2회다.

## 사전 gate

모든 gate를 실행 기록에 PASS로 남긴 경우에만 baseline A를 시작한다.

### 저장소와 toolchain

1. source checkout의 remote, HEAD, clean status를 확인한다. HEAD는 정확히 pinned SHA여야
   하며 tracked/untracked 변경이 있으면 중단한다.
2. `package.json#packageManager`가 `pnpm@10.33.4`인지 확인한다.
3. `pnpm-lock.yaml` SHA-256이 기존 값
   `095aa7494a673e4b15b963a3263bcbc1d025176b00f97406aa61c9893827b862`와 일치하는지
   확인한다.
4. Node 실행 파일과 버전을 기록한다. 기존 성공 환경은 Node 24.19.0이지만 실제 실행
   시 같은 binary인지 **TO VERIFY**다. 선택 package의 `>=20.18.1` engine을 충족해야 한다.
5. 격리 provisioning으로 pnpm 10.33.4를 probe한다. global pnpm을 변경하지 않는다.
6. install 후 각 workspace-local Turbo가 2.9.18, tsup이 8.5.0인지 확인한다. lockfile의
   esbuild 0.25.11, Rollup 4.60.1, TypeScript 5.9.2 resolution도 기록한다.
7. archive 생성 전 Git mode `120000` 파일과 submodule이 없는지 재확인한다. 하나라도
   있으면 현재 추출 전략을 사용하지 않고 중단한다.

### RAM과 disk

- Windows available RAM을 최소 10초 간격으로 두 번 측정한다.
- 두 값 모두 4GiB 이상이어야 한다. 기준을 낮추지 않는다.
- 측정 사이에 다른 process를 종료하거나 system 설정을 바꾸지 않는다.
- 실험 root가 위치할 volume에 최소 8GiB free가 있어야 한다. 이는 이전 승인 gate와
  같고, 약 1.35GB였던 workspace 두 개 및 진단 여유를 포함한다.
- baseline A install/build 후 free space와 experiment-root 크기를 다시 측정한다. free가
  8GiB 아래로 내려가거나 전체 실행이 승인된 임시 footprint 상한을 넘을 전망이면 B를
  시작하지 않는다.
- 임시 workspace 전체 상한은 **6GiB**, 최종 retained evidence 상한은 **64MiB**로 제안한다.
  실제 실행 승인 전에 이 두 상한을 명시적으로 승인받아야 하므로 현재는 **TO VERIFY**다.
- process-tree peak RAM을 신뢰성 있게 측정할 도구는 현재 확정되지 않았다. 실행 시
  available RAM의 주기 표본과 관찰 가능한 direct-process working set만 기록하고,
  process-tree peak는 `NOT MEASURED`로 남긴다. 측정값을 추정하지 않는다.

### 시간과 실패 안전성

기존 E-1에서 사용한 install/build timeout의 정확한 값은 공개 evidence에 남아 있지 않다.
후속 승인 전에 각 command의 timeout을 정해 기록해야 하며 현재 **TO VERIFY**다. timeout,
비정상 exit, summary 부재 또는 예기치 않은 새 파일은 실패이며 재실행하지 않는다.

## 제안 workspace 및 cache 구조

개인 경로가 없는 짧은 owned root를 사용한다. 아래 실제 root와 run ID는 실행 직전에
확정하므로 **TO VERIFY**다.

```text
<owned-short-root>/e1c-<run-id>/
  source.tar
  work/
    baseline-a/
    baseline-b/
  cache/
    baseline-a/
    baseline-b/
  capture/
    baseline-a/
    baseline-b/
  evidence/
```

두 cache directory는 서로 다른 empty directory다. `node_modules`, `.turbo`, `dist`, cache
directory를 workspace 사이에 복사하거나 연결하지 않는다. source checkout에는 어떤
worktree metadata도 추가하지 않기 위해 `git worktree`를 사용하지 않는다.

## 정확한 제안 실행 순서

아래 명령은 **설계안이며 실행하지 않았다**. `<...>` 값과 실행 파일의 absolute path는
승인된 실행 단계의 preflight에서 확정하고 command record에 그대로 남긴다.

### 1. 동일 source snapshot 준비

```powershell
git -C <PINNED_SOURCE> rev-parse HEAD
git -C <PINNED_SOURCE> status --short
git -C <PINNED_SOURCE> archive --format=tar --output=<ROOT>\source.tar 8ab27715521cbd4f87ae6886cd989cbb678f6de7
tar -xf <ROOT>\source.tar -C <ROOT>\work\baseline-a
tar -xf <ROOT>\source.tar -C <ROOT>\work\baseline-b
```

`source.tar` 자체 SHA-256과 두 추출 tree의 sorted raw manifest를 생성해 비교한다.
`node_modules`, `.turbo`, `dist`가 없는 동일 tree임을 확인한다. archive 또는 두 manifest가
다르면 install 전에 중단한다.

### 2. 정제 환경

두 install/build에 같은 environment map을 명시한다.

- 공개값: `CI=true`, `FORCE_COLOR=0`, `NO_COLOR=1`, `NODE_ENV=production`,
  `PUPPETEER_SKIP_DOWNLOAD=true`.
- 빈 override: Turbo remote-cache 변수, credential/build 변수, proxy 변수,
  `npm_config_user_agent` 등 E-1에서 사용한 private 항목 전부.
- Windows에서는 환경변수 이름을 대소문자 비구분으로 취급해 중복 proxy 이름을 만들지
  않는다.
- 전체 `process.env`는 수집하지 않는다. 공개값만 값과 함께 기록하고, private/cleared
  항목은 이름과 `cleared` 상태만 기록한다. secret 원문이나 hash도 저장하지 않는다.
- OS/architecture, Node/pnpm/Turbo binary와 version, locale/timezone 이름, workspace path
  token(`BASELINE_A`/`BASELINE_B`)과 path length를 기록한다. 개인 absolute path는 기록하지
  않는다.

### 3. 독립 frozen install

각 workspace에서 순차 실행한다.

```powershell
<COREPACK_CMD> pnpm@10.33.4 install --frozen-lockfile
```

각 install 직전과 직후에 lockfile SHA-256을 재확인한다. exit code 0만으로 성공을 판단하지
않고 workspace-local Turbo/tsup version과 lockfile/source 불변성을 다시 확인한다. A install
실패 시 B install을 시작하지 않는다. B install 실패 시 build는 시작하지 않는다.

### 4. Turbo task graph capture

baseline A에서 build 전에 한 번만 실행한다. 이는 task를 실행하지 않는 dry-run이며 build
invocation 예산에 포함되지 않는다.

```powershell
<NODE_EXE> node_modules/turbo/bin/turbo run build --filter shadcn... --dry=json --no-color
```

정확히 `@shadcn/registry#build` 후 `shadcn#build`의 dependency closure, Turbo 2.9.18,
`dependsOn`, task hash input, outputs/excludedOutputs를 보존한다. B의 relevant config와 source
hash가 A와 같음을 확인한다. dry-run 실패나 graph 불일치는 build 전 중단 조건이다.

### 5. Baseline A build

cache가 empty이고 `dist`가 없음을 확인한 뒤 정확히 다음 의미의 command를 한 번 실행한다.

```powershell
<NODE_EXE> node_modules/turbo/bin/turbo run build --filter shadcn... `
  --cache=local:rw --cache-dir <ROOT>\cache\baseline-a `
  --summarize --ui=stream --no-color --concurrency 1
```

stdout/stderr를 별도 raw log로 capture하고 command, exit code, duration, timeout 여부를
기록한다. `.turbo/runs`에서 이번 command가 만든 summary가 정확히 하나인지 확인한다.
두 task 모두 `status=MISS`, `local=false`, `remote=false`여야 한다. task가 0회이거나 HIT,
summary 부재, task 누락이면 실패다.

### 6. A output 즉시 보존 및 gate 재평가

두 `dist`에서 reparse point를 먼저 검사한다. 발견 시 traverse/copy하지 않고 경로
metadata만 기록한 뒤 중단한다. 일반 파일만 있으면 원래 상대 경로로 `capture/baseline-a`
에 byte-for-byte copy하고 source와 copy의 per-file SHA-256을 다시 비교한다. 이후 file
count, bytes, manifest hash, chunk graph를 생성한다.

A raw output이 16MiB를 넘거나, logs/graphs/config를 포함한 두 baseline의 projected retained
size가 64MiB를 넘으면 B를 실행하지 않는다. 16MiB는 기존 873,323바이트의 약 19배인
보수적 per-baseline gate이지 실제 필요량의 정밀 추정이 아니다.

### 7. Baseline B build

A의 모든 post-build gate가 통과한 경우에만 B의 별도 empty cache로 같은 command를 한 번
실행한다.

```powershell
<NODE_EXE> node_modules/turbo/bin/turbo run build --filter shadcn... `
  --cache=local:rw --cache-dir <ROOT>\cache\baseline-b `
  --summarize --ui=stream --no-color --concurrency 1
```

A와 같은 MISS/summary/output/reparse/size 검사를 적용하고 즉시 원본 bytes를
`capture/baseline-b`에 보존한다. 실패해도 자동 재시도하지 않으며 성공적으로 생성된
artifact는 삭제하지 않는다.

### 8. 비교와 evidence sealing

원본을 수정하지 않는 별도 분석 output으로 manifest, graph, comparison을 만든다. 모든
evidence 파일의 sorted SHA-256 목록을 마지막에 생성하고 다시 읽어 검증한다.
`hashes.sha256`은 자기 자신을 포함하지 않는다. raw workspace와 retained copy의 hash가
완전히 같아야 한다.

## Evidence directory 설계

후속 실행 evidence는 기존 E-1을 덮어쓰지 않고 별도 run ID를 사용한다.

```text
evidence/phase3-step-e1c/<run-id>/
  run.json
  commands.json
  environment.json
  resource-samples.json
  source/
    provenance.json
    source-tree-manifest.json
    config-hashes.json
    package.json
    pnpm-lock.sha256
    pnpm-workspace.yaml
    turbo.json
    registry-tsup.config.ts
    shadcn-tsup.config.ts
  baseline-a/
    install.log
    build.stdout.log
    build.stderr.log
    turbo-summary.json
    output-manifest.json
    chunk-graph.json
    raw/packages/registry/dist/**
    raw/packages/shadcn/dist/**
  baseline-b/
    install.log
    build.stdout.log
    build.stderr.log
    turbo-summary.json
    output-manifest.json
    chunk-graph.json
    raw/packages/registry/dist/**
    raw/packages/shadcn/dist/**
  comparison/
    raw-differences.json
    text-differences.json
    graph-differences.json
    hypothesis-results.json
  hashes.sha256
```

실제 artifact가 64MiB ceiling 안인지 확인한 후에만 repository evidence로 옮긴다. log에
secret, credential, 개인 경로가 없는지 검사한다. 민감 정보가 발견되면 raw log를
repository에 넣지 않고 접근 제한된 experiment root에 격리하며, 원본 hash와 redaction
정책을 기록한다. 원본 `dist` 파일에는 redaction을 적용하지 않는다. 출력 자체에 secret이
발견되면 publish/commit하지 않고 보안 blocker로 중단한다.

## Raw output와 reparse point 보존 정책

- `packages/registry/dist/**`와 `packages/shadcn/dist/**`의 일반 파일을 모두 보존한다.
- path는 task root 기준 portable relative path와 원래 case를 유지한다.
- file bytes, length, SHA-256, file attributes를 기록한다. mtime은 관찰 metadata로만
  기록하고 content 비교에는 사용하지 않는다.
- rename, canonicalization, newline 변환, JSON pretty-print, 압축을 하지 않는다.
- source map이 생성되면 원본 파일로 보존하고 manifest에 포함한다. 현재 설정은
  `sourcemap: false`이므로 생성되지 않을 것으로 예상되며 실제 부재도 기록한다.
- `dist` 안 reparse point/symlink는 follow하지 않는다. 하나라도 있으면 target type과
  상대 경로만 기록하고 experiment를 중단한다.
- pnpm이 만든 `node_modules` junction은 raw evidence 대상이 아니며 traverse 또는 copy하지
  않는다.
- copy 후 source/copy per-file hash와 tree manifest hash를 비교해 byte 보존을 확인한다.

Manifest contract는 portable relative path 순으로 정렬한
`path<TAB>bytes<TAB>sha256` UTF-8 line의 SHA-256이다. 기존 CacheTrust raw manifest와 같은
의미를 유지하되 실제 파일 bytes도 함께 보존한다.

## Chunk/import-reference graph 복원

Turbo summary는 bundler graph로 사용하지 않는다. 두 baseline의 보존된 모든 `.js`를
독립적으로 parse해 다음 graph를 만든다.

- node: output-relative JS path, file SHA-256, bytes, static exports;
- edge: importer path, raw specifier, 해석된 output-relative target, import/export/dynamic
  import 종류, imported/exported binding;
- unresolved/bare specifier는 외부 dependency로 별도 기록;
- chunk 여부는 `chunk-*.js` 이름만으로 표시하되 대응 근거로 사용하지 않는다.

Parser는 설치된 TypeScript 5.9.2 compiler API를 사용하는 read-only helper를 제안한다.
helper의 정확한 파일, parser version, 자체 SHA-256과 fixture 검증은 실행 승인 전에
**TO VERIFY**다. regex만으로 graph를 확정하지 않는다. parse error 또는 target escape가
하나라도 있으면 graph 분석은 불완전으로 판정하고 정규화를 제안하지 않는다.

A/B node 대응은 다음 순서로만 시도한다.

1. 동일 relative path와 동일 SHA-256;
2. 동일 relative path지만 다른 SHA-256;
3. one-sided chunk는 동일 input을 가정하지 않고 exports, dependency edges, importer set,
   AST 구조와 bytes를 함께 비교해 후보만 제시한다;
4. 일대일 근거가 부족하면 `UNMAPPED`로 남긴다.

어떤 graph 분석도 원본 파일을 다시 쓰거나 이름을 바꾸지 않는다.

## A/B 비교 및 분류 규칙

1. path set을 비교해 `same-path-content`, `A-only`, `B-only`로 분류한다.
2. 같은 path는 bytes, SHA-256, file type을 비교한다.
3. text 파일은 byte offset, line diff, token/AST diff를 별도 산출한다. raw byte가
   authoritative하다.
4. JS는 imports/exports/dependency edges, literal, declaration/statement order와 실행
   code 차이를 비교한다.
5. `.d.ts`는 별도 분류하되 비기능 metadata로 자동 간주하지 않는다.
6. chunk는 같은 크기나 이름 패턴만으로 대응시키지 않는다.
7. timestamp/path/environment 후보는 실제 byte 위치와 source를 특정할 때만 확인으로
   분류한다.
8. 설명되지 않은 차이가 하나라도 남으면 원인은 `PARTIAL` 또는 `UNKNOWN`이며 E-1은
   계속 INCONCLUSIVE다.

## 가설별 조사 방법

| 가설 | 필요한 증거와 비교 | 확인 관찰 | 반박 관찰 | 남는 불확실성 |
| --- | --- | --- | --- | --- |
| H1 workspace path | raw bytes, A/B root token, path length, string/UTF-8/escaped path 검색 | 차이 byte가 각 실제 root와 일대일 대응하거나 graph가 path에 따라 변함 | 두 root가 모든 raw output에 없고 graph도 동일 | bundler 내부 path가 hash/order에만 간접 영향 가능 |
| H2 timestamp/metadata | file text/AST, mtime, build start/end, 알려진 date/epoch 형식 검색 | 차이 literal이 해당 build 시간 범위와 대응 | literal/metadata가 없고 mtime만 다름 | encoding 또는 derived ID 가능 |
| H3 environment | 승인된 env name/state, Turbo hash inputs, config/source의 env read 위치 | 유일한 env 차이와 output byte/source read가 연결됨 | effective relevant env metadata와 task hashes가 동일 | 기록하지 않은 ambient OS 상태 가능 |
| H4 ID/order | source entry 목록, output statement/symbol order, chunk graph | module/export 집합은 같고 순서·minified symbol·hash cascade만 다름 | 실제 module/export/logic 집합도 다름 | 기능 동등성은 별도 negative control 없이는 미확정 |
| H5 graph 차이 | 두 reconstructed graphs의 node/edge/binding 비교 | dependency edge, exports 또는 module allocation이 다름 | graph topology/binding이 완전히 같음 | graph가 같아도 code generation 차이 가능 |
| H6 실제 JS 차이 | raw/text/token/AST diff와 reachable executable statements | literal, operator, control flow, export binding 등 기능 code가 다름 | 차이가 입증된 비실행 metadata에만 제한 | 런타임 동등성은 일반적으로 정적 diff만으로 완전 증명 불가 |
| H7 기타 | filesystem order, locale/timezone, tool logs, unexplained diff 목록 | 특정 외부 상태와 반복 가능한 상관관계 | 모든 수집 상태가 동일 | 두 build만으로 우연성과 인과를 완전히 분리할 수 없음 |

이 실험은 원인 식별용이다. 어떠한 결과도 자동으로 normalization 승인이 되지 않는다.

## Stop 조건

다음 중 하나라도 발생하면 즉시 중단하고 다음 단계나 자동 재시도를 하지 않는다.

- pinned SHA, clean source, lockfile hash 또는 toolchain 불일치;
- RAM 두 측정 중 하나라도 4GiB 미만;
- disk gate 또는 승인된 임시/retained size budget 실패;
- workspace, install 또는 cache 독립성 입증 실패;
- reparse point/symlink를 안전하게 처리할 수 없음;
- frozen install, version probe, dry-run 또는 예상하지 않은 command 실패;
- Turbo graph가 예상 두 task와 dependency를 보고하지 않음;
- build task가 MISS가 아니거나 task/summary가 누락됨;
- raw file을 수정하지 않고 증거를 보존할 수 없음;
- source, lockfile, build config 또는 CacheTrust protected file 변경이 필요함;
- secret/개인정보가 output 또는 log에 포함돼 안전한 보존이 불가능함;
- command timeout 또는 resource safety 악화;
- baseline A 이후 B를 실행하면 build 상한 2회나 storage budget을 넘을 전망;
- 그 밖의 예기치 않은 command 실패.

실패 시 이미 생성된 evidence를 보존하고 failure stage와 exit code를 기록한다. 다른
application/process를 종료하지 않으며 system 설정을 변경하지 않는다.

## 예상 가능한 진단 결과

- **PATH_DEPENDENT**: 실제 root 관련 byte 또는 graph 변화가 확인됨.
- **TIME_OR_METADATA_DEPENDENT**: build 시간/metadata와 직접 대응하는 byte가 확인됨.
- **ENVIRONMENT_DEPENDENT**: relevant env 차이와 source read/output 차이의 연결이 확인됨.
- **ORDER_OR_CHUNK_ID_DEPENDENT**: module/export graph는 같고 ordering/hash cascade가
  구체적으로 확인됨. 이것만으로 normalization은 승인되지 않는다.
- **FUNCTIONAL_CODE_DIFFERENCE**: reachable JS 또는 binding/edge가 실제로 다름.
- **MULTIPLE_CAUSES**: 둘 이상의 독립 원인이 확인됨.
- **PARTIAL/UNKNOWN**: 일부 차이만 설명되거나 인과를 확정할 수 없음.
- **STABLE_ON_THIS_PAIR**: 두 새 baseline이 일치함. 과거 61개 차이를 반박하거나 E-1을
  PASS로 바꾸지 않으며 재현 실패로만 기록한다.

어떤 결과에서도 E1/E2/E3를 자동 실행하지 않는다.

## 한계와 미해결 질문

- 독립 build 2회만으로 저빈도 nondeterminism의 분포나 인과를 통계적으로 확정할 수 없다.
- build config를 바꾸지 않으므로 esbuild metafile이 생성되지 않는다. chunk graph는 emitted
  ESM에서 복원하며 bundler 내부 input ordering 전체를 직접 보여주지 못할 수 있다.
- source glob이 bundler에 전달되는 실제 순서를 외부 관찰만으로 완전히 얻을 수 있는지는
  **TO VERIFY**다.
- reliable process-tree peak memory는 측정하지 못할 수 있다.
- TypeScript parser helper와 log capture wrapper는 실행 전에 별도 검토·hash 고정이
  필요하다.
- 정확한 timeout, short root, Corepack executable, Node executable, 임시/retained size
  상한의 최종 승인은 아직 없다.
- 이 설계는 normalization 안전성 negative-control 실험을 실행하지 않는다.

## 후속 실행 승인 체크리스트

아래 항목을 모두 명시적으로 승인·확정해야만 별도 실행 단계로 진입할 수 있다.

- [ ] 정확한 run ID와 owned short root
- [ ] pinned source absolute path와 clean SHA 확인 방법
- [ ] Node/Corepack executable absolute path 및 version
- [ ] pnpm 10.33.4, Turbo 2.9.18 고정
- [ ] 두 frozen install과 build 2회에 대한 실행 승인
- [ ] install/build별 timeout
- [ ] 두 번의 4GiB RAM gate와 8GiB disk gate
- [ ] 6GiB temporary footprint 및 64MiB retained evidence ceiling
- [ ] 정제 env name/value 정책과 secret 비수집 정책
- [ ] source archive/extract 및 independent cache 전략
- [ ] TypeScript graph helper와 log capture wrapper의 내용 및 SHA-256
- [ ] raw `dist`를 repository evidence에 보존하는 것에 대한 승인
- [ ] 실패 시 재시도하지 않고 중단하는 정책
- [ ] E1/E2/E3 및 normalization은 범위 밖이라는 재확인

## 이번 단계에서 수행하지 않은 작업

- build, install, test, dry-run 또는 experiment 실행;
- source, lockfile, build config, CacheTrust 구현 또는 기존 evidence 수정;
- normalization 설계 승인 또는 구현;
- E1/E2/E3 실행;
- commit 또는 push.

이번 단계의 유일한 변경은 `docs/phase3-step-e1c-design.md` 추가다.
