# PrefixLinker — Claude Project Instructions

## 프로젝트 개요

인터넷 페이지에서 설정된 prefix 패턴(예: `CSWPR-12345`)을 감지해 클릭 가능한 링크로 변환하는 Chrome 익스텐션.

## 디렉토리 구조

```
prefixLinker/
├── src/core.js           # 순수 함수 모음 (DOM 의존 없음, Jest로 테스트)
├── tests/core.test.js    # 단위 테스트 (Jest)
├── extension/
│   ├── manifest.json     # MV3 manifest
│   ├── core.js           # src/core.js 복사본 (content script에서 사용)
│   ├── content.js        # DOM 텍스트 노드 스캔 및 링크 교체
│   ├── popup.html        # 규칙 관리 UI
│   └── popup.js          # popup 로직 (chrome.storage.sync)
└── test.html             # 브라우저 통합 테스트 페이지
```

> `src/core.js`를 수정하면 반드시 `extension/core.js`에도 동기화한다 (`npm run build`).

## 개발 환경 설정

### 처음 클론하거나 `node_modules`가 없을 때

`node_modules`는 `.gitignore`에 의해 저장소에 포함되지 않는다.
`package-lock.json`이 의존성의 정확한 버전을 고정하고 있으므로,
아래 명령어로 동일한 환경을 재현한다.

```bash
npm ci        # package-lock.json 기준으로 정확히 설치 (CI/협업 권장)
# 또는
npm install   # package.json 기준으로 설치 (lock 파일도 갱신될 수 있음)
```

> `npm ci`는 `node_modules`를 한 번 지우고 lock 파일을 그대로 따르므로
> "내 환경에서만 되는" 문제를 예방한다. 새로운 환경 세팅 시 `npm ci`를 기본으로 사용한다.

### 의존성을 새로 추가할 때

```bash
npm install <package>          # 런타임 의존성
npm install --save-dev <package>  # 개발 의존성 (테스트 도구 등)
```

추가 후 `package.json`과 `package-lock.json` 두 파일을 함께 커밋한다.

### `node_modules` 재설치가 필요한 상황

- 저장소를 처음 클론했을 때
- `package-lock.json`이 변경된 커밋을 pull 받았을 때
- 의존성 관련 오류가 발생할 때 (`npm ci`로 클린 설치)

## 개발 명령어

```bash
npm ci                # 의존성 클린 설치 (처음 세팅 시)
npm test              # 단위 테스트 실행
npm run test:watch    # 워치 모드
npm run test:coverage # 커버리지 리포트
npm run build         # src/core.js → extension/core.js 동기화
```

## 아키텍처 원칙

- **핵심 로직은 `src/core.js`에만.** DOM/브라우저 API 없이 Node에서 실행 가능해야 한다.
- **content.js는 DOM 조작만.** 비즈니스 로직은 core.js 함수를 호출한다.
- `data-prefixlinker-done` 속성으로 이미 처리된 노드를 표시해 중복 처리를 방지한다.
- `MutationObserver`로 동적으로 추가된 노드도 실시간으로 처리한다.

## 커밋 규칙

- **기능별로 커밋을 분리**한다. 관련 없는 변경을 하나의 커밋에 묶지 않는다.
- 커밋 메시지는 **무엇을, 왜** 변경했는지 설명한다 (파일 목록 나열 금지).
- **Conventional Commits** 접두사 사용: `feat`, `fix`, `chore`, `test`, `refactor`, `docs`.
  - 스코프 권장: `feat(core):`, `fix(content):` 등.
- **`Signed-off-by` 필수** — 모든 커밋에 아래 줄을 추가한다:
  ```
  Signed-off-by: Kiyoung Yoon <craclog@gmail.com>
  ```

### 커밋 메시지 예시

```
fix(content): linkify dynamically added nodes via MutationObserver

Problem: init() ran once at page load, so text injected afterwards
was never linkified.

Solution: attach MutationObserver after the initial pass; process
each addedNode immediately.

Signed-off-by: Kiyoung Yoon <craclog@gmail.com>
```

## 버전 관리

변경 사항이 있을 때마다 **두 파일의 버전을 함께 올린다.**

- `extension/manifest.json` → `"version"` 필드 (Chrome이 실제로 읽는 버전)
- `package.json` → `"version"` 필드 (npm 에코시스템 버전, manifest와 항상 동기화)

### Semantic Versioning 기준

| 변경 종류 | 올릴 버전 | 예시 |
|-----------|-----------|------|
| 새 기능 추가 (하위 호환) | **minor** `1.0.0 → 1.1.0` | 규칙 편집 기능, 아이콘 추가 |
| 버그 수정, 성능 개선 | **patch** `1.1.0 → 1.1.1` | 크래시 수정, 가드 추가 |
| 기존 동작이 바뀌는 큰 변경 | **major** `1.1.0 → 2.0.0` | 스토리지 구조 변경 |

### 버전 커밋 예시

```
chore: bump version to 1.1.0

Add rule-edit UI, chain-link icon, English UI, and dynamic-content
MutationObserver guard introduced since 1.0.0.

Signed-off-by: Kiyoung Yoon <craclog@gmail.com>
```

## TDD 워크플로우

1. **Red** — 실패하는 테스트를 먼저 작성한다.
2. **Green** — 테스트를 통과시키는 최소한의 코드를 작성한다.
3. **Refactor** — 동작을 유지하며 코드를 정리한다.
4. 각 단계마다 `npm test`를 실행해 확인한다.
