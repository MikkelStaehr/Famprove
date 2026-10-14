import { ZONE_CLASS, type ZoneKey } from "@/lib/zone-scale";

type ZonePillProps = {
  /** Python's form_zone key. */
  readonly zone: ZoneKey;
  /** The zone's word (FORM_ZONE_DISPLAY): the colour is never shown without it. */
  readonly label: string;
  readonly className?: string;
};

/** DESIGN.md ZonePill: Geist Mono text-12 in the zone colour, 1px border at 40 %, fill at 8 %, pill radius, 4px 10px. Not interactive. */
export function ZonePill({ zone, label, className }: ZonePillProps) {
  return (
    <span
      className={`inline-flex items-center rounded-pill border px-2.5 py-1 font-mono text-12 ${ZONE_CLASS[zone].pill}${className === undefined ? "" : ` ${className}`}`}
    >
      {label}
    </span>
  );
}
