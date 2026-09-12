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

  /* Uchrashuvlar — belgilangan vaqtda turadigan band oynalar.
     Ish jadvali ular ustidan sakraydi, tanaffus ham hisoblanmaydi. */
  const meets = tasks
    .filter(t => t.meet && t.meet.minutes > 0)
    .map(t => ({ ...t.meet, title: t.title, id: t.id }))
    .sort((a, b) => a.startMin - b.startMin);

  const meetMinutes = meets.reduce((a, m) => a + m.minutes, 0);

  /** Berilgan oraliq uchrashuvga tegsa — uchrashuv tugagan vaqtni qaytaradi */
  function meetConflictEnd(from, len) {
    for (const m of meets) {
      if (from < m.endMin && from + len > m.startMin) return m.endMin;
    }
    return null;
  }

  // Uchrashuvlar pomodoro sanog'iga kirmaydi
  const totalPomodoros = tasks.reduce((s, t) => s + (t.meet ? 0 : (t.plannedPomodoros || 0)), 0);
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
    /* ── Uchrashuv: belgilangan vaqtda yaxlit blok ── */
    if (task.meet) {
      const m = task.meet;
      const blocks = [];
      const seg = (from, to, type) => {
        const f = at(from), t = at(to);
        blocks.push({
          type, from: f.time, to: t.time,
          fromDayOffset: f.dayOffset, toDayOffset: t.dayOffset,
          abs: from, minutes: to - from,
          meetTitle: task.title,
          overflow: to > dayEndAbs
        });
      };

      // Tanaffus uchrashuv ichida — foydalanuvchi joyini o'zi tanlaydi
      let brStart = null;
      if (m.breakEnabled && m.breakMinutes > 0 && m.breakMinutes < m.minutes) {
        if (m.breakPlacement === 'boshida') brStart = m.startMin;
        else if (m.breakPlacement === 'oxirida') brStart = m.endMin - m.breakMinutes;
        else if (m.breakPlacement === 'vaqt' && Number.isFinite(m.breakAt)) {
          brStart = Math.min(Math.max(m.breakAt, m.startMin), m.endMin - m.breakMinutes);
        } else {
          brStart = m.startMin + Math.round((m.minutes - m.breakMinutes) / 2);
        }
      }

      if (brStart === null) {
        seg(m.startMin, m.endMin, 'meet');
      } else {
        const brEnd = brStart + m.breakMinutes;
        if (brStart > m.startMin) seg(m.startMin, brStart, 'meet');
        seg(brStart, brEnd, 'meet-break');
        if (brEnd < m.endMin) seg(brEnd, m.endMin, 'meet');
      }

      const ishVaqti = m.minutes - (brStart === null ? 0 : m.breakMinutes);
      workMinutes += ishVaqti;
      if (brStart !== null) breakMinutes += m.breakMinutes;

      const s0 = at(m.startMin), e0 = at(m.endMin);
      return {
        ...task,
        startTime: s0.time,
        endTime: e0.time,
        startDayOffset: s0.dayOffset,
        endDayOffset: e0.dayOffset,
        overflow: m.endMin > dayEndAbs,
        spanMinutes: m.minutes,
        focusMinutes: ishVaqti,
        estimatedMinutes: m.minutes,
        isMeet: true,
        meetBreakMinutes: brStart === null ? 0 : m.breakMinutes,
        donePomodoroCount: 0,
        pomodoros: [],
        pausedMinutes: 0,
        pauseCount: 0,
        pinnedStart: true,
        blocks
      };
    }

    const n = Math.max(0, task.plannedPomodoros || 0);
    const blocks = [];

    // Haqiqatda bajarilgan pomodorolar — o'z vaqtida turadi, chunki vazifalar
    // tartib bilan emas, almashtirib bajarilishi mumkin
    const done = (task.donePomodoros || []).slice(0, n);
    const remaining = Math.max(0, n - done.length);

    // Vazifa haqiqatda boshlangan bo'lsa — jadval shu vaqtga bog'lanadi
    const pinned = Number.isFinite(task.actualStartMinutes) ? task.actualStartMinutes : null;
    if (n > 0 && !done.length && pinned !== null) cursor = pinned;

    const taskStart = done.length ? done[0].startMin : cursor;

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

    /** Har bir pomodoroning boshlanish/tugash vaqti — hisobot va interfeys uchun */
    const pomodoroList = [];

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

    /* ── 1. Bajarilgan pomodorolar: haqiqiy vaqti bo'yicha ──
       Ular orasidagi bo'shliq — haqiqatda o'tgan vaqt, sun'iy tanaffus
       qo'yilmaydi. Shuning uchun pomodorolar yig'indisi o'zgarmaydi. */
    for (let i = 0; i < done.length; i++) {
      const d = done[i];
      index++;
      const f = at(d.startMin), t = at(d.endMin);
      blocks.push({
        type: 'work',
        n: index,
        from: f.time, to: t.time,
        fromDayOffset: f.dayOffset, toDayOffset: t.dayOffset,
        abs: d.startMin,
        minutes: d.minutes,
        actual: true,                 // reja emas, haqiqatda bajarilgan
        manual: !!d.manual,
        reasonLabel: d.reasonLabel || '',
        overflow: d.endMin > dayEndAbs
      });
      workMinutes += d.minutes;
      pomodoroList.push({
        n: index, from: f.time, to: t.time,
        fromDayOffset: f.dayOffset, toDayOffset: t.dayOffset,
        minutes: d.minutes, actual: true, manual: !!d.manual, reasonLabel: d.reasonLabel || ''
      });
    }
    // Rejadagi qolgan ish oxirgi haqiqiy pomodorodan keyin boshlanadi
    if (done.length) cursor = Math.max(cursor, done[done.length - 1].endMin);

    /* ── 2. Qolgan pomodorolar: rejadan hisoblanadi ── */
    for (let i = 0; i < remaining; i++) {
      index++;

      // Uchrashuv — qat'iy majburiyat: unga tushadigan ish keyinga suriladi
      const band = meetConflictEnd(cursor, work);
      if (band !== null) cursor = band;

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
        actual: false,
        overflow: cursor + work > dayEndAbs      // ish vaqtidan tashqarida
      });
      pomodoroList.push({
        n: index, from: from.time, to: to.time,
        fromDayOffset: from.dayOffset, toDayOffset: to.dayOffset,
        minutes: work, actual: false, manual: false, reasonLabel: ''
      });
      cursor += work;
      workMinutes += work;

      // Shu pomodoroda qilingan pauza aynan shu yerda ko'rinadi
      putPause(pauseByIndex.get(done.length + i) || 0);

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
          // Uchrashuvga tushadigan tanaffus o'tkazib yuboriladi
          if (meetConflictEnd(cursor, len) !== null) continue;
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

    // Vazifa oralig'i: birinchi pomodoro boshlanishidan oxirgisining tugashigacha.
    // Oradagi uzilishlar shu oraliqqa kiradi, lekin sof ish vaqtiga qo'shilmaydi.
    const lastEnd = (done.length && !remaining) ? done[done.length - 1].endMin : cursor;

    const s = at(taskStart), e = at(lastEnd);
    // Sof ish vaqti — pomodorolar davomiyliklari yig'indisi. Oraliq cho'zilsa ham o'zgarmaydi.
    const focusMinutes = done.reduce((a, d) => a + d.minutes, 0) + remaining * work;

    return {
      ...task,
      startTime: n > 0 ? s.time : null,
      endTime: n > 0 ? e.time : null,
      startDayOffset: n > 0 ? s.dayOffset : 0,
      endDayOffset: n > 0 ? e.dayOffset : 0,
      overflow: n > 0 && lastEnd > dayEndAbs,
      spanMinutes: n > 0 ? Math.max(0, lastEnd - taskStart) : 0,
      focusMinutes,                      // pomodorolar yig'indisi — oraliqdan mustaqil
      estimatedMinutes: n * work,
      donePomodoroCount: done.length,
      pomodoros: pomodoroList,           // har birining boshlanish/tugash vaqti
      pausedMinutes: taskPause,
      pauseCount: (task.pauseList || []).reduce((a, p) => a + (p.count || 1), 0),
      pinnedStart: done.length > 0 || pinned !== null,
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
      meetMinutes,
      meetCount: meets.length,
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
