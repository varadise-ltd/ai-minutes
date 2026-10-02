import { z } from 'zod';

export const newPasswordSchema = z.string()
  .min(8, 'Use at least 8 characters.')
  .max(200, 'Use no more than 200 characters.')
  .regex(/[A-Z]/, 'Include at least one uppercase letter (A–Z).')
  .regex(/[a-z]/, 'Include at least one lowercase letter (a–z).')
  .regex(/[0-9]/, 'Include at least one number (0–9).');
