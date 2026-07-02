#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { assertValidSubjects } = require('./commit-rules.cjs');

function readArg(name) {
	const index = process.argv.indexOf(name);
	return index === -1 ? null : process.argv[index + 1];
}

function readCommitSubjects() {
	const commitsFile = readArg('--commits-file');
	if (commitsFile) {
		return fs.readFileSync(commitsFile, 'utf8').split(/\r?\n/);
	}

	const commits = readArg('--commits');
	if (commits) {
		return commits.split(/\r?\n/);
	}

	return [];
}

function main() {
	const title = readArg('--title') ?? process.env.PR_TITLE ?? '';
	const commitSubjects = readCommitSubjects();

	assertValidSubjects([title], 'pull request title');
	assertValidSubjects(commitSubjects, 'commit subjects');
	console.log('Commit metadata follows the repository convention.');
}

try {
	main();
} catch (error) {
	console.error(error.message);
	process.exit(1);
}
