import { ZoneBarError } from "@/components/ZoneBar";
import type { IsoDate } from "@/lib/db/rows";
import { formatDay, formatDayLong, formatSigned, stopAfter } from "@/lib/format";
import { formSentence, TSB_HINT, type TrainingHeader } from "@/lib/training-view";
import { isZoneKey, ZONE_CLASS } from "@/lib/zone-scale";

import { ZonePill } from "./ZonePill";
import { ZoneLine } from "./ZoneLine";

type FormCardProps =
  | { readonly kind: "ready"; readonly header: TrainingHeader | null; readonly today: IsoDate; readonly className?: string }
  | { readonly kind: "error"; readonly retry: boolean; readonly className?: string };

/**
 * Træning's form card (reset-traening.md §2.3): caption + ZonePill, the TSB in its zone colour with
 * the zone's hint, then the mini zone bar. The zone colour never shows without the zone word (the
 * pill). One sr sentence speaks the card; the visual rows are aria-hidden.
 */
export function FormCard(props: FormCardProps) {
  return (
    <section
      aria-labelledby="form-heading"
      className={`flex min-w-0 flex-col gap-2.5 rounded-half border border-border bg-card p-4${props.className === undefined ? "" : ` ${props.className}`}`}
    >
      {props.kind === "error" ? (
        <>
          <h2 id="form-heading" className="font-mono text-12 font-normal text-text-muted uppercase">
            Form (TSB)
          </h2>
          <ZoneBarError retry={props.retry} />
        </>
      ) : (
        <FormBody header={props.header} today={props.today} />
      )}
    </section>
  );
}

function FormBody({ header, today }: { readonly header: TrainingHeader | null; readonly today: IsoDate }) {
  const zoneKey = header?.zone != null && isZoneKey(header.zone.key) ? header.zone.key : null;
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 id="form-heading" className="font-mono text-12 font-normal text-text-muted uppercase">
          Form (TSB)
        </h2>
        {zoneKey !== null && header?.zone != null && <ZonePill zone={zoneKey} label={header.zone.label} />}
      </div>
      {header === null ? (
        <p className="text-15 text-text-muted">Form (TSB) er ikke beregnet endnu.</p>
      ) : (
        <>
          <p className="sr-only">
            {formSentence(header.tsb, zoneKey, header.date !== today ? formatDayLong(header.date) : undefined)}
          </p>
          <div aria-hidden="true" className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className={`font-mono text-28 font-medium whitespace-nowrap tabular-nums ${zoneKey === null ? "text-text" : ZONE_CLASS[zoneKey].text}`}
            >
              {formatSigned(header.tsb)}
            </span>
            <span className={`text-15 ${zoneKey === null ? "text-text-muted" : "text-text"}`}>
              {zoneKey === null ? "Zone ikke beregnet." : TSB_HINT[zoneKey]}
            </span>
          </div>
          <ZoneLine tsb={header.tsb} zone={zoneKey} />
          {header.date !== today && (
            <p aria-hidden="true" className="text-13 text-text">
              Tallet er fra <time dateTime={header.date}>{formatDay(header.date)}</time>
              {stopAfter(formatDay(header.date))}
            </p>
          )}
        </>
      )}
    </>
  );
}
