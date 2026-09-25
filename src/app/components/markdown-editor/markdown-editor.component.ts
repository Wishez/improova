import { ChangeDetectionStrategy, Component, ElementRef, input, model, output, signal, viewChild } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { MarkdownPipe } from '../../pipes';

type TWrap = { readonly kind: 'wrap'; readonly before: string; readonly after: string; readonly placeholder: string };
type TPrefix = { readonly kind: 'prefix'; readonly prefix: string };
type TFormat = TWrap | TPrefix;

interface IToolbarAction {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly hotkey: string;
  readonly format: TFormat;
}

/** Кнопки разметки; горячие клавиши — как в привычных редакторах. */
const ACTIONS: readonly IToolbarAction[] = [
  { id: 'bold', label: 'Жирный', icon: '@tui.bold', hotkey: 'b', format: { kind: 'wrap', before: '**', after: '**', placeholder: 'главное' } },
  { id: 'italic', label: 'Курсив', icon: '@tui.italic', hotkey: 'i', format: { kind: 'wrap', before: '_', after: '_', placeholder: 'акцент' } },
  { id: 'heading', label: 'Заголовок', icon: '@tui.heading', hotkey: '', format: { kind: 'prefix', prefix: '## ' } },
  { id: 'list', label: 'Список', icon: '@tui.list', hotkey: '', format: { kind: 'prefix', prefix: '- ' } },
  { id: 'check', label: 'Чек-лист', icon: '@tui.list-checks', hotkey: '', format: { kind: 'prefix', prefix: '- [ ] ' } },
  { id: 'quote', label: 'Цитата', icon: '@tui.quote', hotkey: '', format: { kind: 'prefix', prefix: '> ' } },
  { id: 'link', label: 'Ссылка', icon: '@tui.link', hotkey: 'k', format: { kind: 'wrap', before: '[', after: '](https://)', placeholder: 'текст ссылки' } },
];

export interface ITextEdit {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

/** Применяет разметку к выделению: обёртка вокруг текста или префикс у каждой выделенной строки. */
export function applyFormat(params: { readonly value: string; readonly start: number; readonly end: number; readonly format: TFormat }): ITextEdit {
  const { value, start, end, format } = params;
  if (format.kind === 'wrap') {
    const selected = value.slice(start, end) || format.placeholder;
    const next = `${value.slice(0, start)}${format.before}${selected}${format.after}${value.slice(end)}`;
    const from = start + format.before.length;
    return { value: next, selectionStart: from, selectionEnd: from + selected.length };
  }
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const block = value.slice(lineStart, end);
  const lines = block.split('\n');
  const already = lines.every((line) => line.startsWith(format.prefix));
  const changed = lines.map((line) => (already ? line.slice(format.prefix.length) : `${format.prefix}${line}`)).join('\n');
  const next = `${value.slice(0, lineStart)}${changed}${value.slice(end)}`;
  return { value: next, selectionStart: lineStart, selectionEnd: lineStart + changed.length };
}

/**
 * Редактор конспекта с markdown (баг 6): панель разметки, горячие клавиши и просмотр.
 * На широком экране текст и просмотр рядом, на узком — переключатель.
 */
@Component({
  selector: 'app-markdown-editor',
  imports: [TuiButton, MarkdownPipe],
  templateUrl: './markdown-editor.component.html',
  styleUrl: './markdown-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownEditorComponent {
  readonly value = model('');
  readonly label = input('Конспект');
  readonly placeholder = input('**Главное** из урока. Списки, чек-листы, ссылки и заголовки — в markdown.');
  readonly rows = input(8);
  /** Просмотр рядом с текстом на широком экране; false — только переключатель (узкие диалоги). */
  readonly split = input(true);
  /** Поле потеряло фокус — повод сохранить без задержки. */
  readonly committed = output<void>();

  protected readonly actions = ACTIONS;
  protected readonly preview = signal(false);
  private readonly area = viewChild<ElementRef<HTMLTextAreaElement>>('area');

  protected onInput(event: Event): void {
    if (event.target instanceof HTMLTextAreaElement) {
      this.value.set(event.target.value);
    }
  }

  protected run(action: IToolbarAction): void {
    const area = this.area()?.nativeElement;
    if (!area) {
      return;
    }
    const edit = applyFormat({ value: area.value, start: area.selectionStart, end: area.selectionEnd, format: action.format });
    area.value = edit.value;
    this.value.set(edit.value);
    area.focus();
    area.setSelectionRange(edit.selectionStart, edit.selectionEnd);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
      return;
    }
    const action = ACTIONS.find((entry) => entry.hotkey !== '' && entry.hotkey === event.key.toLowerCase());
    if (action) {
      // Ctrl+K в редакторе — ссылка, а не палитра команд
      event.preventDefault();
      event.stopPropagation();
      this.run(action);
    }
  }
}
