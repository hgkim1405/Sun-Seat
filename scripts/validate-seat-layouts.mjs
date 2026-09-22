import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'data', 'processed', 'seat-layouts.json');
const value = JSON.parse(await fs.readFile(file, 'utf8'));
const failures = [];

for (const layout of value.layouts ?? []) {
  if (layout.validationStatus !== 'VALID' || layout.verified !== true) failures.push(`${layout.id}: layout is not verified`);
  const total = (layout.cars ?? []).reduce((sum, car) => {
    const seatNumbers = car.seats.map((seat) => seat.seatNumber);
    if (new Set(seatNumbers).size !== seatNumbers.length) failures.push(`${layout.id}/car-${car.carNumber}: duplicate seat number`);
    if (seatNumbers.length !== car.declaredSeatCount) failures.push(`${layout.id}/car-${car.carNumber}: ${seatNumbers.length} parsed != ${car.declaredSeatCount} declared`);
    return sum + seatNumbers.length;
  }, 0);
  if (total !== layout.totalSeatCount) failures.push(`${layout.id}: ${total} car seats != ${layout.totalSeatCount} total`);
}
if ((value.failures ?? []).length) failures.push(...value.failures.map((item) => `${item.id}: ${item.error}`));

const result = { status: failures.length ? 'FAIL' : 'PASS', layoutCount: value.layouts?.length ?? 0, failures };
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
