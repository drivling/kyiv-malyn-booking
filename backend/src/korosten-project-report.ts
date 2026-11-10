/**
 * Звірка проєкту власника 2025 року з розкладом ради й переліком зупинок ради → REPORT.md
 * (data/korosten-transport/project-2025/). Чиста функція. Docs/korosten-transport-2026-11.md, фаза 2б.
 */
import type { ProjectDirection } from './korosten-project-parser';
import type { SourceRun, SourceTimetable } from './korosten-source-parser';
import type { StopAliases } from './korosten-stop-aliases';

const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Рейс ради належить напрямку проєкту, якщо хоча б дві його точки є в ланцюжку й ідуть у тому ж порядку */
export function runsOfDirection(direction: ProjectDirection, runs: SourceRun[], aliases: StopAliases): Array<{ run: SourceRun; projectMinutes: number }> {
  const uid = (name: string): string | undefined => aliases.stops[name]?.uid;
  const index = new Map<string, number>();
  direction.stops.forEach((s, i) => {
    const id = uid(s.name);
    if (id && !index.has(id)) index.set(id, i);
  });
  const out: Array<{ run: SourceRun; projectMinutes: number }> = [];
  for (const run of runs) {
    // Рейс з іншими кінцевими («… – Бровар – Сади») звіряємо на тій частині шляху, що лежить у ланцюжку
    const points = [run.from, ...run.via, run.to].map((name) => index.get(uid(name) ?? '')).filter((i): i is number => i !== undefined);
    if (points.length < 2) continue;
    const a = points[0];
    const b = points[points.length - 1];
    if (a >= b) continue;
    out.push({ run, projectMinutes: direction.stops[b].minute - direction.stops[a].minute });
  }
  return out;
}

const list = (items: string[]): string => (items.length ? items.join(', ') : '—');

export function buildProjectReport(directions: ProjectDirection[], timetable: SourceTimetable, aliases: StopAliases): string {
  const lines: string[] = [
    '# Проєкт 2025 проти розкладу ради — звірка',
    '',
    'Згенеровано `npm run korosten:snapshot -- --project` (backend). Руками не редагувати: тест',
    '`korosten-project-parser.test.ts` перевіряє, що файл відповідає джерелам.',
    '',
    `Проєкт: ${directions.length} напрямків, стан на ${directions[0]?.asOf ?? '?'}. Розклад ради: сторінка змінена ${timetable.modified ?? '?'}.`,
    '',
    '## Відправлення й час у дорозі',
    '',
    '«Лише в проєкті» — здебільшого рейси з іншими кінцевими (у раді вони записані іншою парою зупинок) і рейси',
    'з позначкою; «лише в раді» — рейс з’явився після 2025 року або його нема в проєкті.',
    '',
    '| Файл | Напрямок | Зупинок | Хв | Будні: проєкт / рада | Лише в проєкті | Лише в раді | Вихідні: проєкт / рада | Час у дорозі за радою, хв |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const d of directions) {
    const route = timetable.routes.find((r) => r.number === d.route);
    const matched = route ? runsOfDirection(d, route.runs, aliases) : [];
    const rada = new Set(matched.map((m) => m.run.departure));
    const radaWeekend = new Set(matched.filter((m) => m.run.days === 'everyday').map((m) => m.run.departure));
    const project = new Set(d.departures.weekdays.map((x) => x.time));
    const onlyProject = d.departures.weekdays.filter((x) => !rada.has(x.time)).map((x) => x.time + (x.mark ? ` (${x.mark})` : ''));
    const onlyRada = [...rada].filter((t) => !project.has(t)).sort();
    const durations = new Map<number, number>();
    for (const m of matched) {
      const dur = minutes(m.run.arrival) - minutes(m.run.departure);
      durations.set(dur, (durations.get(dur) ?? 0) + 1);
    }
    const durText = [...durations.entries()].sort((a, b) => a[0] - b[0]).map(([dur, n]) => `${dur}×${n}`).join(' ');
    lines.push(
      `| ${d.code} | №${d.route} ${d.stops[0].name} → ${d.stops[d.stops.length - 1].name} | ${d.stops.length} | ${d.stops[d.stops.length - 1].minute} | ` +
        `${project.size} / ${rada.size} | ${list(onlyProject)} | ${list(onlyRada)} | ${d.departures.weekends.length} / ${radaWeekend.size} | ${durText || '—'} |`,
    );
  }

  lines.push('', '## Примітки проєкту (варіанти шляху)', '');
  for (const d of directions) {
    for (const note of d.notes) {
      const marked = [...d.departures.weekdays, ...d.departures.weekends].filter((x) => x.mark === note.mark);
      const times = [...new Set(marked.map((x) => x.time))].sort();
      lines.push(`- **${d.code}** «${note.mark}» — ${note.text}. Рейси: ${list(times)}.`);
    }
  }
  const projectRoutes = new Set(directions.map((d) => d.route));
  const missing = timetable.routes.filter((r) => !projectRoutes.has(r.number)).map((r) => `№${r.number}`);
  lines.push('', `Маршрути ради, яких нема в проєкті: ${list(missing)}.`);

  const confirm = Object.entries(aliases.stops).filter(([, a]) => a.confirm);
  const count = (how: string): number => Object.values(aliases.stops).filter((a) => a.how === how).length;
  lines.push(
    '',
    '## Назви зупинок',
    '',
    `Усього назв: ${Object.keys(aliases.stops).length + aliases.newStops.length + aliases.unresolved.length}. ` +
      `Дослівно збіглися з переліком ради: ${count('exact')}, після нормалізації: ${count('normalized')}, ` +
      `за ручною підказкою: ${count('hint')}, нових зупинок: ${aliases.newStops.length}, нерозв’язаних: ${aliases.unresolved.length}.`,
    '',
    '### Підтвердити власнику',
    '',
    '| Назва в джерелі | Зупинка ради | Де трапляється |',
    '|---|---|---|',
    ...confirm.map(([name, a]) => `| ${name} | ${a.uid} ${a.official} | ${a.sources.join(', ')} |`),
    '',
    '### Нові зупинки (у переліку ради нема)',
    '',
    '| Назва | Тимчасовий id | Де трапляється |',
    '|---|---|---|',
    ...aliases.newStops.map((s) => `| ${s.name} | ${s.tempId} | ${s.sources.join(', ')} |`),
  );
  if (aliases.unresolved.length) {
    lines.push('', '### Нерозв’язані', '', ...aliases.unresolved.map((u) => `- ${u.name} — кандидати: ${list(u.candidates)} (${u.sources.join(', ')})`));
  }
  lines.push(
    '',
    '### Зупинки ради, на які не послався ні проєкт, ні розклад',
    '',
    'Це зупинки варіантів шляху й ліній зі схеми 2019 (Південна, Франка, Алейхема, Набережна…) — для фази 8.',
    '',
    list(aliases.unusedOfficial),
    '',
  );
  return lines.join('\n');
}
