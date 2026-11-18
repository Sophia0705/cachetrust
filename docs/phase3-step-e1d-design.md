# Phase 3 Step E-1D — shadcn/ui E1 고정경로 재검증 계획

일자: 2026-11-18 (Asia/Seoul)

## 1. 결정

현재 판정은 **CONDITIONAL GO (target preflight only)**다. shadcn/ui E1 재검증의 fixed-path
실행 방식, 실행 중에도 flush되는 lifecycle/stdout/stderr 기록, hardlink-aware physical storage
측정과 제한 gate가 구현됐고 작은 통제 fixture에서 검증됐다. 이는 E1 build 승인이 아니다.
고정 target의 source/tool/output 계약과 6GiB 여유를 별도 preflight로 확인하고 실행 승인을 받은
경우에만 E1을 1회 실행한다.

기존 판정은 실행 전까지 유지한다.

- E-1C: `EXECUTION ABORTED / DIAGNOSTIC INCOMPLETE`;
- E1: `INCONCLUSIVE / NONDETERMINISTIC_BASELINE`;
- E2/E3: `NO-GO`.

이번 단계에서는 helper와 engine 연결만 구현·검증했다. shadcn/ui install, dry-run, build,
mutation, E1/E2/E3는 실행하지 않았다.

## 2. 재검증 근거

커밋 `fac81c59e302c9328883a9ef4b4d466b62a71c20`을 기반으로 다음 기능이 준비돼 있었다.

- 기존 `independent-paths`를 기본값으로 유지하는 명시적 `fixed-path-sequential` opt-in;
- 단계 전환마다 동일 project slot을 완전히 삭제하고 clean source에서 재생성;
- cache, baseline A, baseline B별 독립 Turbo cache와 frozen install;
- raw output, stdout/stderr, Turbo summary의 단계별 내구성 보존;
- 보존본 manifest와 실제 byte SHA-256 재검증;
- 정규화 규칙별 occurrence 수와 normalized changed-path 기록;
- slot removal, source copy, install, lockfile lifecycle 기록.

작은 stale-cache fixture는 기존 전략과 새 전략에서 모두 `MISMATCH`를 유지했고, RidoBot
Frontend C1은 새 전략으로 `PASS / CORRECT_REUSE`를 기록했다. 이번 보강 후 CacheTrust 루트
테스트 88개, typecheck, build와 `git diff --check`가 통과했다.

이번 변경은 opt-in 실행에서 stdout/stderr chunk와 lifecycle event를 즉시 파일에 쓰고 flush한
뒤 기존 post-run artifact hash 검증과 연결한다. 정상 종료, nonzero, timeout, cancellation 및
process close 전 partial output 보존을 fixture로 검증했다. 외부에서 controller 자체를 강제
종료하는 end-to-end 검증은 하지 않았으므로, 마지막 flush 이전에 OS가 controller를 즉시
종료시키는 경우까지 보장한다고 주장하지 않는다. RidoBot의 Next.js 정책도 shadcn/ui tsup
output에 적용하지 않는다.

## 3. 고정 대상과 변경 금지 사항

| 항목 | 계약 |
|---|---|
| Repository | `shadcn-ui/ui` |
| Commit | `8ab27715521cbd4f87ae6886cd989cbb678f6de7` |
| Lockfile SHA-256 | `095aa7494a673e4b15b963a3263bcbc1d025176b00f97406aa61c9893827b862` |
| Node.js | `24.19.0`을 명시적으로 기록; `.nvmrc` 일치로 표현하지 않음 |
| pnpm | Corepack-managed `10.33.4` |
| Turbo | lockfile의 `2.9.18` |
| Filter | `shadcn...` |
| Tasks | `@shadcn/registry#build`, `shadcn#build` |
| Concurrency | `1` |
| Retry | 자동 retry 0회 |
| Normalization | 없음 |

원본 checkout, lockfile, task selection, output coverage, E2/E3 marker 계약을 변경하지 않는다.
E1에서 raw baseline이 다시 다르면 normalization을 즉석에서 추가하지 않고
`INCONCLUSIVE / NONDETERMINISTIC_BASELINE`을 유지한다.

## 4. 실행 전 필수 gate

### 4.1 Source와 도구

1. 현재 repository root, branch, HEAD, dirty/untracked 상태를 기록한다.
2. target checkout이 정확한 commit이고 clean인지 확인한다.
3. lockfile과 E3 source precondition SHA-256을 다시 확인한다.
4. Node, Corepack, pnpm, Turbo version을 기록한다.
5. 기존 E1/E1C evidence와 새 destination이 겹치지 않는지 확인한다.
6. 남은 `.cachetrust-verify-*` 또는 E1-owned slot이 없어야 한다.

### 4.2 내구성 있는 process lifecycle과 stream

E1 controller는 spawn 전에 append-only lifecycle 파일과 stdout/stderr 파일을 생성해야 한다.
Start time과 controller PID를 먼저 flush하고, spawn 직후 child PID를 추가한다. `exit`, `close`,
`error`, timeout-fired, termination-requested event를 발생 시점에 각각 append하고 flush한다.
stdout/stderr chunk도 메모리에만 보관하지 않고 사전 생성 파일에 지속 기록한다.

작은 fixture에서 정상 종료, nonzero, timeout, cancellation과 process close 전 flush를 각각
검증한다. 각 경우에 마지막으로 확인된 lifecycle event와 partial stdout/stderr가 남아야 한다.
이 검증은 Windows termination 의미나 기존 exit-code 계약을 변경하지 않는다. `src/process.ts`
변경은 이번 작업에서 받은 명시적 승인 범위로 제한했다.

### 4.3 물리 저장공간

Owned root의 physical allocated bytes를 Windows volume file ID 기준으로 중복 제거해 측정한다.
Directory junction은 따라가지 않고, hardlink는 동일 file ID를 한 번만 계산하며,
allocation/compression 크기를 논리 file length와 분리한다.

측정 helper는 먼저 작은 fixture에서 다음을 증명해야 한다.

- 일반 파일, sparse/compressed 파일을 구분;
- hardlink 두 경로를 한 번만 계산;
- junction target을 제외;
- inaccessible file이 있으면 성공값 대신 측정 실패;
- 같은 tree 반복 측정 결과가 안정적임.

E1 실행 중에는 cache install 후, baseline A install 후, baseline B install 후가 아니라 **같은
slot의 각 단계 전환 직전과 직후**를 측정한다. 어느 시점이든 owned temporary root가 6GiB를
초과하거나 측정할 수 없으면 build 전에 중단한다. Volume free-space delta만으로 cap 통과를
주장하지 않는다.

### 4.4 Install과 dry-run

1. `PUPPETEER_SKIP_DOWNLOAD=true`, `NODE_ENV=production`을 기록한다.
2. credential, proxy, remote-cache, 선언된 build environment 값은 승인된 계약대로 비운다.
3. 정확한 pnpm으로 frozen install 하나를 수행하고 lifecycle log와 lockfile 불변을 확인한다.
4. 설치 후 Turbo `--dry=json`만 실행해 task 두 개, dependency order, output/exclusion 배열,
   Turbo version을 확인한다.
5. Dry-run 또는 output contract가 기존 E-0와 다르면 E1을 시작하지 않는다.

## 5. E1 단일 실행 계약

Config는 다음을 명시한다.

```json
{
  "workspaceStrategy": "fixed-path-sequential",
  "retainDiagnostics": true
}
```

실제 config에서는 `normalization` 필드를 생략한다. 실행 순서는 다음과 같다.

1. cache slot clean copy와 frozen install;
2. v1 build: 두 task 모두 genuine MISS 확인;
3. 동일 slot/cache의 cache-v2 build: 두 task 모두 local HIT, remote false 확인;
4. cache-v2 raw output과 logs/summary 보존 및 해시 검증;
5. slot 완전 삭제 확인;
6. baseline A clean copy, frozen install, empty cache build와 raw 보존;
7. slot 완전 삭제 확인;
8. baseline B clean copy, frozen install, empty cache build와 raw 보존;
9. 두 baseline의 MISS/local false/remote false 확인;
10. raw baseline A/B와 cache-v2 manifest 비교;
11. evidence 기록 후 owned root 정리와 원본 checkout clean 상태 재확인.

Build는 최대 4회이고 모두 순차 실행한다. Command별 install/build timeout은 기존 계약의
300,000ms를 유지한다. 한 단계라도 실패하면 뒤 단계로 진행하지 않고 자동 retry하지 않는다.

## 6. Output과 판정 계약

기존 E-0의 task별 전체 output contract를 그대로 사용한다. 첫 v1 build 직후 generated-file
inventory를 Turbo output/exclusion과 비교한다. 선언 범위 밖 output, 빈 `dist`, symlink 또는
비정상 파일 형식은 stop condition이다.

E1 PASS 조건은 모두 충족돼야 한다.

- v1 두 task genuine MISS;
- cache-v2 두 task genuine local HIT와 v1 hash 재사용;
- baseline A/B 두 task genuine MISS, local/remote false;
- output coverage exact-set PASS;
- baseline A/B raw manifest 완전 일치;
- cache-v2 raw manifest가 stable baseline과 완전 일치;
- 세 install lockfile hash 동일;
- raw/log/summary artifact 보존과 복사 검증 PASS;
- physical allocated-size cap PASS;
- 원본 checkout clean.

Raw baseline이 다르면 원인과 무관하게 E1은 INCONCLUSIVE다. Cache와 baseline 차이는 stable
baseline이 먼저 증명되지 않는 한 stale-cache 증거로 해석하지 않는다.

## 7. E2/E3 gate

E2는 E1 native PASS와 위 자원·증거 gate가 모두 통과한 뒤 별도 승인을 받아 실행한다.
E3는 E2 PASS 뒤에만 실행한다.

- E2 marker: `CACHE_TRUST_E2`, `packages/shadcn/src/tailwind.css`;
- E3 marker: `CACHE_TRUST_E3`, `packages/registry/src/logger.ts`;
- E3 precondition SHA-256:
  `6d8cc3391257b828d25fda1ff2cfa3b7ceb8ab69d0ee3a0e5baafa9f3260d285`.

어떤 normalization도 marker 또는 marker가 포함된 output을 제거·치환할 수 없다. E1의 결과가
PASS여도 E2/E3를 자동 시작하지 않는다.

## 8. 예상 evidence와 완료 보고

새 run ID 아래에 다음을 별도로 보존한다.

- 실행 config와 tool/source/lock provenance;
- package-manager probe, 세 install, 네 Turbo run의 stdout/stderr;
- 네 Turbo summary와 task hash/HIT/MISS;
- cache-v2 및 baseline A/B raw output과 manifest;
- generated-file/output-coverage inventory;
- fixed-slot lifecycle과 physical-allocation 측정;
- normalized artifact 없음이라는 명시적 기록;
- 최종 native evidence와 파일 SHA-256 목록.

Raw output과 logs에 비밀값 또는 개인 경로가 포함될 수 있으므로 Git에 직접 올리지 않는다.
공유용 보고서는 경로를 redaction하고 비밀값 대신 해시와 occurrence만 기록한다.

## 9. 다음 단계

다음 작업은 **shadcn/ui 고정 target의 비파괴 preflight**다. source/lock/tool provenance,
destination 비중복, 잔여 owned slot, output 계약과 실제 6GiB 제한 적용 가능성을 먼저 확인한다.
Install, dry-run 또는 E1 build는 이번 승인 범위에 포함되지 않았으며 각각 실행 전 별도 승인이
필요하다. E1 PASS 뒤에도 E2/E3를 자동 시작하지 않는다.
