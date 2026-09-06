/**
 * Kun tartibini pomodoro bloklariga bo'lib, har bir vazifaning
 * boshlanish/tugash vaqtini va tanaffuslarni hisoblaydi.
 *
 * Jadval ish kuni oralig'i (boshlanish–tugash) ichida quriladi.
 * Yarim tundan oshsa, vaqt yoniga kun siljishi (dayOffset) qo'shiladi.
 */
import { timeToMinutes, minutesToTime } from './util.js';

const at = (mins) => ({ time: minutesToTime(mins), dayOffset: Math.floor(mins / 1440) });

/**
 * @param {Array}  tasks     tartiblangan vazifalar
 * @param {Object} settings  foydalanuvchi sozlamalari (zaxira qiymatlar)
 * @param {Object} [setup]   shu kunning sozlamasi: startTime, endTime,
 *                           workMinutes, shortBreakMinutes, longBreakMinutes, longBreakInterval
 */
export function buildSchedule(tasks, settings, setup) {
  const cfg = { ...settings, ...(setup || {}) };
  const work = Math.max(1, cfg.workMinutes);
  const shortB = Math.max(0, cfg.shortBreakMinutes);
  const longB = Math.max(0, cfg.longBreakMinutes);
  const interval = Math.max(1, cfg.longBreakInterval);

  const startTime = cfg.startTime || settings.dayStartTime;
  const endTime = cfg.endTime || settings.dayEndTime || '18:00';

  const dayStart = timeToMinutes(startTime);
  let dayEndAbs = timeToMinutes(endTime);
  // Tugash boshlanishdan oldin bo'lsa — tungi smena, ertasi kunga o'tadi
  if (dayEndAbs <= dayStart) dayEndAbs += 1440;
  const availableMinutes = dayEndAbs - dayStart;

  const totalPomodoros = tasks.reduce((s, t) => s + (t.plannedPomodoros || 0), 0);
  let cursor = dayStart;

  let index = 0;
  let workMinutes = 0;
  let breakMinutes = 0;
  let shortCount = 0;
  let longCount = 0;

  const scheduled = tasks.map((task) => {
    const n = Math.max(0, task.plannedPomodoros || 0);
    const blocks = [];
    const taskStart = cursor;

    for (let i = 0; i < n; i++) {
      index++;
      const from = at(cursor), to = at(cursor + work);
      blocks.push({
        type: 'work',
        n: index,
        from: from.time,
        to: to.time,
        fromDayOffset: from.dayOffset,
        toDayOffset: to.dayOffset,
        minutes: work,
        overflow: cursor + work > dayEndAbs      // ish vaqtidan tashqarida
      });
      cursor += work;
      workMinutes += work;

      const isLast = index >= totalPomodoros;
      if (!isLast) {
        const isLong = index % interval === 0;
        const len = isLong ? longB : shortB;
        if (len > 0) {
          const bFrom = at(cursor), bTo = at(cursor + len);
          blocks.push({
            type: isLong ? 'long' : 'short',
            from: bFrom.time,
            to: bTo.time,
            fromDayOffset: bFrom.dayOffset,
            toDayOffset: bTo.dayOffset,
            minutes: len,
            overflow: cursor + len > dayEndAbs
          });
          cursor += len;
          breakMinutes += len;
          if (isLong) longCount++; else shortCount++;
        }
      }
    }

    const s = at(taskStart), e = at(cursor);
    return {
      ...task,
      startTime: n > 0 ? s.time : null,
      endTime: n > 0 ? e.time : null,
      startDayOffset: n > 0 ? s.dayOffset : 0,
      endDayOffset: n > 0 ? e.dayOffset : 0,
      overflow: n > 0 && cursor > dayEndAbs,
      spanMinutes: n > 0 ? cursor - taskStart : 0,
      estimatedMinutes: n * work,
      blocks
    };
  });

  const completed = tasks.reduce((s, t) => s + Math.min(t.completedPomodoros || 0, t.plannedPomodoros || 0), 0);
  const rawCompleted = tasks.reduce((s, t) => s + (t.completedPomodoros || 0), 0);
  const planEndAbs = totalPomodoros > 0 ? cursor : dayStart;
  const end = at(planEndAbs);
  const windowEnd = at(dayEndAbs);

  const totalMinutes = workMinutes + breakMinutes;
  const freeMinutes = availableMinutes - totalMinutes;

  // Ish vaqtiga nechta pomodoro sig'adi (tanaffuslar bilan birga)
  let capacity = 0, used = 0;
  while (true) {
    const next = capacity + 1;
    const need = used + work;
    if (need > availableMinutes) break;
    capacity = next;
    used = need;
    const br = (next % interval === 0) ? longB : shortB;
    if (used + br > availableMinutes) break;
    used += br;
  }

  return {
    tasks: scheduled,
    summary: {
      taskCount: tasks.length,
      doneTaskCount: tasks.filter(t => t.done).length,
      totalPomodoros,
      completedPomodoros: rawCompleted,
      remainingPomodoros: Math.max(0, totalPomodoros - completed),
      workMinutes,
      breakMinutes,
      shortBreaks: shortCount,
      longBreaks: longCount,
      totalMinutes,
      dayStart: minutesToTime(dayStart),
      dayEnd: end.time,
      dayEndOffset: end.dayOffset,
      overnight: end.dayOffset > 0,
      progressPercent: totalPomodoros > 0 ? Math.round((completed / totalPomodoros) * 100) : 0,

      /* — Shu kunning amaldagi sozlamasi — */
      workMinutesUsed: work,
      shortBreakUsed: shortB,
      longBreakUsed: longB,
      longBreakIntervalUsed: interval,
      isWorkday: setup?.isWorkday !== false,
      weekdayName: setup?.weekdayName || '',
      customDay: !!setup?.custom,

      /* — Ish vaqti oralig'i — */
      workdayStart: startTime,
      workdayEnd: endTime,
      workdayEndOffset: windowEnd.dayOffset,
      availableMinutes,
      freeMinutes,
      fits: freeMinutes >= 0,
      overflowMinutes: freeMinutes < 0 ? -freeMinutes : 0,
      capacityPomodoros: capacity,
      extraPomodoros: Math.max(0, totalPomodoros - capacity),
      utilizationPercent: availableMinutes > 0 ? Math.round((totalMinutes / availableMinutes) * 100) : 0
    }
  };
}
