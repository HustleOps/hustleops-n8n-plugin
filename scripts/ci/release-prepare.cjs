#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { assertValidSubjects } = require('./commit-rules.cjs');
const {
	assertPackageVersionsAgree,
	compareSemver,
	generateChangelog,
	parseReleaseTag,
	selectPreviousTag,
	updatePackageVersion,
} = require('./release-utils.cjs');

const PACKAGE_IMPACTING_PATHS = [
	'.npmignore',
	'CHANGELOG.md',
	'LICENSE',
	'README.md',
	'credentials',
	'dist',
	'nodes',
	'package-lock.json',
	'package.json',
];

function readArg(name) {
	const index = process.argv.indexOf(name);
	return index === -1 ? null : process.argv[index + 1];
}

function hasFlag(name) {
	return process.argv.includes(name);
}

function runGit(args) {
	return childProcess.execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function tryRunGit(args) {
	try {
		return childProcess
			.execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
			.trim();
	} catch {
		return null;
	}
}

function writeOutput(name, value) {
	const outputPath = process.env.GITHUB_OUTPUT;
	if (!outputPath) {
		return;
	}
	fs.appendFileSync(outputPath, `${name}=${value}\n`);
}

function getSubjects(previousTag) {
	const range = previousTag ? [`${previousTag}..HEAD`] : ['HEAD'];
	const output = runGit(['log', '--format=%s', ...range]);
	return output === '' ? [] : output.split(/\r?\n/);
}

function assertTagDoesNotExist(tag) {
	const tags = runGit(['tag', '--list', tag]);
	if (tags !== '') {
		throw new Error(`release tag already exists: ${tag}`);
	}
}

function assertPreparedReleaseTag(releaseTag, releaseCommit) {
	const tagRef = `refs/tags/${releaseTag}`;
	if (!tryRunGit(['show-ref', '--hash', '--verify', tagRef])) return;

	const tagCommit = runGit(['rev-parse', '--verify', `${tagRef}^{commit}`]);
	if (
		tryRunGit(['merge-base', '--is-ancestor', releaseCommit, tagCommit]) === null ||
		tryRunGit(['merge-base', '--is-ancestor', tagCommit, 'HEAD']) === null ||
		getPackageImpactingChangesSince(tagCommit).length > 0
	) {
		throw new Error(`${releaseTag} does not identify this prepared package on main`);
	}
}

function findPreparedReleaseCommit(releaseTag) {
	const releaseSubject = `chore(release): ${releaseTag}`;
	const commits = runGit(['log', '--format=%H%x00%s']);

	for (const commit of commits.split(/\r?\n/)) {
		const separatorIndex = commit.indexOf('\0');
		if (separatorIndex === -1) {
			continue;
		}

		const sha = commit.slice(0, separatorIndex);
		const subject = commit.slice(separatorIndex + 1);
		if (subject === releaseSubject) {
			return sha;
		}
	}

	return null;
}

function getPackageImpactingChangesSince(commit) {
	const output = runGit([
		'diff',
		'--name-only',
		`${commit}..HEAD`,
		'--',
		...PACKAGE_IMPACTING_PATHS,
	]);
	return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function assertPreparedReleaseState(rootDirectory, releaseTag) {
	const changelogPath = path.join(rootDirectory, 'CHANGELOG.md');
	const changelog = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';
	const releaseCommit = findPreparedReleaseCommit(releaseTag);

	if (!releaseCommit) {
		throw new Error(
			`current version already matches ${releaseTag}, but HEAD is not the release commit`,
		);
	}
	const packageChanges = getPackageImpactingChangesSince(releaseCommit);
	if (packageChanges.length > 0) {
		throw new Error(
			`current version already matches ${releaseTag}, but package-impacting files changed after the release commit:\n- ${packageChanges.join('\n- ')}`,
		);
	}
	if (
		!new RegExp(`^## ${releaseTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} - `, 'm').test(changelog)
	) {
		throw new Error(
			`current version already matches ${releaseTag}, but CHANGELOG.md has no release entry`,
		);
	}
	assertPreparedReleaseTag(releaseTag, releaseCommit);
}

function main() {
	const releaseTag = readArg('--release-tag') ?? process.env.RELEASE_TAG;
	const write = hasFlag('--write');
	const requirePrepared =
		hasFlag('--require-prepared') || process.env.RELEASE_REQUIRE_PREPARED === 'true';
	const rootDirectory = process.cwd();
	const requested = parseReleaseTag(releaseTag);
	const currentVersion = assertPackageVersionsAgree(rootDirectory);
	const preparedRelease = currentVersion === requested.version;

	if (compareSemver(requested.version, currentVersion) < 0) {
		throw new Error(
			`requested version ${requested.version} must be greater than current version ${currentVersion}`,
		);
	}
	if (requirePrepared && !preparedRelease) {
		throw new Error(
			`release files must be prepared through a pull request before publishing ${releaseTag}`,
		);
	}

	assertTagDoesNotExist(requested.version);
	if (preparedRelease) {
		assertPreparedReleaseState(rootDirectory, releaseTag);
	} else {
		assertTagDoesNotExist(releaseTag);
	}

	const tagsOutput = runGit(['tag', '--list']);
	const tags = tagsOutput === '' ? [] : tagsOutput.split(/\r?\n/);
	const previousTag = selectPreviousTag(tags, requested.version);
	const subjects = getSubjects(previousTag);
	assertValidSubjects(subjects, `commits in ${previousTag ?? 'initial history'}..HEAD`);

	writeOutput('package_version', requested.version);
	writeOutput('release_tag', releaseTag);
	writeOutput('previous_tag', previousTag ?? '');
	writeOutput('release_already_prepared', preparedRelease ? 'true' : 'false');

	if (preparedRelease) {
		console.log(`Release files are already prepared for ${releaseTag}.`);
		return;
	}

	if (!write) {
		console.log(`Release preflight passed for ${releaseTag}.`);
		return;
	}

	updatePackageVersion(rootDirectory, requested.version);
	const changelogPath = path.join(rootDirectory, 'CHANGELOG.md');
	const existingChangelog = fs.existsSync(changelogPath)
		? fs.readFileSync(changelogPath, 'utf8')
		: '';
	const releaseDate = new Date().toISOString().slice(0, 10);
	const changelog = generateChangelog(existingChangelog, releaseTag, releaseDate, subjects);
	fs.writeFileSync(changelogPath, changelog);
	console.log(`Prepared release files for ${releaseTag}.`);
}

try {
	main();
} catch (error) {
	console.error(error.message);
	process.exit(1);
}
