import type { SVGProps } from "react";

const base = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Engine air filter — pleated cylinder seen from 3/4 */
export function AirFilterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.2" />
      <path d="M5 5.5v13c0 1.2 3.13 2.2 7 2.2s7-1 7-2.2v-13" />
      <path d="M7.5 6.5v12M10 7v12M12 7v12M14 7v12M16.5 6.5v12" />
    </svg>
  );
}

/** Stacked tires — one lying flat with one standing on top */
export function TireStackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      {/* standing tire (top) */}
      <circle cx="12" cy="8" r="4.2" />
      <circle cx="12" cy="8" r="1.6" />
      {/* lying tire (bottom, ellipse) */}
      <ellipse cx="12" cy="17" rx="8" ry="2.4" />
      <ellipse cx="12" cy="17" rx="3" ry="0.9" />
    </svg>
  );
}

/** Brake disc with caliper and pad */
export function BrakeDiscIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="12" r="7.5" />
      <circle cx="11" cy="12" r="2" />
      {/* vent slots */}
      <path d="M11 5.5v2M11 16.5v2M4.5 12h2M15.5 12h2M6.6 7.6l1.4 1.4M14 14l1.4 1.4M6.6 16.4 8 15M14 10l1.4-1.4" />
      {/* caliper hugging the right edge */}
      <path d="M16.5 8.5h2.2a1.3 1.3 0 0 1 1.3 1.3v4.4a1.3 1.3 0 0 1-1.3 1.3h-2.2" />
      {/* pad */}
      <path d="M16.8 10.5h1.6v3h-1.6z" />
    </svg>
  );
}
