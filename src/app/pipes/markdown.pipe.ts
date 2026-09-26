import { Pipe, type PipeTransform } from '@angular/core';
import { marked } from 'marked';

/** Markdown → HTML; результат проходит санитайзер Angular при привязке к [innerHTML]. */
@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) {
      return '';
    }
    const html = marked.parse(value, { async: false, breaks: true, gfm: true });
    return typeof html === 'string' ? html : '';
  }
}

/** Строчный markdown (жирный, курсив, ссылки) без абзацев — для пунктов списков и подписей. */
@Pipe({ name: 'markdownInline' })
export class MarkdownInlinePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) {
      return '';
    }
    const html = marked.parseInline(value, { async: false, gfm: true });
    return typeof html === 'string' ? html : '';
  }
}
