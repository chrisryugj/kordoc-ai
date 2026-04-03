import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { SectionCard, CollapsibleSection, KVRow, flattenForDisplay } from "./shared";

async function openFile(path: string) {
  try { await invoke("sidecar_call", { method: "open_file", params: { path } }); } catch { /* non-critical */ }
}

// ─── Tool-specific Result Renderers ───

export function ToolResult({
  toolId, data, onRerun,
}: {
  toolId: string;
  data: Record<string, unknown>;
  onRerun?: (params: Record<string, string>) => void;
}) {
  const cleaned = getDataOnly(data);

  switch (toolId) {
    case "schoolinfo":
      return <SchoolInfoResult data={cleaned} onRerun={onRerun} />;
    case "building_info":
      return <BuildingInfoResult data={cleaned} />;
    case "land_info":
      return <LandInfoResult data={cleaned} />;
    case "population":
      return <PopulationResult data={cleaned} />;
    case "heritage":
      return <HeritageResult data={cleaned} />;
    case "design_fee":
      return <DesignFeeResult data={cleaned} />;
    case "school_zone":
      return <SchoolZoneResult data={cleaned} onRerun={onRerun} />;
    default:
      return <GenericResult data={cleaned} />;
  }
}

/** 결과에서 _meta를 제외한 데이터만 반환 */
export function getDataOnly(result: Record<string, unknown>): Record<string, unknown> {
  const { _meta, ...data } = result;
  return data;
}

// ─── 학교알리미 결과 ───

type SchoolCandidate = { 학교명?: string; name?: string; schulId?: string };

function SchoolInfoResult({ data, onRerun }: { data: Record<string, unknown>; onRerun?: (params: Record<string, string>) => void }) {
  const name = String(data.학교명_정식 || data.학교명 || "");
  const resultCount = Number(data.검색결과수 || 0);
  const candidates = (data.후보목록 as SchoolCandidate[] | undefined) ?? [];
  const categories = data.공시_카테고리 as string[] | undefined;

  // 후보 목록이 있으면 선택 UI만 표시
  if (candidates.length > 1) {
    return (
      <div className="space-y-3">
        <SectionCard title="검색 결과" subtitle={`${candidates.length}개교 — 선택하면 해당 학교 정보를 조회합니다`}>
          <div className="space-y-1.5">
            {candidates.map((c, i) => {
              const cName = c.학교명 || c.name || `${i + 1}번 학교`;
              const hasId = !!c.schulId;
              return (
                <div key={i} className="flex items-center gap-3 p-2 rounded"
                  style={{ backgroundColor: "var(--color-bg-secondary)" }}>
                  <div className="flex-1 min-w-0">
                    <span className="ts-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                      {cName}
                    </span>
                  </div>
                  {hasId && onRerun && (
                    <button
                      onClick={() => onRerun({
                        school_name: cName,
                        schul_id: c.schulId!,
                      })}
                      className="px-2.5 py-1 rounded ts-2xs font-medium shrink-0 transition-opacity hover:opacity-80"
                      style={{ backgroundColor: "var(--color-accent)", color: "white" }}
                    >
                      정보 조회
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>
    );
  }

  const SKIP_KEYS = new Set([
    "학교명", "학교명_정식", "검색결과수", "공시_카테고리",
    "오류", "본문", "성공", "급식일자", "급식메뉴", "후보목록",
  ]);
  const infoKeys = Object.keys(data).filter(
    (k) => !SKIP_KEYS.has(k) && !k.startsWith("테이블_")
  );

  const mealDate = data.급식일자 ? String(data.급식일자) : null;
  const mealMenu = data.급식메뉴 ? String(data.급식메뉴) : null;

  return (
    <div className="space-y-3">
      <SectionCard title={`${name} 기본정보`} subtitle={`검색결과 ${resultCount}건`}>
        <div className="space-y-1">
          {infoKeys.map((key) => (
            <KVRow key={key} label={key} value={data[key]} />
          ))}
        </div>
      </SectionCard>

      {(mealDate || mealMenu) && (
        <SectionCard title="급식 정보 (참고)">
          {mealDate && (
            <p className="ts-2xs mb-1.5 font-medium" style={{ color: "var(--color-text-secondary)" }}>
              {mealDate}
              <span className="ml-2 font-normal" style={{ color: "var(--color-text-muted)" }}>
                (학교알리미 기준 — 현재 날짜와 다를 수 있음)
              </span>
            </p>
          )}
          {mealMenu && (
            <p className="ts-2xs" style={{ color: "var(--color-text-primary)", lineHeight: "1.6" }}>
              {mealMenu}
            </p>
          )}
        </SectionCard>
      )}

      {categories && categories.length > 0 && (
        <SectionCard title="공시 카테고리">
          <div className="flex flex-wrap gap-1.5">
            {categories.map((cat, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full ts-2xs"
                style={{ backgroundColor: "var(--color-accent-subtle)", color: "var(--color-accent)" }}>
                {cat}
              </span>
            ))}
          </div>
        </SectionCard>
      )}

      {Object.keys(data).filter((k) => k.startsWith("테이블_")).map((key) => (
        <CollapsibleSection key={key} title={key}>
          <pre className="ts-2xs whitespace-pre-wrap" style={{ color: "var(--color-text-secondary)" }}>
            {String(data[key])}
          </pre>
        </CollapsibleSection>
      ))}
    </div>
  );
}

// ─── 세움터 결과 ───

function BuildingInfoResult({ data }: { data: Record<string, unknown> }) {
  const query = String(data.검색어 || "");
  const detail = data.상세정보 as Record<string, unknown> | undefined;
  const list = data.결과목록 as Record<string, string>[] | undefined;

  return (
    <div className="space-y-3">
      {detail && Object.keys(detail).length > 0 ? (
        <SectionCard title={`건축물 상세 — ${query}`}>
          <div className="space-y-1">
            {Object.entries(detail).map(([k, v]) => (
              <KVRow key={k} label={k} value={v} />
            ))}
          </div>
        </SectionCard>
      ) : (
        <SectionCard title={`검색 결과 — ${query}`}>
          {list && list.length > 0 ? (
            <div className="space-y-2">
              {list.map((item, i) => (
                <div key={i} className="p-2 rounded" style={{ backgroundColor: "var(--color-bg-secondary)" }}>
                  {Object.entries(item).map(([k, v]) => (
                    <span key={k} className="ts-2xs mr-3" style={{ color: "var(--color-text-secondary)" }}>
                      <strong>{k}:</strong> {v}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>검색 결과 없음</p>
          )}
        </SectionCard>
      )}
    </div>
  );
}

// ─── 토지이음 결과 ───

function LandInfoResult({ data }: { data: Record<string, unknown> }) {
  const address = String(data.정확주소 || data.주소 || "");

  // 기본정보 필드
  const basicFields = ["소재지", "지목", "면적", "개별공시지가", "PNU"];
  // 토지이용규제 필드
  const zoneFields = ["국토계획법_지역지구", "다른법령_지역지구", "토지이용규제_기타",
                       "용도지역", "용도지구", "용도구역"];
  // 구조화 서브섹션 필드
  const subSections = ["토지소유_거래", "토지이력_특성", "건축물정보",
                        "토지정보", "토지특성", "토지이동"];
  // 숨김 필드
  const hideKeys = new Set(["주소", "정확주소", "성공", "오류", "주소후보", "정보패널",
                             "확인도면", "확인도면_base64", ...basicFields, ...zoneFields, ...subSections]);

  // 확인도면 이미지
  const mapSrc = data.확인도면_base64
    ? String(data.확인도면_base64)
    : data.확인도면
    ? convertFileSrc(String(data.확인도면))
    : null;

  // 기타 필드
  const otherKeys = Object.keys(data).filter((k) => !hideKeys.has(k) && !k.startsWith("_"));

  const zoneLabelMap: Record<string, string> = {
    "국토계획법_지역지구": "국토계획법에 따른 지역·지구등",
    "다른법령_지역지구": "다른 법령에 따른 지역·지구등",
    "토지이용규제_기타": "토지이용규제 기본법 시행령",
    "용도지역": "용도지역",
    "용도지구": "용도지구",
    "용도구역": "용도구역",
  };

  return (
    <div className="space-y-3">
      {/* 기본정보 */}
      <SectionCard title={`토지 정보 — ${address}`}>
        <div className="space-y-1">
          {basicFields.map((key) =>
            data[key] != null ? <KVRow key={key} label={key} value={data[key]} /> : null
          )}
        </div>
      </SectionCard>

      {/* 토지이용규제 */}
      {zoneFields.some((k) => data[k]) && (
        <SectionCard title="토지이용규제">
          <div className="space-y-2">
            {zoneFields.map((key) => {
              const val = data[key];
              if (!val) return null;
              return (
                <div key={key}>
                  <p className="ts-2xs font-semibold mb-0.5" style={{ color: "var(--color-text-secondary)" }}>
                    {zoneLabelMap[key] || key}
                  </p>
                  <p className="ts-2xs" style={{ color: "var(--color-text-primary)", lineHeight: 1.5 }}>
                    {String(val)}
                  </p>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* 토지이력/특성, 건축물정보 등 */}
      {subSections.map((sec) => {
        const secData = data[sec] as Record<string, unknown> | undefined;
        if (!secData || typeof secData !== "object" || Object.keys(secData).length === 0) return null;
        return (
          <SectionCard key={sec} title={sec.replace(/_/g, " · ")}>
            <div className="space-y-1">
              {Object.entries(secData).map(([k, v]) => {
                // 표제부 등 긴 텍스트는 pre-wrap
                if (typeof v === "string" && v.includes("\n")) {
                  return (
                    <div key={k}>
                      <p className="ts-2xs font-semibold mb-0.5" style={{ color: "var(--color-text-secondary)" }}>{k}</p>
                      <pre className="ts-2xs whitespace-pre-wrap" style={{ color: "var(--color-text-primary)", lineHeight: 1.4 }}>{v}</pre>
                    </div>
                  );
                }
                return <KVRow key={k} label={k} value={v} />;
              })}
            </div>
          </SectionCard>
        );
      })}

      {/* 확인도면 미리보기 */}
      {mapSrc && (
        <SectionCard title="확인도면">
          <img
            src={mapSrc}
            alt="확인도면"
            onClick={() => { const p = String(data.확인도면 ?? ""); if (p) openFile(p); }}
            className="rounded-md"
            style={{
              maxHeight: 200,
              width: "auto",
              maxWidth: "100%",
              objectFit: "contain",
              display: "block",
              backgroundColor: "var(--color-bg-secondary)",
              cursor: data.확인도면 ? "pointer" : "default",
            }}
            title="클릭하여 원본 이미지 열기"
          />
          {!!data.확인도면 && (
            <p className="ts-2xs mt-1" style={{ color: "var(--color-text-muted)" }}>
              클릭하면 원본 이미지가 열립니다
            </p>
          )}
        </SectionCard>
      )}

      {/* 기타 */}
      {otherKeys.length > 0 && (
        <CollapsibleSection title="기타 정보">
          <div className="space-y-1">
            {otherKeys.map((key) => (
              <KVRow key={key} label={key} value={data[key]} />
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

// ─── 학령인구 결과 ───

function PopulationResult({ data }: { data: Record<string, unknown> }) {
  const region = String(data.지역 || data.지역명 || "");
  const totalPop = Number(data.총인구 || 0);
  const agePop = data.연령별_인구 as Record<string, number> | undefined;

  const schoolAges: Record<string, { label: string; range: [number, number]; count: number }> = {
    elementary: { label: "초등학교 (6~11세)", range: [6, 11], count: 0 },
    middle: { label: "중학교 (12~14세)", range: [12, 14], count: 0 },
    high: { label: "고등학교 (15~17세)", range: [15, 17], count: 0 },
  };

  if (agePop) {
    for (const [, info] of Object.entries(schoolAges)) {
      for (let age = info.range[0]; age <= info.range[1]; age++) {
        info.count += agePop[`${age}세`] || 0;
      }
    }
  }
  const totalSchool = Object.values(schoolAges).reduce((s, g) => s + g.count, 0);

  return (
    <div className="space-y-3">
      <SectionCard title={`${region} 학령인구`} subtitle={totalPop > 0 ? `총인구 ${totalPop.toLocaleString()}명` : undefined}>
        {totalSchool > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <span className="ts-lg font-bold" style={{ color: "var(--color-accent)" }}>
                {totalSchool.toLocaleString()}명
              </span>
              {totalPop > 0 && (
                <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                  (총인구 대비 {(totalSchool / totalPop * 100).toFixed(1)}%)
                </span>
              )}
            </div>
            {Object.entries(schoolAges).map(([key, group]) => (
              <div key={key} className="flex items-center gap-3">
                <span className="ts-2xs shrink-0 whitespace-nowrap" style={{ color: "var(--color-text-secondary)", minWidth: "120px" }}>
                  {group.label}
                </span>
                <div className="flex-1 h-5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${totalSchool > 0 ? (group.count / totalSchool * 100) : 0}%`,
                      backgroundColor: key === "elementary" ? "#3B82F6" : key === "middle" ? "#10B981" : "#F59E0B",
                    }}
                  />
                </div>
                <span className="ts-2xs font-semibold shrink-0 whitespace-nowrap text-right" style={{ color: "var(--color-text-primary)", minWidth: "70px" }}>
                  {group.count.toLocaleString()}명
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>데이터 없음</p>
        )}
      </SectionCard>

      {agePop && Object.keys(agePop).length > 0 && (
        <CollapsibleSection title="전체 연령별 인구">
          <div className="grid grid-cols-4 gap-x-4 gap-y-0.5">
            {Object.entries(agePop)
              .filter(([_, v]) => v > 0)
              .map(([age, count]) => (
                <div key={age} className="flex justify-between ts-2xs" style={{ color: "var(--color-text-secondary)" }}>
                  <span>{age}</span>
                  <span className="font-mono">{count.toLocaleString()}</span>
                </div>
              ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

// ─── 국가유산 결과 ───

function HeritageResult({ data }: { data: Record<string, unknown> }) {
  const location = String(data.검색위치 || "");
  const count = Number(data.발견수 || 0);
  const list = data.유산목록 as { 명칭?: string; 종목?: string; 소재지?: string; 시대?: string; 내용?: string; 유형?: string }[] | undefined;
  const detail = data.첫번째_상세 as Record<string, unknown> | undefined;

  // 종목별 그룹핑
  const byKind: Record<string, typeof list> = {};
  if (list) {
    for (const item of list) {
      const kind = item.종목 || item.유형 || "기타";
      if (!byKind[kind]) byKind[kind] = [];
      byKind[kind]!.push(item);
    }
  }

  return (
    <div className="space-y-3">
      <SectionCard
        title={`${location} 국가유산`}
        subtitle={count === 0 ? "문화유산 영향 없음" : `${count}건 발견`}
      >
        {count === 0 ? (
          <div className="p-3 rounded-lg" style={{ backgroundColor: "var(--color-success-bg, #D1FAE5)" }}>
            <p className="ts-sm font-medium" style={{ color: "var(--color-success)" }}>
              해당 지역에서 국가유산이 발견되지 않았습니다.
            </p>
            <p className="ts-2xs mt-1" style={{ color: "var(--color-text-muted)" }}>
              검토의견서 부지분석에 "문화유산 영향 없음"으로 기재 가능
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(byKind).map(([kind, items]) => (
              <div key={kind}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="px-2 py-0.5 rounded ts-2xs font-bold shrink-0"
                    style={{ backgroundColor: "#FEE2E2", color: "#991B1B" }}>
                    {kind}
                  </span>
                  <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                    {items!.length}건
                  </span>
                </div>
                <div className="space-y-1">
                  {items!.map((item, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded" style={{ backgroundColor: "var(--color-bg-secondary)" }}>
                      <span className="ts-2xs font-medium shrink-0" style={{ color: "var(--color-text-primary)" }}>
                        {item.명칭 || item.내용 || ""}
                      </span>
                      {(item.소재지 || item.시대) && (
                        <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                          {[item.소재지, item.시대].filter(Boolean).join(" / ")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {detail && Object.keys(detail).length > 0 && (
        <SectionCard title="상세 정보 (첫 번째 유산)">
          <div className="space-y-1">
            {Object.entries(detail).map(([k, v]) => (
              <KVRow key={k} label={k} value={v} />
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ─── 설계대가 결과 ───

function DesignFeeResult({ data }: { data: Record<string, unknown> }) {
  const input = data.입력 as Record<string, string> | undefined;
  const amounts = data.산출금액 as string[] | undefined;
  const rawResult = data.결과_원본 as string | undefined;
  const resultLines = data.결과_라인 as string[] | undefined;

  return (
    <div className="space-y-3">
      {input && (
        <SectionCard title="산출 조건">
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(input).map(([k, v]) => (
              <div key={k}>
                <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>{k}</span>
                <p className="ts-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  {k === "공사비" ? `${Number(v).toLocaleString()}원` : v}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {amounts && amounts.length > 0 && (
        <SectionCard title="산출 결과">
          <div className="space-y-2">
            {amounts.map((amt, i) => (
              <div key={i} className="p-3 rounded-lg text-center"
                style={{ backgroundColor: "var(--color-accent-subtle)" }}>
                <span className="ts-lg font-bold" style={{ color: "var(--color-accent)" }}>{amt}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {!amounts && rawResult && (
        <CollapsibleSection title="산출 결과 (원본)">
          <pre className="ts-2xs whitespace-pre-wrap" style={{ color: "var(--color-text-secondary)" }}>{rawResult}</pre>
        </CollapsibleSection>
      )}

      {!amounts && !rawResult && resultLines && (
        <SectionCard title="산출 결과">
          <div className="space-y-1">
            {resultLines.map((line, i) => (
              <p key={i} className="ts-sm" style={{ color: "var(--color-text-primary)" }}>{line}</p>
            ))}
          </div>
        </SectionCard>
      )}

      {typeof data.오류 === "string" && data.오류 && (
        <div className="p-3 rounded-lg" style={{ backgroundColor: "var(--color-error-bg)" }}>
          <p className="ts-sm" style={{ color: "var(--color-error)" }}>{data.오류}</p>
        </div>
      )}
    </div>
  );
}

// ─── 학구도 결과 ───

type SchoolItem = Record<string, string>;
type ZoneSchool = { 학교명: string; 직선거리?: string; 주소?: string; 교육지원청?: string };

function SchoolZoneResult({
  data, onRerun,
}: {
  data: Record<string, unknown>;
  onRerun?: (params: Record<string, string>) => void;
}) {
  const schools = (data.학교목록 as SchoolItem[]) ?? [];
  const zone = (data.학구_상세 as Record<string, unknown>) ?? {};

  const mapSrc = zone.지도_이미지_base64
    ? String(zone.지도_이미지_base64)
    : zone.지도_이미지
    ? convertFileSrc(String(zone.지도_이미지))
    : null;

  const SCHOOL_TYPES = ["초등학교", "중학교", "고등학교"] as const;
  // 학교 선택 UI: 여러 학교일 때만 표시 (1개면 무조건 숨김)
  const showSchoolList = schools.length > 1;

  return (
    <div className="space-y-3">
      {/* 검색 결과 목록 + 선택 */}
      {showSchoolList && (
        <SectionCard title={`검색 결과`} subtitle={`${schools.length}개교 — 선택하면 해당 학교 학구도 조회`}>
          <div className="space-y-1.5">
            {schools.map((school, i) => {
              const name = school.학교명 || school.정보 || `${i + 1}번 학교`;
              const grade = school.학교급 || school.유형 || "";
              const region = school.지역 || "";
              const hasId = !!school.schoolId;
              return (
                <div key={i} className="flex items-center gap-3 p-2 rounded"
                  style={{ backgroundColor: "var(--color-bg-secondary)" }}>
                  <div className="flex-1 min-w-0">
                    <span className="ts-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                      {name}
                    </span>
                    {(grade || region) && (
                      <span className="ml-2 ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                        {[grade, region].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                  {hasId && onRerun && (
                    <button
                      onClick={() => onRerun({
                        address: name,
                        school_id: school.schoolId,
                        school_class: school.schoolClass || "",
                      })}
                      className="px-2.5 py-1 rounded ts-2xs font-medium shrink-0 transition-opacity hover:opacity-80"
                      style={{ backgroundColor: "var(--color-accent)", color: "white" }}
                    >
                      학구도 조회
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* 지도 미리보기 — 클릭하면 파일 외부 열기 */}
      {mapSrc && (
        <SectionCard title="학구도 지도">
          <img
            src={mapSrc}
            alt="학구도 지도"
            onClick={() => { const p = String(zone.지도_이미지 ?? ""); if (p) openFile(p); }}
            className="rounded-md"
            style={{
              maxHeight: 160,
              width: "auto",
              maxWidth: "100%",
              objectFit: "contain",
              display: "block",
              backgroundColor: "var(--color-bg-secondary)",
              cursor: zone.지도_이미지 ? "pointer" : "default",
            }}
            title="클릭하여 원본 이미지 열기"
          />
          {!!zone.지도_이미지 && (
            <p className="ts-2xs mt-1" style={{ color: "var(--color-text-muted)" }}>
              클릭하면 원본 이미지가 열립니다
            </p>
          )}
        </SectionCard>
      )}

      {/* 학교급별 학구 상세 */}
      {SCHOOL_TYPES.map((type) => {
        const zoneName = zone[`${type}_학구`] as string | undefined;
        const list = zone[`${type}_학교목록`] as ZoneSchool[] | undefined;
        const exceptions = zone[`${type}_예외학교`] as ZoneSchool[] | undefined;
        if (!zoneName && !list?.length) return null;
        return (
          <SectionCard key={type} title={type} subtitle={zoneName}>
            {list && list.length > 0 && (
              <div className="space-y-1">
                {list.map((s, i) => (
                  <div key={i} className="flex items-start gap-3 py-1"
                    style={{ borderBottom: i < list.length - 1 ? "1px solid var(--color-border)" : "none" }}>
                    <span className="ts-sm font-semibold min-w-0 flex-1" style={{ color: "var(--color-text-primary)" }}>
                      {s.학교명}
                    </span>
                    {s.직선거리 && (
                      <span className="ts-2xs shrink-0" style={{ color: "var(--color-accent)", fontVariantNumeric: "tabular-nums" }}>
                        {s.직선거리}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {exceptions && exceptions.length > 0 && (
              <CollapsibleSection title={`예외학교 (${exceptions.length}개)`}>
                <div className="space-y-0.5">
                  {exceptions.map((s, i) => (
                    <div key={i} className="flex gap-2 ts-2xs" style={{ color: "var(--color-text-secondary)" }}>
                      <span>{s.학교명}</span>
                      {s.직선거리 && <span style={{ color: "var(--color-text-muted)" }}>{s.직선거리}</span>}
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}
          </SectionCard>
        );
      })}

      {!schools.length && !Object.keys(zone).length && (
        <div className="p-4 text-center ts-sm" style={{ color: "var(--color-text-muted)" }}>검색 결과 없음</div>
      )}
    </div>
  );
}

// ─── Generic Fallback ───

function GenericResult({ data }: { data: Record<string, unknown> }) {
  const entries = flattenForDisplay(data);
  if (entries.length === 0) {
    return (
      <div className="p-4 rounded-lg ts-sm text-center"
        style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-muted)" }}>
        결과 데이터가 비어있습니다
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {entries.map(({ label, value }, i) => (
        <KVRow key={`${label}-${i}`} label={label} value={value} />
      ))}
    </div>
  );
}
