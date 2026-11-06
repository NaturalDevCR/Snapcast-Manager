// Shared factory for the app's code editors (Server config > Expert,
// Watchdogs > Expert mode).
//
// Deliberately NOT `prism-code-editor/setups`: those helpers render into a
// shadow root and inject their CSS through <style> elements, which the
// server's CSP (`style-src 'self'`, see server/src/index.ts) blocks. With
// every style dropped the editor's real <textarea> shows up as a small white
// native box above an unaligned copy of the text. Vite's dev server sends no
// CSP, so the breakage only ever appears in production builds. Building the
// editor in the light DOM keeps all of its CSS in the bundled stylesheet.
import { createEditor, type PrismEditor } from 'prism-code-editor';
import { defaultCommands, editHistory } from 'prism-code-editor/commands';
import { cursorPosition } from 'prism-code-editor/cursor';
import { indentGuides } from 'prism-code-editor/guides';
import { highlightBracketPairs } from 'prism-code-editor/highlight-brackets';
import { matchBrackets } from 'prism-code-editor/match-brackets';
import { highlightSelectionMatches, searchWidget, showInvisibles } from 'prism-code-editor/search';
import 'prism-code-editor/languages/ini';
import 'prism-code-editor/languages/json';
import 'prism-code-editor/prism/languages/ini';
import 'prism-code-editor/prism/languages/json';
import 'prism-code-editor/layout.css';
import 'prism-code-editor/scrollbar.css';
import 'prism-code-editor/guides.css';
import 'prism-code-editor/search.css';
import 'prism-code-editor/invisibles.css';
import './codeEditor.css';

export type CodeEditor = PrismEditor;

export function createCodeEditor(
  container: HTMLElement,
  options: { language: 'ini' | 'json'; value: string },
): CodeEditor {
  return createEditor(
    container,
    options,
    defaultCommands(),
    indentGuides(),
    matchBrackets(),
    highlightBracketPairs(),
    cursorPosition(),
    highlightSelectionMatches(),
    searchWidget(),
    showInvisibles(),
    editHistory(),
  );
}
