# Phase 3 Step E-1B — Baseline Nondeterminism Analysis

## 결론

E-1의 두 독립 clean baseline에서 관찰된 61개 raw 차이는 단순한 파일명 변동으로
안전하게 정규화할 수 없다. 24개 one-sided 파일은 12쌍의 해시 이름 JavaScript chunk로
묶을 수 있고 각 쌍의 바이트 수는 같지만, 각 쌍의 SHA-256은 서로 다르다. 나머지 37개는
같은 경로에서 내용 해시가 달랐으며, 여기에는 실행 JavaScript 27개와 declaration 10개가
포함된다. 따라서 실행 코드가 동일하다는 증거가 없고 E-1의
`INCONCLUSIVE / NONDETERMINISTIC_BASELINE` 판정은 유지한다.

추가 E1/E2/E3 검증 진입 판정은 **NO-GO**다. 원본 baseline 파일을 보존하는 별도 진단
실험은 권고하지만, 그 실험의 승인이나 실행은 이번 단계에 포함되지 않는다.

## 범위와 증거 무결성

- 대상: `shadcn-ui/ui` commit
  `8ab27715521cbd4f87ae6886cd989cbb678f6de7`.
- 분석 입력: E-0, E-1A recheck, E-1 문서와
  `evidence/phase3-step-e1/verification.json`, `raw-differences.json`,
  `hashes.sha256`.
- `hashes.sha256`에 기록된 두 파일의 SHA-256을 다시 계산했고 모두 일치했다.
- 고정 source checkout의 HEAD와 clean 상태를 확인했다. 파일은 변경하지 않았다.
- E-1 engine-owned baseline workspace는 실행 후 정리됐다. 따라서 증거에는 정렬된 경로,
  바이트 수, SHA-256 manifest는 남아 있지만 두 baseline의 원본 파일 바이트는 남아 있지
  않다.
- 보존된 E-1A 단일 빌드 산출물은 출력 구조와 import 형태를 확인하는 보조 자료로만
  사용했다. 이것은 baseline A/B 간 의미적 동등성을 증명하지 않는다.
- 새 build, install, E1/E2/E3, 테스트는 실행하지 않았다.

## 61개 차이 분류

### 집계

| Task | 차이 종류 | 파일 형식 | 수 | 차이 메커니즘 |
| --- | --- | --- | ---: | --- |
| `@shadcn/registry#build` | content | `.js` | 26 | 동일 경로·동일 바이트 수, SHA-256 불일치 |
| `@shadcn/registry#build` | content | `.d.ts` | 8 | 동일 경로·동일 바이트 수, SHA-256 불일치 |
| `@shadcn/registry#build` | left-only | `.js` chunk | 12 | baseline A에만 해당 해시 이름 존재 |
| `@shadcn/registry#build` | right-only | `.js` chunk | 12 | baseline B에만 해당 해시 이름 존재 |
| `shadcn#build` | content | `.js` | 1 | 동일 경로·동일 바이트 수, SHA-256 불일치 |
| `shadcn#build` | content | `.d.ts` | 2 | 동일 경로·동일 바이트 수, SHA-256 불일치 |
| **합계** |  |  | **61** | content 37, left-only 12, right-only 12 |

61개 중 실행 JavaScript와 직접 관련된 경로는 51개다(content 27개와 chunk 24개).
나머지 10개는 `.d.ts`지만, 이는 runtime code가 아닐 뿐 공개 타입과 소비자 typecheck에
영향을 줄 수 있으므로 무조건 비기능 메타데이터로 취급할 수 없다. 모든 content 차이
37개는 좌우 바이트 수가 같았으나 SHA-256이 달랐다.

### 동일 경로 content 차이 37개

| Task / 형식 | 경로 |
| --- | --- |
| registry `.js` (26) | `add-components.js`; `get-config.js`; `get-project-info.js`; `registry/add.js`; `registry/address.js`; `registry/api.js`; `registry/builder.js`; `registry/config.js`; `registry/fetcher.js`; `registry/github-ref.js`; `registry/github.js`; `registry/index.js`; `registry/loader.js`; `registry/namespaces.js`; `registry/resolver.js`; `registry/search.js`; `registry/source.js`; `registry/utils.js`; `registry/validate.js`; `registry/validator.js`; `transformers/index.js`; `transformers/transform-icons.js`; `transformers/transform-rtl.js`; `transformers/transform-tw-prefix.js`; `updaters/update-files.js`; `updaters/update-fonts.js` |
| registry `.d.ts` (8) | `registry/api.d.ts`; `registry/fetcher.d.ts`; `registry/github.d.ts`; `registry/resolver.d.ts`; `registry/schema.d.ts`; `registry/source.d.ts`; `registry/utils.d.ts`; `updaters/update-fonts.d.ts` |
| shadcn `.js` (1) | `index.js` |
| shadcn `.d.ts` (2) | `index.d.ts`; `tailwind.d.ts` |

표의 registry 경로는 모두 `packages/registry/dist/`, shadcn 경로는 모두
`packages/shadcn/dist/` 기준이다.

### One-sided chunk 24개

아래 쌍은 오직 같은 바이트 수를 기준으로 대응시킨 것이다. 이름과 크기가 대응된다는
사실만으로 같은 논리 역할이나 같은 기능을 증명하지 않는다.

| Bytes | Baseline A only | Baseline B only | 내용 관계 |
| ---: | --- | --- | --- |
| 536 | `chunk-BHU27KHS.js` | `chunk-CG6RHFNT.js` | SHA-256 다름 |
| 1,379 | `chunk-J7DMLUED.js` | `chunk-WXP6SNZN.js` | SHA-256 다름 |
| 2,293 | `chunk-ZVEJ2BMI.js` | `chunk-DYB6YQ2S.js` | SHA-256 다름 |
| 2,797 | `chunk-AW3NYH2T.js` | `chunk-IP7LRVEH.js` | SHA-256 다름 |
| 3,271 | `chunk-UL3BFSP3.js` | `chunk-R4GIHKEE.js` | SHA-256 다름 |
| 4,471 | `chunk-UDHDDDRZ.js` | `chunk-F26MPF6V.js` | SHA-256 다름 |
| 4,680 | `chunk-PVW25JWN.js` | `chunk-BOKNXK35.js` | SHA-256 다름 |
| 4,756 | `chunk-QCRUN24Y.js` | `chunk-WJGGK4JS.js` | SHA-256 다름 |
| 7,472 | `chunk-3OLGOFMN.js` | `chunk-5QRP7DWO.js` | SHA-256 다름 |
| 8,235 | `chunk-TOLRNYZN.js` | `chunk-2ZD6RDHW.js` | SHA-256 다름 |
| 9,514 | `chunk-KHFSTWMF.js` | `chunk-V4SQINGL.js` | SHA-256 다름 |
| 40,978 | `chunk-FH2VLXDR.js` | `chunk-NLGKPK5X.js` | SHA-256 다름 |

즉, 변경된 해시 chunk 이름에는 대응 가능한 크기의 chunk 내용 변경도 동반된다. 다만
원본 바이트가 없어 그 변경이 import specifier만인지, 식별자/정렬 변화인지, 실제 로직
변화인지 판별할 수 없다.

## 빌드 설정과 의존 관계

고정 checkout과 lockfile에서 확인한 실제 도구는 pnpm 10.33.4, Turbo 2.9.18,
tsup 8.5.0, esbuild 0.25.11, Rollup 4.60.1, TypeScript 5.9.2다.

Registry tsup 설정은 모든 비테스트 `src/**/*.ts`를 entry로 사용하고 `dts`와 code
splitting을 활성화한다. Shadcn은 명시된 8개 entry를 사용한다. 두 설정 모두 ESM,
`minify: true`, `treeshake: true`, `sourcemap: false`, `target: "esnext"`, production
clean을 사용한다. tsup 설정에는 chunk 이름 template, build timestamp, random ID,
absolute workspace path 삽입이 명시돼 있지 않다. tsup의 declaration bundling 경로에는
`[name]-[hash].d.ts` 형식이 있고, JavaScript 출력에서는 esbuild가 생성한
`chunk-<hash>.js` 형태가 실제 관찰됐다.

보존된 E-1A 산출물에서 이번에 content 차이로 분류된 JavaScript 27개 모두가 하나 이상의
`chunk-*.js`를 참조했다. 또한 E-1A 산출물 중 baseline A manifest와 정확히 일치하는
one-sided chunk 2개는 각각 여러 entry/chunk에서 참조됐다. 이는 chunk 이름/내용 변화가
상위 entry 파일의 content hash 변화로 전파될 수 있음을 보여준다. 그러나 baseline B의
원본 파일과 import graph가 없으므로 12쌍 전체의 노드 대응이나 dependency closure는
확정할 수 없다.

## 가능한 원인과 불확실성

### 증거로 확인된 사실

- 세 workspace의 task hash는 registry `969934d40a44d7c3`, shadcn
  `e2137f265edb64b9`로 같았고 두 baseline task는 실제 MISS였다.
- 두 manifest는 각각 270개 파일이며 output coverage 누락은 없었다.
- 차이는 registry에서 시작해 registry entry와 그 소비자인 shadcn `index.js`까지
  전파되는 형태와 양립한다.
- sourcemap은 꺼져 있어 source-map 경로가 직접 차이를 만든 경우는 현재 설정과 맞지
  않는다.
- 보존된 단일 E-1A 출력에서 개인/절대 workspace 경로와 고정 build timestamp 문자열은
  발견되지 않았다.
- 생성 코드에서 `Date.now()`, `new Date`, `Math.random()`은 발견되지만 모두 프로그램
  실행 시 호출되는 애플리케이션 로직이다. 빌드 시 값을 평가해 출력에 삽입한다는 증거는
  없다.

### 가설

1. **chunk graph 또는 출력 순서 변동.** 많은 entry를 glob으로 전달하고 shared code를
   chunk로 분할하므로, entry 발견 순서나 내부 module ordering 차이가 minified symbol,
   chunk 내용, 해시 이름과 importer를 연쇄 변경했을 수 있다. 현재 가장 넓은 관찰을
   설명하지만 baseline 원본과 metafile이 없어 입증되지 않았다.
2. **declaration bundling 순서 변동.** 10개 `.d.ts`의 길이는 같지만 hash가 다르다.
   Rollup/TypeScript declaration 단계의 import/type ordering 또는 식별자 변화 가능성이
   있으나 실제 text diff가 없어 원인을 특정할 수 없다.
3. **workspace 경로 또는 환경 입력.** 두 baseline 경로가 달랐으므로 원리상 가능하다.
   하지만 source map은 꺼져 있고 보존된 단일 출력에서 절대 경로를 찾지 못했다. 이를
   원인으로 지지하는 직접 증거는 없다.
4. **timestamp 또는 random build metadata.** 설정과 보존 출력에 직접 증거가 없다.
   runtime용 시간/난수 코드를 build-time nondeterminism과 혼동해서는 안 된다.

## 정규화 안전성 평가

| 후보 | 정확한 변환 | 대상 | 지지 증거 | 숨길 수 있는 기능 차이 | 판정 및 필요한 negative control |
| --- | --- | --- | --- | --- | --- |
| 해시 chunk 이름 canonicalization | `chunk-<hash>.js`를 graph 기반 안정 ID로 바꾸고 모든 import specifier도 같은 ID로 치환 | 24개 one-sided chunk와 이를 참조하는 JS | 크기별 12쌍, importer 변화와 양립 | 같은 크기의 다른 로직, export binding, chunk 경계 및 실행 순서 변화 | **거부.** 원본 graph/bytes로 semantic 대응을 먼저 입증하고, chunk 내부 로직·export·dependency를 각각 변이한 negative control이 canonical fingerprint를 반드시 바꾸는지 확인해야 함 |
| 해시 chunk 제외 | 모든 `chunk-*.js`를 fingerprint에서 제거 | registry executable chunks | 파일명 패턴만 존재 | shared 실행 로직 전체와 E3 marker를 은폐 가능 | **거부.** 안전한 negative control을 설계할 수 없을 정도로 검증 대상을 제거함 |
| import specifier만 제거 | JS 문자열의 `./chunk-<hash>.js` 부분만 placeholder로 치환 | entry 및 chunk JS | 모든 변경 JS가 chunk를 참조하는 보조 관찰 | import 대상 교체, dependency graph 변조, 다른 export 연결 | **거부.** graph 대응 및 export binding을 포함해 비교하지 않으면 기능 차이를 숨김 |
| 절대 workspace root 치환 | 확인된 root prefix만 `<WORKSPACE>`로 변경 | JS/`.d.ts`의 경로 문자열 | 이번 baseline 원본에는 확인 자료 없음 | 의도된 경로 상수 또는 path-sensitive 동작 | **거부.** 먼저 두 원본에서 정확한 필드와 유일한 root 차이를 확인하고, root 밖 경로 및 실행 로직 변이는 계속 탐지됨을 보여야 함 |
| timestamp/build ID 제거 | 확인된 metadata 필드만 삭제 또는 고정 | 특정 JSON/comment/metadata field | 그런 필드가 관찰되지 않음 | 실제 버전, 배포 ID, 시간 의존 동작 | **거부.** 필드 출처와 비기능성을 입증하고 해당 필드 외 한 글자 변이가 탐지되는 negative control 필요 |
| declaration 정렬 | AST로 비순서적이라고 증명된 선언 집합만 정렬 | 10개 `.d.ts` | 같은 길이의 declaration hash 차이 | overload 순서, declaration merging, export order 등 타입 의미 차이 | **거부.** text/AST diff와 TypeScript 소비자 negative control 없이 안전하지 않음 |

현재 승인할 수 있는 정규화는 **없다**. 파일명 패턴이나 동일 바이트 수만으로 기능적
동등성을 추정하지 않는다.

## 누락된 증거

- baseline A/B의 원본 61개 파일과 byte-level/text diff.
- 두 빌드의 esbuild metafile 또는 동등한 input-to-output graph.
- 각 chunk의 import/export 목록, importer 목록과 baseline 간 검증된 node 대응.
- glob이 tsup/esbuild에 전달한 실제 entry 순서와 module traversal 순서.
- build process가 본 정제된 환경값, locale, filesystem enumeration 정보.
- `.d.ts`의 AST 수준 차이와 소비자 typecheck 영향.
- workspace root, timestamp, random/build ID가 실제 baseline bytes에 존재하는지에 대한 검색.
- 기능 동등성 및 정규화 안전성을 검증할 negative-control 결과.

이 누락 때문에 61개 차이를 비기능적이라고 확정할 수 없다.

## 권고하는 다음 실험

별도 승인을 받아 다음 진단 실험 하나를 설계한다. 추가 검증 시나리오로 넘어가기 전에
두 독립 clean build의 전체 raw output tree를 삭제하지 않고 보존하고, esbuild metafile
또는 동등한 graph 자료, 실제 entry 순서, 정제된 비민감 환경 메타데이터를 함께 수집한다.
그 후 다음 순서로 분석한다.

1. 61개 파일의 원문 diff와 AST/import-export graph를 비교한다.
2. chunk를 파일 크기가 아니라 input module 집합, exports, dependencies로 대응시킨다.
3. 절대 경로·timestamp·난수·정렬 차이를 실제 byte 위치에서 확인한다.
4. 원인이 entry 순서라면 진단용 복제본에서 정렬 전후를 비교하되 pinned source나 기존
   evidence는 변경하지 않는다.
5. 후보 정규화가 생기면 실행 로직, export binding, dependency edge, E2/E3 marker를 각각
   변이하는 negative controls가 모두 불일치로 남는지 검증한다.

이 증거로 동일 기능이 입증되고 negative controls가 통과하기 전까지 E-1 PASS 또는
E2/E3 진입으로 승격해서는 안 된다.

## 변경 및 검증

- 새 파일: `docs/phase3-step-e1b-analysis.md`.
- 기존 문서, evidence, CacheTrust source, target checkout, lockfile은 변경하지 않았다.
- 실행하지 않음: build, install, E1/E2/E3, 테스트, normalization 구현.
- 최종 검증: `git diff --check`와 changed-file 확인을 수행한다.
