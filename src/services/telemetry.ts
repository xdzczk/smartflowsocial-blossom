const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const histograms = new Map<string, number[]>();

function key(name: string, labels?: Record<string, string | number>): string {
  if (!labels) return name;
  const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  const labelString = sorted.map(([k, v]) => `${k}=${String(v)}`).join(",");
  return `${name}{${labelString}}`;
}

export function incrementCounter(
  name: string,
  labels?: Record<string, string | number>,
  amount = 1
): void {
  const metricKey = key(name, labels);
  counters.set(metricKey, (counters.get(metricKey) ?? 0) + amount);
}

export function setGauge(
  name: string,
  value: number,
  labels?: Record<string, string | number>
): void {
  gauges.set(key(name, labels), value);
}

export function observeHistogram(
  name: string,
  value: number,
  labels?: Record<string, string | number>
): void {
  const metricKey = key(name, labels);
  const samples = histograms.get(metricKey) ?? [];
  samples.push(value);
  if (samples.length > 1_000) samples.shift();
  histograms.set(metricKey, samples);
}

export async function withTiming<T>(
  name: string,
  fn: () => Promise<T>,
  labels?: Record<string, string | number>
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    observeHistogram(name, performance.now() - start, labels);
  }
}

function renderHistogram(name: string, samples: number[]): string[] {
  const count = samples.length;
  const sum = samples.reduce((acc, curr) => acc + curr, 0);
  return [`${name}_count ${count}`, `${name}_sum ${sum.toFixed(3)}`];
}

function metricBaseName(metric: string): string {
  const base = metric.split("{")[0];
  return base ?? metric;
}

export function renderMetrics(): string {
  const lines: string[] = [];
  for (const [metric, value] of counters.entries()) {
    lines.push(`# TYPE ${metricBaseName(metric)} counter`);
    lines.push(`${metric} ${value}`);
  }
  for (const [metric, value] of gauges.entries()) {
    lines.push(`# TYPE ${metricBaseName(metric)} gauge`);
    lines.push(`${metric} ${value}`);
  }
  for (const [metric, samples] of histograms.entries()) {
    lines.push(`# TYPE ${metricBaseName(metric)} histogram`);
    lines.push(...renderHistogram(metric, samples));
  }
  return `${lines.join("\n")}\n`;
}
