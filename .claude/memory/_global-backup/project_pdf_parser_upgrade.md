---
name: PDF 파서 업그레이드 Phase 1+2 완료
description: kordoc PDF 파서 ODL 기반 업그레이드 진행 상황 — Phase 2까지 완료, Phase 3 대기
type: project
---

kordoc PDF 파서를 ODL(OpenDataLoader) 알고리즘 기반으로 업그레이드 중.

**Why:** 한국 정부 공문서 PDF에서 셀 과분할, 9열 오감지, 텍스트 박스 오인식 심각. pdfplumber도 동일 문제 있어서 자체 개선이 유일한 방법.

**How to apply:** 
- Phase 1+2 완료: Vertex 기반 tolerance, 선 전처리, 균등배분 감지, 텍스트 박스 demote
- Phase 3 남음: 공백 누락 해결(조사 경계 휴리스틱 or disableCombineTextItems), 목차 감지기, ODL ClusterTableConsumer 포팅
- 테스트 PDF: 서울시메신저 20260408 중동 상황 대응 비상경제대책단 회의 PDF
- 변경 파일: `src/pdf/line-detector.ts`, `src/pdf/parser.ts`, `src/pdf/cluster-detector.ts`
