"""브라우저 자동화 도구 모음.

사전기획 검토 업무에 필요한 7개 사이트 자동 수집 도구.
Playwright(sync API)를 사용합니다.

사용법:
    python -m src.browser_tools.schoolinfo "광남고등학교"
    python -m src.browser_tools.population "서울특별시 광진구"
    python -m src.browser_tools.design_fee --pay 5000000000
    python -m src.browser_tools.building_info "서울 광진구 아차산로 200"
    python -m src.browser_tools.land_info "광진구 군자동 98"
    python -m src.browser_tools.heritage "서울특별시 광진구"
    python -m src.browser_tools.school_zone "광남고등학교"
"""

from .base import BrowserTool
from .schoolinfo import SchoolInfoTool
from .population import PopulationTool
from .design_fee import DesignFeeTool
from .building_info import BuildingInfoTool
from .land_info import LandInfoTool
from .heritage import HeritageTool
from .school_zone import SchoolZoneTool

__all__ = [
    "BrowserTool",
    "SchoolInfoTool",
    "PopulationTool",
    "DesignFeeTool",
    "BuildingInfoTool",
    "LandInfoTool",
    "HeritageTool",
    "SchoolZoneTool",
]
