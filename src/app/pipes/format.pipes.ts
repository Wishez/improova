import { Pipe, type PipeTransform } from '@angular/core';
import { formatDayShort, formatMinutes, formatTime, weekdayShort, weekdayIndex } from '../utils';

@Pipe({ name: 'minutes' })
export class MinutesPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatMinutes(value ?? 0);
  }
}

@Pipe({ name: 'dayShort' })
export class DayShortPipe implements PipeTransform {
  transform(value: string, withYear = false): string {
    return withYear ? `${formatDayShort(value)} ${value.slice(0, 4)}` : formatDayShort(value);
  }
}

@Pipe({ name: 'weekday' })
export class WeekdayPipe implements PipeTransform {
  transform(value: string): string {
    return weekdayShort(weekdayIndex(value));
  }
}

/** Нечистый: результат зависит от часового пояса в настройках, не только от входа. */
@Pipe({ name: 'clockTime', pure: false })
export class ClockTimePipe implements PipeTransform {
  transform(value: string): string {
    return formatTime(value);
  }
}

@Pipe({ name: 'percent100' })
export class Percent100Pipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : `${Math.round(value * 100)} %`;
  }
}
