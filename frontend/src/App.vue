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
const dateMenu = ref(false);
const selectedSource = ref('schedule');
const selectedCatalogItem = ref(null);
const mobileMenuOpen = ref(false);
const vehicleMenuOpen = ref(false);
const analysisMode = ref('train');
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
const searchTrainTypeItems = computed(() => trainTypes.value.map((type) => ({ title: type.name, value: type.id })));
const sourceItems = [
  { id: 'schedule', title: '열차 일정', description: 'TAGO REST API · 실제 응답 기반 Node 필터·캐시', status: '사용 중', statusColor: 'secondary', source: '공공데이터포털 TAGO REST API', usage: '출발·도착역, 운행일, 열차번호와 실제 운행 시간을 검색 결과에 반영합니다.' },
  { id: 'route', title: '철도 선형', description: 'OpenStreetMap Overpass · 경로 geometry / tunnel 기반', status: 'PoC', statusColor: 'info', source: 'OpenStreetMap Overpass API', usage: '열차 이동 경로와 터널 구간을 연결해 구간별 햇빛 노출을 계산합니다.' },
  { id: 'sun', title: '태양 위치', description: 'NOAA 방식 · 맑은 날 창가 방향 계산', status: '사용 중', statusColor: 'secondary', source: 'NOAA Solar Position 방식', usage: '시간과 위치를 기준으로 태양 방위각·고도를 계산하고 좌우 창가를 비교합니다.' },
  { id: 'seat', title: '좌석 지도', description: 'KORAIL 공식 좌석배치 기반 · 좌석 줄·번호·객차 구조', status: '공식', statusColor: 'primary', source: 'KORAIL 공식 좌석배치 원본', usage: '차량 형식과 호차별 좌석 구조를 표시하고 선택 좌석 분석의 기준으로 사용합니다.' },
  { id: 'availability', title: '잔여좌석', description: '실시간 잔여좌석은 사용하지 않음', status: '미사용', statusColor: 'warning', source: '서비스 범위에서 제외', usage: '예약 가능 여부나 잔여좌석을 임의로 표시하지 않고, 햇빛 분석과 공식 좌석 구조만 제공합니다.' },
];
const selectedSourceItem = computed(() => sourceItems.find((item) => item.id === selectedSource.value) ?? sourceItems[0]);
const dateDisplayValue = computed(() => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.value.date)) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(`${form.value.date}T00:00:00+09:00`));
});
const datePickerValue = computed({
  get: () => /^\d{4}-\d{2}-\d{2}$/.test(form.value.date)
    ? new Date(`${form.value.date}T00:00:00`)
    : null,
  set: (value) => {
    form.value.date = normalizeDateValue(value);
    dateMenu.value = false;
  },
});
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
const detailTimelineTotal = computed(() => (exposure.value?.segments ?? []).reduce((total, segment) => total + Number(segment.durationMinutes || 0), 0) || 1);
const timelineStations = computed(() => {
  const seen = new Set();
  return (selectedTrain.value?.stationTimeline ?? []).filter((event) => {
    if (seen.has(event.station)) return false;
    seen.add(event.station);
    return true;
  });
});
const comparisonSeat = computed(() => {
  if (!selectedSeat.value || !selectedCar.value) return null;
  const selectedRow = Number(selectedSeat.value.row ?? selectedSeat.value.layoutRow);
  return selectedCar.value.seats.find((seat) => {
    const row = Number(seat.row ?? seat.layoutRow);
    return row === selectedRow && seat.position === 'WINDOW' && seat.physicalSide !== selectedSeat.value.physicalSide;
  }) ?? null;
});

function messageOf(caught) {
  return caught instanceof Error ? caught.message : String(caught);
}

function timeText(value) {
  return String(value ?? '').slice(11, 16) || '--:--';
}

function normalizeDateValue(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const iso = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (iso) return iso;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function clearDate() {
  form.value.date = '';
  dateMenu.value = false;
}

function sideLabel(value) {
  if (value === 'LEFT') return '왼쪽 창가 추천';
  if (value === 'RIGHT') return '오른쪽 창가 추천';
  return '햇빛 방향 분석';
}

function segmentLabel(type) {
  return {
    LEFT: '왼쪽 햇빛',
    RIGHT: '오른쪽 햇빛',
    WEAK: '약한 햇빛',
    TUNNEL: '터널',
    NIGHT: '밤',
  }[type] ?? '햇빛 분석';
}

function segmentClass(type) {
  return String(type ?? '').toLowerCase();
}

function friendlyError(value) {
  const text = String(value ?? '');
  if (text.includes('Active route dataset')) return '햇빛 분석 경로 데이터를 준비하고 있습니다. 잠시 후 다시 시도해 주세요.';
  if (text.includes('TAGO_SCHEDULE_URL') || text.includes('TAGO_SERVICE_KEY')) return '열차 일정 데이터가 준비되지 않았습니다. TAGO 환경변수를 확인해 주세요.';
  if (text.includes('Calculation service')) return '햇빛 분석 서버에 연결할 수 없습니다. 계산 서비스 상태를 확인해 주세요.';
  return text || '잠시 후 다시 시도해 주세요.';
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

function trainTypeName(code) {
  return trainTypes.value.find((item) => item.id === code)?.name ?? code;
}

function setTimePreset(preset) {
  selectedPreset.value = preset.id;
  form.value.departureTimeFrom = preset.from;
  form.value.departureTimeTo = preset.to;
}

function markCustomTime() {
  selectedPreset.value = 'CUSTOM';
}

function swapStations() {
  const origin = form.value.origin;
  form.value.origin = form.value.destination;
  form.value.destination = origin;
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
      selectedSeat.value = preferredSeatFor(result.layout.cars?.[0]);
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
  selectedSeat.value = preferredSeatFor(layout.cars?.[0]);
}

function preferredSeatFor(car) {
  return car?.seats?.find((seat) => seat.position === 'WINDOW') ?? car?.seats?.[0] ?? null;
}

function selectSeatCar(car) {
  selectedCarNumber.value = car?.carNumber ?? null;
  selectedSeat.value = preferredSeatFor(car);
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
    analysisMode.value = 'train';
    view.value = 'detail';
    return;
  }
  loading.value = true;
  try {
    exposure.value = await calculateExposure(exposureRequest(train));
    await loadSeatLayout(train);
    analysisMode.value = 'train';
    view.value = 'detail';
  } catch (caught) { error.value = messageOf(caught); }
  finally { loading.value = false; }
}

function openSeatSelection() {
  if (!selectedTrain.value || !exposure.value) return;
  view.value = 'seats';
}

function showSeatAnalysis() {
  if (!selectedSeat.value) return;
  analysisMode.value = 'seat';
  view.value = 'detail';
}

function goToSearch() {
  mobileMenuOpen.value = false;
  view.value = 'search';
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
    <header class="site-header">
      <div class="header-inner">
        <button class="brand-button" type="button" aria-label="SunSeat 홈" @click="goToSearch">
          <span class="brand-sun" aria-hidden="true"><span /></span>
          <span class="brand-copy"><strong>SunSeat</strong><small>햇빛자리</small></span>
        </button>
        <nav class="main-nav" aria-label="주요 메뉴">
          <button type="button" :class="{ active: ['search', 'trains'].includes(view) }" @click="goToSearch">열차 검색</button>
          <button type="button" :class="{ active: ['seats', 'detail'].includes(view) }" @click="selectedTrain && exposure ? (view = 'seats') : goToSearch()">좌석 선택</button>
          <button type="button" :class="{ active: view === 'about' }" @click="openAbout">서비스 소개</button>
          <button type="button" :class="{ active: view === 'poc' }" @click="loadPoc">햇빛 가이드</button>
          <button type="button" @click="openAbout">자주 묻는 질문</button>
        </nav>
        <div class="header-tools">
          <button type="button" @click="loadPoc"><v-icon icon="mdi-information-outline" /> PoC 확인</button>
          <button type="button" @click="openAbout">데이터 출처</button>
          <button type="button" class="profile-button" aria-label="사용자 메뉴"><v-icon icon="mdi-account-outline" /></button>
        </div>
        <button class="mobile-menu-button" type="button" :aria-expanded="mobileMenuOpen" aria-label="메뉴 열기" @click="mobileMenuOpen = !mobileMenuOpen"><v-icon :icon="mobileMenuOpen ? 'mdi-close' : 'mdi-menu'" /></button>
      </div>
      <div v-if="mobileMenuOpen" class="mobile-nav">
        <button type="button" @click="goToSearch">열차 검색</button>
        <button type="button" @click="selectedTrain && exposure ? (view = 'seats', mobileMenuOpen = false) : goToSearch()">좌석 선택</button>
        <button type="button" @click="openAbout(); mobileMenuOpen = false">서비스 소개</button>
        <button type="button" @click="loadPoc(); mobileMenuOpen = false">햇빛 가이드</button>
        <button type="button" @click="openAbout(); mobileMenuOpen = false">데이터 출처</button>
      </div>
    </header>

    <main>
      <section v-if="view === 'search'" class="home-hero">
        <div class="hero-background" aria-hidden="true" />
        <div class="page-container hero-content">
          <div class="hero-copy">
            <p class="eyebrow">A MORE COMFORTABLE TRAIN JOURNEY</p>
            <h1>여행의 설렘은 그대로,<br /><em>햇빛은</em> 조금 더 피해서.</h1>
            <p>실제 운행 열차와 철도 선형을 바탕으로 여행 시간대별 햇빛 방향을 분석해,<br class="desktop-only" /> 더 편안한 좌석을 추천해 드립니다.</p>
          </div>
          <div class="hero-note" aria-hidden="true"><span>햇빛은 풍경이 되고,</span><span>당신의 여행은 더 특별해집니다.</span><i /></div>
        </div>
      </section>

      <section v-if="view === 'search'" class="page-container search-panel-wrap">
        <form class="search-panel" @submit.prevent="searchTrains">
          <div class="search-panel-head">
            <div class="search-title"><span class="icon-disc"><v-icon icon="mdi-train" /></span><div><h2>열차 검색</h2><p>여행 정보를 입력하고 햇빛이 적은 좌석을 찾아보세요.</p></div></div>
          </div>
          <div class="search-fields">
            <label class="field-group">
              <span>출발역</span>
              <span class="field-control"><v-icon icon="mdi-train" /><select v-model="form.origin" :disabled="stationLoading" aria-label="출발역"><option v-for="station in stationItems" :key="station.value" :value="station.value">{{ station.title }}</option></select><v-icon class="field-chevron" icon="mdi-chevron-down" /></span>
            </label>
            <button class="swap-button" type="button" aria-label="출발역과 도착역 바꾸기" @click="swapStations"><v-icon icon="mdi-swap-horizontal" /></button>
            <label class="field-group">
              <span>도착역</span>
              <span class="field-control"><v-icon icon="mdi-map-marker-outline" /><select v-model="form.destination" :disabled="stationLoading" aria-label="도착역"><option v-for="station in stationItems" :key="station.value" :value="station.value">{{ station.title }}</option></select><v-icon class="field-chevron" icon="mdi-chevron-down" /></span>
            </label>
            <div class="field-group">
              <span>여행 날짜</span>
              <v-menu v-model="dateMenu" :close-on-content-click="false" location="bottom start" min-width="320">
                <template #activator="{ props: dateProps }">
                  <button v-bind="dateProps" class="field-control date-control" type="button" aria-label="여행 날짜">
                    <v-icon icon="mdi-calendar-blank-outline" /><span :class="{ placeholder: !dateDisplayValue }">{{ dateDisplayValue || '날짜를 선택하세요' }}</span><v-icon v-if="dateDisplayValue" class="clear-field" icon="mdi-close-circle" @click.stop="clearDate" />
                  </button>
                </template>
                <v-date-picker v-model="datePickerValue" locale="ko" first-day-of-week="1" color="primary" show-adjacent-months hide-header />
              </v-menu>
            </div>
            <div class="field-group vehicle-field">
              <span>차량</span>
              <button class="field-control" type="button" aria-haspopup="listbox" :aria-expanded="vehicleMenuOpen" @click="vehicleMenuOpen = !vehicleMenuOpen">
                <v-icon icon="mdi-train-variant" /><span>{{ form.trainGradeCodes.length ? form.trainGradeCodes.map(trainTypeName).join(', ') : '전체 차량' }}</span><v-icon class="field-chevron" :icon="vehicleMenuOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'" />
              </button>
              <div v-if="vehicleMenuOpen" class="vehicle-menu">
                <label><input v-model="form.trainGradeCodes" type="checkbox" value="ALL" @change="form.trainGradeCodes = []" /> 전체 차량</label>
                <label v-for="type in searchTrainTypeItems" :key="type.value"><input v-model="form.trainGradeCodes" type="checkbox" :value="type.value" /> {{ type.title }}</label>
              </div>
            </div>
          </div>
          <div class="search-options">
            <div class="preset-group"><span class="filter-label">시간대</span><div class="preset-list"><button v-for="preset in TIME_PRESETS" :key="preset.id" type="button" :class="{ selected: selectedPreset === preset.id }" @click="setTimePreset(preset)">{{ preset.label }}</button></div></div>
            <div class="time-group"><span class="filter-label">출발 시간 <small>(선택)</small></span><div class="time-range"><label class="time-control"><v-icon icon="mdi-clock-outline" /><input v-model="form.departureTimeFrom" type="time" aria-label="출발 시간 시작" @input="markCustomTime" /></label><b>~</b><label class="time-control"><v-icon icon="mdi-clock-outline" /><input v-model="form.departureTimeTo" type="time" aria-label="출발 시간 종료" @input="markCustomTime" /></label></div></div>
            <button class="primary-button search-submit" type="submit" :disabled="loading"><v-icon icon="mdi-magnify" /> {{ loading ? '검색 중…' : '햇빛 적은 열차 찾기' }} <v-icon icon="mdi-arrow-right" /></button>
          </div>
          <p v-if="error" class="form-error">{{ friendlyError(error) }}</p>
        </form>
      </section>

      <section v-if="view === 'trains'" class="results-page page-container">
        <div class="compact-search-bar">
          <div class="compact-route"><strong>{{ form.origin }}</strong><v-icon icon="mdi-arrow-right" /><strong>{{ form.destination }}</strong></div>
          <div class="compact-date"><v-icon icon="mdi-calendar-blank-outline" /> {{ formatDateLabel(form.date) || '날짜 미지정' }}</div>
          <div class="compact-actions"><button type="button" @click="goToSearch">검색 조건 수정</button><button type="button" @click="searchTrains">다시 검색</button></div>
        </div>
        <div class="results-heading"><div><p class="eyebrow">TRAIN LIST</p><h1>{{ form.origin }} <span>→</span> {{ form.destination }}</h1><p>{{ formatDateLabel(form.date) || '날짜 미지정' }} · {{ selectedPreset === 'ALL' ? '전체 시간' : TIME_PRESETS.find((item) => item.id === selectedPreset)?.label }}</p></div><span class="source-badge">{{ scheduleState || 'TAGO' }}</span></div>
        <div v-if="loadingMessage" class="loading-banner"><v-progress-circular indeterminate size="18" width="2" color="primary" /> {{ loadingMessage }}</div>
        <div v-if="error" class="error-banner"><v-icon icon="mdi-alert-circle-outline" /><span>{{ friendlyError(error) }}</span></div>
        <div v-if="searchSummary" class="result-summary-strip"><strong>{{ searchSummary.displayedCount ?? visibleTrains.length }}개</strong><span>표시</span><span>전체 {{ searchSummary.totalCount ?? visibleTrains.length }}개 검색</span><span>오늘 운행 {{ searchSummary.firstDeparture ? timeText(searchSummary.firstDeparture) : '--:--' }} ~ {{ searchSummary.lastDeparture ? timeText(searchSummary.lastDeparture) : '--:--' }}</span></div>
        <div v-if="searchState === 'SUCCESS'" class="result-filters">
          <div class="filter-copy"><p class="eyebrow">FILTER RESULTS</p><strong>차량 종류</strong><span>검색 후 원하는 차량만 골라보세요.</span></div>
          <div class="filter-pills"><button type="button" :class="{ selected: vehicleFilter.includes('ALL') }" @click="clearGradeFilter">전체 차량 <small v-if="searchSummary">{{ searchSummary.totalCount ?? '' }}</small></button><button v-for="type in resultFilterTrainTypes" :key="type.id" type="button" :class="{ selected: vehicleFilter.includes(type.id) }" @click="updateVehicleFilter(vehicleFilter.includes(type.id) ? vehicleFilter.filter((value) => value !== type.id) : [...vehicleFilter.filter((value) => value !== 'ALL'), type.id])">{{ type.name }} <small v-if="type.count !== null">{{ type.count }}편</small></button></div>
        </div>
        <div v-if="searchState === 'SUCCESS' && visibleTrains.length" class="train-list">
          <button v-for="train in visibleTrains" :key="train.id" class="train-row" type="button" @click="calculateSelected(train)">
            <div class="train-identity"><strong>{{ train.trainGradeName }}</strong><small>{{ train.trainNumber }}</small><span v-if="previewFor(train)" class="sun-status"><v-icon icon="mdi-white-balance-sunny" /> 햇빛 분석 완료</span></div>
            <div class="train-times"><strong>{{ timeText(train.departureAt) }}</strong><span class="time-line"><i /><small>{{ formatDuration(train.durationMinutes) }}</small><i /></span><strong>{{ timeText(train.arrivalAt) }}</strong><small class="stations">{{ train.origin }} → {{ train.destination }}</small></div>
            <div class="train-price"><small>{{ train.trainGradeName }}</small><strong>{{ formatFare(train.adultFare) }}</strong></div>
            <div class="train-sun"><v-icon icon="mdi-white-balance-sunny" /><div><strong>{{ previewFor(train) ? sideLabel(previewFor(train).recommendedSide) : (previewLoading ? '햇빛 계산 중' : '햇빛 분석 준비 중') }}</strong><small>{{ previewFor(train) ? '노선과 시간대 기준 분석 완료' : '열차를 선택하면 상세 분석합니다' }}</small></div></div>
            <span class="row-detail">상세 보기 <v-icon icon="mdi-chevron-right" /></span>
          </button>
        </div>
        <div v-else-if="searchState === 'SUCCESS' && vehicleFilter[0] !== 'ALL'" class="empty-state"><h2>선택한 차량 종류의 열차가 없습니다.</h2><p>검색 결과에서 다른 차량을 선택하거나 전체 차량으로 돌아가세요.</p><button class="secondary-button" type="button" @click="clearGradeFilter">전체 차량 보기</button></div>
        <div v-else-if="searchState === 'NO_TRAINS_IN_TIME_RANGE'" class="empty-state"><h2>선택한 시간대에는 열차가 없습니다.</h2><p>{{ searchSummary?.conditions?.departureTimeFrom || '00:00' }} ~ {{ searchSummary?.conditions?.departureTimeTo || '23:59' }} 사이의 운행편을 찾지 못했습니다.</p><div v-if="nearbyTrains.length" class="nearby-list"><strong>가장 가까운 열차</strong><button v-for="train in nearbyTrains" :key="train.id" type="button" @click="calculateSelected(train)"><span>{{ timeText(train.departureAt) }} {{ train.trainGradeName }} {{ train.trainNumber }}</span><small>{{ formatDuration(train.durationMinutes) }}</small></button></div></div>
        <div v-else class="empty-state"><h2>해당 날짜에 표시할 열차가 없습니다.</h2><p>다른 날짜 또는 출발·도착역을 선택해 다시 검색해 주세요.</p></div>
        <p v-if="previewError" class="muted preview-note">열차 목록은 표시되었지만 햇빛 미리보기를 준비하지 못했습니다. 열차를 선택하면 개별 계산을 시도합니다.</p>
      </section>

      <section v-if="view === 'detail' && exposure && analysisMode === 'train'" class="detail-page page-container">
        <div class="detail-breadcrumb"><button type="button" @click="view = 'trains'">‹ 검색 결과로 돌아가기</button><span>열차 검색</span><v-icon icon="mdi-chevron-right" /><span>열차 상세</span></div>
        <div class="detail-journey-bar">
          <span><v-icon icon="mdi-swap-horizontal" /> {{ selectedTrain.origin }} <b>→</b> {{ selectedTrain.destination }}</span><span><v-icon icon="mdi-calendar-blank-outline" /> {{ form.date }} ({{ new Date(form.date + 'T00:00:00+09:00').toLocaleDateString('ko-KR', { weekday: 'short' }) }})</span><span><v-icon icon="mdi-train-variant" /> {{ selectedTrain.trainGradeName }} {{ selectedTrain.trainNumber }}</span><span><v-icon icon="mdi-clock-outline" /> {{ timeText(selectedTrain.departureAt) }} → {{ timeText(selectedTrain.arrivalAt) }} <small>({{ formatDuration(selectedTrain.durationMinutes) }})</small></span>
        </div>
        <div class="detail-title-block"><div><p class="eyebrow">A MORE COMFORTABLE TRAIN JOURNEY</p><h1>여행의 설렘은 그대로,<br /><em>햇빛은</em> 조금 더 가까이.</h1><p>지금 이 열차의 햇빛 방향을 분석했습니다. 가장 좋은 자리에 앉아 더 특별한 여행을 시작해 보세요.</p></div><div class="detail-note">햇빛이 머무는 창가가<br />여행을 더 특별하게 만듭니다.<i /></div></div>
        <div class="detail-layout">
          <div class="detail-main-column">
            <article class="analysis-main-card white-card">
              <div class="card-heading"><div><p class="eyebrow">SUNSEAT ANALYSIS</p><h2>{{ selectedTrain.trainGradeName }} {{ selectedTrain.trainNumber }} 햇빛 분석</h2><p>열차가 이동하는 동안 좌우 창가에 들어오는 햇빛을 비교했습니다.</p></div><span class="recommend-pill"><v-icon icon="mdi-seat-outline" /> 추천 좌석 방향</span></div>
              <div class="recommendation-banner"><div class="recommendation-icon"><v-icon icon="mdi-seat-outline" /></div><div><small>추천 좌석 방향</small><strong>{{ sideLabel(exposure.recommendedSide) }}</strong><p>이 열차는 전체 구간에서 {{ exposure.recommendedSide === 'LEFT' ? '왼쪽' : '오른쪽' }}으로 햇빛이 더 적게 비칩니다.</p></div></div>
              <div class="analysis-metrics"><div><v-icon icon="mdi-white-balance-sunny" /><span>{{ exposure.recommendedSide === 'LEFT' ? '왼쪽' : '오른쪽' }} 창가<strong>{{ exposure.recommendedSide === 'LEFT' ? exposure.summary.leftExposureMinutes.toFixed(0) : exposure.summary.rightExposureMinutes.toFixed(0) }}분</strong><small>직접 햇빛 예상 시간</small></span></div><div><v-icon icon="mdi-chart-bar" /><span>반대편 창가<strong>{{ exposure.recommendedSide === 'LEFT' ? exposure.summary.rightExposureMinutes.toFixed(0) : exposure.summary.leftExposureMinutes.toFixed(0) }}분</strong><small>추천 방향보다 더 많음</small></span></div></div>
              <div class="timeline-card"><div class="timeline-heading"><h3>구간별 햇빛 타임라인</h3><span>열차 이동 중 방향과 강도를 시간대별로 확인할 수 있습니다.</span></div><div class="timeline-track"><span v-for="segment in exposure.segments" :key="segment.start + '-' + segment.type" :class="['timeline-segment', segmentClass(segment.type)]" :style="{ flex: Math.max(0.12, Number(segment.durationMinutes || 0) / detailTimelineTotal) }" :title="segmentLabel(segment.type)">{{ segmentLabel(segment.type) }}</span></div><div class="timeline-stops"><span v-for="station in timelineStations" :key="station.station"><b>{{ timeText(station.time || station.arrivalAt || station.departureAt) }}</b><small>{{ station.station }}</small></span></div></div>
            </article>
          </div>
          <aside class="detail-side-column">
            <article class="train-info-card white-card"><div class="card-heading"><h2><v-icon icon="mdi-train-variant" /> 열차 정보</h2><span class="light-pill">실제 운행</span></div><div class="train-info-image"><img src="/images/sunseat-train-detail.png" alt="열차와 호수 풍경" /></div><dl><div><dt>운행 구간</dt><dd>{{ selectedTrain.origin }} → {{ selectedTrain.destination }}</dd></div><div><dt>운행 일자</dt><dd>{{ form.date }}</dd></div><div><dt>출발 / 도착</dt><dd>{{ timeText(selectedTrain.departureAt) }} → {{ timeText(selectedTrain.arrivalAt) }}</dd></div></dl></article>
            <article class="seat-cta-card"><div><v-icon icon="mdi-seat-outline" /><h2>이 열차에서 좌석을 선택해 보세요.</h2><p>햇빛 분석 결과를 참고해 더 좋은 자리를 선택할 수 있습니다.</p></div><button class="primary-button" type="button" @click="openSeatSelection">좌석 선택하기 <v-icon icon="mdi-arrow-right" /></button></article>
          </aside>
        </div>
      </section>

      <section v-if="view === 'seats' && selectedTrain" class="seat-page page-container">
        <div class="seat-hero"><div><p class="eyebrow">A MORE COMFORTABLE TRAIN JOURNEY</p><h1>좌석 선택</h1><p>햇빛과 함께하는, 더 특별한 좌석을 선택하세요.<br />SunSeat의 햇빛 분석으로 여행이 더 즐거워집니다.</p></div><div class="hero-note">좋은 풍경이 좋은 여행을 만듭니다.<i /></div></div>
        <div class="seat-journey-bar"><span><v-icon icon="mdi-train" /> {{ selectedTrain.origin }} <b>→</b> {{ selectedTrain.destination }}</span><span>{{ timeText(selectedTrain.departureAt) }} → {{ timeText(selectedTrain.arrivalAt) }}</span><span>{{ selectedTrain.trainGradeName }} {{ selectedTrain.trainNumber }}</span><button type="button" @click="view = 'trains'">열차 정보 보기 <v-icon icon="mdi-arrow-right" /></button></div>
        <section class="car-selector white-card"><div><h2>호차 선택</h2><p>좌석을 선택하면 오른쪽에서 상세 정보를 확인할 수 있습니다.</p></div><div class="car-tabs"><button v-for="car in seatLayout?.cars ?? []" :key="car.carNumber" type="button" :class="{ selected: selectedCarNumber === car.carNumber }" @click="selectSeatCar(car)">{{ car.carNumber }}호차</button></div></section>
        <div class="seat-content-grid">
          <article class="seat-map-panel white-card"><div class="card-heading"><div><h2><v-icon icon="mdi-white-balance-sunny" /> {{ selectedCarNumber || 1 }}호차 좌석도</h2><p>햇빛 방향과 세기 정보가 표시된 좌석도입니다.</p></div><span class="help-pill">좌석 선택 도움말 <v-icon icon="mdi-help-circle-outline" /></span></div><div v-if="seatLayoutLoading" class="loading-box"><v-progress-circular indeterminate color="primary" /> 공식 좌석도를 불러오는 중입니다.</div><div v-else-if="selectedCar && hasVisualSeatRows" class="seat-map-scroller"><div class="seat-map-direction"><span>← {{ selectedTrain.origin }} 방향</span><b>열차 진행 방향</b><span>{{ selectedTrain.destination }} 방향 →</span></div><div class="seat-map-guide"><span><i class="sun-dot strong" /> 왼쪽 창가</span><span><i class="sun-dot weak" /> 오른쪽 창가</span></div><div class="reference-seat-cabin"><div v-for="row in selectedCarRows" :key="row.row" class="reference-seat-row"><span class="row-number">{{ row.row }}</span><div class="seat-side"><button v-for="seat in row.left" :key="seat.seatNumber" type="button" :class="['seat-button', seat.physicalSide.toLowerCase(), { selected: selectedSeat?.seatNumber === seat.seatNumber, recommended: seat.position === 'WINDOW' && seat.physicalSide === 'SIDE_B' }]" @click="selectedSeat = seat"><span>☀</span><strong>{{ seat.seatNumber }}</strong></button></div><span class="seat-aisle">통로</span><div class="seat-side"><button v-for="seat in row.right" :key="seat.seatNumber" type="button" :class="['seat-button', seat.physicalSide.toLowerCase(), { selected: selectedSeat?.seatNumber === seat.seatNumber, recommended: seat.position === 'WINDOW' && seat.physicalSide === 'SIDE_B' }]" @click="selectedSeat = seat"><span>☀</span><strong>{{ seat.seatNumber }}</strong></button></div></div></div><div class="seat-map-legend"><span><i class="legend-seat strong" /> 강한 햇빛</span><span><i class="legend-seat medium" /> 보통 햇빛</span><span><i class="legend-seat weak" /> 약한 햇빛</span></div></div><div v-else class="empty-map"><span>SEAT LAYOUT</span><strong>{{ seatLayoutError || '공식 좌석도 확인 후 좌석 구조를 표시합니다.' }}</strong></div></article>
          <aside class="seat-info-panel white-card"><div class="card-heading"><h2><v-icon icon="mdi-seat-outline" /> 선택 좌석 정보</h2><span class="recommend-pill"><v-icon icon="mdi-crown-outline" /> 추천 좌석</span></div><div v-if="selectedSeat" class="selected-seat-summary"><div class="seat-icon-large"><v-icon icon="mdi-seat" /></div><div><p class="eyebrow">{{ selectedTrain.trainGradeName }}</p><h2>{{ selectedCarNumber }}호차 {{ selectedSeat.seatNumber }}</h2><p>{{ selectedSeat.position === 'WINDOW' ? '창가' : selectedSeat.position === 'AISLE' ? '통로' : '좌석' }} · {{ selectedSeat.physicalSide === 'SIDE_A' ? '왼쪽' : '오른쪽' }}</p></div></div><div v-else class="seat-empty-state"><v-icon icon="mdi-cursor-default-click-outline" /><strong>좌석을 선택해 주세요</strong><span>좌석을 선택하면 햇빛 정보를 보여드립니다.</span></div><div class="seat-metrics"><div><v-icon icon="mdi-white-balance-sunny" /><span>예상 직사광<strong>{{ selectedSeatExposure ? selectedSeatExposure.directSunMinutes.toFixed(0) + '분' : '—' }}</strong></span></div><div><v-icon icon="mdi-star-four-points-outline" /><span>추천 등급<strong>{{ selectedSeat ? (selectedSeatExposure?.travelSide === exposure?.recommendedSide ? '매우 좋음' : '좋음') : '선택 대기' }}</strong></span></div></div><button class="primary-button wide" type="button" :disabled="!selectedSeat" @click="showSeatAnalysis">이 좌석으로 분석 보기 <v-icon icon="mdi-arrow-right" /></button><p class="disclaimer"><v-icon icon="mdi-lightbulb-on-outline" /> 실제 좌석 예약 가능 여부는 제공하지 않습니다.</p></aside>
        </div>
      </section>

      <section v-if="view === 'detail' && exposure && analysisMode === 'seat' && selectedSeat" class="seat-analysis-page page-container">
        <div class="detail-breadcrumb"><button type="button" @click="view = 'seats'">‹ 좌석 선택으로 돌아가기</button><span>좌석 분석 결과</span></div>
        <div class="detail-title-block seat-analysis-title"><div><p class="eyebrow">SELECTED SEAT ANALYSIS</p><h1>선택 좌석 <em>분석 결과</em></h1><p>햇빛 방향을 분석한 결과, 선택하신 좌석은 쾌적한 여행에 좋은 조건을 가지고 있습니다.</p></div><div class="detail-note">좋은 자리는<br />더 특별한 풍경을 만듭니다.<i /></div></div>
        <div class="seat-analysis-summary white-card"><div class="seat-analysis-seat"><div class="seat-icon-large"><v-icon icon="mdi-seat" /></div><div><span class="recommend-pill">추천 좌석</span><h2>{{ selectedCarNumber }}호차 {{ selectedSeat.seatNumber }}</h2><p>{{ selectedSeat.position === 'WINDOW' ? '창가' : '좌석' }} · {{ selectedSeat.physicalSide === 'SIDE_A' ? '왼쪽' : '오른쪽' }}</p><small>전반적으로 햇빛이 적어 쾌적한 여행을 즐길 수 있습니다.</small></div></div><div class="seat-analysis-metrics"><div><v-icon icon="mdi-white-balance-sunny" /><span>맑은 날 기준 예상 직사광<strong>{{ selectedSeatExposure?.directSunMinutes.toFixed(0) }}분</strong></span></div><div><v-icon icon="mdi-chart-bar" /><span>반대편 {{ comparisonSeat?.seatNumber || '창가' }} 비교<strong>{{ comparisonSeat ? '동일 기준 비교' : '비교 좌석 없음' }}</strong></span></div><div><v-icon icon="mdi-thumb-up-outline" /><span>추천 결과<strong>대체로 쾌적한 좌석입니다.</strong></span></div></div></div>
        <div class="seat-analysis-columns"><article class="white-card"><div class="card-heading"><h2>시간대별 햇빛 분석</h2><span>{{ selectedCarNumber }}호차 {{ selectedSeat.seatNumber }}</span></div><div class="timeline-track large"><span v-for="segment in exposure.segments" :key="segment.start + '-seat-' + segment.type" :class="['timeline-segment', segmentClass(segment.type)]" :style="{ flex: Math.max(0.12, Number(segment.durationMinutes || 0) / detailTimelineTotal) }">{{ segmentLabel(segment.type) }}</span></div><div class="timeline-stops"><span v-for="station in timelineStations" :key="station.station"><b>{{ timeText(station.time || station.arrivalAt || station.departureAt) }}</b><small>{{ station.station }}</small></span></div></article><article class="white-card comparison-card"><div class="card-heading"><h2>동일 열차 · 동일 호차 좌석 비교</h2></div><div class="compare-seats"><div class="compare-seat selected"><strong>{{ selectedSeat.seatNumber }}</strong><span>선택 좌석</span><b>{{ selectedSeatExposure?.directSunMinutes.toFixed(0) }}분</b></div><div v-if="comparisonSeat" class="compare-seat"><strong>{{ comparisonSeat.seatNumber }}</strong><span>반대편 창가</span><b>분석 기준 확인</b></div></div><button class="secondary-button" type="button" @click="view = 'seats'">다른 좌석 보기 <v-icon icon="mdi-arrow-right" /></button></article></div>
      </section>

      <section v-if="view === 'poc'" class="page-container simple-page"><div v-if="pocLoading" class="loading-box">PoC 결과를 불러오는 중입니다…</div><div v-else-if="pocError" class="error-banner">{{ friendlyError(pocError) }}</div><template v-else-if="pocSummary"><div class="simple-heading"><p class="eyebrow">TECHNICAL POC</p><h1>서울 → 부산 햇빛 노출 검증</h1><p>실제 경로·시간표·태양 위치 계산을 연결한 기술 검증 화면입니다.</p></div><div class="poc-metrics"><div><span>추천 창가</span><strong>{{ pocSummary.recommendedSide }}</strong></div><div><span>LEFT weighted</span><strong>{{ pocSummary.leftWeightedExposure.toFixed(2) }}</strong></div><div><span>RIGHT weighted</span><strong>{{ pocSummary.rightWeightedExposure.toFixed(2) }}</strong></div><div><span>터널</span><strong>{{ pocSummary.tunnelDistanceKm.toFixed(1) }}km</strong></div></div><div class="poc-grid"><section class="white-card timeline-panel"><div class="card-heading"><h2>좌우 노출과 터널 구간</h2><select v-model="resolution" @change="changePocResolution"><option value="1m">1분 표시</option><option value="5m">5분 표시</option><option value="raw">30초 원본</option></select></div><div class="poc-track"><span v-for="(item, index) in timeline" :key="item.time + index" :class="exposureClass(item, 'LEFT')" @click="selectedIndex = index" /></div><input v-model.number="selectedIndex" type="range" min="0" :max="Math.max(0, timeline.length - 1)" class="slider" /></section><RouteMap :route="route" :current="current" /></div></template></section>

      <section v-if="view === 'about'" class="page-container simple-page about-page"><div class="simple-heading"><p class="eyebrow">TRUSTED DATA FOUNDATION</p><h1>햇빛자리의 데이터 출처</h1><p>실제 운행 일정과 공개·공식 구조 데이터를 기준으로 햇빛 방향을 계산합니다.</p></div><div class="about-grid"><article class="white-card source-card"><h2>계산에 사용한 자료</h2><div class="source-list"><button v-for="source in sourceItems" :key="source.id" type="button" :class="{ selected: selectedSource === source.id }" @click="selectedSource = source.id"><span class="source-item-icon"><v-icon :icon="source.id === 'schedule' ? 'mdi-calendar-clock-outline' : source.id === 'route' ? 'mdi-vector-polyline' : source.id === 'sun' ? 'mdi-white-balance-sunny' : 'mdi-seat-outline'" /></span><span><strong>{{ source.title }}</strong><small>{{ source.description }}</small></span><v-chip size="small" :color="source.statusColor" variant="tonal">{{ source.status }}</v-chip></button></div><div class="source-detail-panel"><p class="eyebrow">{{ selectedSourceItem.title }}</p><p>{{ selectedSourceItem.usage }}</p><small>{{ selectedSourceItem.source }}</small></div></article><article class="white-card train-types-card"><h2>TRAIN TYPES</h2><p>실제 API 차량 종류와 공식 좌석 구조 상태입니다.</p><div class="catalog-list"><button v-for="item in catalogItems" :key="item.id" type="button" @click="openSeatCatalog(item)"><span><strong>{{ item.name }}</strong><small>{{ item.id }}</small></span><v-chip size="small" :color="item.available ? 'secondary' : 'warning'" variant="tonal">{{ item.available ? '확인됨' : '일부 확인' }}</v-chip><v-icon icon="mdi-chevron-right" /></button></div></article></div></section>
    </main>
    <footer class="site-footer"><div class="page-container footer-inner"><div class="footer-brand"><span class="brand-sun small" aria-hidden="true"><span /></span><strong>SunSeat</strong><small>햇빛자리</small></div><p>햇빛이 덜한, 더 좋은 여행의 시작</p><span>© 2026 SunSeat. 더 편안한 기차 여행을 위해.</span></div></footer>
    <v-dialog v-model="seatDialog" max-width="1440" scrollable><v-card class="seat-dialog-card"><v-card-title><div><span class="eyebrow">OFFICIAL SEAT PLAN</span><h2>공식 좌석 전체 비교</h2></div><v-btn variant="text" @click="seatDialog = false">닫기</v-btn></v-card-title><v-divider /><v-card-text><div v-if="selectedCatalogItem" class="dialog-train-heading"><div><h3>{{ selectedCatalogItem.name }}</h3><p>{{ selectedCatalogItem.id }} · 공식 좌석 원본 기준</p></div><v-chip :color="selectedCatalogItem.available ? 'secondary' : 'warning'" variant="tonal">{{ selectedCatalogItem.available ? '구조 좌석 확인' : '원본 확인 필요' }}</v-chip></div><div v-if="selectedCatalogItem?.available" class="seat-catalog-variants"><section v-for="layout in selectedCatalogLayouts" :key="layout.id" class="seat-catalog-variant"><div class="seat-catalog-variant-heading"><strong>{{ layout.id }}</strong><span>{{ layout.rollingStockType }} · {{ layout.totalSeatCount.toLocaleString('ko-KR') }}석</span></div><div class="seat-catalog-cars"><v-card v-for="car in layout.cars" :key="layout.id + '-' + car.carNumber" class="seat-catalog-car" variant="outlined"><v-card-title>{{ car.carNumber }}호차 <small>{{ car.seats.length }}석</small></v-card-title><v-card-text><div v-for="row in seatRowsFor(car)" :key="layout.id + '-' + car.carNumber + '-' + row.row" class="seat-plan-row"><div class="seat-plan-side"><span v-for="seat in row.left" :key="seat.seatNumber" class="seat-chip">{{ seat.seatNumber }}</span></div><span class="seat-plan-aisle">{{ row.row }}</span><div class="seat-plan-side"><span v-for="seat in row.right" :key="seat.seatNumber" class="seat-chip">{{ seat.seatNumber }}</span></div></div></v-card-text></v-card></div></section></div><p v-else class="muted">공식 좌석 식별자 원본이 없어 좌석을 임의로 생성하지 않았습니다.</p></v-card-text></v-card></v-dialog>
  </v-app>
</template>
