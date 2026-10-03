import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(resolve(process.env.TYPIST_CANDIDATE_ROOT || '.', 'components/report-writing/ResumeWorkflowButton.tsx'), 'utf8');
type Element = { type: string; props: { children?: unknown; onClick?: () => unknown; role?: string; [key: string]: unknown } };
function fixture(result: 'accepted' | 'rejected' | 'uncertain', initiallyEligible = true) {
  const state: unknown[] = [], effects: Array<{ deps: unknown[]; cleanup?: () => void }> = [];
  let cursor = 0, effectCursor = 0, eligible = initiallyEligible, revision = 'before', queued = 0, posts = 0;
  let scheduled: Array<() => void> = [];
  const react = {
    useState: (initial: unknown) => {
      const index = cursor++; if (!(index in state)) state[index] = initial;
      return [state[index], (next: unknown) => { state[index] = next; }];
    },
    useRef: (initial: unknown) => { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useEffect: (effect: () => (() => void), deps: unknown[]) => {
      const index = effectCursor++, previous = effects[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        scheduled.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: effect() }; });
      }
    },
  };
  const box = { exports: {} as { ResumeWorkflowButton: (props: unknown) => Element | null },
    require: (name: string) => name === 'react' ? react : { jsx: (type: string, props: Element['props']) => ({ type, props }), jsxs: (type: string, props: Element['props']) => ({ type, props }) },
    AbortController,
    fetch: async (_url: string, options?: { method?: string }) => {
      if (options?.method !== 'POST') return Response.json({ eligible });
      posts++;
      if (result === 'uncertain') throw new Error('synthetic network uncertainty');
      return Response.json({ success: result === 'accepted', error: result === 'rejected' ? 'This workflow is not currently eligible for safe automatic resumption.' : undefined }, { status: result === 'accepted' ? 200 : 409 });
    },
  };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, box);
  const render = () => {
    cursor = 0; effectCursor = 0;
    const tree = box.exports.ResumeWorkflowButton({ draftId: 'synthetic', revision, onQueued: () => { queued++; } });
    const work = scheduled; scheduled = []; work.forEach(effect => effect()); return tree;
  };
  const settle = () => new Promise(r => setImmediate(r));
  return { render, settle, queued: () => queued, posts: () => posts, authoritative: () => { revision = 'after'; eligible = false; },
    submit: async () => {
      render(); await settle(); let tree = render();
      const idle = elements(tree).find(e => e.type === 'button'); assert.ok(idle); idle.props.onClick?.();
      tree = render(); const confirm = elements(tree).find(e => e.type === 'button' && e.props.children === 'Yes — resume workflow');
      assert.ok(confirm); await confirm.props.onClick?.(); return render();
    },
  };
}
function elements(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return [];
  const node = tree as Element; return [node, ...elements(node.props.children)];
}
function text(tree: unknown): string {
  if (typeof tree === 'string') return tree;
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return '';
  return text((tree as Element).props.children);
}
for (const result of ['rejected', 'uncertain'] as const) test(`actual Resume ${result} result stays visible while ineligible action is unavailable`, async () => {
  const f = fixture(result); const tree = await f.submit();
  assert.equal(f.queued(), 1); assert.equal(f.posts(), 1);
  assert.match(text(tree), result === 'rejected' ? /not currently eligible/ : /acknowledgement is unavailable/);
  assert.ok(elements(tree).some(e => e.props.role === 'status'));
  assert.equal(elements(tree).filter(e => e.type === 'button').length, 0);
});
test('accepted Resume requests reconciliation and closes submission controls', async () => {
  const f = fixture('accepted'); const tree = await f.submit(); assert.equal(f.queued(), 1); assert.equal(f.posts(), 1);
  assert.equal(elements(tree).filter(e => e.type === 'button').length, 0);
  f.authoritative(); f.render(); await f.settle(); assert.equal(f.render(), null);
});
for (const result of ['rejected', 'uncertain'] as const) test(`authoritative revision clears obsolete ${result} result`, async () => {
  const f = fixture(result); await f.submit(); f.authoritative(); f.render(); await f.settle(); assert.equal(f.render(), null);
});
test('normal ineligible state without local result remains hidden', async () => {
  const f = fixture('rejected', false); f.render(); await f.settle(); assert.equal(f.render(), null); assert.equal(f.posts(), 0);
});
