import React from "react";
import { LOCATION_PRESETS } from "../services/weatherService";
import { MapPin, Maximize2, Sprout, Droplets, Sliders, RefreshCw } from "lucide-react";

export default function FarmerProfile({ farmerInput, onUpdateFarmerInput, onRefreshData, isRefreshing }) {
  const handleChange = (field, value) => {
    onUpdateFarmerInput({ ...farmerInput, [field]: value });
  };

  return (
    <div className="farmer-profile-card">
      <div className="profile-header">
        <div className="profile-title">
          <MapPin size={20} color="var(--green-bright)" />
          <h3>Farmer & Field Information</h3>
        </div>
        <button
          className="refresh-btn"
          onClick={onRefreshData}
          disabled={isRefreshing}
        >
          <RefreshCw size={14} className={isRefreshing ? "spin" : ""} />
          {isRefreshing ? "Fetching Locality API..." : "Update Locality Data"}
        </button>
      </div>

      <div className="profile-form-grid">
        {/* Location Select */}
        <div className="form-group">
          <label>
            <MapPin size={14} /> Location / Village / District
          </label>
          <select
            value={farmerInput.locationPreset}
            onChange={(e) => handleChange("locationPreset", e.target.value)}
          >
            {LOCATION_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}, {p.state} ({p.soilType})
              </option>
            ))}
          </select>
        </div>

        {/* Total Plot Size */}
        <div className="form-group">
          <label>
            <Maximize2 size={14} /> Total Land Size (Acres)
          </label>
          <input
            type="number"
            step="0.25"
            min="0.25"
            max="100"
            value={farmerInput.totalLandAcres}
            onChange={(e) => handleChange("totalLandAcres", parseFloat(e.target.value) || 1)}
          />
        </div>

        {/* Primary Conventional Crop */}
        <div className="form-group">
          <label>
            <Sprout size={14} /> Main Conventional Crop
          </label>
          <select
            value={farmerInput.primaryCrop}
            onChange={(e) => handleChange("primaryCrop", e.target.value)}
          >
            <option value="Paddy / Rice">Paddy (Rice)</option>
            <option value="Wheat">Wheat</option>
            <option value="Sugarcane">Sugarcane</option>
            <option value="Cotton">Cotton</option>
            <option value="Maize">Maize</option>
          </select>
        </div>

        {/* Irrigation Availability */}
        <div className="form-group">
          <label>
            <Droplets size={14} /> Irrigation Facility
          </label>
          <select
            value={farmerInput.irrigationType}
            onChange={(e) => handleChange("irrigationType", e.target.value)}
          >
            <option value="Drip Irrigation">Drip Irrigation (Micro-drip)</option>
            <option value="Sprinkler Irrigation">Sprinkler Irrigation</option>
            <option value="Borewell / Tube Well">Borewell / Tube Well</option>
            <option value="Canal / Flood">Canal / Flood</option>
            <option value="Rainfed">Rainfed (Seasonal)</option>
          </select>
        </div>
      </div>

      {/* High-Value Allocation Slider */}
      <div className="allocation-strip">
        <div className="allocation-header">
          <label>
            <Sliders size={14} /> Allocated Portion for Minor High-Value Crop:
          </label>
          <strong>
            {farmerInput.highValueLandAcres} Acre ({Math.round((farmerInput.highValueLandAcres / farmerInput.totalLandAcres) * 100)}% of total land)
          </strong>
        </div>
        <input
          type="range"
          min="0.1"
          max={Math.min(farmerInput.totalLandAcres, 5)}
          step="0.1"
          value={farmerInput.highValueLandAcres}
          onChange={(e) => handleChange("highValueLandAcres", parseFloat(e.target.value) || 0.1)}
        />
        <div className="allocation-note">
          <span>Conventional Crop ({farmerInput.primaryCrop}): {(farmerInput.totalLandAcres - farmerInput.highValueLandAcres).toFixed(2)} Acres</span>
          <span>High-Value Diversified Crop: {farmerInput.highValueLandAcres} Acre</span>
        </div>
      </div>
    </div>
  );
}
