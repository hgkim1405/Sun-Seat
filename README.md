# SunSeat / 햇빛자리

실제 철도 선형과 태양 위치를 이용해 열차 여행 중 햇빛이 들어오는 창가 방향을 안내하는 기술 PoC + 서비스 MVP 골격입니다.

현재 제공되는 것:

- OpenStreetMap Overpass에서 수집한 서울–부산 실제 철도 route, tunnel mask, 역 anchor
- NOAA 태양 위치 계산과 LEFT/RIGHT/TUNNEL/WEAK/NIGHT 구간 분석
- Python 내부 FastAPI 계산 서버 (`127.0.0.1:8100`)
- Node API (`127.0.0.1:3000`)의 역 검색, 일정 캐시 계약, 계산 캐시, route display, 차량/좌석 데이터 계약
- Vue 3/Vite 모바일 우선 검색·열차상세·PoC 확인 화면
- TAGO 일정 연동 경계. API 키·URL·공식 역 코드가 없으면 가짜 열차를 만들지 않고 설정 오류를 반환
- KORAIL 공식 좌석배치 HTML에서 검증한 차량별 좌석번호·좌석 구조를 실제 좌석 줄 형태로 표시함
- 무궁화호·KTX-이음·ITX-마음처럼 공식 편성 변형이 여러 개인 열차는 검증된 변형 배치를 선택할 수 있음
- 실시간 잔여좌석 여부는 사용하지 않으며, 공식 좌석 원본이 없는 TAGO 유형은 좌석번호를 임의 생성하지 않음
- TAGO 도시·역 목록 동기화로 전국 349개 역을 검색할 수 있음
- KORAIL 공식 시간표를 XLSX로 동기화하고 KTX·일반열차·ITX-청춘 운행편을 파싱함

## 구조

```text
frontend/              Vue 3 + Vite browser UI
server/                Node 22 API; TAGO key stays here
python/api/            private FastAPI calculation service
python/sunseat/        GIS·철도·태양·노출 계산 모듈
python/scripts/        OSM 수집/전처리/PoC 데이터 파이프라인
data/metadata/         station/source metadata
data/cache/            schedule/exposure filesystem cache (ignored)
shared/schemas/        Node API Zod schemas
nginx/                 production reverse-proxy example
```

## 로컬에서 front + server + python 확인

PowerShell 터미널을 3개 열고 `C:\sunSpot`에서 실행합니다. Python 계산 서버는 외부에 공개하지 않습니다.

터미널 1 — Python 계산 서버:

```powershell
cd C:\sunSpot\python
\.venv\Scripts\Activate.ps1
$env:PYTHONPATH = "."
python -m uvicorn api.main:app --host 127.0.0.1 --port 8100
```

터미널 2 — Node API:

```powershell
cd C:\sunSpot\server
$env:SUNSEAT_CALC_URL = "http://127.0.0.1:8100"
npm start
```

터미널 3 — Vue/Vite:

```powershell
cd C:\sunSpot\frontend
npm run dev -- --host 127.0.0.1
```

브라우저: [http://127.0.0.1:5173](http://127.0.0.1:5173)

상태 확인:

```powershell
Invoke-RestMethod http://127.0.0.1:8100/health
Invoke-RestMethod http://127.0.0.1:3000/api/health
Invoke-WebRequest http://127.0.0.1:5173/ -UseBasicParsing
```

`PoC 확인` 탭은 일정 API 키 없이도 현재 생성된 실제 OSM 기반 PoC 결과를 보여줍니다. `열차 검색`은 TAGO 캐시가 있거나 아래 환경변수를 설정한 경우에만 실제 일정이 표시됩니다. 역 목록은 `data/metadata/tago-stations.json`의 TAGO 공식 목록을 사용합니다.

## TAGO 일정 연동 설정

Node/PM2 환경에만 설정합니다. 브라우저용 `VITE_*` 변수에 넣지 않습니다.

```powershell
$env:TAGO_SCHEDULE_URL = "https://apis.data.go.kr/1613000/TrainInfo/GetStrtpntAlocFndTrainInfo"
$env:TAGO_SERVICE_KEY = "발급받은_서비스키"
$env:SUNSEAT_STATION_CODES_JSON = '{"seoul":"NAT010000","gwangmyeong":"NATH10219","osong":"NAT050044","daejeon":"NAT011668","dongdaegu":"NAT013271","busan":"NAT014445"}'
```

CMD에서는 같은 값을 현재 창에 설정합니다. 서비스키는 포털의 복사 버튼으로
복사한 값을 사용하고, 브라우저 `VITE_*` 변수에는 넣지 않습니다.

```cmd
cd /d C:\sunSpot
set "TAGO_SCHEDULE_URL=https://apis.data.go.kr/1613000/TrainInfo/GetStrtpntAlocFndTrainInfo"
set "TAGO_SERVICE_KEY=발급받은_서비스키"
set "SUNSEAT_STATION_CODES_JSON={\"seoul\":\"NAT010000\",\"gwangmyeong\":\"NATH10219\",\"osong\":\"NAT050044\",\"daejeon\":\"NAT011668\",\"dongdaegu\":\"NAT013271\",\"busan\":\"NAT014445\"}"
```

현재 동기화된 TAGO 공식 역 코드는 전국 역 마스터에 저장되며, 서울 `NAT010000`, 광명 `NATH10219`, 오송 `NAT050044`, 대전 `NAT011668`, 동대구 `NAT013271`, 부산 `NAT014445`는 실제 OSM 서울–부산 PoC route anchor와 연결되어 있습니다. 역 코드가 있어도 route geometry가 없는 구간은 실제 열차 검색은 가능하지만 햇빛 계산은 제공하지 않습니다. 파일 캐시가 있으면 stale 상태도 `source: CACHE`, `stale: true`로 반환합니다. 캐시도 없고 설정도 없으면 `503 SCHEDULE_NOT_CONFIGURED`가 정상적인 응답입니다.

주요 서비스 API:

```text
GET  /api/health
GET  /api/stations?q=부산
GET  /api/trains?origin=서울&destination=부산&date=2026-09-22&departureTimeFrom=14:00&departureTimeTo=18:00&trainGradeCodes=00
POST /api/exposure
POST /api/exposure/batch
GET  /api/train-types
GET  /api/train-types/:type/seats
GET  /api/routes/:routeId/display
GET  /api/poc/summary
GET  /api/poc/timeline?resolution=raw|1m|5m
GET  /api/poc/route
```

`/api/trains`는 `origin + destination + date` 기준의 TAGO 결과를 캐시하고,
`departureTimeFrom`, `departureTimeTo`, `trainGradeCodes`는 캐시된 목록에
Node에서 적용합니다. 정상적인 0건도 오류로 바꾸지 않고 `searchState.type`으로
구분합니다: `SUCCESS`, `NO_TRAINS`, `NO_TRAINS_IN_TIME_RANGE`,
`NO_TRAINS_FOR_GRADE`. 시간대 결과가 0건이면 `nearbyTrains.previous/next`에
선택 범위 앞뒤의 실제 열차를 함께 반환합니다.

열차 DTO는 실제 TAGO 응답을 다음 도메인 필드로 변환합니다:
`trainno → trainNumber`, `traingradename → trainGradeName`,
`depplandtime/arrplandtime → departureAt/arrivalAt`,
`adultcharge → adultFare`. `durationMinutes`는 출발·도착 시각 차이로 계산하며,
정확한 중간 정차시각은 TAGO 일정 응답에 없을 때 만들어내지 않습니다.

`/api/train-types/:type/seats`는 KORAIL 공식 좌석배치에서 확인한 구조만 반환합니다.
응답의 `availability`는 `STRUCTURAL_ONLY`이며, 실시간 잔여좌석 필드는 제공하지 않습니다.
공식 편성 변형이 여러 개인 차량은 `variantLayouts`에 검증된 배치를 모두 반환하고,
프론트에서 변형을 선택할 수 있습니다. 현재 TAGO 차량 마스터 중 `03 통근열차`와
`06 AREX직통`은 KORAIL 좌석 원본 경로에서 좌석 식별자를 확인하지 못했으므로
API가 임의의 좌석을 만들지 않고 `NO_VERIFIED_OFFICIAL_SEAT_LAYOUT`으로 표시합니다.

공식 데이터 동기화:

```powershell
npm run sync:tago-stations
npm run sync:korail-seat-layouts
npm run validate:seat-layouts
npm run sync:korail-timetables
npm run parse:korail-timetables
```

좌석 원본은 `data/raw/korail-seat-layouts/`, 검증 결과는
`data/processed/seat-layouts.json`, 차량 Master는
`data/rolling-stock/rolling-stock.json`에 저장합니다. 시간표 원본과 파싱 결과는
`data/raw/timetables/`와 `data/processed/timetables/`에 저장합니다.

## PoC 데이터 재생성

```powershell
python python/scripts/download_osm.py --source overpass
python python/scripts/extract_railway.py
python python/scripts/build_route.py
python python/scripts/build_tunnels.py
python python/scripts/generate_samples.py
python python/scripts/calculate_sun_exposure.py
python python/scripts/validate_results.py
```

또는 `./scripts/poc.ps1`를 실행합니다. 외부 OSM 데이터에 접근할 수 없거나 route 검증에 실패하면 결과를 성공으로 남기지 않습니다.

## 테스트와 빌드

```powershell
cd C:\sunSpot
npm run test:python
npm run test:server
npm run build:front
```

검증된 현재 결과:

- Python: 9 passed
- Node server: 6 passed
- Vite production build: 성공
- live Python `/health`: `datasetLoaded: true`
- live Node `/api/health`: `status: ok`
- live Node → Python `/api/exposure`: 서울–부산 303 samples, recommended side `LEFT`

## PM2 / Nginx

```powershell
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs
```

PM2에 실시간 TAGO를 연결할 때는 키를 먼저 현재 CMD 창에 설정하고 `--update-env`를
사용합니다. 키는 설정 파일에 저장하지 않습니다.

```cmd
cd /d C:\sunSpot
set "TAGO_SERVICE_KEY=발급받은_서비스키"
pm2 startOrRestart ecosystem.config.cjs --only sunseat-calc,sunseat-api --update-env
```

`pm2 save`는 환경변수에 서비스키를 저장할 수 있으므로 이 개발 환경에서는
실행하지 않습니다. 새 CMD/PM2 세션에서는 키를 다시 설정한 뒤 위 명령을
실행합니다.

PM2에는 `sunseat-calc` (`127.0.0.1:8100`)와 `sunseat-api` (`127.0.0.1:3000`)만 정의되어 있습니다. 프론트는 `frontend/dist`를 빌드한 뒤 Nginx가 직접 제공합니다. `nginx/sun-seat.conf`는 `/`를 정적 프론트로, `/api/`만 Node로 전달합니다. Python 포트는 Nginx에 공개하지 않습니다.

## 해석 범위

분석은 맑은 하늘 태양 기하만 사용하며 날씨·건물 그림자·창가 세부 구조는 모델링하지 않습니다. 위치는 제공된 정차시각 사이의 route-distance 보간 추정값입니다. 좌석은 실제 잔여 여부가 아니라 공식 구조와 번호를 사용해 창가/통로 및 좌우 방향을 표시합니다. 현재 OSM route geometry는 서울–부산 PoC 구간이며, 다른 TAGO 역 조합은 일정 검색과 역 선택까지 지원하되 geometry가 없으면 햇빛 계산을 거부합니다. `data/results/poc/report.md`와 `data/results/poc/summary.json`에 전체 PoC 근거가 있습니다.

철도 선형 출처: © OpenStreetMap contributors.
