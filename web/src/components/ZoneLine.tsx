import { BANDS, position, ZONE_CLASS, type ZoneKey } from "@/lib/zone-scale";

/**
 * Træning's mini zone bar (reset-traening.md §2.3, mockup C): five segments on the zone scale with a
 * 2px gap, 14px tall, the active one 4px in its zone colour, the others 3px faint; a 2px --text
 * marker at today's TSB, full height. Geometry only (zone-scale.position); which zone is active
 * comes from Python. aria-hidden: the form card's sr sentence says it.
 */
export function ZoneLine({ tsb, zone }: { readonly tsb: number; readonly zone: ZoneKey | null }) {
  return (
    <div aria-hidden="true" data-testid="zone-line" className="relative flex h-3.5 w-full items-center gap-0.5">
      {BANDS.map((band) => (
        <span
          key={band.key}
          data-active={band.key === zone ? "true" : undefined}
          style={{ flexGrow: band.end - band.start, flexBasis: 0 }}
          className={band.key === zone ? `h-1 ${ZONE_CLASS[band.key].fill}` : `h-0.75 ${ZONE_CLASS[band.key].faint}`}
        />
      ))}
      <span
        data-testid="zone-line-marker"
        // Centred on the value, kept inside the bar at the scale ends (an off-scale TSB is pinned there).
        style={{ left: `clamp(0px, calc(${position(tsb) * 100}% - 1px), calc(100% - 2px))` }}
        className="absolute inset-y-0 w-0.5 bg-text"
      />
    </div>
  );
}
