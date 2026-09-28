import type { WeekView } from "@/lib/dashboard-view";
import { formatDay, formatLoad } from "@/lib/format";

/**
 * This ISO week's days (daily_load rows so far) and the week total from weekly_load.
 * Displays values only; the week SUM comes from SQL.
 */
export function WeekTable({ week }: { readonly week: WeekView }) {
  const partial = week.days.length < 7;
  // Data tables may scroll sideways at 200% text (WCAG reflow exception); focusable for keyboards.
  return (
    <div
      role="region"
      aria-label={`Week ${week.isoWeek} load per day`}
      tabIndex={0}
      className="overflow-x-auto"
    >
      <table className="w-full border-collapse text-14 tabular-nums">
        <caption className="pb-2 text-left text-14 text-text-muted">
          {formatDay(week.weekStart)} – {formatDay(week.weekEnd)}
          {partial && ` · ${week.days.length} of 7 days so far`}
        </caption>
        <thead>
          <tr className="border-b border-border text-12 text-text-muted">
            <th scope="col" className="py-2 pr-2 text-left font-semibold">
              Day
            </th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">
              Cycling <span className="font-normal">TSS</span>
            </th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">
              Strength <span className="font-normal">TSS</span>
            </th>
            <th scope="col" className="py-2 pl-2 text-right font-semibold">
              Total <span className="font-normal">TSS</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {week.days.map((day) => (
            <tr key={day.date} className="border-b border-border">
              <th scope="row" className="py-2 pr-2 text-left font-normal">
                {formatDay(day.date)}
              </th>
              <td className="px-2 py-2 text-right">{formatLoad(day.cyclingTss)}</td>
              <td className="px-2 py-2 text-right">{formatLoad(day.strengthTss)}</td>
              <td className="py-2 pl-2 text-right">{formatLoad(day.totalTss)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <th scope="row" className="pt-2 pr-2 text-left">
              Week {week.isoWeek} total
            </th>
            <td className="px-2 pt-2 text-right">{formatLoad(week.cyclingTss)}</td>
            <td className="px-2 pt-2 text-right">{formatLoad(week.strengthTss)}</td>
            <td className="pt-2 pl-2 text-right">{formatLoad(week.totalTss)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
