<script setup>
import { computed } from 'vue';

const props = defineProps({
  route: { type: Object, default: null },
  current: { type: Object, default: null },
});

const points = computed(() => {
  const coordinates = (props.route?.features || []).flatMap((feature) => feature.geometry?.coordinates || []);
  if (!coordinates.length) return '';
  const lons = coordinates.map((point) => point[0]);
  const lats = coordinates.map((point) => point[1]);
  const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const scaleX = (lon) => 20 + ((lon - minLon) / Math.max(0.001, maxLon - minLon)) * 360;
  const scaleY = (lat) => 260 - ((lat - minLat) / Math.max(0.001, maxLat - minLat)) * 230;
  return coordinates.map((point) => `${scaleX(point[0]).toFixed(1)},${scaleY(point[1]).toFixed(1)}`).join(' ');
});

const currentPoint = computed(() => {
  if (!props.current || !props.route?.features?.length) return null;
  const coordinates = props.route.features.flatMap((feature) => feature.geometry?.coordinates || []);
  const lons = coordinates.map((point) => point[0]); const lats = coordinates.map((point) => point[1]);
  const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  return {
    x: 20 + ((props.current.lon - minLon) / Math.max(0.001, maxLon - minLon)) * 360,
    y: 260 - ((props.current.lat - minLat) / Math.max(0.001, maxLat - minLat)) * 230,
  };
});
</script>

<template>
  <div class="map-card">
    <div class="section-title">실제 OSM route 개요</div>
    <svg viewBox="0 0 400 280" role="img" aria-label="서울 부산 철도 route">
      <polyline v-if="points" :points="points" class="route-line" />
      <circle v-if="currentPoint" :cx="currentPoint.x" :cy="currentPoint.y" r="6" class="train-dot" />
      <text x="20" y="274">서울</text>
      <text x="350" y="274">부산</text>
    </svg>
    <p class="muted">지도 배경 없이 route geometry와 현재 추정 위치만 표시합니다.</p>
  </div>
</template>

