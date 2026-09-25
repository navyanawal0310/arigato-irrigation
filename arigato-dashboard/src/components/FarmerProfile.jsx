import { useState } from "react";
import { ArrowRight, MapPin } from "lucide-react";
import { LOCATION_PRESETS, getPreset, nearestPreset, presetLocation } from "../services/weatherService";
import { CONVENTIONAL_CROPS, LAND_UNITS, toAcres } from "../services/recommendationEngine";
import { PageHeader } from "./ui";
import FieldMap from "./FieldMap";

const IRRIGATION_OPTIONS = [
  { value: "available", label: "Available" },
  { value: "partial", label: "Partial" },
  { value: "none", label: "Not Available" },
];

const FARMING_TYPES = ["Open Field", "Polyhouse", "Shade Net", "Terrace / Kitchen Garden"];

export default function FarmerProfile({ farmerInput, onSave }) {
  const [draft, setDraft] = useState(farmerInput);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(null);
  const set = (field, value) => {
    setDraft((d) => ({ ...d, [field]: value }));
  };

  const acres = toAcres(draft.plotSize, draft.plotUnit);
  const sideFt = Math.sqrt(acres * 43560);

  // Derive map centre and preset reference from the new location object
  const loc = draft.location ?? presetLocation(LOCATION_PRESETS[0]);
  const preset = loc.presetId ? getPreset(loc.presetId) : nearestPreset(loc.lat, loc.lon);
  const center = { lat: loc.mapLat ?? loc.lat, lon: loc.mapLon ?? loc.lon };
  const areaLabel = `${Number(draft.plotSize).toLocaleString("en-IN")} ${LAND_UNITS[draft.plotUnit].label}`;

  const locate = () => {
    if (!navigator.geolocation) {
      setLocateError("Location is not supported by this browser.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const near = nearestPreset(pos.coords.latitude, pos.coords.longitude);
        setDraft((d) => ({
          ...d,
          location: {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            mapLat: pos.coords.latitude,
            mapLon: pos.coords.longitude,
            name: `Near ${near.name}`,
            state: near.state,
            source: "gps",
          },
        }));
        setLocating(false);
      },
      (err) => {
        setLocateError(err.code === 1 ? "Location permission was denied." : "Could not get your location.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const locationDisplay = loc.source === "gps" ? `My Field (near ${preset.name})` : loc.name ? `${loc.name}, ${loc.state || ""}` : `${preset.name}, ${preset.state}`;

  return (
    <div className="page">
      <PageHeader title="Farmer & Land Profile" subtitle="Enter your farm details to get personalized recommendations" />

      <div className="card profile-card">
        <div className="profile-form">
          <div className="field">
            <label htmlFor="loc">Location</label>
            <div className="input-icon">
              <MapPin size={16} className="text-green" />
              <select
                id="loc"
                value={loc.presetId ?? "custom"}
                onChange={(e) => {
                  if (e.target.value === "custom") return;
                  setDraft((d) => ({ ...d, location: presetLocation(getPreset(e.target.value)) }));
                }}
              >
                {!loc.presetId && <option value="custom">{locationDisplay}</option>}
                {LOCATION_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}, {p.state}</option>
                ))}
              </select>
            </div>
            {locateError && <span className="field-error">{locateError}</span>}
          </div>

          <div className="field">
            <label htmlFor="plot">Plot Size</label>
            <div className="input-pair">
              <input
                id="plot"
                type="number"
                min="0"
                step="any"
                value={draft.plotSize}
                onChange={(e) => set("plotSize", Math.max(0, parseFloat(e.target.value) || 0))}
              />
              <select value={draft.plotUnit} onChange={(e) => set("plotUnit", e.target.value)} aria-label="Unit">
                {Object.entries(LAND_UNITS).map(([key, u]) => (
                  <option key={key} value={key}>{u.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="crop">Current / Main Crop</label>
            <select id="crop" value={draft.primaryCrop} onChange={(e) => set("primaryCrop", e.target.value)}>
              {Object.entries(CONVENTIONAL_CROPS).map(([key, c]) => (
                <option key={key} value={key}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Irrigation Availability</label>
            <div className="radio-row" role="radiogroup">
              {IRRIGATION_OPTIONS.map((o) => (
                <label key={o.value} className={`radio ${draft.irrigation === o.value ? "checked" : ""}`}>
                  <input
                    type="radio"
                    name="irrigation"
                    value={o.value}
                    checked={draft.irrigation === o.value}
                    onChange={() => set("irrigation", o.value)}
                  />
                  <span className="radio-dot" />
                  {o.label}
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="ftype">Farming Type</label>
            <select id="ftype" value={draft.farmingType} onChange={(e) => set("farmingType", e.target.value)}>
              {FARMING_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>

          <button className="btn btn-primary btn-block" onClick={() => onSave(draft)} disabled={!acres}>
            Save & Continue <ArrowRight size={16} />
          </button>
        </div>

        <div className="profile-map">
          <FieldMap
            lat={center.lat}
            lon={center.lon}
            acres={acres}
            label={areaLabel}
            onLocate={locate}
            locating={locating}
          />
          <div className="map-stats">
            <div>
              <strong>{acres < 10 ? acres.toFixed(3) : acres.toFixed(1)}</strong>
              <span>Acres</span>
            </div>
            <div>
              <strong>{Math.round(sideFt).toLocaleString("en-IN")} × {Math.round(sideFt).toLocaleString("en-IN")} ft</strong>
              <span>Approx. Dimensions</span>
            </div>
            <div>
              <strong>{draft.farmingType}</strong>
              <span>Farm Type</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
