// Recommendation Engine for KRISHI SETU
// Evaluates agronomic suitability for minor/high-value crops based on locality API data and optional hardware sensor feeds.

export const MINOR_HIGH_VALUE_CROPS = [
  {
    id: "capsicum",
    name: "Capsicum (Bell Pepper)",
    kannadaName: "ಕ್ಯಾಪ್ಸಿಕಂ (ದೊಣ್ಣೆ ಮೆಣಸಿನಕಾಯಿ)",
    scientificName: "Capsicum annuum",
    icon: "🫑",
    category: "High Return Premium Vegetable",
    idealTempMin: 18,
    idealTempMax: 30,
    idealHumidityMin: 45,
    idealHumidityMax: 75,
    preferredSoils: ["Red Loamy Soil", "Black Cotton Soil", "Medium Black Soil", "Alluvial Loam Soil"],
    waterReqMm: "450 - 550 mm",
    waterReqLevel: "Moderate (Drip Ideal)",
    growingPeriodDays: "90 - 110 days",
    harvestWindow: "Multiple picks over 60 days",
    potentialRevenueCategory: "High Return",
    yieldPerAcreKg: 12000,
    avgMarketPricePerKg: 45,
    cultivationCostPerAcre: 180000,
    grossRevenuePerAcre: 540000,
    netReturnPerAcre: 360000,
    reasonTemplate: "Locality temperature ({temp}°C) and soil drainage ({soil}) provide ideal canopy development conditions with drip irrigation.",
    whySuitable: [
      "Current ambient temperature falls squarely within the 18°C–30°C optimal photosynthetic range.",
      "Soil profile supports robust root penetration and avoids waterlogging.",
      "High market demand in urban APMC mandis ensures strong farmgate pricing.",
      "Inter-cropping or dedicated 0.25–0.5 acre allocation yields quick cash flow."
    ],
    climateCompatibility: "Requires mild to warm temperatures with protection from excessive heavy downpours.",
    soilCompatibility: "Well-drained sandy loam or red loamy soil with pH 6.0 - 7.0.",
    waterGuidance: "Drip irrigation at 2.5 - 3.5 liters/plant/day during fruiting stage.",
    fertilizerSchedule: "Basal: 50kg N, 60kg P, 50kg K per acre. Fertigation with 19-19-19 water soluble every 4 days.",
    pestDefense: "Watch for Thrips and Aphids. Spray Neem Seed Kernel Extract (NSKE 5%) or installation of yellow sticky traps.",
    harvestingInfo: "Harvest when fruits achieve firm, glossy skin at full size (green or colored phase).",
  },
  {
    id: "strawberry",
    name: "Strawberry",
    kannadaName: "ಸ್ಟ್ರಾಬೆರಿ",
    scientificName: "Fragaria × ananassa",
    icon: "🍓",
    category: "Exotic High-Value Fruit",
    idealTempMin: 14,
    idealTempMax: 26,
    idealHumidityMin: 40,
    idealHumidityMax: 70,
    preferredSoils: ["Red Loamy Soil", "Mountain Brown Soil", "Medium Black Soil"],
    waterReqMm: "350 - 450 mm",
    waterReqLevel: "Moderate (Raised Beds + Drip)",
    growingPeriodDays: "75 - 90 days to first harvest",
    harvestWindow: "Continuous harvest over 3-4 months",
    potentialRevenueCategory: "Premium Exotic Market",
    yieldPerAcreKg: 8000,
    avgMarketPricePerKg: 120,
    cultivationCostPerAcre: 250000,
    grossRevenuePerAcre: 960000,
    netReturnPerAcre: 710000,
    reasonTemplate: "Cool night temperatures ({temp}°C locality) and well-drained soil favor high brix fruit formation and rapid crown growth.",
    whySuitable: [
      "Sub-tropical or elevated hill climate triggers early flowering and intense sweetness.",
      "Mulched raised-bed cultivation conserves soil moisture and prevents fruit rotting.",
      "Exceptional profit margin per square foot compared to conventional grain crops.",
      "Drip fertigation compatibility reduces water loss by up to 40%."
    ],
    climateCompatibility: "Thrives in cool to moderate climates. Sensitive to severe frost or temperatures exceeding 32°C.",
    soilCompatibility: "Deep, fertile sandy loam rich in organic matter. pH 5.8 - 6.5 preferred.",
    waterGuidance: "Frequent light drip applications. Avoid overhead watering to protect delicate berries.",
    fertilizerSchedule: "Incorporate 10 tonnes well-rotted FYM basal. Apply Calcium Nitrate & Potassium Nitrate fertigation weekly.",
    pestDefense: "Susceptible to Powdery Mildew and Crown Rot. Ensure raised bed drainage & Trichoderma viride soil application.",
    harvestingInfo: "Pick when 3/4th of the berry surface turns bright red with calyx attached.",
  },
  {
    id: "tomato",
    name: "Hybrid Tomato",
    kannadaName: "ಟೊಮೆಟೊ",
    scientificName: "Solanum lycopersicum",
    icon: "🍅",
    category: "High Yield Cash Crop",
    idealTempMin: 18,
    idealTempMax: 32,
    idealHumidityMin: 40,
    idealHumidityMax: 80,
    preferredSoils: ["Red Loamy Soil", "Black Cotton Soil", "Alluvial Loam Soil", "Medium Black Soil"],
    waterReqMm: "500 - 650 mm",
    waterReqLevel: "Moderate to High",
    growingPeriodDays: "100 - 120 days",
    harvestWindow: "8 - 10 pickings over 45 days",
    potentialRevenueCategory: "High Volume Cash Crop",
    yieldPerAcreKg: 22000,
    avgMarketPricePerKg: 22,
    cultivationCostPerAcre: 140000,
    grossRevenuePerAcre: 484000,
    netReturnPerAcre: 344000,
    reasonTemplate: "Strong agro-climatic match with local temperature ({temp}°C) and soil pH for rapid fruit set and high tonnage yield.",
    whySuitable: [
      "Consistent regional demand across local APMC markets throughout the year.",
      "Indeterminate hybrid varieties offer prolonged harvest windows.",
      "Excellent response to drip irrigation and plastic mulching.",
      "Ideal candidate to diversify 0.5 acre for steady weekly cash flow."
    ],
    climateCompatibility: "Warm sunny days with moderate humidity. Optimal daytime 22-28°C.",
    soilCompatibility: "Deep loamy soil with high organic matter and good water retention.",
    waterGuidance: "Maintain uniform soil moisture. Avoid soil moisture fluctuations during fruit development to prevent blossom end rot.",
    fertilizerSchedule: "NPK 60:80:60 kg/acre basal. Weekly Micronutrient spray (Boron & Zinc).",
    pestDefense: "Fruit Borer & Early Blight risks. Use pheromone traps & Copper Oxychloride spray.",
    harvestingInfo: "Harvest at breaker stage for long-distance transport or red ripe for local mandis.",
  },
  {
    id: "mint",
    name: "Mint / Pudina",
    kannadaName: "ಪುದೀನಾ",
    scientificName: "Mentha arvensis",
    icon: "🌿",
    category: "Quick Turnaround Aromatic Crop",
    idealTempMin: 15,
    idealTempMax: 35,
    idealHumidityMin: 50,
    idealHumidityMax: 85,
    preferredSoils: ["Red Loamy Soil", "Alluvial Loam Soil", "Black Cotton Soil", "Red Laterite Soil"],
    waterReqMm: "400 - 500 mm",
    waterReqLevel: "Frequent Light Watering",
    growingPeriodDays: "45 - 60 days (First Cut)",
    harvestWindow: "Cut every 35-40 days (3 cuts total)",
    potentialRevenueCategory: "Fast Cash Turnaround",
    yieldPerAcreKg: 9000,
    avgMarketPricePerKg: 30,
    cultivationCostPerAcre: 60000,
    grossRevenuePerAcre: 270000,
    netReturnPerAcre: 210000,
    reasonTemplate: "Quick 45-day maturity cycle compatible with locality rainfall ({rainfall}mm) and flexible irrigation setups.",
    whySuitable: [
      "Fastest payback period (first harvest in 45-50 days after stolon planting).",
      "Multiple cuttings per single planting reduce seed cost.",
      "Low capital intensity makes it low-risk for smallholder farmers.",
      "High local retail demand in culinary & essential oil markets."
    ],
    climateCompatibility: "Adaptable to warm tropical and sub-tropical conditions with adequate soil moisture.",
    soilCompatibility: "Moist, fertile loamy soil with rich humus content.",
    waterGuidance: "Requires light frequent irrigation every 3-4 days to maintain vegetative lushness.",
    fertilizerSchedule: "Top dress Nitrogen (Urea) after every harvest to boost foliage re-growth.",
    pestDefense: "Rust and Leaf Roller. Maintain spacing and apply Neem oil 3ml/L.",
    harvestingInfo: "Cut stolons 2cm above soil level when leaves show rich aroma and before flowering.",
  },
  {
    id: "dragonfruit",
    name: "Dragonfruit (Pitaya)",
    kannadaName: "ಡ್ರಾಗನ್ ಫ್ರೂಟ್",
    scientificName: "Hylocereus undatus",
    icon: "🌵",
    category: "Perennial High Margin Fruit",
    idealTempMin: 20,
    idealTempMax: 38,
    idealHumidityMin: 35,
    idealHumidityMax: 70,
    preferredSoils: ["Red Loamy Soil", "Medium Black Soil", "Sandy Loam", "Red Laterite Soil"],
    waterReqMm: "250 - 350 mm",
    waterReqLevel: "Very Low (Drought Tolerant)",
    growingPeriodDays: "120 - 150 days (Seasonal Harvest)",
    harvestWindow: "Productive for 20+ years",
    potentialRevenueCategory: "Long-Term High Equity",
    yieldPerAcreKg: 6000,
    avgMarketPricePerKg: 140,
    cultivationCostPerAcre: 220000,
    grossRevenuePerAcre: 840000,
    netReturnPerAcre: 620000,
    reasonTemplate: "Drought-resilient cactus crop ideal for low rainfall locality ({rainfall}mm) and well-drained soil.",
    whySuitable: [
      "Extremely drought tolerant — requires 60% less water than sugarcane or paddy.",
      "Perennial crop with 20+ years of active fruiting lifetime.",
      "Premium pricing in supermarkets and urban direct-to-consumer outlets.",
      "Minimal pesticide requirement due to tough waxy cladodes."
    ],
    climateCompatibility: "Enjoys warm sunshine. Can withstand temperatures up to 40°C.",
    soilCompatibility: "Well-drained sandy loam or gravelly soil. Highly intolerant to water stagnation.",
    waterGuidance: "Drip irrigation 1-2 liters per pole every 4 days.",
    fertilizerSchedule: "Organic compost + Neem cake + 20-20-20 NPK balance twice per year.",
    pestDefense: "Ants and Stem Rot. Keep pole base weed-free and well-drained.",
    harvestingInfo: "Pick 30-35 days after flowering when fruit skin turns fully pink/red.",
  },
  {
    id: "zucchini",
    name: "Exotic Zucchini / Broccoli",
    kannadaName: "ಜುಚಿನಿ ಮತ್ತು ಬ್ರೊಕೊಲಿ",
    scientificName: "Cucurbita pepo / Brassica oleracea",
    icon: "🥦",
    category: "Short Duration Gourmet Veg",
    idealTempMin: 15,
    idealTempMax: 28,
    idealHumidityMin: 45,
    idealHumidityMax: 75,
    preferredSoils: ["Red Loamy Soil", "Mountain Brown Soil", "Alluvial Loam Soil"],
    waterReqMm: "350 - 450 mm",
    waterReqLevel: "Moderate Drip",
    growingPeriodDays: "55 - 70 days",
    harvestWindow: "Every 2 days for 4 weeks",
    potentialRevenueCategory: "High Margin Gourmet",
    yieldPerAcreKg: 10000,
    avgMarketPricePerKg: 55,
    cultivationCostPerAcre: 110000,
    grossRevenuePerAcre: 550000,
    netReturnPerAcre: 440000,
    reasonTemplate: "Moderate climate ({temp}°C) and fertile loamy soil enable rapid growth and tender head development.",
    whySuitable: [
      "Short crop duration of 60 days allows 2 to 3 crop cycles per year.",
      "High profit density — ideal for 0.25 acre diversification.",
      "Growing supermarket and hotel industry contract farming demand.",
      "Lower water footprint than conventional grain crops."
    ],
    climateCompatibility: "Prefers mild cool-to-warm conditions without extreme heat spikes.",
    soilCompatibility: "Rich loamy soil with pH 6.0 - 7.5 and high humus content.",
    waterGuidance: "Drip irrigation at 2 liters/plant every alternate day.",
    fertilizerSchedule: "High Nitrogen and Potassium requirement. Fertigate Calcium Nitrate during curd formation.",
    pestDefense: "Diamondback Moth and Downy Mildew. Biological control with Bacillus thuringiensis (Bt).",
    harvestingInfo: "Harvest compact green heads before flower buds begin to open.",
  }
];


// Soil classes the engine understands — Gemini soil analysis is constrained to this list
export const SOIL_TYPES = [
  "Red Loamy Soil",
  "Red Laterite Soil",
  "Black Cotton Soil",
  "Medium Black Soil",
  "Alluvial Loam Soil",
  "Mountain Brown Soil",
  "Sandy Loam",
];

// Compact display metadata used by cards, comparison table and charts
export const CROP_DISPLAY = {
  capsicum: { shortName: "Capsicum", accent: "#16a34a", duration: "4 – 5 months", water: "Medium", revenue: "High", demand: "High" },
  strawberry: { shortName: "Strawberry", accent: "#e11d48", duration: "4 – 6 months", water: "Medium", revenue: "High", demand: "High" },
  tomato: { shortName: "Tomato", accent: "#ea580c", duration: "3 – 4 months", water: "High", revenue: "Medium", demand: "Very High" },
  mint: { shortName: "Mint", accent: "#0d9488", duration: "2 – 3 months", water: "Low", revenue: "High", demand: "Medium" },
  dragonfruit: { shortName: "Dragonfruit", accent: "#c026d3", duration: "4 – 5 months", water: "Low", revenue: "High", demand: "Medium" },
  zucchini: { shortName: "Zucchini", accent: "#65a30d", duration: "2 – 3 months", water: "Medium", revenue: "High", demand: "Medium" },
};

export const CONVENTIONAL_CROPS = {
  "Paddy / Rice": { netPerAcre: 35000, name: "Rice (Paddy)" },
  Wheat: { netPerAcre: 30000, name: "Wheat" },
  Sugarcane: { netPerAcre: 65000, name: "Sugarcane" },
  Cotton: { netPerAcre: 40000, name: "Cotton" },
  Maize: { netPerAcre: 28000, name: "Maize" },
  Ragi: { netPerAcre: 26000, name: "Ragi (Finger Millet)" },
};

export const LAND_UNITS = {
  acre: { label: "acres", toAcres: 1 },
  sqft: { label: "sq ft", toAcres: 1 / 43560 },
  guntha: { label: "guntha", toAcres: 1 / 40 },
  hectare: { label: "hectares", toAcres: 2.47105 },
};

export function toAcres(size, unit) {
  return (Number(size) || 0) * (LAND_UNITS[unit]?.toAcres ?? 1);
}

// Crops that need a lot of water lose points when irrigation is limited
const WATER_NEED = { Low: 0, Medium: 1, High: 2 };
const IRRIGATION_POINTS = {
  available: [15, 15, 15],
  partial: [14, 10, 5],
  none: [12, 5, 0],
};

export function evaluateSuitability({ farmerInput, localityData, sensorData = null, aiInsights = null }) {
  const {
    plotSize = 2,
    plotUnit = "acre",
    minorSharePercent = 25,
    primaryCrop = "Paddy / Rice",
    irrigation = "available",
  } = farmerInput || {};
  const { temp = 27, humidity = 65, rainfall = 5, soilType = "Red Loamy Soil" } = localityData || {};

  const totalLand = Math.max(toAcres(plotSize, plotUnit), 0.001);
  const hvLand = totalLand * (minorSharePercent / 100);
  const convLand = totalLand - hvLand;
  const convInfo = CONVENTIONAL_CROPS[primaryCrop] || CONVENTIONAL_CROPS["Paddy / Rice"];
  const conventionalOnlyIncome = Math.round(totalLand * convInfo.netPerAcre);
  const moisture = sensorData?.moisture_index;
  const aiScores = new Map((aiInsights?.cropScores ?? []).map((s) => [s.id, s]));

  const evaluatedCrops = MINOR_HIGH_VALUE_CROPS.map((crop) => {
    const display = CROP_DISPLAY[crop.id];
    let score = 30;
    const factors = {};

    // Temperature (25 pts)
    let tempPts = 25;
    if (temp < crop.idealTempMin || temp > crop.idealTempMax) {
      const diff = Math.min(Math.abs(temp - crop.idealTempMin), Math.abs(temp - crop.idealTempMax));
      tempPts = Math.max(0, 25 - diff * 4);
    }
    score += tempPts;
    factors.climate = tempPts >= 20 ? "Good" : tempPts >= 10 ? "Fair" : "Poor";

    // Soil (20 pts)
    const matchesSoil = crop.preferredSoils.includes(soilType);
    score += matchesSoil ? 20 : 8;
    factors.soil = matchesSoil ? "Good" : "Fair";

    // Water availability vs crop need (15 pts)
    const waterPts = (IRRIGATION_POINTS[irrigation] || IRRIGATION_POINTS.available)[WATER_NEED[display.water] ?? 1];
    score += waterPts;
    factors.water = waterPts >= 14 ? "Good" : waterPts >= 8 ? "Fair" : "Poor";

    // Humidity (10 pts)
    const humidOk = humidity >= crop.idealHumidityMin && humidity <= crop.idealHumidityMax;
    score += humidOk ? 10 : 4;

    // Mode 2: live soil moisture refines the score
    let sensorPrecisionApplied = false;
    if (typeof moisture === "number") {
      sensorPrecisionApplied = true;
      if (moisture >= 35 && moisture <= 75) score += 3;
      else if (moisture < 20 && display.water === "High") score -= 6;
    }

    // Blend in Gemini's location-specific judgement when available
    const ai = aiScores.get(crop.id);
    const ruleScore = Math.round(score) - 5;
    const blended = ai ? 0.6 * ruleScore + 0.4 * ai.score : ruleScore;
    const suitabilityScore = Math.min(97, Math.max(40, Math.round(blended)));
    let suitabilityLevel = "Moderate Match";
    if (suitabilityScore >= 85) suitabilityLevel = "High Match";
    else if (suitabilityScore < 70) suitabilityLevel = "Low Match";

    const reason =
      ai?.reason ??
      crop.reasonTemplate.replace("{temp}", temp).replace("{soil}", soilType).replace("{rainfall}", rainfall);

    const estCultivationCost = Math.round(crop.cultivationCostPerAcre * hvLand);
    const estGrossRevenue = Math.round(crop.grossRevenuePerAcre * hvLand);
    const estNetReturn = Math.round(crop.netReturnPerAcre * hvLand);
    const estYieldKg = Math.round(crop.yieldPerAcreKg * hvLand);
    const diversifiedIncome = Math.round(convLand * convInfo.netPerAcre + estNetReturn);

    return {
      ...crop,
      ...display,
      suitabilityScore,
      suitabilityLevel,
      factors,
      reason,
      allocatedAcres: Number(hvLand.toFixed(3)),
      estCultivationCost,
      estGrossRevenue,
      estNetReturn,
      estYieldKg,
      diversifiedIncome,
      additionalRevenue: diversifiedIncome - conventionalOnlyIncome,
      sensorPrecisionApplied,
      aiScore: ai?.score ?? null,
    };
  });

  evaluatedCrops.sort((a, b) => b.suitabilityScore - a.suitabilityScore || b.estNetReturn - a.estNetReturn);

  const topCrop = evaluatedCrops[0];
  const additionalRevenue = Math.max(0, topCrop.additionalRevenue);
  const percentageBoost = Math.round((additionalRevenue / (conventionalOnlyIncome || 1)) * 100);

  return {
    recommendations: evaluatedCrops,
    topRecommendation: topCrop,
    economics: {
      totalLand,
      hvLand,
      convLand,
      primaryCrop: convInfo.name,
      conventionalOnlyIncome,
      diversifiedIncome: topCrop.diversifiedIncome,
      additionalRevenue,
      percentageBoost,
    },
  };
}
