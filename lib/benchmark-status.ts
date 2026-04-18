export type BenchmarkStatus = 'green' | 'orange' | 'red'

type BenchmarkThresholds = {
  target_percent?: number | null
  green_min?: number | null
  green_max?: number | null
  orange_min?: number | null
  orange_max?: number | null
  red_min?: number | null
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const num = Number(value)

  if (Number.isNaN(num)) {
    return null
  }

  return num
}

function isWithinRange(value: number, min: number | null, max: number | null) {
  const meetsMin = min === null || value >= min
  const meetsMax = max === null || value <= max
  return meetsMin && meetsMax
}

export function getBenchmarkStatus(
  actualPercent: number,
  benchmark: BenchmarkThresholds
): BenchmarkStatus {
  const greenMin = toNumberOrNull(benchmark.green_min)
  const greenMax = toNumberOrNull(benchmark.green_max)
  const orangeMin = toNumberOrNull(benchmark.orange_min)
  const orangeMax = toNumberOrNull(benchmark.orange_max)
  const redMin = toNumberOrNull(benchmark.red_min)
  const targetPercent = toNumberOrNull(benchmark.target_percent)

  if (greenMin !== null || greenMax !== null) {
    if (isWithinRange(actualPercent, greenMin, greenMax)) {
      return 'green'
    }
  }

  if (orangeMin !== null || orangeMax !== null) {
    if (isWithinRange(actualPercent, orangeMin, orangeMax)) {
      return 'orange'
    }
  }

  if (redMin !== null && actualPercent >= redMin) {
    return 'red'
  }

  if (targetPercent !== null) {
    if (actualPercent <= targetPercent) {
      return 'green'
    }

    return 'red'
  }

  return 'red'
}

export function getStatusLabel(status: BenchmarkStatus): string {
  if (status === 'green') {
    return 'On Track'
  }

  if (status === 'orange') {
    return 'Warning'
  }

  return 'Action Needed'
}

export function getStatusColors(status: BenchmarkStatus) {
  if (status === 'green') {
    return {
      background: '#dcfce7',
      text: '#166534',
      border: '#86efac',
    }
  }

  if (status === 'orange') {
    return {
      background: '#ffedd5',
      text: '#9a3412',
      border: '#fdba74',
    }
  }

  return {
    background: '#fee2e2',
    text: '#991b1b',
    border: '#fca5a5',
  }
}