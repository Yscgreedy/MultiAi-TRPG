export function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    throw new Error(`AI 工具参数不是有效 JSON：${raw.slice(0, 120)}`);
  }
}

export function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

export function rollDice(count: number, sides: number): {
  expression: string;
  rolls: number[];
  total: number;
} {
  const rolls = Array.from(
    { length: count },
    () => Math.floor(Math.random() * sides) + 1,
  );
  return {
    expression: `${count}d${sides}`,
    rolls,
    total: rolls.reduce((sum, value) => sum + value, 0),
  };
}
