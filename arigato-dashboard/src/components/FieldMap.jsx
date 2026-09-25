import { LocateFixed, Loader2 } from "lucide-react";

const TILE = 256;
const GRID = 5; // 5x5 tiles around the centre tile
const PLOT_TARGET_PX = 130;

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

// Satellite view (Esri World Imagery) centred on the field, with the plot drawn to scale
export default function FieldMap({ lat, lon, acres, label, onLocate, locating }) {
  const sideMetres = Math.sqrt(Math.max(acres, 0.0005) * 4046.86);
  const metresPerPxZ0 = 156543.03 * Math.cos((lat * Math.PI) / 180);
  const zoom = Math.min(18, Math.max(13, Math.round(Math.log2((metresPerPxZ0 * PLOT_TARGET_PX) / sideMetres))));
  const sidePx = Math.min(240, Math.max(36, sideMetres / (metresPerPxZ0 / 2 ** zoom)));

  const { x, y } = lonLatToTile(lon, lat, zoom);
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const half = Math.floor(GRID / 2);
  const offsetX = (x - (tx - half)) * TILE;
  const offsetY = (y - (ty - half)) * TILE;

  const tiles = [];
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const tileX = tx - half + col;
      const tileY = ty - half + row;
      tiles.push(
        <img
          key={`${tileX}-${tileY}`}
          src={`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${tileY}/${tileX}`}
          alt=""
          draggable="false"
          style={{ left: col * TILE, top: row * TILE }}
        />
      );
    }
  }

  // Slightly irregular quadrilateral so it reads as a surveyed plot
  const h = sidePx / 2;
  const points = [
    [-h * 0.92, -h * 1.02],
    [h * 1.04, -h * 0.9],
    [h * 0.94, h * 1.02],
    [-h * 1.02, h * 0.92],
  ];
  const box = sidePx * 1.4;
  const c = box / 2;

  return (
    <div className="field-map">
      <div className="field-map-tiles" style={{ transform: `translate(${-offsetX}px, ${-offsetY}px)` }}>
        {tiles}
      </div>
      <svg className="field-map-plot" width={box} height={box} viewBox={`0 0 ${box} ${box}`}>
        <polygon
          points={points.map(([px, py]) => `${c + px},${c + py}`).join(" ")}
          className="plot-shape"
          transform={`rotate(-8 ${c} ${c})`}
        />
        {points.map(([px, py], i) => (
          <circle key={i} cx={c + px} cy={c + py} r="4" className="plot-vertex" transform={`rotate(-8 ${c} ${c})`} />
        ))}
      </svg>
      <span className="field-map-label">{label}</span>
      <button className="map-locate-btn" onClick={onLocate} disabled={locating}>
        {locating ? <Loader2 size={13} className="spin" /> : <LocateFixed size={13} />}
        {locating ? "Locating…" : "Use My Location"}
      </button>
      <span className="map-attribution">Imagery © Esri</span>
    </div>
  );
}
