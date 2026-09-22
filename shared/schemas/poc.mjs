import { z } from 'zod';

export const resolutionSchema = z.enum(['raw', '1m', '5m']);

export const timelineQuerySchema = z.object({
  resolution: resolutionSchema.default('1m'),
});

