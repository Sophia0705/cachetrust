# Phase 3 Step E-1 — shadcn/ui 동일 입력 검증

일자: 2026-11-10 (Asia/Seoul)

## 판정

CacheTrust 검증 판정은 **INCONCLUSIVE / NONDETERMINISTIC_BASELINE**이다. 단계 준비 상태는
**NO-GO**이며 E2를 실행할 수 없다.

동일 입력 cache 재실행에서는 두 task 모두 실제 local HIT가 확인됐다. 그러나 독립 clean
baseline A와 B의 raw output manifest가 일치하지 않았고 cache output도 어느 baseline과도
일치하지 않았다. 기존 판정 계약에 따라 이 결과를 PASS로 승격하지 않았으며 normalization을
추가하거나 차이를 억제하지 않았다.

E2와 E3는 실행하지 않았다.

## Preflight

실행 전 다음 조건을 확인했다.

- CacheTrust 저장소: `codex/phase-3-real-world-verification`, HEAD
  `461f8f68a902dc432a9ca86fcbce25d49bb84ca2`, clean;
- 대상 source: shadcn-ui/ui `8ab27715521cbd4f87ae6886cd989cbb678f6de7`, clean;
- lockfile SHA-256:
  `095aa7494a673e4b15b963a3263bcbc1d025176b00f97406aa61c9893827b862`;
- Node v24.19.0, Corepack 0.35.0, pnpm 10.33.4, Turbo 2.9.18;
- E-1A raw output coverage evidence와 해시: 모두 유효;
- 남아 있는 `.cachetrust-verify-*` workspace: 없음;
- E-1 native evidence 목적지: 실행 전 부재;
- available RAM: 10초 간격으로 4.078 GiB, 4.471 GiB;
- C: 여유 공간: 162.4 GiB;
- 관련 없는 heavy build: 관찰되지 않음.

E-Prep-1의 install environment 전달·검증·evidence 기록 구현과 집중 테스트 결과는 기존
커밋 및 문서로 확인했다. 실행 config는 기존 validator로 사전 검증했다. Windows에서 환경변수
이름은 대소문자를 구분하지 않으므로 proxy override는 각 이름당 하나만 사용했다.

## 실행 계약

기존 CacheTrust verification engine만 사용했다. Production code나 검증 계약은 수정하지
않았다. Engine의 고정 실행 모델은 요청 예산과 정확히 일치했다.

1. cache workspace frozen install;
2. baseline A frozen install;
3. baseline B frozen install;
4. cache workspace v1 build — cache population;
5. 동일 cache workspace v2 build — identical-input reuse;
6. baseline A clean build;
7. baseline B clean build.

Build invocation은 총 4회이며 모두 순차 실행됐다. 세 workspace와 cache는 서로 독립적이었다.
모든 install은 다음 계약을 사용했다.

```text
corepack pnpm@10.33.4 install --frozen-lockfile
```

Turbo 실행은 각 workspace에서 다음 의미의 명령으로 수행됐다.

```text
node node_modules/turbo/bin/turbo run build --filter shadcn...
  --cache=local:rw --cache-dir <owned-cache> --summarize
  --ui=stream --no-color --concurrency 1
```

Turbo command를 pnpm wrapper로 실행하지 않아 `npm_config_user_agent` 자동 주입을 피했다.
Remote cache 변수는 기존 engine이 비활성화했다. Install과 build 모두 E-Prep에서 승인한
`NODE_ENV=production` 및 빈 credential/proxy/build-variable override를 사용했다. Normalization은
설정하지 않았다.

## 설치와 자원 관찰

세 frozen install은 모두 exit code 0, timeout false였다.

| Workspace | 설치 시간 |
| --- | ---: |
| cache | 112.921초 |
| baseline A | 103.270초 |
| baseline B | 101.454초 |

Evidence 전체 실행 구간은 UTC 기준 `2026-11-09T21:10:06.760Z`부터
`2026-11-09T21:20:15.784Z`까지였다. Engine은 process-tree peak memory를 측정하지 않으므로
그 값은 `NOT MEASURED`이며 추정하지 않는다. 실행 전 RAM과 디스크 gate만 검증했다.

## Task별 cache 증거

두 task hash는 네 build 전체에서 각각 동일했다.

| Run | Task | Hash | 상태 | Local | Remote | 시간 |
| --- | --- | --- | --- | --- | --- | ---: |
| v1 cache population | `@shadcn/registry#build` | `969934d40a44d7c3` | MISS | false | false | 75.786초(run 전체) |
| v1 cache population | `shadcn#build` | `e2137f265edb64b9` | MISS | false | false | 75.786초(run 전체) |
| identical-input reuse | `@shadcn/registry#build` | `969934d40a44d7c3` | HIT | true | false | 1.195초(run 전체) |
| identical-input reuse | `shadcn#build` | `e2137f265edb64b9` | HIT | true | false | 1.195초(run 전체) |
| baseline A | `@shadcn/registry#build` | `969934d40a44d7c3` | MISS | false | false | 52.400초(run 전체) |
| baseline A | `shadcn#build` | `e2137f265edb64b9` | MISS | false | false | 52.400초(run 전체) |
| baseline B | `@shadcn/registry#build` | `969934d40a44d7c3` | MISS | false | false | 56.100초(run 전체) |
| baseline B | `shadcn#build` | `e2137f265edb64b9` | MISS | false | false | 56.100초(run 전체) |

따라서 task-level cache 관찰 자체는 E1 기대와 일치한다. HIT는 실행 시간으로 추정한 것이
아니라 Turbo summary의 `status=HIT`, `local=true`, `remote=false`에서 확인했다.

## Raw output fingerprint 비교

각 manifest는 270개 파일을 포함한다. Raw tree digest는 다음과 같다.

| Output | Raw manifest SHA-256 |
| --- | --- |
| cache reuse | `42effee7b8adb8790d5bed2a341e7372e02642916ec76029d0f78e696ae2fc20` |
| baseline A | `dea45e8c483946d9ea299c4fa56e665150a140c7c80f21e942415493a7d2df30` |
| baseline B | `0e47b872872ffb6482d2ae85f4e3d21801c9ab7b7599dee084bcf7d8f523c0c2` |

비교 결과:

| 비교 | 차이 수 | 내용 차이 | 왼쪽에만 | 오른쪽에만 |
| --- | ---: | ---: | ---: | ---: |
| baseline A ↔ baseline B | 61 | 37 | 12 | 12 |
| cache ↔ baseline A | 57 | 35 | 11 | 11 |
| cache ↔ baseline B | 49 | 27 | 11 | 11 |

Baseline A/B 차이 61개 중 58개는 `packages/registry/dist`, 3개는
`packages/shadcn/dist`에 있다. Registry의 hashed chunk 이름이 run마다 달라지고 이를 참조하는
JavaScript 및 일부 declaration output의 digest도 달라졌다. Shadcn에서도 `index.js`,
`index.d.ts`, `tailwind.d.ts` 차이가 관찰됐다.

Raw 차이 전체는 `raw-differences.json`에 보존했다. 차이가 기능적으로 무해하다는 분석이나
안전한 normalization 근거는 이번 단계에 없으므로 어떤 rule도 제안·적용하지 않았다.

## Output coverage

모든 run의 Turbo summary가 E-1A와 같은 output contract를 보고했고 engine의 exact-set coverage
검사가 통과했다.

```json
{
  "outputs": [".next/**", "dist/**", "public/r/styles/**", "styles/**"],
  "excludedOutputs": [".next/cache/**"]
}
```

각 raw manifest의 270개 파일은 구성된 CacheTrust fingerprint 범위에 포함됐다. Coverage 누락이
이번 INCONCLUSIVE의 원인은 아니다.

## Verdict와 단계 준비 상태

Native verdict:

```text
INCONCLUSIVE / NONDETERMINISTIC_BASELINE
Two independent clean baselines disagree.
```

Cache HIT는 확인됐지만 baseline 안정성이 증명되지 않았으므로 cache output correctness는 판정할
수 없다. `cacheMatchesBaseline=false`도 stale cache 증거로 해석할 수 없다. 독립 baseline끼리 먼저
불일치하기 때문이다.

E2 readiness: **NO-GO**. 다음 단계로 가기 전에 raw 차이의 원인을 별도 분석하고, 필요하다면 각
차이가 비기능적이고 mutation signal을 지우지 않으며 좁게 제한된다는 근거를 갖춘 normalization
정책을 별도 승인받아야 한다. 이 E-1 실행을 자동 재시도하거나 E2/E3를 시작하지 않는다.

## Evidence

- `evidence/phase3-step-e1/verification.json`: CacheTrust native schema-v1 evidence;
- `evidence/phase3-step-e1/raw-differences.json`: 세 raw manifest pair의 전체 차이;
- `evidence/phase3-step-e1/hashes.sha256`: 두 evidence 파일의 SHA-256.

실행 후 engine-owned temporary verification workspaces는 정리됐고 원본 target checkout은 clean
상태를 유지했다.
