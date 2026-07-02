const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
	CONVENTIONAL_COMMIT_PATTERN,
	assertValidSubjects,
	isIgnoredSubject,
	normalizeSubject,
	validateSubjects,
} = require('../scripts/ci/commit-rules.cjs');

test('normalizes commit subjects before validation', () => {
	assert.equal(normalizeSubject('  fix: trim whitespace  '), 'fix: trim whitespace');
	assert.equal(normalizeSubject(undefined), '');
});

test('accepts repository conventional commit subjects', () => {
	const subjects = [
		'build: update package metadata',
		'chore(ci): add release workflow',
		'ci!: replace release pipeline',
		'docs: update release runbook',
		'feat(alerts): add search option',
		'fix: correct package registry',
		'perf(cache)!: reduce release lookup time',
		'refactor(workflows): split release helpers',
		'style: format release plan',
		'test(ci): cover version parser',
		'revert: fix: correct package registry',
	];

	assert.deepEqual(validateSubjects(subjects), []);
	for (const subject of subjects) {
		assert.match(subject, CONVENTIONAL_COMMIT_PATTERN);
	}
});

test('ignores merge, blank, and comment subjects', () => {
	assert.equal(isIgnoredSubject('Merge branch main'), true);
	assert.equal(isIgnoredSubject(''), true);
	assert.equal(isIgnoredSubject('   '), true);
	assert.equal(isIgnoredSubject('# comment'), true);
	assert.deepEqual(validateSubjects(['Merge pull request #1', '', '# skipped']), []);
});

test('reports invalid commit subjects exactly', () => {
	assert.deepEqual(validateSubjects(['Added release workflow', 'fix:', 'bugfix: bad type']), [
		'Added release workflow',
		'fix:',
		'bugfix: bad type',
	]);
});

test('assertValidSubjects includes invalid subjects in the error message', () => {
	assert.throws(
		() => assertValidSubjects(['fix: valid', 'broken subject'], 'commit subjects'),
		/error validating commit subjects:\n- broken subject/,
	);
});
