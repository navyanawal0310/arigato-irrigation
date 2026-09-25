import { useState } from "react";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
} from "lucide-react";

export function PageHeader({ title, subtitle, right }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {right && <div className="page-header-right">{right}</div>}
    </div>
  );
}

// tone: good | fair | poor | info | neutral
export function Chip({ tone = "neutral", children }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function WeatherIcon({ code = 0, size = 22 }) {
  if (code === 0) return <Sun size={size} className="wx wx-sun" />;
  if (code <= 2) return <CloudSun size={size} className="wx wx-sun" />;
  if (code === 3) return <Cloud size={size} className="wx wx-cloud" />;
  if (code <= 48) return <CloudFog size={size} className="wx wx-cloud" />;
  if (code <= 57) return <CloudDrizzle size={size} className="wx wx-rain" />;
  if (code <= 67 || (code >= 80 && code <= 82)) return <CloudRain size={size} className="wx wx-rain" />;
  if (code <= 77) return <CloudSnow size={size} className="wx wx-cloud" />;
  return <CloudLightning size={size} className="wx wx-rain" />;
}

// Shows /crops/<id>.jpg when present in public/, otherwise a tinted emoji tile
export function CropImage({ crop, className = "" }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`crop-image ${className}`} style={{ "--accent": crop.accent }}>
      {!failed ? (
        <img src={`/crops/${crop.id}.jpg`} alt={crop.shortName} onError={() => setFailed(true)} />
      ) : (
        <span className="crop-image-emoji" aria-hidden="true">{crop.icon}</span>
      )}
    </div>
  );
}
