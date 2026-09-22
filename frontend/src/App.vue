<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { getRoute, getSummary, getTimeline } from './api/poc';
import { calculateExposure, calculateExposureBatch, getSeatLayout, getStations, getTrainTypes, getTrains } from './api/mvp';
import RouteMap from './components/RouteMap.vue';

const TIME_PRESETS = [
  { id: 'ALL', label: '전체', from: '', to: '' },
  { id: 'DAWN', label: '새벽', from: '00:00', to: '06:00' },
  { id: 'MORNING', label: '오전', from: '06:00', to: '12:00' },
  { id: 'AFTERNOON', label: '오후', from: '12:00', to: '18:00' },
  { id: 'EVENING', label: '저녁', from: '18:00', to: '23:59' },
];

const view = ref('search');
const stations = ref([]);
const trainTypes = ref([]);
const form = ref({ origin: '서울', destination: '부산', date: '2026-09-22', departureTimeFrom: '', departureTimeTo: '', trainGradeCodes: [] });
const vehicleFilter = ref(['ALL']);
const selectedPreset = ref('ALL');
const trains = ref([]);
const searchResult = ref(null);
const selectedTrain = ref(null);
const exposure = ref(null);
const seatLayout = ref(null);
const seatLayoutVariants = ref([]);
const selectedCarNumber = ref(null);
const selectedSeat = ref(null);
const seatLayoutLoading = ref(false);
const seatLayoutError = ref('');
const seatCatalog = ref([]);
const seatCatalogLoading = ref(false);
const seatCatalogError = ref('');
const seatDialog = ref(false);
const selectedCatalogItem = ref(null);
const previewByTrainId = ref({});
const loading = ref(false);
const previewLoading = ref(false);
const stationLoading = ref(false);
const error = ref('');
const previewError = ref('');
const scheduleState = ref('');
const hasSearched = ref(false);

const pocSummary = ref(null);
const timeline = ref([]);
const route = ref(null);
const resolution = ref('1m');
const selectedIndex = ref(0);
const pocLoading = ref(false);
const pocError = ref('');
const current = computed(() => timeline.value[selectedIndex.value] || null);
const timelineStart = computed(() => timeline.value[0]?.time?.slice(11, 16) || '--:--');
const timelineEnd = computed(() => timeline.value.at(-1)?.time?.slice(11, 16) || '--:--');
const searchState = computed(() => searchResult.value?.searchState?.type ?? null);
const searchSummary = computed(() => searchResult.value?.summary ?? null);
const nearbyTrains = computed(() => {
  const result = searchResult.value?.nearbyTrains ?? {};
  return [result.previous, result.next].filter(Boolean);
});
const routeTrainTypeCounts = computed(() => new Map((searchResult.value?.availableTrainTypes ?? []).map((type) => [type.id, type.count])));
const filterTrainTypes = computed(() => {
  if (!trainTypes.value.length) return searchResult.value?.availableTrainTypes ?? [];
  return trainTypes.value.map((type) => ({
    ...type,
    count: searchResult.value ? routeTrainTypeCounts.value.get(type.id) ?? 0 : null,
  }));
});
const resultFilterTrainTypes = computed(() => filterTrainTypes.value.filter((type) => type.count === null || type.count > 0));
const visibleTrains = computed(() => {
  if (vehicleFilter.value.includes('ALL')) return trains.value;
  return trains.value.filter((train) => vehicleFilter.value.includes(train.trainGradeCode));
});
const stationItems = computed(() => stations.value.filter((station) => station.tagoCode).map((station) => ({ title: station.name, value: station.name })));
const catalogItems = computed(() => seatCatalog.value.length ? seatCatalog.value : trainTypes.value.map((type) => ({ ...type, available: type.seatMapAvailable, layouts: [] })));
const selectedCatalogLayouts = computed(() => selectedCatalogItem.value?.layouts ?? []);
const loadingMessage = computed(() => {
  if (loading.value) return '열차를 찾고 있습니다…';
  if (previewLoading.value) return '열차 목록을 표시했습니다. 햇빛 정보를 계산하고 있습니다…';
  return '';
});
const selectedCar = computed(() => seatLayout.value?.cars?.find((car) => car.carNumber === selectedCarNumber.value) ?? seatLayout.value?.cars?.[0] ?? null);
const selectedCarRows = computed(() => {
  const seats = selectedCar.value?.seats ?? [];
  const rows = new Map();
  seats.forEach((seat) => {
    const row = Number.isFinite(seat.row) ? seat.row : Number.isFinite(seat.layoutRow) ? seat.layoutRow : null;
    if (row === null) return;
    if (!rows.has(row)) rows.set(row, { row, left: [], right: [] });
    const group = rows.get(row);
    (seat.physicalSide === 'SIDE_B' ? group.right : group.left).push(seat);
  });
  return [...rows.values()].sort((left, right) => left.row - right.row);
});
const hasVisualSeatRows = computed(() => selectedCarRows.value.length > 0);
const selectedSeatExposure = computed(() => {
  if (!selectedSeat.value || !exposure.value) return null;
  const origin = stations.value.find((station) => station.name === selectedTrain.value?.origin);
  const destination = stations.value.find((station) => station.name === selectedTrain.value?.destination);
  const reverse = Number(destination?.routeDistanceM) < Number(origin?.routeDistanceM);
  const travelSide = reverse
    ? selectedSeat.value.physicalSide === 'SIDE_A' ? 'RIGHT' : 'LEFT'
    : selectedSeat.value.physicalSide === 'SIDE_A' ? 'LEFT' : 'RIGHT';
  const summary = exposure.value.summary;
  return {
    ...selectedSeat.value,
    travelSide,
    directSunMinutes: travelSide === 'LEFT' ? summary.leftExposureMinutes : summary.rightExposureMinutes,
    weightedExposure: travelSide === 'LEFT' ? summary.leftWeightedExposure : summary.rightWeightedExposure,
    tunnelMinutes: summary.tunnelMinutes,
  };
});

function messageOf(caught) {
  return caught instanceof Error ? caught.message : String(caught);
}

function timeText(value) {
  return String(value ?? '').slice(11, 16) || '--:--';
}

function formatDateLabel(value) {
  if (!value) return '';
  return new Date(`${value}T00:00:00+09:00`).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) return '소요시간 확인 불가';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}시간 ${rest}분` : `${rest}분`;
}

function formatFare(value) {
  return Number.isFinite(value) ? `${value.toLocaleString('ko-KR')}원` : '요금 미제공';
}

function setTimePreset(preset) {
  selectedPreset.value = preset.id;
  form.value.departureTimeFrom = preset.from;
  form.value.departureTimeTo = preset.to;
}

function markCustomTime() {
  selectedPreset.value = 'CUSTOM';
}

function clearGradeFilter() {
  vehicleFilter.value = ['ALL'];
}

function updateVehicleFilter(nextValue) {
  const values = Array.isArray(nextValue) ? nextValue : [];
  if (values.includes('ALL') && !vehicleFilter.value.includes('ALL')) {
    vehicleFilter.value = ['ALL'];
    return;
  }
  const selected = values.filter((value) => value !== 'ALL');
  if (!selected.length) {
    vehicleFilter.value = ['ALL'];
    return;
  }
  vehicleFilter.value = selected;
}

function invalidateResults() {
  if (!hasSearched.value) return;
  trains.value = [];
  searchResult.value = null;
  selectedTrain.value = null;
  exposure.value = null;
  seatLayout.value = null;
  seatLayoutVariants.value = [];
  selectedCarNumber.value = null;
  selectedSeat.value = null;
  seatLayoutError.value = '';
  previewByTrainId.value = {};
  previewError.value = '';
  scheduleState.value = '';
  if (view.value === 'trains' || view.value === 'detail') view.value = 'search';
}

function exposureRequest(train) {
  return {
    origin: train.origin,
    destination: train.destination,
    departure: train.departureAt,
    arrival: train.arrivalAt,
    stationTimeline: train.stationTimeline,
    routeId: train.routeId,
    trainNumber: train.trainNumber,
    trainType: train.trainType,
    scheduleSource: scheduleState.value || 'TAGO',
  };
}

function previewFor(train) {
  return previewByTrainId.value[train.id] ?? null;
}

async function loadSeatLayout(train) {
  seatLayout.value = null;
  seatLayoutVariants.value = [];
  selectedCarNumber.value = null;
  selectedSeat.value = null;
  seatLayoutError.value = '';
  const typeCode = train.trainGradeCode;
  if (!typeCode) return;
  seatLayoutLoading.value = true;
  try {
    const result = await getSeatLayout(typeCode);
    if (result.available) {
      seatLayout.value = result.layout;
      seatLayoutVariants.value = result.variantLayouts?.length ? result.variantLayouts : result.layout ? [result.layout] : [];
      selectedCarNumber.value = result.layout.cars?.[0]?.carNumber ?? null;
    } else if (result.layoutVariants?.length) {
      seatLayoutError.value = '공식 좌석도 변형은 확인했지만 현재 편성 정보를 자동으로 연결하지 못했습니다.';
    }
  } catch (caught) {
    seatLayoutError.value = messageOf(caught);
  } finally { seatLayoutLoading.value = false; }
}

function selectSeatLayout(layout) {
  seatLayout.value = layout;
  selectedCarNumber.value = layout.cars?.[0]?.carNumber ?? null;
  selectedSeat.value = null;
}

function seatRowsFor(car) {
  const rows = new Map();
  for (const seat of car?.seats ?? []) {
    const row = Number.isFinite(seat.row) ? seat.row : Number.isFinite(seat.layoutRow) ? seat.layoutRow : null;
    if (row === null) continue;
    if (!rows.has(row)) rows.set(row, { row, left: [], right: [] });
    const group = rows.get(row);
    (seat.physicalSide === 'SIDE_B' ? group.right : group.left).push(seat);
  }
  return [...rows.values()].sort((left, right) => left.row - right.row);
}

async function loadSeatCatalog() {
  if (seatCatalogLoading.value || seatCatalog.value.length || !trainTypes.value.length) return;
  seatCatalogLoading.value = true;
  seatCatalogError.value = '';
  try {
    seatCatalog.value = await Promise.all(trainTypes.value.map(async (type) => {
      try {
        const result = await getSeatLayout(type.id);
        return {
          ...type,
          available: result.available,
          layouts: result.variantLayouts?.length ? result.variantLayouts : result.layout ? [result.layout] : [],
          reason: result.reason ?? null,
        };
      } catch (caught) {
        return { ...type, available: false, layouts: [], reason: messageOf(caught) };
      }
    }));
  } catch (caught) {
    seatCatalogError.value = messageOf(caught);
  } finally {
    seatCatalogLoading.value = false;
  }
}

async function openAbout() {
  view.value = 'about';
  if (!trainTypes.value.length) {
    try {
      trainTypes.value = (await getTrainTypes()).trainTypes;
    } catch (caught) {
      seatCatalogError.value = messageOf(caught);
      return;
    }
  }
  void loadSeatCatalog();
}

async function openSeatCatalog(item) {
  selectedCatalogItem.value = { ...item, layouts: item.layouts ?? [] };
  seatDialog.value = true;
  if (!seatCatalog.value.length) {
    await loadSeatCatalog();
  }
  selectedCatalogItem.value = seatCatalog.value.find((candidate) => candidate.id === item.id) ?? selectedCatalogItem.value;
}

async function loadStations() {
  stationLoading.value = true;
  try { stations.value = (await getStations()).stations; } catch (caught) { error.value = messageOf(caught); }
  finally { stationLoading.value = false; }
}

async function loadExposurePreviews(nextTrains) {
  const candidates = nextTrains.filter((train) => train.routeId).slice(0, 20);
  if (!candidates.length) return;
  previewLoading.value = true;
  previewError.value = '';
  try {
    const result = await calculateExposureBatch(candidates.map(exposureRequest));
    const next = { ...previewByTrainId.value };
    candidates.forEach((train, index) => {
      if (result.results?.[index]) next[train.id] = result.results[index];
    });
    previewByTrainId.value = next;
  } catch (caught) {
    previewError.value = messageOf(caught);
  } finally { previewLoading.value = false; }
}

async function searchTrains() {
  loading.value = true;
  error.value = '';
  previewError.value = '';
  hasSearched.value = true;
  vehicleFilter.value = ['ALL'];
  selectedTrain.value = null;
  exposure.value = null;
  seatLayout.value = null;
  selectedSeat.value = null;
  previewByTrainId.value = {};
  try {
    const result = await getTrains({ ...form.value, trainGradeCodes: [...form.value.trainGradeCodes] });
    searchResult.value = result;
    trains.value = result.trains ?? [];
    scheduleState.value = `${result.source}${result.stale ? ' · stale cache' : ''}`;
    view.value = 'trains';
    void loadExposurePreviews(trains.value);
  } catch (caught) {
    trains.value = [];
    searchResult.value = null;
    error.value = messageOf(caught);
  } finally { loading.value = false; }
}

async function calculateSelected(train) {
  selectedTrain.value = train;
  exposure.value = previewFor(train);
  error.value = '';
  if (exposure.value) {
    await loadSeatLayout(train);
    view.value = 'detail';
    return;
  }
  loading.value = true;
  try {
    exposure.value = await calculateExposure(exposureRequest(train));
    await loadSeatLayout(train);
    view.value = 'detail';
  } catch (caught) { error.value = messageOf(caught); }
  finally { loading.value = false; }
}

async function loadPoc() {
  pocLoading.value = true;
  pocError.value = '';
  try {
    const [nextSummary, nextTimeline, nextRoute] = await Promise.all([getSummary(), getTimeline(resolution.value), getRoute()]);
    pocSummary.value = nextSummary;
    timeline.value = nextTimeline;
    route.value = nextRoute;
    selectedIndex.value = Math.min(selectedIndex.value, Math.max(0, timeline.value.length - 1));
    view.value = 'poc';
  } catch (caught) { pocError.value = messageOf(caught); }
  finally { pocLoading.value = false; }
}

async function changePocResolution() {
  try { timeline.value = await getTimeline(resolution.value); } catch (caught) { pocError.value = messageOf(caught); }
}

function exposureClass(item, side) {
  const value = side === 'LEFT' ? item.leftExposure : item.rightExposure;
  return { active: value > 0.15, weak: item.rawSide === 'WEAK', tunnel: item.rawSide === 'TUNNEL' };
}

watch(form, invalidateResults, { deep: true });

onMounted(async () => {
  await Promise.all([
    loadStations(),
    getTrainTypes().then((value) => { trainTypes.value = value.trainTypes; }).catch((caught) => { error.value = messageOf(caught); }),
  ]);
});
</script>

<template>
  <v-app>
    <v-app-bar class="sunseat-appbar" flat border>
      <v-container class="appbar-inner" max-width="1180">
        <v-btn class="brand" variant="text" @click="view = 'search'"><span class="brand-mark">☼</span><span><b>SunSeat</b><small>햇빛자리</small></span></v-btn>
        <v-spacer />
        <v-btn :variant="['search', 'trains', 'detail'].includes(view) ? 'tonal' : 'text'" color="primary" @click="view = 'search'">열차 검색</v-btn>
        <v-btn :variant="view === 'poc' ? 'tonal' : 'text'" color="primary" @click="loadPoc">PoC 확인</v-btn>
        <v-btn :variant="view === 'about' ? 'tonal' : 'text'" color="primary" @click="openAbout">데이터 출처</v-btn>
      </v-container>
    </v-app-bar>

    <v-main>
      <v-container class="page" max-width="1180">
    <section v-if="view === 'search'" class="hero search-hero"><div class="hero-copy"><p class="eyebrow">SUNLIGHT-AWARE RAIL TRAVEL</p><h1>여행 전에,<br /><em>햇빛이 머무는 자리</em><br />를 확인하세요.</h1><p class="subtitle">실제 운행 열차와 철도 선형을 바탕으로 출발 시간과 햇빛 방향을 함께 비교합니다.</p></div><div class="sun-orbit"><span>sun</span></div></section>

    <v-card class="search-panel search-card" :class="{ compact: view !== 'search' }" elevation="1">
      <v-card-text>
        <v-row align="center">
          <v-col cols="12" md="3"><v-select v-model="form.origin" :items="stationItems" label="출발역" :loading="stationLoading" hide-details="auto" /></v-col>
          <v-col cols="12" md="3"><v-select v-model="form.destination" :items="stationItems" label="도착역" :loading="stationLoading" hide-details="auto" /></v-col>
          <v-col cols="12" md="3"><v-text-field v-model="form.date" type="date" label="여행 날짜" hide-details="auto" /></v-col>
          <v-col cols="12" md="3"><v-btn block size="large" color="primary" :loading="loading" :disabled="stationLoading" @click="searchTrains">열차 찾기</v-btn></v-col>
        </v-row>
        <v-divider class="my-2" />
        <v-row class="search-options-row">
          <v-col cols="12"><div class="filter-label">출발 시간대</div><v-chip-group v-model="selectedPreset" selected-class="text-primary" class="preset-row" @update:model-value="(id) => { const preset = TIME_PRESETS.find((item) => item.id === id); if (preset) setTimePreset(preset); }"><v-chip v-for="preset in TIME_PRESETS" :key="preset.id" :value="preset.id" filter variant="outlined">{{ preset.label }}</v-chip></v-chip-group><div class="time-range"><v-text-field v-model="form.departureTimeFrom" type="time" density="compact" hide-details aria-label="출발 시간 시작" @update:model-value="markCustomTime" /><span>~</span><v-text-field v-model="form.departureTimeTo" type="time" density="compact" hide-details aria-label="출발 시간 종료" @update:model-value="markCustomTime" /></div></v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <section v-if="loadingMessage" class="notice loading-notice"><strong>{{ loadingMessage }}</strong><small v-if="previewLoading">열차 검색 결과를 먼저 표시하고, 최대 20개 열차의 햇빛 요약을 묶어서 계산합니다.</small></section>
    <section v-if="error" class="notice error"><strong>요청을 완료하지 못했습니다.</strong><br />{{ error }}<small>실시간 일정은 Node 환경에 TAGO_SCHEDULE_URL·TAGO_SERVICE_KEY가 필요합니다. 정상적인 0건 결과는 오류가 아닙니다.</small></section>

    <section v-if="view === 'trains'" class="section">
      <div class="section-heading"><div><p class="eyebrow">TRAIN LIST</p><h2>{{ form.origin }} → {{ form.destination }}</h2><p class="muted">{{ formatDateLabel(form.date) }} · {{ searchSummary?.conditions?.departureTimeFrom || searchSummary?.conditions?.departureTimeTo ? `${searchSummary?.conditions?.departureTimeFrom || '00:00'} ~ ${searchSummary?.conditions?.departureTimeTo || '23:59'}` : '전체 시간' }}</p></div><span class="source-badge">{{ scheduleState }}</span></div>
      <div v-if="searchSummary" class="condition-summary"><span><strong>{{ visibleTrains.length }}개</strong> 표시</span><span v-if="vehicleFilter[0] !== 'ALL'">전체 {{ searchSummary.totalMatches }}개 중 차량 필터 적용</span><span v-else>전체 {{ searchSummary.totalMatches }}개 검색</span><span v-if="searchSummary.firstDeparture">오늘 운행 {{ timeText(searchSummary.firstDeparture) }} ~ {{ timeText(searchSummary.lastDeparture) }}</span><span v-if="searchSummary.departedHidden">출발 완료 {{ searchSummary.departedHidden }}개 제외</span></div>
      <div v-if="searchState === 'SUCCESS'" class="result-filter-bar"><div class="result-filter-copy"><p class="eyebrow">FILTER RESULTS</p><strong>차량 종류</strong><span>검색 후 원하는 차량만 골라보세요.</span></div><v-btn-toggle :model-value="vehicleFilter" multiple divided color="primary" class="grade-toggle result-grade-toggle" @update:model-value="updateVehicleFilter"><v-btn value="ALL" size="small">전체 차량</v-btn><v-btn v-for="type in resultFilterTrainTypes" :key="type.id" :value="type.id" size="small">{{ type.name }}<small v-if="type.count !== null" class="grade-count">{{ type.count }}편</small></v-btn></v-btn-toggle></div>
      <div v-if="searchState === 'SUCCESS' && visibleTrains.length" class="train-list"><button v-for="train in visibleTrains" :key="train.id" class="train-card" @click="calculateSelected(train)"><div><span class="train-name">{{ train.trainGradeName }} <small>{{ train.trainNumber }}</small></span><strong class="train-times">{{ timeText(train.departureAt) }} <i>→</i> {{ timeText(train.arrivalAt) }}</strong><div class="train-meta"><span>{{ train.origin }} → {{ train.destination }}</span><span>{{ formatDuration(train.durationMinutes) }}</span><span>{{ formatFare(train.adultFare) }}</span></div></div><div v-if="previewFor(train)" class="sun-preview"><small>햇빛 미리보기</small><strong>{{ previewFor(train).recommendedSide }}</strong><span>분석 결과 보기 →</span></div><div v-else class="sun-preview pending"><small>{{ previewLoading ? '햇빛 계산 중' : '햇빛 분석' }}</small><span>열차 선택하기 →</span></div></button></div>
      <div v-else-if="searchState === 'SUCCESS' && vehicleFilter[0] !== 'ALL'" class="empty-state panel"><h3>선택한 차량종류의 열차가 없습니다.</h3><p>검색 결과에서 다른 차량을 선택하거나 전체 차량으로 돌아가세요.</p><button class="secondary-button" @click="clearGradeFilter">전체 차량 보기</button></div>
      <div v-else-if="searchState === 'NO_TRAINS_IN_TIME_RANGE'" class="empty-state panel"><h3>선택한 시간대에는 열차가 없습니다.</h3><p>{{ searchSummary?.conditions?.departureTimeFrom || '00:00' }} ~ {{ searchSummary?.conditions?.departureTimeTo || '23:59' }} 사이의 운행편을 찾지 못했습니다.</p><div v-if="nearbyTrains.length" class="nearby-list"><strong>가장 가까운 열차</strong><button v-for="train in nearbyTrains" :key="train.id" class="nearby-train" @click="calculateSelected(train)"><span>{{ timeText(train.departureAt) }} {{ train.trainGradeName }} {{ train.trainNumber }}</span><small>{{ formatDuration(train.durationMinutes) }}</small></button></div><p v-else class="muted">앞뒤 시간대에 확인 가능한 열차도 없습니다.</p></div>
      <div v-else-if="searchState === 'NO_TRAINS_FOR_GRADE'" class="empty-state panel"><h3>선택한 차량종류의 열차가 없습니다.</h3><p>이 날짜와 구간에는 선택한 차량종류가 운행하지 않습니다.</p><button class="secondary-button" @click="clearGradeFilter">전체 차량 보기</button></div>
      <div v-else class="empty-state panel"><h3>{{ searchState === 'NO_TRAINS' && searchSummary?.conditions?.date === form.date ? '해당 날짜에 표시할 열차가 없습니다.' : '이 구간의 열차가 없습니다.' }}</h3><p v-if="searchResult?.searchState?.reason === 'ALL_DEPARTED'">오늘 출발이 끝난 열차는 기본 검색에서 제외했습니다.</p><p v-else>다른 날짜 또는 출발·도착역을 선택해 다시 검색해 주세요.</p></div>
      <p v-if="previewError" class="muted preview-note">햇빛 미리보기는 아직 준비되지 않았습니다. 열차를 선택하면 개별 계산을 시도합니다.</p>
    </section>

    <section v-if="view === 'detail' && exposure" class="section">
      <button class="back-button" @click="view = 'trains'">← 목록으로</button>
      <div class="section-heading"><div><p class="eyebrow">TRAIN DETAIL</p><h2>{{ selectedTrain?.trainGradeName }} {{ selectedTrain?.trainNumber }}</h2><p class="muted">{{ timeText(selectedTrain?.departureAt) }} → {{ timeText(selectedTrain?.arrivalAt) }} · {{ formatDuration(selectedTrain?.durationMinutes) }}</p></div><div class="recommendation"><small>추천 창가 방향</small><strong>{{ exposure.recommendedSide }}</strong></div></div>
      <div class="summary-grid"><article class="metric featured"><span>추천 방향</span><strong>{{ exposure.recommendedSide }}</strong><small>맑은 날·터널 제외 노출 가중치</small></article><article class="metric"><span>좌측 노출</span><strong>{{ exposure.summary.leftExposureMinutes.toFixed(1) }}분</strong><small>가중치 {{ exposure.summary.leftWeightedExposure.toFixed(2) }}</small></article><article class="metric"><span>우측 노출</span><strong>{{ exposure.summary.rightExposureMinutes.toFixed(1) }}분</strong><small>가중치 {{ exposure.summary.rightWeightedExposure.toFixed(2) }}</small></article><article class="metric"><span>분석 정밀도</span><strong>{{ exposure.precision.position }}</strong><small>{{ exposure.precision.schedule }}</small></article></div>
      <div class="content-grid"><article class="panel"><p class="eyebrow">TIMELINE</p><div class="segment-list"><div v-for="segment in exposure.segments" :key="`${segment.start}-${segment.type}`" :class="['segment', segment.type.toLowerCase()]"><span>{{ segment.type }}</span><strong>{{ segment.durationMinutes.toFixed(1) }}분</strong><small>{{ segment.start.slice(11, 16) }}–{{ segment.end.slice(11, 16) }}</small></div></div></article>
        <article class="panel seat-panel"><p class="eyebrow">SEAT LAYOUT</p><h3 v-if="seatLayout">{{ seatLayout.rollingStockType }}</h3><h3 v-else-if="seatLayoutLoading">공식 좌석도를 불러오는 중입니다…</h3><h3 v-else>좌석도는 확인된 차량형식에만 제공합니다.</h3><p class="muted">실시간 잔여좌석은 사용하지 않습니다. 공식 좌석배치에서 확인된 좌석 구조와 햇빛 방향만 표시합니다.</p>
          <div v-if="seatLayout" class="seat-layout"><div v-if="seatLayoutVariants.length > 1" class="layout-variant-tabs"><span>공식 편성 변형</span><button v-for="variant in seatLayoutVariants" :key="variant.id" type="button" :class="{ selected: seatLayout.id === variant.id }" @click="selectSeatLayout(variant)">{{ variant.id }} · {{ variant.totalSeatCount }}석</button></div><div class="car-tabs"><button v-for="car in seatLayout.cars" :key="car.carNumber" type="button" :class="{ selected: selectedCarNumber === car.carNumber }" @click="selectedCarNumber = car.carNumber; selectedSeat = null">{{ car.carNumber }}호차</button></div><div v-if="selectedCar && hasVisualSeatRows" class="seat-map"><div class="seat-map-direction"><span>창측</span><span>통로</span><span>창측</span></div><div v-for="row in selectedCarRows" :key="row.row" class="seat-row"><div class="seat-side seat-side-left"><button v-for="seat in row.left" :key="seat.seatNumber" type="button" :class="['seat-button', seat.physicalSide.toLowerCase(), { selected: selectedSeat?.seatNumber === seat.seatNumber }]" @click="selectedSeat = seat"><strong>{{ seat.seatNumber }}</strong><small>{{ seat.position === 'WINDOW' ? '창가' : seat.position === 'AISLE' ? '통로' : '좌석' }}</small></button></div><span class="seat-aisle">{{ row.row }}</span><div class="seat-side seat-side-right"><button v-for="seat in row.right" :key="seat.seatNumber" type="button" :class="['seat-button', seat.physicalSide.toLowerCase(), { selected: selectedSeat?.seatNumber === seat.seatNumber }]" @click="selectedSeat = seat"><strong>{{ seat.seatNumber }}</strong><small>{{ seat.position === 'WINDOW' ? '창가' : seat.position === 'AISLE' ? '통로' : '좌석' }}</small></button></div></div></div><div v-else-if="selectedCar" class="seat-grid seat-grid-list"><button v-for="seat in selectedCar.seats" :key="seat.seatNumber" type="button" :class="['seat-button', seat.physicalSide.toLowerCase(), { selected: selectedSeat?.seatNumber === seat.seatNumber }]" @click="selectedSeat = seat"><strong>{{ seat.seatNumber }}</strong><small>{{ seat.position === 'WINDOW' ? '창가' : seat.position === 'AISLE' ? '통로' : '좌석' }}</small></button></div><div v-if="selectedSeatExposure" class="seat-result"><strong>{{ selectedCarNumber }}호차 {{ selectedSeatExposure.seatNumber }}</strong><span>{{ selectedSeatExposure.position === 'WINDOW' ? '창가' : '좌석' }} · {{ selectedSeatExposure.travelSide }} 측</span><b>예상 직사광 {{ selectedSeatExposure.directSunMinutes.toFixed(1) }}분</b><small>가중치 {{ selectedSeatExposure.weightedExposure.toFixed(2) }} · 터널 {{ selectedSeatExposure.tunnelMinutes.toFixed(1) }}분</small></div></div>
          <p v-else-if="seatLayoutError" class="muted">{{ seatLayoutError }}</p><div v-else class="cabin-placeholder"><span>SEAT LAYOUT</span><b>확인된 좌석도 없음 · 좌우 햇빛 추천만 제공</b></div>
        </article></div>
    </section>

    <section v-if="view === 'poc'" class="section"><div v-if="pocLoading" class="notice">PoC 결과를 불러오는 중입니다…</div><div v-else-if="pocError" class="notice error">{{ pocError }}</div><template v-else-if="pocSummary"><div class="section-heading"><div><p class="eyebrow">TECHNICAL POC</p><h2>서울 → 부산 햇빛 노출 검증</h2><p class="muted">실제 OSM route · 30초 샘플 · 위치는 시간표 보간 추정값</p></div><span class="status pass">{{ pocSummary.pocStatus }}</span></div><section class="summary-grid"><article class="metric featured"><span>추천 창가</span><strong>{{ pocSummary.recommendedSide }}</strong><small>weighted exposure 기준</small></article><article class="metric"><span>LEFT weighted</span><strong>{{ pocSummary.leftWeightedExposure.toFixed(2) }}</strong></article><article class="metric"><span>RIGHT weighted</span><strong>{{ pocSummary.rightWeightedExposure.toFixed(2) }}</strong></article><article class="metric"><span>터널</span><strong>{{ pocSummary.tunnelDistanceKm.toFixed(1) }} km</strong><small>{{ pocSummary.tunnelPercentage.toFixed(1) }}%</small></article></section><section class="panel timeline-panel"><div class="panel-header"><div><p class="eyebrow">EXPOSURE TIMELINE</p><h2>좌우 노출과 터널 구간</h2></div><select v-model="resolution" @change="changePocResolution"><option value="1m">1분 표시</option><option value="5m">5분 표시</option><option value="raw">30초 원본</option></select></div><div class="time-labels"><span>{{ timelineStart }}</span><span>{{ timelineEnd }}</span></div><div class="track"><span v-for="(item, index) in timeline" :key="`${item.time}-${index}`" class="tick" :class="exposureClass(item, 'LEFT')" @click="selectedIndex = index" /></div><div class="track right-track"><span v-for="(item, index) in timeline" :key="`r-${item.time}-${index}`" class="tick" :class="exposureClass(item, 'RIGHT')" @click="selectedIndex = index" /></div><div class="legend"><span><i class="legend-dot left" /> LEFT</span><span><i class="legend-dot right" /> RIGHT</span><span><i class="legend-dot tunnel" /> TUNNEL</span><span><i class="legend-dot weak" /> WEAK</span></div><input v-model.number="selectedIndex" type="range" min="0" :max="Math.max(0, timeline.length - 1)" class="slider" /></section><section class="content-grid"><RouteMap :route="route" :current="current" /><article class="panel current-card"><div class="section-title">선택 시점 데이터</div><div v-if="current" class="data-list"><div><span>시간</span><strong>{{ current.time.replace('T', ' ').slice(0, 19) }}</strong></div><div><span>좌표</span><strong>{{ current.lat.toFixed(5) }}, {{ current.lon.toFixed(5) }}</strong></div><div><span>태양 방위각 / 고도</span><strong>{{ current.sunAzimuth.toFixed(1) }}° / {{ current.sunAltitude.toFixed(1) }}°</strong></div><div><span>상태</span><strong :class="current.rawSide.toLowerCase()">{{ current.rawSide }}</strong></div></div></article></section></template></section>

    <section v-if="view === 'about'" class="section about-page"><v-row><v-col cols="12" md="7"><v-card class="source-card" elevation="1"><v-card-item><v-card-title>계산에 사용한 자료</v-card-title><v-card-subtitle>실제 API와 공식 구조 데이터를 기준으로 표시합니다.</v-card-subtitle></v-card-item><v-list lines="two" class="source-v-list"><v-list-item title="열차 일정" subtitle="TAGO REST API · 실제 응답 기반 Node 필터·캐시" /><v-list-item title="철도 선형" subtitle="OpenStreetMap Overpass · 서울–부산 PoC route" /><v-list-item title="태양 위치" subtitle="NOAA 방정식 · 맑은 날 창가 방향 계산" /><v-list-item title="좌석 지도" subtitle="KORAIL 공식 좌석배치 HTML · 좌석 줄·번호·객차 구조" /><v-list-item title="잔여좌석" subtitle="실시간 잔여좌석은 사용하지 않음" /></v-list><v-card-actions><v-chip color="secondary" variant="tonal">© OpenStreetMap contributors</v-chip></v-card-actions></v-card></v-col><v-col cols="12" md="5"><v-card class="source-card train-types-card" elevation="1"><v-card-item><v-card-title>TRAIN TYPES</v-card-title><v-card-subtitle>실제 API 차량종류 · 차량을 클릭하면 전체 좌석 배치가 열립니다.</v-card-subtitle></v-card-item><v-list lines="two" class="train-type-list"><v-list-item v-for="item in catalogItems" :key="item.id" :disabled="seatCatalogLoading" rounded="lg" @click="openSeatCatalog(item)"><template #prepend><v-avatar color="primary" variant="tonal" size="36">{{ item.id }}</v-avatar></template><v-list-item-title>{{ item.name }}</v-list-item-title><v-list-item-subtitle>{{ item.available ? '공식 좌석 배치 확인' : '공식 원본 확인 필요' }}</v-list-item-subtitle><template #append><v-chip size="small" :color="item.available ? 'secondary' : 'warning'" variant="tonal">{{ item.available ? '좌석 보기' : '미확인' }}</v-chip></template></v-list-item></v-list><v-card-actions><v-progress-linear v-if="seatCatalogLoading" color="primary" indeterminate /><span v-else class="muted">{{ catalogItems.length }}개 차량 종류</span></v-card-actions></v-card></v-col></v-row></section>
      </v-container>
    </v-main>

    <v-dialog v-model="seatDialog" max-width="1440" scrollable>
      <v-card class="seat-dialog-card">
        <v-card-title class="dialog-title"><div><span class="eyebrow">OFFICIAL SEAT PLAN</span><h2>공식 좌석 전체 비교</h2></div><v-btn variant="text" aria-label="닫기" @click="seatDialog = false">닫기</v-btn></v-card-title>
        <v-divider />
        <v-card-text>
          <v-progress-linear v-if="seatCatalogLoading" color="primary" indeterminate class="mb-4" />
          <div v-if="selectedCatalogItem" class="dialog-train-heading"><div><h3>{{ selectedCatalogItem.name }}</h3><p>{{ selectedCatalogItem.id }} · 공식 좌석 원본 기준</p></div><v-chip :color="selectedCatalogItem.available ? 'secondary' : 'warning'" variant="tonal">{{ selectedCatalogItem.available ? '구조 좌석 확인' : '원본 확인 필요' }}</v-chip></div>
          <v-alert v-if="!selectedCatalogItem?.available" type="warning" variant="tonal" class="mb-4">공식 좌석 식별자 원본이 없어 좌석을 임의로 생성하지 않았습니다.</v-alert>
          <div v-if="selectedCatalogItem?.available" class="seat-catalog-variants">
            <section v-for="layout in selectedCatalogLayouts" :key="layout.id" class="seat-catalog-variant">
              <div class="seat-catalog-variant-heading"><strong>{{ layout.id }}</strong><span>{{ layout.rollingStockType }} · {{ layout.totalSeatCount.toLocaleString('ko-KR') }}석</span></div>
              <div class="seat-catalog-cars">
                <v-card v-for="car in layout.cars" :key="`${layout.id}-${car.carNumber}`" class="seat-catalog-car" variant="outlined">
                  <v-card-title>{{ car.carNumber }}호차 <small>{{ car.seats.length }}석</small></v-card-title>
                  <v-card-text><div class="seat-plan-direction"><span>창측</span><span>통로</span><span>창측</span></div><div v-for="row in seatRowsFor(car)" :key="`${layout.id}-${car.carNumber}-${row.row}`" class="seat-plan-row"><div class="seat-plan-side"><span v-for="seat in row.left" :key="seat.seatNumber" :class="['seat-chip', seat.physicalSide.toLowerCase()]">{{ seat.seatNumber }}</span></div><span class="seat-plan-aisle">{{ row.row }}</span><div class="seat-plan-side"><span v-for="seat in row.right" :key="seat.seatNumber" :class="['seat-chip', seat.physicalSide.toLowerCase()]">{{ seat.seatNumber }}</span></div></div></v-card-text>
                </v-card>
              </div>
            </section>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-app>
</template>
