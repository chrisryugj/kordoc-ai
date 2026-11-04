/** 서무 도구 "영수증으로 지출조서" 옵션: 어떤 서식으로 만드는지와 서식 바꾸는 곳 */

import { useApp } from "../../state/app";

export function ReceiptTaskOptions() {
  const { settings, openSettings, ai } = useApp();
  const name = settings?.receipt?.template_name;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="kd-small">
        지출조서 서식: <b>{name ? `기관 서식(${name})` : "기본 서식"}</b>
        <button type="button" className="kd-link kd-small kd-hit32 ml-2" onClick={() => openSettings("set-receipt")}
          data-tip="우리 기관 지출조서 한글 서식을 넣으면 그 표 칸에 맞춰 채웁니다">{name ? "서식 바꾸기" : "기관 서식 넣기"}</button>
      </p>
      <p className="kd-small kd-muted">
        글자는 이 PC에서 읽습니다. 날짜·거래처·사업자등록번호·금액을 뽑아 고칠 수 있는 표로 보이고, 표 복사와 HWPX 저장을 합니다.
        {ai?.configured ? (ai.is_cloud ? " 외부 AI로 적요를 받으려면 결과에서 누르세요." : " 적요 한 줄은 AI가 제안합니다.") : ""}
      </p>
    </div>
  );
}
