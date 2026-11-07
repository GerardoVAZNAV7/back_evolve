import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogMeta,
  findExercise,
  hasLanguage,
  listExercises,
  toExerciseDetail,
  toExerciseSummary,
} from '../src/catalog.js';

const baseUrl = 'http://localhost:3000';

test('el catálogo carga el dataset completo sin ids duplicados', () => {
  const meta = catalogMeta();
  assert.equal(meta.total, 1324);
  assert.ok(meta.bodyParts.length >= 10);
  assert.ok(meta.languages.includes('es'));
  assert.ok(meta.languages.includes('en'));
  assert.match(meta.attribution, /Gym visual/);
});

test('los idiomas soportados se validan', () => {
  assert.equal(hasLanguage('es'), true);
  assert.equal(hasLanguage('xx'), false);
});

test('el listado filtra por texto y pagina', () => {
  const all = listExercises({ limit: 5, offset: 0 }, baseUrl);
  assert.equal(all.data.length, 5);
  assert.ok(all.total > 5);
  assert.equal(all.data[0]?.imageUrl.startsWith(`${baseUrl}/media/images/`), true);
  assert.equal(all.data[0]?.gifUrl.startsWith(`${baseUrl}/media/videos/`), true);

  const page2 = listExercises({ limit: 5, offset: 5 }, baseUrl);
  assert.notEqual(page2.data[0]?.id, all.data[0]?.id);
});

test('el listado filtra por grupo muscular', () => {
  const result = listExercises(
    { bodyPart: 'chest', limit: 100, offset: 0 },
    baseUrl
  );
  assert.ok(result.total > 0);
  assert.equal(result.data.every((exercise) => exercise.bodyPart === 'chest'), true);
});

test('el detalle devuelve instrucciones en español', () => {
  const first = listExercises({ limit: 1, offset: 0 }, baseUrl).data[0];
  assert.ok(first);

  const raw = findExercise(first.id);
  assert.ok(raw);

  const detail = toExerciseDetail(raw, 'es', baseUrl);
  assert.equal(detail.id, first.id);
  assert.ok(detail.instructions.length > 0);
  assert.ok(Array.isArray(detail.steps));

  const summary = toExerciseSummary(raw, baseUrl);
  assert.equal(summary.imageUrl, first.imageUrl);
});

test('un id inexistente devuelve undefined', () => {
  assert.equal(findExercise('9999'), undefined);
});
