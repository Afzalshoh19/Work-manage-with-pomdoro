/**
 * Kun tartibini pomodoro bloklariga bo'lib, har bir vazifaning
 * boshlanish/tugash vaqtini va tanaffuslarni hisoblaydi.
 *
 * Jadval ish kuni oralig'i (boshlanish–tugash) ichida quriladi.
 * Yarim tundan oshsa, vaqt yoniga kun siljishi (dayOffset) qo'shiladi.
 *
 * Jadval uch xil haqiqiy holatni hisobga oladi:
 *   1. Pauza vaqti — vazifa bloklaridan keyin "pauza" bloki bo'lib qo'shiladi
 *      va keyingi hamma narsani surib yuboradi.
 *   2. Haqiqiy boshlanish — foydalanuvchi vazifani ▶ bilan boshlagan bo'lsa,
 *      shu vazifa rejadagi emas, haqiqiy vaqtga bog'lanadi.
 *   3. Tushlik — bu oraliqqa hech qanday ish yoki tanaffus tushmaydi.
 */
import { timeToMinutes, minutesToTime } from './util.js';

const at = (mins) => ({ time: minutesToTime(mins), dayOffset: Math.floor(mins / 1440) });

/** Tushlik oralig'ini ish kuni o'qiga joylashtiradi */
function lunchWindow(cfg, dayStart) {
  if (!cfg.lunchEnabled) return null;
  const ls = cfg.lunchStart || '13:00';
  const le = cfg.lunchEnd || '14:00';
  let start = timeToMinutes(ls);
  let end = timeToMinutes(le);
  if (end <= start) end += 1440;                       // tungi smenada yarim tundan oshishi mumkin
  while (start < dayStart) { start += 1440; end += 1440; }
  if (end - start <= 0) return null;
  return { start, end, minutes: end - start, startTime: ls, endTime: le };
}

/**
 * @param {Array}  tasks     tartiblangan vazifalar. Har biri ixtiyoriy ravishda
 *                           `actualStartMinutes` (haqiqiy boshlanish) va
 *                           `pausedMinutes` (jamlangan pauza) maydonlarini olishi mumkin.
 * @param {Object} settings  foydalanuvchi sozlamalari (zaxira qiymatlar)
 * @param {Object} [setup]   shu kunning sozlamasi: startTime, endTime, workMinutes,
 *                           shortBreakMinutes, longBreakMinutes, longBreakInterval,
 *                           lunchEnabled, lunchStart, lunchEnd
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

  const lunch = lunchWindow(cfg, dayStart);
  // Ish oynasiga tushadigan tushlik qismi — sig'im hisobidan chiqariladi
  const lunchInWindow = lunch
    ? Math.max(0, Math.min(lunch.end, dayEndAbs) - Math.max(lunch.start, dayStart))
    : 0;
  const workableMinutes = Math.max(0, availableMinutes - lunchInWindow);

  const totalPomodoros = tasks.reduce((s, t) => s + (t.plannedPomodoros || 0), 0);
  let cursor = dayStart;

  let index = 0;
  let workMinutes = 0;
  let breakMinutes = 0;
  let pauseMinutes = 0;
  let lunchMinutes = 0;
  let shortCount = 0;
  let longCount = 0;
  let lunchPlaced = false;

  /** Tushlik blokini joriy kursordan tushlik oxirigacha qo'yadi */
  function placeLunch(blocks) {
    const startAt = Math.max(cursor, lunch.start);
    const from = at(startAt), to = at(lunch.end);
    blocks.push({
      type: 'lunch',
      from: from.time,
      to: to.time,
      fromDayOffset: from.dayOffset,
      toDayOffset: to.dayOffset,
      abs: startAt,
      minutes: lunch.end - startAt,
      late: startAt > lunch.start,          // pomodoro tugashi kutilgani uchun kech boshlandi
      overflow: false
    });
    lunchPlaced = true;
    cursor = lunch.end;
  }

  /**
   * Ish bloki tushlikka tegsa nima qilish kerakligini hal qiladi.
   * Boshlangan pomodoroni bo'lmaymiz: agar u tushlik tugashidan oldin
   * yakunlansa — ishlashda davom etadi, tushlikka biroz kech chiqiladi.
   * Aks holda blok butunlay tushlikdan keyinga suriladi.
   * @returns {boolean} true — blokdan keyin tushlik qo'yilishi kerak
   */
  function lunchBeforeWork(blocks, len) {
    if (!lunch || lunchPlaced || len <= 0) return false;
    if (cursor >= lunch.end || cursor + len <= lunch.start) return false;

    // Pomodoro tushlikdan oldin boshlangan va tushlik tugashiga ulguradi — davom etsin
    if (cursor < lunch.start && cursor + len <= lunch.end) return true;

    placeLunch(blocks);
    return false;
  }

  /** Tanaffus tushlikka tegsa — tushlikning o'zi tanaffus vazifasini bajaradi */
  function lunchInsteadOfBreak(blocks, len) {
    if (!lunch || lunchPlaced || len <= 0) return false;
    if (cursor >= lunch.end || cursor + len <= lunch.start) return false;
    placeLunch(blocks);
    return true;
  }

  const scheduled = tasks.map((task) => {
    const n = Math.max(0, task.plannedPomodoros || 0);
    const blocks = [];

    // Vazifa haqiqatda boshlangan bo'lsa — jadval shu vaqtga bog'lanadi
    const pinned = Number.isFinite(task.actualStartMinutes) ? task.actualStartMinutes : null;
    if (n > 0 && pinned !== null) cursor = pinned;

    const taskStart = cursor;

    // Pauzalar pomodoro tartib raqami bo'yicha: { 0: daqiqa, 1: daqiqa, ... }
    const pauseByIndex = new Map();
    let listed = 0;
    for (const p of (task.pauseList || [])) {
      const m = Math.round(p.minutes || 0);
      if (m <= 0) continue;
      pauseByIndex.set(p.index, (pauseByIndex.get(p.index) || 0) + m);
      listed += m;
    }
    // Indekssiz qolgan pauza (eski yozuvlar) — oxiriga qo'shiladi
    const trailing = Math.max(0, Math.round(task.pausedMinutes || 0) - listed);
    let taskPause = 0;

    /** Pauza blokini joriy o'ringa qo'yadi */
    const putPause = (mins) => {
      if (!(mins > 0)) return;
      const f = at(cursor), t = at(cursor + mins);
      blocks.push({
        type: 'pause',
        from: f.time, to: t.time,
        fromDayOffset: f.dayOffset, toDayOffset: t.dayOffset,
        abs: cursor, minutes: mins,
        overflow: cursor + mins > dayEndAbs
      });
      cursor += mins;
      pauseMinutes += mins;
      taskPause += mins;
    };

    for (let i = 0; i < n; i++) {
      index++;

      // Tushlik ish blokidan oldin kerakmi, yoki blokdan keyingami
      const lunchAfterWork = lunchBeforeWork(blocks, work);

      const from = at(cursor), to = at(cursor + work);
      blocks.push({
        type: 'work',
        n: index,
        from: from.time,
        to: to.time,
        fromDayOffset: from.dayOffset,
        toDayOffset: to.dayOffset,
        abs: cursor,
        minutes: work,
        overflow: cursor + work > dayEndAbs      // ish vaqtidan tashqarida
      });
      cursor += work;
      workMinutes += work;

      // Shu pomodoroda qilingan pauza aynan shu yerda ko'rinadi
      putPause(pauseByIndex.get(i) || 0);

      // Pomodoro tushlik ustidan o'tdi — endi tushlikka chiqiladi.
      // Tushlikning o'zi tanaffus bo'lgani uchun keyingi tanaffus qo'yilmaydi:
      // tushlikdan keyingi ish aniq belgilangan vaqtda (masalan 14:00) boshlanadi.
      let lunchTookBreak = false;
      if (lunchAfterWork && !lunchPlaced) {
        placeLunch(blocks);
        lunchTookBreak = true;
      }

      const isLast = index >= totalPomodoros;
      if (!isLast && !lunchTookBreak) {
        const isLong = index % interval === 0;
        const len = isLong ? longB : shortB;
        if (len > 0) {
          // Tanaffus tushlikka tushsa — tushlikning o'zi tanaffus bo'ladi
          if (lunchInsteadOfBreak(blocks, len)) continue;
          const bFrom = at(cursor), bTo = at(cursor + len);
          blocks.push({
            type: isLong ? 'long' : 'short',
            from: bFrom.time,
            to: bTo.time,
            fromDayOffset: bFrom.dayOffset,
            toDayOffset: bTo.dayOffset,
            abs: cursor,
            minutes: len,
            overflow: cursor + len > dayEndAbs
          });
          cursor += len;
          breakMinutes += len;
          if (isLong) longCount++; else shortCount++;
        }
      }
    }

    // Rejadagi pomodorolardan tashqarida qolgan pauza
    if (n > 0) {
      let extra = trailing;
      for (const [idx, m] of pauseByIndex) if (idx >= n) extra += m;
      putPause(extra);
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
      pausedMinutes: taskPause,
      pauseCount: (task.pauseList || []).reduce((a, p) => a + (p.count || 1), 0),
      pinnedStart: pinned !== null,
      blocks
    };
  });

  // Hech bir vazifaga tushmagan bo'lsa ham tushlik jadvalda ko'rinsin
  const lunchBlock = lunch && !lunchPlaced ? {
    type: 'lunch',
    from: at(lunch.start).time,
    to: at(lunch.end).time,
    fromDayOffset: at(lunch.start).dayOffset,
    toDayOffset: at(lunch.end).dayOffset,
    abs: lunch.start,
    minutes: lunch.minutes,
    overflow: false
  } : null;

  const completed = tasks.reduce((s, t) => s + Math.min(t.completedPomodoros || 0, t.plannedPomodoros || 0), 0);
  const rawCompleted = tasks.reduce((s, t) => s + (t.completedPomodoros || 0), 0);
  const planEndAbs = totalPomodoros > 0 ? cursor : dayStart;
  const end = at(planEndAbs);
  const windowEnd = at(dayEndAbs);

  const totalMinutes = workMinutes + breakMinutes + pauseMinutes;
  const freeMinutes = workableMinutes - totalMinutes;

  // Ish vaqtiga nechta pomodoro sig'adi (tanaffuslar bilan, tushliksiz)
  let capacity = 0, used = 0;
  while (true) {
    const next = capacity + 1;
    const need = used + work;
    if (need > workableMinutes) break;
    capacity = next;
    used = need;
    const br = (next % interval === 0) ? longB : shortB;
    if (used + br > workableMinutes) break;
    used += br;
  }

  return {
    tasks: scheduled,
    lunchBlock,
    summary: {
      taskCount: tasks.length,
      doneTaskCount: tasks.filter(t => t.done).length,
      totalPomodoros,
      completedPomodoros: rawCompleted,
      remainingPomodoros: Math.max(0, totalPomodoros - completed),
      workMinutes,
      breakMinutes,
      pauseMinutes,
      lunchMinutes: lunchInWindow,
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

      /* — Tushlik — */
      lunch: lunch
        ? { enabled: true, start: lunch.startTime, end: lunch.endTime, minutes: lunch.minutes }
        : { enabled: false, start: cfg.lunchStart || '13:00', end: cfg.lunchEnd || '14:00', minutes: 0 },

      /* — Ish vaqti oralig'i — */
      workdayStart: startTime,
      workdayEnd: endTime,
      workdayEndOffset: windowEnd.dayOffset,
      availableMinutes,
      workableMinutes,
      freeMinutes,
      fits: freeMinutes >= 0,
      overflowMinutes: freeMinutes < 0 ? -freeMinutes : 0,
      capacityPomodoros: capacity,
      extraPomodoros: Math.max(0, totalPomodoros - capacity),
      utilizationPercent: workableMinutes > 0 ? Math.round((totalMinutes / workableMinutes) * 100) : 0
    }
  };
}

/** Berilgan vaqt tushlik oralig'iga tushadimi (daqiqalarda, kun boshidan) */
export function overlapsLunch(cfg, dayStartTime, fromMinutes, lengthMinutes) {
  const dayStart = timeToMinutes(dayStartTime);
  const lunch = lunchWindow(cfg, dayStart);
  if (!lunch) return false;
  return fromMinutes < lunch.end && fromMinutes + lengthMinutes > lunch.start;
}
