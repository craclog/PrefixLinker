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

## 개발 명령어

```bash
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

## TDD 워크플로우

1. **Red** — 실패하는 테스트를 먼저 작성한다.
2. **Green** — 테스트를 통과시키는 최소한의 코드를 작성한다.
3. **Refactor** — 동작을 유지하며 코드를 정리한다.
4. 각 단계마다 `npm test`를 실행해 확인한다.
