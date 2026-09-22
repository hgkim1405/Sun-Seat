import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const isoDateTime = z.string().datetime({ offset: true });
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:mm');
const gradeCodes = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value.flatMap((item) => String(item).split(','));
  return String(value).split(',');
}, z.array(z.string().trim().min(1)).max(20).optional());

export const stationSearchSchema = z.object({
  q: z.string().trim().max(80).default(''),
});

export const trainSearchSchema = z.object({
  origin: z.string().trim().min(1),
  destination: z.string().trim().min(1),
  date: isoDate,
  departureTimeFrom: clockTime.optional(),
  departureTimeTo: clockTime.optional(),
  trainGradeCodes: gradeCodes,
  includeDeparted: z.preprocess((value) => value === true || value === 'true', z.boolean().default(false)),
}).superRefine((value, context) => {
  if (value.departureTimeFrom && value.departureTimeTo && value.departureTimeFrom > value.departureTimeTo) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['departureTimeTo'], message: 'departureTimeTo must be after departureTimeFrom' });
  }
});

export const stationTimelineEventSchema = z.object({
  station: z.string().trim().min(1),
  time: isoDateTime,
  event: z.enum(['arrival', 'departure']),
});

export const exposureRequestSchema = z.object({
  origin: z.string().trim().min(1),
  destination: z.string().trim().min(1),
  departure: isoDateTime,
  arrival: isoDateTime,
  stationTimeline: z.array(stationTimelineEventSchema).min(2),
  routeId: z.string().trim().min(1).default('seoul-busan'),
  trainNumber: z.string().trim().optional(),
  trainType: z.string().trim().optional(),
  scheduleSource: z.string().trim().optional(),
});

export const exposureBatchSchema = z.object({
  requests: z.array(exposureRequestSchema).min(1).max(20),
});

export const trainTypeSchema = z.enum(['KTX', 'KTX-SANCHEON', 'KTX-EUM', 'KTX-CHEONGRYONG', 'UNKNOWN']);
