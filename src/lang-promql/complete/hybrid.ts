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

import { AutocompleteContext, Completion, CompletionResult, snippet, SnippetSpec } from '@nexucis/codemirror-next-autocomplete';
import { CompleteStrategy } from './index';
import { Subtree } from 'lezer-tree';
import { EditorState } from '@codemirror/next/state';
import { PrometheusClient } from '../client';
import {
  AggregateOp,
  BinaryExpr,
  FunctionIdentifier,
  GroupingLabel,
  GroupingLabels,
  Identifier,
  LabelMatcher,
  LabelMatchers,
  LabelName,
  MetricIdentifier,
  StringLiteral,
  VectorSelector,
  MatchOp,
} from 'lezer-promql';
import { walkBackward, walkThrough } from '../parser/path-finder';
import { aggregateOpModifierTerms, aggregateOpTerms, binOpModifierTerms, binOpTerms, functionIdentifierTerms, matchOpTerms } from './promql.terms';

interface AutoCompleteNode {
  labels: string[];
  type: string;
}

const autocompleteNode: { [key: string]: AutoCompleteNode } = {
  matchOp: { labels: matchOpTerms, type: '' },
  binOp: { labels: binOpTerms, type: '' },
  binOpModifier: { labels: binOpModifierTerms, type: 'keyword' },
  functionIdentifier: { labels: functionIdentifierTerms, type: 'function' },
  aggregateOp: { labels: aggregateOpTerms, type: 'keyword' },
  aggregateOpModifier: { labels: aggregateOpModifierTerms, type: 'keyword' },
};

const snippets: readonly SnippetSpec[] = [
  {
    keyword: 'sum(rate(__input_vector__[5m]))',
    snippet: 'sum(rate(${__input_vector__}[5m]))',
  },
  {
    keyword: 'histogram_quantile(__quantile__, sum by(le) (rate(__histogram_metric__[5m])))',
    snippet: 'histogram_quantile(${__quantile__}, sum by(le) (rate(${__histogram_metric__}[5m])))',
  },
  {
    keyword: 'label_replace(__input_vector__, "__dst__", "__replacement__", "__src__", "__regex__")',
    snippet: 'label_replace(${__input_vector__}, "${__dst__}", "${__replacement__}", "${__src__}", "${__regex__}")',
  },
];

// parsedSnippets shouldn't be modified. It's only there to not parse everytime the above list of snippet
const parsedSnippets: Completion[] = snippets.map((s) => ({
  label: s.name || s.keyword,
  original: s.name || s.keyword,
  apply: snippet(s.snippet),
  score: 0,
}));

// HybridComplete provides a full completion result with or without a remote prometheus.
export class HybridComplete implements CompleteStrategy {
  private readonly prometheusClient: PrometheusClient | undefined;

  constructor(prometheusClient?: PrometheusClient) {
    this.prometheusClient = prometheusClient;
  }

  promQL(context: AutocompleteContext): Promise<CompletionResult> | CompletionResult | null {
    const { state, pos } = context;
    const tree = state.tree.resolve(pos, -1);
    if (tree.parent?.type.id === MetricIdentifier && tree.type.id === Identifier) {
      let nonMetricCompletions = [autocompleteNode.functionIdentifier, autocompleteNode.aggregateOp, autocompleteNode.binOp];

      if (tree.parent?.parent?.parent?.parent?.type.id === BinaryExpr) {
        // This is for autocompleting binary operator modifiers (on / ignoring / group_x). When we get here, we have something like:
        //       metric_name / ignor
        // And the tree components above the half-finished set operator will look like:
        //
        // Identifier -> MetricIdentifier -> VectorSelector -> Expr -> BinaryExpr.
        nonMetricCompletions = nonMetricCompletions.concat(autocompleteNode.binOpModifier);
      }

      // Here we cannot know if we have to autocomplete the metric_name, or the function or the aggregation.
      // So we will just autocomplete everything
      if (this.prometheusClient) {
        return this.prometheusClient.labelValues('__name__').then((metricNames: string[]) => {
          const result: AutoCompleteNode[] = [{ labels: metricNames, type: 'constant' }];
          return this.arrayToCompletionResult(result.concat(nonMetricCompletions), tree.start, pos, context, state, true);
        });
      }
      return this.arrayToCompletionResult(nonMetricCompletions, tree.start, pos, context, state, true);
    }
    if (tree.type.id === GroupingLabels || (tree.parent?.type.id === GroupingLabel && tree.type.id === LabelName)) {
      // In this case we are in the given situation:
      //      sum by ()
      // So we have to autocomplete any labelName
      return this.labelNames(tree, pos, context, state);
    }
    if (tree.type.id === LabelMatchers || (tree.parent?.type.id === LabelMatcher && tree.type.id === LabelName)) {
      // In that case we are in the given situation:
      //       metric_name{} or {}
      return this.autocompleteLabelNamesByMetric(tree, pos, context, state);
    }
    if (tree.parent?.type.id === LabelMatcher && tree.type.id === StringLiteral) {
      // In this case we are in the given situation:
      //      metric_name{labelName=""}
      // So we can autocomplete the labelValue
      return this.autocompleteLabelValue(tree.parent, tree, pos, context, state);
    }
    if (
      tree.type.id === LabelMatcher &&
      tree.firstChild?.type.id === LabelName &&
      tree.lastChild?.type.id === 0 &&
      tree.lastChild?.firstChild === null // Discontinues completion in invalid cases like `foo{bar==<cursor>}`
    ) {
      // In this case the current token is not itself a valid match op yet:
      //      metric_name{labelName!}
      return this.arrayToCompletionResult([autocompleteNode.matchOp], tree.lastChild.start, pos, context, state);
    }
    if (tree.type.id === MatchOp || tree.parent?.type.id === MatchOp) {
      // In this case the current token is already a valid match op, but could be extended, e.g. "=" to "=~".
      return this.arrayToCompletionResult([autocompleteNode.matchOp], tree.start, pos, context, state);
    }
    if (tree.parent?.type.id === BinaryExpr) {
      return this.arrayToCompletionResult([autocompleteNode.binOp], tree.start, pos, context, state);
    }
    if (tree.parent?.type.id === FunctionIdentifier) {
      return this.arrayToCompletionResult([autocompleteNode.functionIdentifier], tree.start, pos, context, state);
    }
    if (tree.parent?.type.id === AggregateOp) {
      return this.arrayToCompletionResult([autocompleteNode.aggregateOp], tree.start, pos, context, state);
    }
    if ((tree.type.id === Identifier && tree.parent?.type.id === 0) || (tree.type.id === 0 && tree.parent?.type.id !== LabelMatchers)) {
      // This matches identifier-ish keywords in certain places where a normal identifier would be invalid, like completing "b" into "by":
      //        sum b
      // ...or:
      //        sum(metric_name) b
      // ...or completing "unle" into "unless":
      //        metric_name / unle
      // TODO: This is imprecise and autocompletes in too many situations. Make this better.
      return this.arrayToCompletionResult([autocompleteNode.aggregateOpModifier].concat(autocompleteNode.binOp), tree.start, pos, context, state);
    }
    return null;
  }

  private autocompleteLabelValue(
    parent: Subtree,
    current: Subtree,
    pos: number,
    context: AutocompleteContext,
    state: EditorState
  ): Promise<CompletionResult> | null {
    if (!this.prometheusClient) {
      return null;
    }
    // First get the labelName.
    // By definition it's the firstChild: https://github.com/promlabs/lezer-promql/blob/0ef65e196a8db6a989ff3877d57fd0447d70e971/src/promql.grammar#L250
    let labelName = '';
    if (this.prometheusClient && parent.firstChild && parent.firstChild.type.id === LabelName) {
      labelName = state.sliceDoc(parent.firstChild.start, parent.firstChild.end);
    }
    // then find the metricName if it exists
    const metricName = this.getMetricNameInVectorSelector(current, state);
    return this.prometheusClient.labelValues(labelName, metricName).then((labelValues: string[]) => {
      // +1 to avoid to remove the first quote.
      return this.arrayToCompletionResult(
        [
          {
            labels: labelValues,
            type: 'text',
          },
        ],
        current.start + 1,
        pos,
        context,
        state
      );
    });
  }

  private autocompleteLabelNamesByMetric(
    tree: Subtree,
    pos: number,
    context: AutocompleteContext,
    state: EditorState
  ): Promise<CompletionResult> | null {
    return this.labelNames(tree, pos, context, state, this.getMetricNameInVectorSelector(tree, state));
  }

  private getMetricNameInVectorSelector(tree: Subtree, state: EditorState): string {
    // Find if there is a defined metric name. Should be used to autocomplete a labelValue or a labelName
    // First find the parent "VectorSelector" to be able to find then the subChild "MetricIdentifier" if it exists.
    let currentNode: Subtree | undefined | null = walkBackward(tree, VectorSelector);
    if (!currentNode) {
      // Weird case that shouldn't happen, because "VectorSelector" is by definition the parent of the LabelMatchers.
      return '';
    }
    currentNode = walkThrough(currentNode, MetricIdentifier, Identifier);
    if (!currentNode) {
      return '';
    }
    return state.sliceDoc(currentNode.start, currentNode.end);
  }

  private labelNames(
    tree: Subtree,
    pos: number,
    context: AutocompleteContext,
    state: EditorState,
    metricName?: string
  ): Promise<CompletionResult> | null {
    return !this.prometheusClient
      ? null
      : this.prometheusClient.labelNames(metricName).then((labelNames: string[]) => {
          // this case can happen when you are in empty bracket. Then you don't want to remove the first bracket
          return this.arrayToCompletionResult(
            [
              {
                labels: labelNames,
                type: 'constant',
              },
            ],
            tree.type.id === GroupingLabels || tree.type.id === LabelMatchers ? tree.start + 1 : tree.start,
            pos,
            context,
            state
          );
        });
  }

  private arrayToCompletionResult(
    data: AutoCompleteNode[],
    from: number,
    to: number,
    context: AutocompleteContext,
    state: EditorState,
    includeSnippet = false
  ): CompletionResult {
    const text = state.sliceDoc(from, to);
    const options: Completion[] = [];

    for (const completionList of data) {
      for (const label of completionList.labels) {
        const completionResult = context.filter(
          {
            label: label,
            original: label,
            apply: label,
            type: completionList.type,
            score: 0,
          },
          text
        );
        if (completionResult !== null) {
          options.push(completionResult);
        }
      }
    }
    if (includeSnippet) {
      for (const s of parsedSnippets) {
        const completionResult = context.filter(s, text);
        if (completionResult !== null) {
          options.push(completionResult);
        }
      }
    }
    return {
      from: from,
      to: to,
      options: options,
      filterDownOn: /^[a-zA-Z0-9_:]+$/,
    } as CompletionResult;
  }
}
