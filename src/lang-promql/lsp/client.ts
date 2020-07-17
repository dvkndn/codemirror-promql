import axios from 'axios';
import { AutocompleteContext, Completion, CompletionResult } from "@codemirror/next/autocomplete";
import { AutocompleteResponse, TextEdit } from "./model";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isIterable(obj: any): boolean {
  return obj != null && typeof obj[ Symbol.iterator ] === 'function';
}

export class LSPClient {
  private readonly url: string
  private readonly autocompleteEndpoint = "/completion"

  constructor(url: string) {
    this.url = url;
  }

  autocomplete(context: AutocompleteContext): Promise<CompletionResult> {
    const {state, pos} = context
    const line = state.doc.lineAt(pos)
    const body = {
      expr: state.doc.sliceString(0),
      limit: 100,
      // positionChar start at 0 at the beginning of the line for LSP
      positionChar: pos - line.from - 1 > 0 ? pos - line.from - 1 : pos - line.from,
      // positionLine start at 0 from LSP and at 1 from CMN
      positionLine: line.number - 1,
    }
    return axios.post<AutocompleteResponse[]>(this.url + this.autocompleteEndpoint, body)
      .then((response) => {
        const options: Completion[] = []
        // for every textEdit present, they qll have exactly the same value
        // so the goal is to save the last one present in order to use it later to calculate the position "from"
        // Note: textEdit can be undefined but that's just because otherwise it doesn't compile
        // see more here: https://github.com/microsoft/TypeScript/issues/12916
        // and here https://github.com/microsoft/TypeScript/issues/9568
        let textEdit: TextEdit | undefined
        if (isIterable(response.data)) {
          for (const res of response.data) {
            // TODO map kind with icon Completion.type when it is released on CMN side
            // https://github.com/codemirror/codemirror.next/commit/459bba29c1fd1d80fc4f36dac27e5825b2362273
            let label = res.label
            if (res.textEdit) {
              label = res.textEdit.newText
              textEdit = res.textEdit
            }
            options.push({label: label})
          }
        }

        // "from" and "to" are the absolute value in term of character and doesn't consider the line number
        // so we have to calculate the position of "from"
        // "to" is the direct value of pos
        return {
          from: textEdit ? line.from + textEdit.range.start.character : line.from,
          to: pos,
          options: options
        } as CompletionResult
      })
  }
}
