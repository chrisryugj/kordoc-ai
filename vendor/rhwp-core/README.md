# vendor/rhwp-core: 패치한 rhwp 엔진

내장 한글 편집기·미리보기(화면)·쪽 그리기(엔진)가 함께 쓰는 rhwp 엔진(`@rhwp/core`). npm 0.8.7 대신 같은 태그 소스에 `patches/` 를 얹어 이 레포에서 빌드한 결과를 둠.

- 원본: https://github.com/edwardkim/rhwp 태그 `v0.8.7`(커밋 `1a76570e`), MIT. 원본 라이선스 `LICENSE`, WASM 에 든 크레이트 목록 `THIRD_PARTY_LICENSES.md`.
- 패치 출처: 이음오피스(IeumOffice, https://github.com/pblsketch/openoffice, Apache-2.0, Copyright 2026 Mainfunc, Inc.) `vendor/rhwp-core/patches`(커밋 63e2a636) 그대로.
- 루트 `package.json`(`file:vendor/rhwp-core`)과 `node-sidecar/package.json`(`file:../vendor/rhwp-core`)이 이 폴더를 가리킴. 설치본은 `node-sidecar/scripts/stage-natives.mjs` 가 파일째 복사.
- 버전 `0.8.7-kordoc.N` 의 N 은 패치 묶음이 바뀔 때마다 올림. `rhwp.js`·`rhwp.d.ts` 는 npm 0.8.7 에 0014 의 호출 둘(`setPageNumberPos`, `getPageNumberPos`)만 더한 것.

## 패치

| 파일 | 고치는 것 |
| --- | --- |
| 0001 | 쪽·종이 기준 어울림 표와 같은 문단의 글자처럼 취급 표를 그 표 아래 줄에 둠 (뒤 문단이 표와 겹치던 것) |
| 0002 | 저장 줄 위치가 0 으로 되감기는 줄 뒤의 각주 표식·문단 기준 그림에서 문단을 나눔 (그림이 앞 쪽 본문에 겹치던 것) |
| 0003 | 본문이 각주 영역보다 아래까지 그려진 쪽에서 각주 영역만 내림 (마지막 줄과 각주 구분선 겹침) |
| 0004·0008 | 제목 표 바닥에서 시작하는 쪽은 저장 위치 그대로 (학습목표 상자가 제목 표를 덮던 것) |
| 0005 | 쪽 위쪽에서 다시 시작한 문단을 앞 쪽 꼬리에 남기지 않음 (본문 아래로 넘쳐 그리던 것) |
| 0006 | 쪽을 나누어 저장하지 않은 생성 문서에서 각주 높이를 그리는 높이로 예약 |
| 0007 | 예전 한글이 남긴 "앵커만 든 빈 줄 + 상자 줄" 을 한 줄로 합침 |
| 0009 | 셀 영역 배경이 병합 칸 끝까지 칠해짐 (제목 표 장식 그림이 절반만 그려지던 것) |
| 0010 | 머리말·꼬리말의 종이·쪽 기준 표·글상자를 그 틀에서 잼 (쪽 번호 상자가 엉뚱한 구석에 그려지던 것) |
| 0011 | 바탕쪽 없는 구역이 앞 구역 바탕쪽을 이어받음 (둘째 구역부터 쪽 번호·아래 띠가 빠지던 것) |
| 0012 | 스타일을 지울 때 표 칸·글상자·머리말·각주 안 문단의 스타일 번호도 고침 |
| 0013 | 스타일 걸기·고치기를 한컴 한글 2024처럼 속성마다 (직접 서식만 남기고, 고친 스타일이 모든 문단에 퍼짐) |
| 0014 | 쪽 번호 매기기 호출(`setPageNumberPos`·`getPageNumberPos`), HWPX 의 줄표 없는 쪽 번호를 원본대로 읽고 씀 |
| 0015 | 편집할 때마다 하는 캔버스 측정 요청 수집에서 글자 진행 폭을 재지 않음 (큰 문서에서 키 하나 시간 감소) |

0001~0011·0015 는 조판·그리기만 바꿈(저장 결과 같음). 0012·0013 은 스타일을 지우거나 걸거나 고친 문서, 0014 는 쪽 번호를 넣었거나 줄표 없는 쪽 번호가 든 HWPX 의 저장 결과를 한글처럼 바꿈.

## 다시 빌드

```bash
node scripts/build-rhwp-core.mjs     # 태그 받기 → 커밋 확인 → 패치 차례로 → wasm-pack build --target web --release
```

- 필요: git, rustup(태그의 rust-toolchain.toml 이 1.93.1·wasm32 를 고름), wasm-pack 0.15.0(`cargo install wasm-pack --version 0.15.0 --locked`)
- 결과 파일과 `package.json` 의 `rhwp.wasmSha256` 이 바뀜. 빌드한 PC 경로는 `--remap-path-prefix` 로 지움
- 바꾼 뒤 루트에서 `pnpm install`(화면은 복사본을 씀), `node scripts/build-rhwp-studio.mjs`(편집기 확인 값에 WASM 이 들어가 다시 빌드됨)
- 앱 빌드에는 Rust 가 필요 없음. rhwp 를 올릴 땐 새 판이 같은 수정을 담았는지 먼저 보고 담은 패치를 지움. 다 사라지면 npm 패키지로 되돌림
