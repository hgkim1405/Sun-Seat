export function resolveRollingStock(train, rollingStocks) {
  const code = train.trainGradeCode ? String(train.trainGradeCode) : null;
  const match = code ? rollingStocks.find((item) => item.id === code) : null;
  if (!match) {
    return {
      trainNumber: train.trainNumber,
      rollingStockType: train.trainGradeName ?? null,
      confidence: 'UNKNOWN',
      seatLayoutId: null,
      seatLayoutVariants: [],
      source: null,
    };
  }
  return {
    trainNumber: train.trainNumber,
    rollingStockType: match.displayName,
    confidence: 'CONFIRMED',
    seatLayoutId: match.layoutId ?? null,
    seatLayoutVariants: match.layoutVariants ?? [],
    source: match.sourceUrl ?? null,
  };
}
