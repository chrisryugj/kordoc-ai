"""공통 결과 추적 타입.

모든 MVP 파이프라인이 이 타입을 반환하여
성공/실패/경고를 일관되게 추적합니다.
"""

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class StepResult:
    """개별 단계(페이지, 파일 등)의 처리 결과."""
    name: str
    success: bool
    message: str = ""
    warnings: List[str] = field(default_factory=list)

    def __str__(self):
        status = "OK" if self.success else "FAIL"
        return f"[{status}] {self.name}: {self.message}"


@dataclass
class Result:
    """전체 파이프라인의 누적 결과."""
    total: int = 0
    success_count: int = 0
    fail_count: int = 0
    steps: List[StepResult] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    output_path: Optional[str] = None

    def add_success(self, name: str, message: str = "", warnings: List[str] = None):
        self.total += 1
        self.success_count += 1
        step = StepResult(name=name, success=True, message=message,
                          warnings=warnings or [])
        self.steps.append(step)
        if warnings:
            self.warnings.extend(warnings)

    def add_failure(self, name: str, message: str = ""):
        self.total += 1
        self.fail_count += 1
        self.steps.append(StepResult(name=name, success=False, message=message))

    @property
    def all_success(self) -> bool:
        return self.fail_count == 0 and self.total > 0

    def summary(self) -> str:
        lines = [
            f"처리 결과: 총 {self.total}건 중 성공 {self.success_count}건, 실패 {self.fail_count}건"
        ]
        if self.warnings:
            lines.append(f"경고 {len(self.warnings)}건:")
            for w in self.warnings:
                lines.append(f"  - {w}")
        if self.fail_count > 0:
            lines.append("실패 항목:")
            for s in self.steps:
                if not s.success:
                    lines.append(f"  - {s.name}: {s.message}")
        if self.output_path:
            lines.append(f"출력 위치: {self.output_path}")
        return "\n".join(lines)
