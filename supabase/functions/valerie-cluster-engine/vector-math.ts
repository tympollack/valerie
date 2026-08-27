/**
 * Project Valerie: Topic Clustering Engine — Vector Math Module
 * File: supabase/functions/valerie-cluster-engine/vector-math.ts
 *
 * Provides high-performance vector arithmetic, cosine distance calculations,
 * bivariate sentiment projections, running centroid updates, and bifurcation
 * geometry for dynamic topic clustering on a 1536-dimensional unit hypersphere.
 */

export const VECTOR_DIM = 1536;

/**
 * Computes the dot product of two vectors of identical dimensionality.
 */
export function dotProduct(a: number[] | Float64Array, b: number[] | Float64Array): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch in dot product: ${a.length} vs ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Computes the L2 (Euclidean) norm / magnitude of a vector.
 */
export function magnitude(a: number[] | Float64Array): number {
  let sumSq = 0;
  for (let i = 0; i < a.length; i++) {
    sumSq += a[i] * a[i];
  }
  return Math.sqrt(sumSq);
}

/**
 * Normalizes a vector to unit length (L2 norm = 1.0).
 * If the input vector is zero-length, returns a normalized default vector.
 */
export function l2Normalize(a: number[] | Float64Array): number[] {
  const mag = magnitude(a);
  if (mag < 1e-12) {
    const result = new Array(a.length).fill(0);
    result[0] = 1.0;
    return result;
  }
  const result = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] / mag;
  }
  return result;
}

/**
 * Computes Cosine Similarity between two vectors: (a . b) / (||a|| * ||b||).
 * Ranges from -1.0 to 1.0 (or 0.0 to 1.0 for positive-domain vectors).
 */
export function cosineSimilarity(a: number[] | Float64Array, b: number[] | Float64Array): number {
  const dot = dotProduct(a, b);
  const magA = magnitude(a);
  const magB = magnitude(b);
  if (magA < 1e-12 || magB < 1e-12) return 0;
  const sim = dot / (magA * magB);
  // Clamp to [-1, 1] to guard against floating-point precision inaccuracies
  return Math.max(-1, Math.min(1, sim));
}

/**
 * Computes Cosine Distance: 1.0 - cosineSimilarity(a, b).
 * Distance of 0.0 indicates identical direction; 1.0 indicates orthogonality; 2.0 indicates opposite direction.
 */
export function cosineDistance(a: number[] | Float64Array, b: number[] | Float64Array): number {
  return 1.0 - cosineSimilarity(a, b);
}

/**
 * Normalizes bivariate voting scores:
 * - likertScore in [-2, 2] -> normalizedLikert in [-1.0, 1.0]
 * - confidenceScore in [0, 100] -> normalizedConfidence in [0.0, 1.0]
 */
export function normalizeBivariateScores(
  likertScore: number,
  confidenceScore: number
): { normalizedLikert: number; normalizedConfidence: number } {
  const clampedLikert = Math.max(-2, Math.min(2, Math.round(likertScore)));
  const clampedConfidence = Math.max(0, Math.min(100, confidenceScore));

  return {
    normalizedLikert: clampedLikert / 2.0,           // [-1.0, 1.0]
    normalizedConfidence: clampedConfidence / 100.0, // [0.0, 1.0]
  };
}

/**
 * Combines a high-dimensional text embedding with bivariate sentiment scores.
 * Modulates the embedding vector by injecting confidence-weighted directional polarity,
 * followed by hyperspherical L2 normalization.
 */
export function combineEmbeddingWithBivariateScores(
  baseEmbedding: number[],
  likertScore: number,
  confidenceScore: number,
  sentimentWeight = 0.25
): number[] {
  if (baseEmbedding.length !== VECTOR_DIM) {
    throw new Error(`Expected embedding dimension ${VECTOR_DIM}, got ${baseEmbedding.length}`);
  }

  const { normalizedLikert, normalizedConfidence } = normalizeBivariateScores(likertScore, confidenceScore);
  const result = [...baseEmbedding];

  // Strong sentiment weighting: scale first 8 coordinate bases with bivariate characteristics
  const weightedPolarity = normalizedLikert * normalizedConfidence; // in [-1.0, 1.0]
  const confidenceFactor = normalizedConfidence;                    // in [0.0, 1.0]

  result[0] += sentimentWeight * weightedPolarity;
  result[1] += sentimentWeight * normalizedLikert;
  result[2] += sentimentWeight * confidenceFactor;
  result[3] += sentimentWeight * (weightedPolarity >= 0 ? 1 : -1) * Math.sqrt(Math.abs(weightedPolarity));

  // Modulate remaining components with harmonic sentiment dampening
  for (let i = 4; i < 16; i++) {
    const harmonic = (i % 2 === 0 ? 1 : -1) * (weightedPolarity / (i + 1));
    result[i] += sentimentWeight * 0.5 * harmonic;
  }

  return l2Normalize(result);
}

/**
 * Deterministic vector synthesizer for unit testing and offline fallback.
 * Derives a 1536-dimensional unit vector from input text + bivariate scores.
 */
export function synthesizeVectorFromScoresAndText(
  text: string,
  likertScore: number,
  confidenceScore: number,
  dim = VECTOR_DIM
): number[] {
  const { normalizedLikert, normalizedConfidence } = normalizeBivariateScores(likertScore, confidenceScore);
  const vec = new Array(dim).fill(0);

  // Seed deterministic pseudo-random sequence from text
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++) {
    seed ^= text.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }

  // Linear Congruential Generator (LCG)
  let state = seed >>> 0;
  for (let i = 0; i < dim; i++) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const randUniform = (state / 4294967296.0) * 2 - 1; // [-1, 1]
    vec[i] = randUniform;
  }

  // Inject bivariate sentiment features
  return combineEmbeddingWithBivariateScores(l2Normalize(vec), likertScore, confidenceScore);
}

/**
 * Incremental running centroid update on unit hypersphere:
 * c_new = normalize((N * c_old + v) / (N + 1))
 */
export function updateCentroid(
  currentCentroid: number[],
  currentCount: number,
  newVector: number[]
): number[] {
  if (currentCentroid.length !== newVector.length) {
    throw new Error("Dimension mismatch during centroid update");
  }
  const n = Math.max(1, currentCount);
  const updated = new Array(currentCentroid.length);
  for (let i = 0; i < currentCentroid.length; i++) {
    updated[i] = (n * currentCentroid[i] + newVector[i]) / (n + 1);
  }
  return l2Normalize(updated);
}

/**
 * Updates running variance of cosine distances within a cluster:
 * Welford-style incremental variance computation over cosine distances.
 */
export function calculateIncrementalVariance(
  currentVariance: number,
  currentDistance: number,
  currentCount: number
): number {
  if (currentCount <= 1) {
    return currentDistance * currentDistance * 0.5;
  }
  const n = currentCount;
  // Exponential moving average blend of variance
  const alpha = 2.0 / (n + 1.0);
  const squaredError = currentDistance * currentDistance;
  return (1 - alpha) * currentVariance + alpha * squaredError;
}

/**
 * Computes two bifurcated child centroids when variance threshold is exceeded.
 * Uses hyperspherical 2-branch bifurcation:
 * - Child A: Centroid anchored towards the outlier vector v (new emergent cluster mode).
 * - Child B: Centroid retaining the core parent mass c_P shifted away from outlier v.
 */
export function computeBifurcatedCentroids(
  parentCentroid: number[],
  outlierVector: number[],
  splitDelta = 0.35
): { childA: number[]; childB: number[] } {
  if (parentCentroid.length !== outlierVector.length) {
    throw new Error("Dimension mismatch during bifurcation calculation");
  }

  const pNorm = l2Normalize(parentCentroid);
  const vNorm = l2Normalize(outlierVector);
  const cosSim = cosineSimilarity(pNorm, vNorm);

  const dim = parentCentroid.length;
  const childA = new Array(dim);
  const childB = new Array(dim);

  // Weight for Child A: strongly biased towards outlier (e.g. 0.75 towards outlier)
  const alphaA = Math.max(0.4, Math.min(0.9, 0.5 + splitDelta * 0.5));
  
  for (let i = 0; i < dim; i++) {
    childA[i] = (1 - alphaA) * pNorm[i] + alphaA * vNorm[i];
  }

  // Orthogonal component of outlier relative to parent
  const vPerp = new Array(dim);
  for (let i = 0; i < dim; i++) {
    vPerp[i] = vNorm[i] - cosSim * pNorm[i];
  }
  const vPerpMag = magnitude(vPerp);

  if (vPerpMag > 1e-6) {
    const vPerpHat = l2Normalize(vPerp);
    const betaB = Math.max(0.2, Math.min(0.6, splitDelta));
    for (let i = 0; i < dim; i++) {
      childB[i] = pNorm[i] - betaB * vPerpHat[i];
    }
  } else {
    // If outlier is exactly antipodal or parallel
    for (let i = 0; i < dim; i++) {
      childB[i] = pNorm[i];
    }
  }

  return {
    childA: l2Normalize(childA),
    childB: l2Normalize(childB),
  };
}

