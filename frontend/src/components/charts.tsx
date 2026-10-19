// Yengil, kutubxonasiz SVG chart komponentlari (mavzuga moslashuvchan).
// Ranglar CSS o'zgaruvchilari orqali (light/dark) — dataviz uslubiga mos.
import { useId } from "react";
import { Icon, type IconName } from "./Icon";

// ---------- Stat tile (ikonka-chip + sarlavha tepada, katta raqam pastda) ----------
export function StatTile({
  value,
  label,
  icon,
  unit,
  accent,
}: {
  value: string | number;
  label: string;
  icon?: IconName;
  unit?: string;
  accent?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-card-head">
        {icon && (
          <span className="stat-card-chip" style={accent ? { color: accent } : undefined}>
            <Icon name={icon} size={18} />
          </span>
        )}
        <span className="stat-card-lbl">{label}</span>
      </div>
      <div className="stat-card-num">
        {value}
        {unit && <span className="stat-card-unit">{unit}</span>}
      </div>
    </div>
  );
}

// ---------- Chiziqli (line/area) chart — bir yoki ko'p seriya ----------
export interface Series {
  name: string;
  color: string;
  points: number[];
}
export function LineChart({
  series,
  labels,
  height = 220,
}: {
  series: Series[];
  labels: string[];
  height?: number;
}) {
  const W = 640;
  const H = height;
  const padL = 34;
  const padR = 14;
  const padT = 14;
  const padB = 26;
  const n = labels.length;
  const uid = useId();

  const allVals = series.flatMap((s) => s.points);
  const maxV = Math.max(1, ...allVals);
  const niceMax = niceCeil(maxV);

  const x = (i: number) => padL + (n <= 1 ? 0 : (i * (W - padL - padR)) / (n - 1));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / niceMax);

  const yTicks = 4;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => (niceMax / yTicks) * i);

  // X o'qi belgilar (ko'pi bilan 6 ta)
  const step = Math.max(1, Math.ceil(n / 6));

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img">
        {/* Gridlines + y belgilar */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} className="chart-gridline" />
            <text x={padL - 6} y={y(t) + 3} className="chart-axis-txt" textAnchor="end">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {/* X belgilar */}
        {labels.map((lb, i) =>
          i % step === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={H - 8} className="chart-axis-txt" textAnchor="middle">
              {lb}
            </text>
          ) : null
        )}
        {/* Seriya maydoni + chizig'i */}
        {series.map((s, si) => {
          const line = s.points.map((v, i) => `${x(i)},${y(v)}`).join(" ");
          const area = `${padL},${y(0)} ${line} ${x(n - 1)},${y(0)}`;
          return (
            <g key={si}>
              <polygon points={area} fill={s.color} opacity={0.1} />
              <polyline points={line} fill="none" stroke={s.color} strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round" />
              {s.points.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={9} fill="transparent">
                  <title>{`${labels[i]} · ${s.name}: ${v}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} className="chart-axis" />
      </svg>
      {series.length >= 1 && (
        <div className="chart-legend">
          {series.map((s) => (
            <span key={s.name} className="legend-item">
              <span className="legend-swatch" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <span className="sr-only" id={uid} />
    </div>
  );
}

// ---------- Gorizontal bar chart (bitta yoki segmentli) ----------
export interface HBarRow {
  label: string;
  color: string;
  value: number;
  // ixtiyoriy: segmentli (masalan bajarilgan/qolgan)
  segments?: { value: number; color: string; name: string }[];
}
export function HBarChart({ rows, unit = "" }: { rows: HBarRow[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.segments ? r.segments.reduce((a, b) => a + b.value, 0) : r.value));
  return (
    <div className="hbar-chart">
      {rows.map((r) => {
        const total = r.segments ? r.segments.reduce((a, b) => a + b.value, 0) : r.value;
        return (
          <div key={r.label} className="hbar-row">
            <span className="hbar-label" title={r.label}>{r.label}</span>
            <div className="hbar-track">
              {r.segments ? (
                r.segments.map((seg, i) => (
                  <div
                    key={i}
                    className="hbar-fill seg"
                    style={{ width: `${(seg.value / max) * 100}%`, background: seg.color }}
                    title={`${seg.name}: ${seg.value}`}
                  />
                ))
              ) : (
                <div
                  className="hbar-fill"
                  style={{ width: `${(r.value / max) * 100}%`, background: r.color }}
                  title={`${r.label}: ${r.value}${unit}`}
                />
              )}
            </div>
            <span className="hbar-val">{total}{unit}</span>
          </div>
        );
      })}
      {rows.length === 0 && <div className="empty">Ma'lumot yo'q</div>}
    </div>
  );
}

// ---------- Donut chart ----------
export function Donut({
  data,
  centerLabel,
  centerValue,
}: {
  data: { label: string; value: number; color: string }[];
  centerLabel: string;
  centerValue: string | number;
}) {
  const total = data.reduce((a, b) => a + b.value, 0);
  const R = 60;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const cx = 80;
  const cy = 80;

  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 160 160" className="donut-svg" role="img">
        <circle cx={cx} cy={cy} r={R} className="donut-bg" fill="none" strokeWidth={20} />
        {total > 0 &&
          data.map((d, i) => {
            const frac = d.value / total;
            const dash = frac * C;
            const el = (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={R}
                fill="none"
                stroke={d.color}
                strokeWidth={20}
                strokeDasharray={`${Math.max(0, dash - 2)} ${C - Math.max(0, dash - 2)}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${cx} ${cy})`}
              >
                <title>{`${d.label}: ${d.value} (${Math.round(frac * 100)}%)`}</title>
              </circle>
            );
            offset += dash;
            return el;
          })}
        <text x={cx} y={cy - 4} className="donut-center-num" textAnchor="middle">
          {centerValue}
        </text>
        <text x={cx} y={cy + 14} className="donut-center-lbl" textAnchor="middle">
          {centerLabel}
        </text>
      </svg>
      <div className="chart-legend col">
        {data.map((d) => (
          <span key={d.label} className="legend-item">
            <span className="legend-swatch" style={{ background: d.color }} />
            {d.label}
            <span className="legend-val">{d.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- Vertikal ustunli chart (masalan hafta kunlari) ----------
export function ColumnChart({
  data,
  color,
}: {
  data: { label: string; value: number }[];
  color: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="col-chart">
      {data.map((d) => (
        <div key={d.label} className="col-item" title={`${d.label}: ${d.value}`}>
          <div className="col-bar-area">
            <div className="col-val">{d.value || ""}</div>
            <div
              className="col-bar"
              style={{ height: `${(d.value / max) * 100}%`, background: color }}
            />
          </div>
          <div className="col-label">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

function niceCeil(v: number): number {
  if (v <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}
