export const inr = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

export const formatArea = (acres) => {
  if (acres >= 0.1) return `${Number(acres.toFixed(2))} acres`;
  return `${Math.round(acres * 43560).toLocaleString("en-IN")} sq ft`;
};

export const scoreTone = (score) => (score >= 85 ? "good" : score >= 70 ? "fair" : "poor");
