// ISO dates (YYYY-MM-DD) are parsed as UTC so the weekday never shifts with the viewer's time zone.

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function parse(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export function formatCnDate(isoDate: string): string {
  const d = parse(isoDate);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

export function weekdayCn(isoDate: string): string {
  return WEEKDAYS[parse(isoDate).getUTCDay()];
}
