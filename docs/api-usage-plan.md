# SunSeat public API usage plan

## Probe result

The live probe ran on `20260922` with actual network responses and used the
decoded form of the supplied service key. All 11 requested calls returned HTTP
200. The probe saved request metadata, raw response bodies, and analysis in
`probe-output/REPORT.md` and `probe-output/01..11-*.json` without storing the
service key.

Confirmed TAGO records:

- city codes: `서울특별시=11`, `부산광역시=21`
- station codes: the TAGO station sync currently stores 349 official stations;
  route anchors include `서울=NAT010000`, `광명=NATH10219`, `오송=NAT050044`,
  `대전=NAT011668`, `동대구=NAT013271`, `부산=NAT014445`
- Seoul → Busan timetable: 75 records for `20260922`
- timetable fields: `trainno`, `traingradename`, `depplandtime`,
  `arrplandtime`, `adultcharge`

Runtime mapping now exposes these as `trainNumber`, `trainGradeName`,
`departureAt`, `arrivalAt`, `adultFare`, and a calculated `durationMinutes`.
The `GetVhcleKndList` response is stored as the server-side train-grade master;
the browser does not maintain a separate hard-coded vehicle list.

Confirmed KORAIL response shape:

- actual-operation endpoint returned records with `trn_no`, `run_ymd`,
  `stn_nm`, `trn_arvl_dt`, and `trn_dptre_dt`
- plan and code-filter calls returned HTTP 200 with `totalCount: 0` for this
  probe, so they are retained as verification evidence and are not used as the
  primary timetable source

## Application boundary

| API | Endpoint | Intended use | Current state |
| --- | --- | --- | --- |
| TAGO | `GetCtyCodeList` | Discover city codes for station search bootstrap | Confirmed live response |
| TAGO | `GetVhcleKndList` | Map vehicle codes to KTX/KTX-Sancheon/etc. | Confirmed live response |
| TAGO | `GetCtyAcctoTrainSttnList` | Resolve official station IDs | Confirmed; 349 stations synchronized |
| TAGO | `GetStrtpntAlocFndTrainInfo` | Primary date/origin/destination timetable search | Connected to Node adapter |
| KORAIL | `/codes2` | Cross-check KORAIL station/train code vocabulary | Live endpoint; this filter returned no rows |
| KORAIL | `/travelerTrainRunPlan2` | Future operating plan and route verification | Live endpoint; this date returned no rows |
| KORAIL | `/travelerTrainRunInfo2` | Past actual operation evidence and delay/operation audit | Confirmed actual-operation DTO; verification source |

## Next successful-response workflow

1. Keep the raw probe artifacts for regression checks when the upstream data
   changes.
2. Confirm the raw `items.item` path, pagination fields, station-code fields,
   train number, train type, departure/arrival fields, and date formats.
3. Add only confirmed mappings to a TAGO adapter and a separate KORAIL adapter.
   The confirmed TAGO mappings are now in `ScheduleService` and route metadata.
4. Normalize both into the SunSeat train/station domain model.
5. Keep raw responses in a dated cache and expose `scheduleSource`,
   `verificationSource`, and precision metadata in the API response.
6. Use KORAIL actual-operation data to compare planned vs actual service where
   the response contains a stable train number and date; never infer seat
   availability from it.

KORAIL's public seat-plan HTML is used separately for verified structural seat
layouts. It supplies actual seat identifiers, carriage layouts, and source seat
rows, but no live remaining-seat state is requested or inferred. When a type
has multiple verified formations, the seat endpoint returns all of them in
`variantLayouts` so the UI can show the actual alternatives. The TAGO types
`03 통근열차` and `06 AREX직통` remain explicitly unresolved because their
official seat identifiers were not available from the verified KORAIL source;
the implementation does not fabricate those seats.

## Search and solar-analysis flow

The public train search cache is keyed only by date, origin, and destination.
Time-range and vehicle-grade filters are applied to that cached result in Node,
so changing a filter does not call TAGO again. Empty results remain successful
domain responses with a distinct state and, for time ranges, previous/next
nearby trains. The browser renders the train list first, then sends up to 20
visible trains to `POST /api/exposure/batch` for non-blocking sunlight previews;
selecting any train still supports an individual calculation.

## Security

API keys are Node/worker secrets only. They must not be placed in Vite variables,
JSON artifacts, reports, or URLs committed to source control. The probe redacts
`serviceKey` from saved request URLs. The key supplied for this run should be
rotated or reissued because it was shared in chat.
