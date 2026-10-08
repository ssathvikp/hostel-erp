/**
 * Pure helpers that mirror what the database generates, so the UI can show
 * exactly what will be created before anything is written. The database
 * (create_rooms_bulk and sync_room_beds) remains the source of truth.
 */

/** Bed labels for a room: `101-A`, `101-B`... */
export function bedLabels(roomNumber: string, capacity: number): string[] {
  return Array.from(
    { length: capacity },
    (_, index) => `${roomNumber}-${String.fromCharCode(65 + index)}`,
  );
}

export interface BulkRoomPlan {
  roomNumbers: string[];
  bedCount: number;
}

/** Rooms `from`..`to` (inclusive) with `capacity` beds each. */
export function planBulkRooms(from: number, to: number, capacity: number): BulkRoomPlan {
  const roomNumbers = Array.from({ length: Math.max(0, to - from + 1) }, (_, index) =>
    String(from + index),
  );
  return { roomNumbers, bedCount: roomNumbers.length * capacity };
}

/** Collapses `101, 102, 103, 105` into `101–103, 105` for compact display. */
export function summariseRange(numbers: readonly string[]): string {
  const parts: string[] = [];
  let start = 0;
  for (let index = 1; index <= numbers.length; index += 1) {
    const previous = Number(numbers[index - 1]);
    if (index < numbers.length && Number(numbers[index]) === previous + 1) continue;
    const first = numbers[start];
    const last = numbers[index - 1];
    parts.push(first === last ? first : `${first}–${last}`);
    start = index;
  }
  return parts.join(", ");
}
