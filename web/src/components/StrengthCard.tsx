import type { IsoDate } from "@/lib/db/rows";
import type { StrengthSession } from "@/lib/today-view";

import { Card } from "./Card";
import { ExerciseList, TickProgress } from "./ExerciseChecklist";

type StrengthCardProps = {
  readonly id: string;
  readonly date: IsoDate;
  readonly session: StrengthSession;
};

/** Today's strength session from the coach's sheet: the rows to tick, as written. */
export function StrengthCard({ id, date, session }: StrengthCardProps) {
  return (
    <Card
      id={id}
      title="Strength"
      action={<TickProgress date={date} rowKeys={session.exercises.map((e) => e.key)} />}
    >
      <p className="text-16">
        {session.block} · week {session.week}
      </p>
      {session.week === 1 && (
        <p className="text-14 text-text-muted">
          Week 1 of the block: no kg from last week to compare yet.
        </p>
      )}
      <ExerciseList date={date} week={session.week} exercises={session.exercises} />
      <p className="text-14 text-text-muted">Ticks clear when the page reloads. Log kg in the sheet.</p>
    </Card>
  );
}
