'use strict';

const CONVENTIONAL_COMMIT_PATTERN =
	/^(?:revert: )?(?:build|chore|ci|docs|feat|fix|perf|refactor|style|test)(?:\([^)]+\))?!?: .+$/;

function normalizeSubject(subject) {
	return String(subject ?? '').trim();
}

function isIgnoredSubject(subject) {
	const normalized = normalizeSubject(subject);
	return normalized === '' || normalized.startsWith('#') || normalized.startsWith('Merge ');
}

function validateSubjects(subjects) {
	const invalidSubjects = [];

	for (const subject of subjects) {
		const normalized = normalizeSubject(subject);
		if (isIgnoredSubject(normalized)) {
			continue;
		}

		if (!CONVENTIONAL_COMMIT_PATTERN.test(normalized)) {
			invalidSubjects.push(normalized);
		}
	}

	return invalidSubjects;
}

function assertValidSubjects(subjects, label) {
	const invalidSubjects = validateSubjects(subjects);
	if (invalidSubjects.length === 0) {
		return;
	}

	const details = invalidSubjects.map((subject) => `- ${subject}`).join('\n');
	throw new Error(`error validating ${label}:\n${details}`);
}

module.exports = {
	CONVENTIONAL_COMMIT_PATTERN,
	assertValidSubjects,
	isIgnoredSubject,
	normalizeSubject,
	validateSubjects,
};
