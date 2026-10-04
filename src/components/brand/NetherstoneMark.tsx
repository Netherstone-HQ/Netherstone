import { useId, type SVGProps } from "react";

// The stone is drawn on a 2:1 grid as four flat faces that each paint
// their own outer edge exactly once, so small sizes keep clean
// anti-aliasing. An inset copy of the silhouette sits underneath to
// fill the seams between faces without reaching the outer edge.
export const SILHOUETTE =
  "M30.75 10.13Q32 9.5 33.25 10.13L54.11 20.55Q55 21 54.83 21.99L51 44Q50.71 45.64 49 46.5L33.25 54.37Q32 55 30.75 54.37L22.2 50.1Q20.8 49.4 20 48L11.89 33.8Q11 32.3 10.79 31L9.18 21.98Q9 21 9.89 20.55Z";
export const LEFT =
  "M9.26 21.13L25 29L32 38V54.69Q31.38 54.69 30.75 54.37L22.2 50.1Q20.8 49.4 20 48L11.89 33.8Q11 32.3 10.79 31L9.18 21.98Q9.09 21.49 9.26 21.13Z";
export const RIGHT =
  "M54.74 21.13Q54.92 21.5 54.83 21.99L51 44Q50.71 45.64 49 46.5L33.25 54.37Q32.63 54.69 32 54.69V38L39 29Z";
export const TOP =
  "M30.75 10.13Q32 9.5 33.25 10.13L54.11 20.55Q54.56 20.78 54.74 21.13L39 29L32 38L25 29L9.26 21.13Q9.45 20.78 9.89 20.55Z";
export const FACET = "M25 29H39L32 38Z";

export const BRAND = {
  left: "#4FA38E",
  right: "#2B6A5B",
  top: "#8FD1BE",
  facet: "#C4EBDF",
};
// Mono draws the faces as greys into a luminance mask over currentColor:
// 70% left, 100% right, 42% top, 20% facet.
const MONO = { left: "#B3B3B3", right: "#FFF", top: "#6B6B6B", facet: "#333" };

type NetherstoneMarkProps = SVGProps<SVGSVGElement> & {
  /** "brand" uses the fixed Basalt verdigris; "mono" follows currentColor so it fits any theme. */
  variant?: "brand" | "mono";
};

export function NetherstoneMark({
  variant = "brand",
  ...props
}: NetherstoneMarkProps) {
  const id = useId().replace(/[^\w-]/g, "");
  const mono = variant === "mono";
  const color = mono ? MONO : BRAND;
  const faces = (
    <>
      <path d={SILHOUETTE} fill={color.left} mask={`url(#${id}-inset)`} />
      <path d={LEFT} fill={color.left} />
      <path d={RIGHT} fill={color.right} />
      <path d={TOP} fill={color.top} />
      <path d={FACET} fill={color.facet} />
    </>
  );
  return (
    <svg viewBox="8 8 48 48" aria-hidden="true" {...props}>
      <defs>
        <mask id={`${id}-inset`}>
          <path d={SILHOUETTE} fill="#FFF" stroke="#000" strokeWidth={1.5} />
        </mask>
        {mono && <mask id={`${id}-shade`}>{faces}</mask>}
      </defs>
      {mono ? (
        <rect
          x="8"
          y="8"
          width="48"
          height="48"
          fill="currentColor"
          mask={`url(#${id}-shade)`}
        />
      ) : (
        faces
      )}
    </svg>
  );
}
