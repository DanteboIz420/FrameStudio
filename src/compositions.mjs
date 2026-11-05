import { defaults, uid } from './model.mjs';

const keys = Object.keys(defaults()).filter((k) => !['version', 'name', 'media'].includes(k));
export function compositionState(p) {
  return structuredClone(Object.fromEntries(keys.map((k) => [k, p[k]])));
}
export function syncCompositions(p) {
  if (!p.compositions?.length) {
    p.activeComposition = uid();
    p.compositions = [
      { id: p.activeComposition, name: 'Composition 1', state: compositionState(p) },
    ];
  }
  const active = p.compositions.find((c) => c.id === p.activeComposition);
  if (!active) throw Error('Active composition is missing.');
  active.state = compositionState(p);
  return p;
}
export function switchComposition(p, id) {
  syncCompositions(p);
  const next = p.compositions.find((c) => c.id === id);
  if (!next) throw Error('Composition not found.');
  Object.assign(p, structuredClone(next.state));
  p.activeComposition = id;
}
export function addComposition(p, name, source = null) {
  syncCompositions(p);
  const state = compositionState(p);
  state.clips = source ? [{ ...structuredClone(source), id: uid(), start: 0, slot: 0 }] : [];
  if (source) state.layout = 'single';
  const item = { id: uid(), name, state };
  p.compositions.push(item);
  switchComposition(p, item.id);
  return item;
}
export function compositionProject(p, item) {
  return {
    ...defaults(),
    ...structuredClone(item.state),
    name: item.name,
    media: structuredClone(p.media),
  };
}
