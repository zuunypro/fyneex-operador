// Date arrives as ISO ("2026-04-25") or Brazilian ("25/04/2026"); time as
// "HH:mm" or "HH:mm:ss". Both can be empty. Returns formatted date and time
// strings ready for display, never null — falls back to '—' so the UI doesn't
// have to guard.
export function formatEventDateTime(
  date: string | null | undefined,
  time: string | null | undefined,
): { date: string; time: string } {
  const out = { date: '—', time: '' }
  if (!date) return out

  let d: Date | null = null

  if (/^\d{4}-\d{2}-\d{2}/.test(date)) {
    const iso = date.length === 10 ? `${date}T12:00:00` : date
    const parsed = new Date(iso)
    if (!Number.isNaN(parsed.getTime())) d = parsed
  } else if (/^\d{2}\/\d{2}\/\d{4}/.test(date)) {
    const [dd, mm, yyyy] = date.slice(0, 10).split('/')
    const parsed = new Date(`${yyyy}-${mm}-${dd}T12:00:00`)
    if (!Number.isNaN(parsed.getTime())) d = parsed
  }

  if (d) {
    out.date = d
      .toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
      .replace('.', '')
  } else {
    out.date = date
  }

  if (time) {
    const m = /^(\d{1,2}):(\d{2})/.exec(time)
    if (m) out.time = `${m[1].padStart(2, '0')}:${m[2]}`
  }

  return out
}
