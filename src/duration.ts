const DURATION_UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60
};

export function parseDurationSeconds(input: string): number {
  const value = input.trim();
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    throw new Error(`Invalid duration "${input}". Use a number followed by s, m, h, or d.`);
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "";
  const multiplier = DURATION_UNITS[unit];
  const seconds = amount * multiplier;
  if (!Number.isSafeInteger(seconds)) {
    throw new Error(`Invalid duration "${input}". Duration is too large.`);
  }

  return seconds;
}
