import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { processJSON } from '../src/lib/json';

// Graph.tsx imports stylesheets; let Node treat them as empty modules.
const CSS = { format: 'module' as const, source: '', shortCircuit: true };
if (nodeModule.registerHooks)
  nodeModule.registerHooks({
    load: (url, context, next) => (url.endsWith('.css') ? CSS : next(url, context)),
  });
else
  nodeModule.register(
    'data:text/javascript,' +
      encodeURIComponent(
        'export async function load(url, context, next) { return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, context); }',
      ),
  );
const {
  graphIndex,
  graphLayout,
  initialCollapse,
  countVisible,
  cardChain,
  exportPixelRatio,
  isColorValue,
  isUrlValue,
  CARD_WIDTH,
  MAX_VISIBLE_CARDS,
} = await import('../src/components/Graph');

const entries = (value: unknown) => processJSON(JSON.stringify(value)).entries;
const ORBITAL = entries({
  project: 'Orbital',
  settings: { theme: '#b5d68b', notifications: true },
  crew: [
    { name: 'Alex', role: 'Engineer' },
    { name: 'Sam', role: 'Designer' },
  ],
});

test('lays out one card per visible container', () => {
  const layout = graphLayout(ORBITAL);
  assert.deepEqual(
    layout.cards.map((card) => card.entry.path),
    ['', '/settings', '/crew', '/crew/0', '/crew/1'],
  );
  assert.equal(layout.visible, 5);
  assert.equal(layout.total, 5);
  assert.equal(layout.overflow, false);
  assert.equal(countVisible(ORBITAL, new Set()), 5);
});

test('hidden containers drop their whole subtree from the layout', () => {
  const layout = graphLayout(ORBITAL, { hidden: new Set(['/crew']) });
  assert.deepEqual(
    layout.cards.map((card) => card.entry.path),
    ['', '/settings'],
  );
  assert.equal(layout.total - layout.visible, 3);
  assert.equal(countVisible(ORBITAL, new Set(['/crew/0'])), 4);
});

test('focuses a branch', () => {
  const layout = graphLayout(ORBITAL, { root: '/crew' });
  assert.deepEqual(
    layout.cards.map((card) => card.entry.path),
    ['/crew', '/crew/0', '/crew/1'],
  );
  assert.equal(layout.total, 3);
  assert.equal(layout.positions.get('/crew')?.depth, 0);
});

test('direction swaps the depth and breadth axes', () => {
  const lr = graphLayout(ORBITAL, { direction: 'LR' }).positions;
  const tb = graphLayout(ORBITAL, { direction: 'TB' }).positions;
  const [root, crew, alex, sam] = ['', '/crew', '/crew/0', '/crew/1'];
  assert.ok(lr.get(crew)!.x > lr.get(root)!.x);
  assert.equal(lr.get(alex)!.x, lr.get(sam)!.x);
  assert.ok(lr.get(sam)!.y > lr.get(alex)!.y);
  assert.ok(tb.get(crew)!.y > tb.get(root)!.y);
  assert.equal(tb.get(alex)!.y, tb.get(sam)!.y);
  assert.ok(tb.get(sam)!.x > tb.get(alex)!.x);
  assert.equal(lr.get(alex)!.width, CARD_WIDTH);
});

test('parents are centred on their children where space allows', () => {
  const { positions } = graphLayout(ORBITAL);
  const crew = positions.get('/crew')!;
  const alex = positions.get('/crew/0')!;
  const sam = positions.get('/crew/1')!;
  const childCentre = (alex.y + sam.y + sam.height) / 2;
  assert.ok(Math.abs(crew.y + crew.height / 2 - childCentre) < 1);
});

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('cards never overlap, in either direction', () => {
  const doc = entries({
    a: { b: [{ c: 1 }, { d: { e: [1, 2, 3, 4, 5, 6, 7, 8, 9] } }], f: {} },
    g: Array.from({ length: 6 }, (_, i) => ({ i, nested: { deep: { deeper: i } } })),
    h: { only: { one: { chain: { here: true } } } },
    big: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, i])),
  });
  for (const direction of ['LR', 'TB'] as const) {
    const { cards } = graphLayout(doc, { direction });
    assert.equal(cards.length, countVisible(doc, new Set()));
    for (let i = 0; i < cards.length; i++)
      for (let j = i + 1; j < cards.length; j++)
        assert.ok(
          !overlaps(cards[i], cards[j]),
          `${direction}: ${cards[i].entry.path} overlaps ${cards[j].entry.path}`,
        );
  }
});

test('initial collapse keeps the deepest level that fits the budget', () => {
  const doc = entries(Array.from({ length: 50 }, (_, i) => ({ i, child: { leaf: { x: i } } })));
  // 1 root + 50 items + 50 children + 50 leaves = 151 containers.
  assert.equal(initialCollapse(doc, 200).size, 0);
  const hidden = initialCollapse(doc, 120);
  assert.equal(countVisible(doc, hidden), 101);
  assert.ok(hidden.has('/0/child/leaf') && !hidden.has('/0/child'));
  const tight = initialCollapse(doc, 40);
  assert.equal(countVisible(doc, tight), 1);
  assert.equal(tight.size, 150);
  const branch = initialCollapse(doc, 1, '/3');
  assert.deepEqual([...branch].sort(), ['/3/child', '/3/child/leaf']);
});

test('caps the number of drawn cards', () => {
  const doc = entries(Array.from({ length: 30 }, () => ({})));
  const layout = graphLayout(doc, { cap: 20 });
  assert.equal(layout.overflow, true);
  assert.equal(layout.cards.length, 0);
  assert.ok(MAX_VISIBLE_CARDS >= 1000);
  assert.equal(graphLayout(doc, { cap: 31 }).cards.length, 31);
});

test('large documents lay out in linear time', () => {
  const doc = entries(Array.from({ length: 20_000 }, (_, i) => ({ i, tags: [i] })));
  const index = graphIndex(doc);
  const started = performance.now();
  const hidden = initialCollapse(index);
  const layout = graphLayout(index, { hidden });
  assert.equal(layout.visible, 1);
  assert.equal(layout.total, 40_001);
  assert.ok(performance.now() - started < 1000);
});

test('card chain names the card and its ancestors', () => {
  assert.deepEqual(cardChain(ORBITAL, '/crew/1/name'), ['/crew/1', '/crew', '']);
  assert.deepEqual(cardChain(ORBITAL, '/settings'), ['/settings', '']);
  assert.deepEqual(cardChain(ORBITAL, '/missing'), []);
});

test('export pixel ratio stays within canvas limits', () => {
  assert.equal(exportPixelRatio(800, 600), 2);
  for (const [w, h] of [
    [20_000, 3_000],
    [5_000, 40_000],
    [9_000, 9_000],
  ]) {
    const ratio = exportPixelRatio(w, h);
    assert.ok(w * ratio <= 16_384 && h * ratio <= 16_384);
    assert.ok(w * h * ratio * ratio <= 16_000_001);
  }
});

test('recognises colours and links', () => {
  for (const value of [
    '#abc',
    '#abcd',
    '#a1b2c3',
    '#a1b2c3d4',
    'rgb(1, 2, 3)',
    'rgba(1,2,3,0.5)',
    'hsl(120 50% 40%)',
    'hsla(120, 50%, 40%, .3)',
  ])
    assert.ok(isColorValue(value), value);
  for (const value of ['#abcde', 'red', 'rgb(1,2)', 'url(x)', 'rgb(1,2,3); x'])
    assert.ok(!isColorValue(value), value);
  assert.ok(isUrlValue('https://example.com/a?b=c'));
  assert.ok(!isUrlValue('javascript:alert(1)'));
  assert.ok(!isUrlValue('ftp://example.com'));
});
