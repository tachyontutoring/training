// Digital-SAT score prediction. The real exam scales each section to 200–800 and
// sums to a 400–1600 composite. We don't have the College Board equating tables,
// so we approximate: section score = 200 + accuracy × 600, rounded to the nearest
// 10 (the SAT reports in 10-point increments). A section with no answered
// questions floors at 200. This is an estimate, not an official concordance.
export interface PredictedScore {
  rw: number; // 200–800
  math: number; // 200–800
  total: number; // 400–1600
}

function scaleSection(correct: number, answered: number): number {
  const acc = answered > 0 ? correct / answered : 0;
  const raw = 200 + acc * 600;
  return Math.round(raw / 10) * 10;
}

export function predictedScore(
  rwCorrect: number,
  rwAnswered: number,
  mathCorrect: number,
  mathAnswered: number,
): PredictedScore {
  const rw = scaleSection(rwCorrect, rwAnswered);
  const math = scaleSection(mathCorrect, mathAnswered);
  return { rw, math, total: rw + math };
}
