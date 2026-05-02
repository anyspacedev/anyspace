// Tiny registry so STT can route a transcription into the Super Agent input
// when the panel is open but the textarea isn't focused. Mirrors editorRegistry's
// pattern.

let textareaRef: HTMLTextAreaElement | null = null;

export function registerSuperAgentInput(el: HTMLTextAreaElement | null): void {
  textareaRef = el;
}

export function getSuperAgentInput(): HTMLTextAreaElement | null {
  if (textareaRef && document.contains(textareaRef)) return textareaRef;
  return null;
}
