// The MIT License (MIT)
//
// Copyright (c) 2020 The Prometheus Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { EditorState, EditorView } from '@codemirror/next/basic-setup';
import { PromQLExtension } from '../lang-promql';
import { Extension } from '@codemirror/next/state';
import { history, historyKeymap } from '@codemirror/next/history';
import { highlightSpecialChars, keymap, multipleSelections } from '@codemirror/next/view';
import { lineNumbers } from '@codemirror/next/gutter';
import { foldGutter, foldKeymap } from '@codemirror/next/fold';
import { bracketMatching } from '@codemirror/next/matchbrackets';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/next/closebrackets';
import { autocomplete, autocompleteKeymap } from '@nexucis/codemirror-next-autocomplete';
import { rectangularSelection } from '@codemirror/next/rectangular-selection';
import { highlightActiveLine, highlightSelectionMatches } from '@codemirror/next/highlight-selection';
import { defaultKeymap } from '@codemirror/next/commands';
import { searchKeymap } from '@codemirror/next/search';
import { commentKeymap } from '@codemirror/next/comment';
import { gotoLineKeymap } from '@codemirror/next/goto-line';
import { lintKeymap } from '@codemirror/next/lint';
import { promQLHighlightMaterialTheme } from './theme';

const basicSetup: Extension = [
  lineNumbers(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  multipleSelections(),
  bracketMatching(),
  closeBrackets(),
  autocomplete({ matchPre: '<b style="color: brown">', matchPost: '</b>' }),
  rectangularSelection(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...commentKeymap,
    ...gotoLineKeymap,
    ...autocompleteKeymap,
    ...lintKeymap,
  ]),
];

const promqlExtension = new PromQLExtension();
let editor: EditorView;

function setCompletion() {
  const completionSelect = document.getElementById('completion') as HTMLSelectElement;
  const completionValue = completionSelect.options[completionSelect.selectedIndex].value;
  switch (completionValue) {
    case 'offline':
      promqlExtension.setComplete();
      break;
    case 'lsp':
      promqlExtension.setComplete({
        lsp: {
          url: 'http://localhost:8080/lsp',
        },
      });
      break;
    case 'prometheus':
      promqlExtension.setComplete({
        hybrid: {
          url: 'http://localhost:9090',
        },
      });
      break;
    default:
      promqlExtension.setComplete();
  }
}

function setLinter() {
  const completionSelect = document.getElementById('linter') as HTMLSelectElement;
  const completionValue = completionSelect.options[completionSelect.selectedIndex].value;
  switch (completionValue) {
    case 'offline':
      promqlExtension.setLinter();
      break;
    case 'lsp':
      promqlExtension.setLinter({
        lsp: {
          url: 'http://localhost:8080/lsp',
        },
      });
      break;
    default:
      promqlExtension.setLinter();
  }
}

function createEditor() {
  if (editor) {
    // When the linter is changed, it required to reload completely the editor.
    // So the first thing to do, is to completely delete the previous editor and to recreate it from scratch
    editor.destroy();
  }
  editor = new EditorView({
    state: EditorState.create({ extensions: [basicSetup, promqlExtension.asExtension(), promQLHighlightMaterialTheme] }),
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    parent: document.querySelector('#editor')!,
  });
}

function applyConfiguration(): void {
  setCompletion();
  setLinter();
  createEditor();
}

createEditor();

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion,@typescript-eslint/ban-ts-ignore
// @ts-ignore
document.getElementById('apply').addEventListener('click', function () {
  applyConfiguration();
});
