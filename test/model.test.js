import test from 'node:test';
import assert from 'node:assert/strict';
import { createSamples, validateCompanies, filterCompanies, progress, safeUrl, daysUntil } from '../src/model.js';

test('research progress counts populated research sections, not company metadata', () => {
  assert.equal(progress({ name: '企業名', industry: 'IT', business: '事業', strength: '   ', culture: '社風' }), 40);
  assert.equal(progress({}), 0);
});
test('filters combine search, industry, status and favorites', () => {
  const data = createSamples();
  assert.equal(filterCompanies(data, { search: 'プロダクト', industry: 'IT・通信', status: '研究中', favorites: true })[0].id, 'sample-1');
  assert.equal(filterCompanies(data, { search: 'プロダクト', status: '選考中' }).length, 0);
  assert.equal(filterCompanies(data, { search: '   ' }).length, data.length);
});
test('backup round trip preserves all research notes', () => {
  const data = createSamples();
  assert.deepEqual(validateCompanies(JSON.parse(JSON.stringify(data))), data);
});
test('invalid backups cannot introduce duplicate IDs, executable URLs or invalid dates', () => {
  const data = createSamples();
  assert.throws(() => validateCompanies([data[0], data[0]]), /重複/);
  assert.throws(() => validateCompanies([{ ...data[0], url: 'javascript:alert(1)' }]), /URL/);
  assert.throws(() => validateCompanies([{ ...data[0], deadline: '2026-02-30' }]), /日付/);
  assert.throws(() => validateCompanies([{ ...data[0], status: 'unknown' }]), /ステータス/);
  assert.throws(() => validateCompanies([{ ...data[0], business: {} }]), /テキスト/);
  assert.throws(() => validateCompanies([{ ...data[0], name: '   ' }]), /企業名/);
  assert.equal(safeUrl('https://example.com/careers'), 'https://example.com/careers');
  assert.equal(safeUrl('data:text/html,hello'), '');
});
test('deadline difference uses calendar days and distinguishes past, today and future', () => {
  const now = new Date(2026, 9, 30, 23, 59);
  assert.equal(daysUntil('2026-10-30', now), 0);
  assert.equal(daysUntil('2026-11-01', now), 2);
  assert.equal(daysUntil('2026-10-29', now), -1);
  assert.equal(daysUntil('', now), null);
});
