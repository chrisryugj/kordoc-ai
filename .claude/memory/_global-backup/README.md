# 사용자 글로벌 메모리 백업

> Claude Code의 사용자별 글로벌 user memory (`~/.claude/projects/<project-id>/memory/`) 백업.
> Git으로 동기화 안 되는 영역이라 다른 PC에서 작업 이어갈 때 수동 복원 필요.

## 집 PC에서 복원 (Windows)

```powershell
# Claude Code가 인식하는 글로벌 메모리 경로 (사용자명 동일하다고 가정)
$dest = "$env:USERPROFILE\.claude\projects\d--AI-Project-kordoc\memory"
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item -Path "$PSScriptRoot\*.md" -Destination $dest -Exclude "README.md" -Force

Write-Host "복원 완료. Claude Code 새 세션 시작하면 자동 로드됨."
```

## 다른 사용자명일 경우
경로의 `Chris` 부분이 본인 사용자명에 맞게 변경됨. 위 스크립트는 `$env:USERPROFILE` 사용으로 자동 처리.

만약 프로젝트 ID가 다르면 (`d--AI-Project-kordoc` 부분) 새 PC의 디렉토리명에 맞게 수정.

## 파일 설명

| 파일 | 내용 |
|------|------|
| `MEMORY.md` | 글로벌 메모리 인덱스 (한 줄당 한 entry) |
| `project_kordoc_suite_phase1.md` | Phase 1 완료 + Phase 2 진행 상태 + 기술 함정 |
| `project_pdf_parser_upgrade.md` | 별도 작업 (PDF 파서 ODL 업그레이드, Phase 3 대기) |
