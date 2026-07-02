const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
	assertPackageVersionsAgree,
	compareSemver,
	generateChangelog,
	parseReleaseTag,
	selectPreviousTag,
	updatePackageVersion,
} = require('../scripts/ci/release-utils.cjs');

function createPackageFixture(version, lockVersion = version, rootLockVersion = lockVersion) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hustleops-release-utils-'));
	fs.writeFileSync(
		path.join(directory, 'package.json'),
		`${JSON.stringify({ name: '@hustleops-n8n/n8n-nodes-hustleops', version }, null, '\t')}\n`,
	);
	fs.writeFileSync(
		path.join(directory, 'package-lock.json'),
		`${JSON.stringify(
			{
				name: '@hustleops-n8n/n8n-nodes-hustleops',
				version: lockVersion,
				lockfileVersion: 3,
				packages: {
					'': {
						name: '@hustleops-n8n/n8n-nodes-hustleops',
						version: rootLockVersion,
					},
				},
			},
			null,
			'\t',
		)}\n`,
	);
	return directory;
}

test('parseReleaseTag accepts stable v-prefixed semver tags', () => {
	assert.deepEqual(parseReleaseTag('v0.1.2'), { major: 0, minor: 1, patch: 2, version: '0.1.2' });
	assert.deepEqual(parseReleaseTag('v10.20.30'), {
		major: 10,
		minor: 20,
		patch: 30,
		version: '10.20.30',
	});
});

test('parseReleaseTag rejects bare, prerelease, and malformed tags', () => {
	for (const tag of ['0.1.2', 'v0.1', 'v0.1.2-beta.1', 'v0.1.2+build.1', 'version']) {
		assert.throws(() => parseReleaseTag(tag), /release_tag must match vX.Y.Z/);
	}
});

test('compareSemver sorts versions numerically', () => {
	assert.equal(compareSemver('0.1.2', '0.1.1'), 1);
	assert.equal(compareSemver('0.1.2', '0.1.2'), 0);
	assert.equal(compareSemver('0.1.2', '0.2.0'), -1);
	assert.equal(compareSemver('10.0.0', '2.0.0'), 1);
});

test('selectPreviousTag accepts legacy bare tags and new v-prefixed tags', () => {
	assert.equal(selectPreviousTag(['0.1.0', '0.1.1'], '0.1.2'), '0.1.1');
	assert.equal(selectPreviousTag(['0.1.1', 'v0.1.2', 'v0.2.0'], '0.3.0'), 'v0.2.0');
	assert.equal(selectPreviousTag(['v0.1.0'], '0.1.0'), null);
});

test('selectPreviousTag rejects duplicate tag styles for the same previous version', () => {
	assert.throws(() => selectPreviousTag(['0.1.1', 'v0.1.1'], '0.1.2'), /duplicate release tags/);
});

test('assertPackageVersionsAgree detects package and lockfile mismatch', () => {
	assert.doesNotThrow(() => assertPackageVersionsAgree(createPackageFixture('0.1.1')));
	assert.throws(
		() => assertPackageVersionsAgree(createPackageFixture('0.1.1', '0.1.2')),
		/package.json version 0.1.1 does not match package-lock.json version 0.1.2/,
	);
	assert.throws(
		() => assertPackageVersionsAgree(createPackageFixture('0.1.1', '0.1.1', '0.1.2')),
		/package-lock.json packages\[""\] version 0.1.2/,
	);
});

test('updatePackageVersion updates package and root lockfile versions', () => {
	const directory = createPackageFixture('0.1.1');
	updatePackageVersion(directory, '0.1.2');

	const packageJson = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
	const packageLock = JSON.parse(
		fs.readFileSync(path.join(directory, 'package-lock.json'), 'utf8'),
	);

	assert.equal(packageJson.version, '0.1.2');
	assert.equal(packageLock.version, '0.1.2');
	assert.equal(packageLock.packages[''].version, '0.1.2');
});

test('generateChangelog creates a release entry from conventional commits', () => {
	const changelog = generateChangelog('', 'v0.1.2', '2026-07-02', [
		'feat(alerts): add search filter',
		'fix: correct package registry',
		'docs(ci): add release runbook',
		'chore(release): v0.1.2',
	]);

	assert.match(changelog, /^# Changelog/);
	assert.match(changelog, /## v0.1.2 - 2026-07-02/);
	assert.match(changelog, /### Features/);
	assert.match(changelog, /- add search filter \(`alerts`\)/);
	assert.match(changelog, /### Fixes/);
	assert.match(changelog, /- correct package registry/);
	assert.match(changelog, /### Documentation/);
	assert.doesNotMatch(changelog, /chore\(release\): v0.1.2/);
});
