const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
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
		`${JSON.stringify({ name: '@hustleops/n8n-nodes-hustleops', version }, null, '\t')}\n`,
	);
	fs.writeFileSync(
		path.join(directory, 'package-lock.json'),
		`${JSON.stringify(
			{
				name: '@hustleops/n8n-nodes-hustleops',
				version: lockVersion,
				lockfileVersion: 3,
				packages: {
					'': {
						name: '@hustleops/n8n-nodes-hustleops',
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

function createGitPackageFixture(
	version,
	{
		changelog = '',
		subject = 'feat: create release fixture',
		lockVersion = version,
		rootLockVersion = lockVersion,
	} = {},
) {
	const directory = createPackageFixture(version, lockVersion, rootLockVersion);
	fs.writeFileSync(path.join(directory, 'CHANGELOG.md'), changelog);
	childProcess.execFileSync('git', ['init'], { cwd: directory, stdio: 'ignore' });
	childProcess.execFileSync('git', ['config', 'user.name', 'Test User'], {
		cwd: directory,
		stdio: 'ignore',
	});
	childProcess.execFileSync('git', ['config', 'user.email', 'test@example.com'], {
		cwd: directory,
		stdio: 'ignore',
	});
	childProcess.execFileSync('git', ['add', 'package.json', 'package-lock.json', 'CHANGELOG.md'], {
		cwd: directory,
		stdio: 'ignore',
	});
	childProcess.execFileSync('git', ['commit', '-m', subject], { cwd: directory, stdio: 'ignore' });
	return directory;
}

function createMergedReleaseFixture() {
	const directory = createGitPackageFixture('0.1.1', {
		changelog: '# Changelog\n',
		subject: 'feat: create release fixture',
	});
	const baseBranch = childProcess
		.execFileSync('git', ['branch', '--show-current'], { cwd: directory, encoding: 'utf8' })
		.trim();

	childProcess.execFileSync('git', ['checkout', '-b', 'release-v0.1.2'], {
		cwd: directory,
		stdio: 'ignore',
	});
	updatePackageVersion(directory, '0.1.2');
	fs.writeFileSync(
		path.join(directory, 'CHANGELOG.md'),
		'# Changelog\n\n## v0.1.2 - 2026-07-03\n\n- Prepared release.\n',
	);
	childProcess.execFileSync('git', ['add', 'package.json', 'package-lock.json', 'CHANGELOG.md'], {
		cwd: directory,
		stdio: 'ignore',
	});
	childProcess.execFileSync('git', ['commit', '-m', 'chore(release): v0.1.2'], {
		cwd: directory,
		stdio: 'ignore',
	});
	childProcess.execFileSync('git', ['checkout', baseBranch], { cwd: directory, stdio: 'ignore' });
	childProcess.execFileSync(
		'git',
		[
			'merge',
			'--no-ff',
			'release-v0.1.2',
			'-m',
			'Merge pull request #4 from HustleOps/codex/release-v0.1.2',
		],
		{ cwd: directory, stdio: 'ignore' },
	);

	return directory;
}

function mergePostReleaseChange(directory, { branch, subject, mergeSubject, files }) {
	const baseBranch = childProcess
		.execFileSync('git', ['branch', '--show-current'], { cwd: directory, encoding: 'utf8' })
		.trim();
	childProcess.execFileSync('git', ['checkout', '-b', branch], {
		cwd: directory,
		stdio: 'ignore',
	});

	for (const [relativePath, contents] of Object.entries(files)) {
		const filePath = path.join(directory, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, contents);
	}

	childProcess.execFileSync('git', ['add', ...Object.keys(files)], {
		cwd: directory,
		stdio: 'ignore',
	});
	childProcess.execFileSync('git', ['commit', '-m', subject], {
		cwd: directory,
		stdio: 'ignore',
	});
	childProcess.execFileSync('git', ['checkout', baseBranch], { cwd: directory, stdio: 'ignore' });
	childProcess.execFileSync('git', ['merge', '--no-ff', branch, '-m', mergeSubject], {
		cwd: directory,
		stdio: 'ignore',
	});
}

function runReleasePrepare(directory, args) {
	return childProcess.execFileSync(
		process.execPath,
		[path.join(__dirname, '..', 'scripts', 'ci', 'release-prepare.cjs'), ...args],
		{ cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
	);
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

test('release prepare write updates package files and changelog', () => {
	const directory = createGitPackageFixture('0.1.1', {
		changelog: '# Changelog\n\n## v0.1.1 - 2026-07-01\n\n- Existing release.\n',
		subject: 'feat(alerts): add severity mapping',
	});
	childProcess.execFileSync('git', ['tag', 'v0.1.1'], { cwd: directory, stdio: 'ignore' });
	fs.writeFileSync(path.join(directory, 'README.md'), '# Fixture\n');
	childProcess.execFileSync('git', ['add', 'README.md'], { cwd: directory, stdio: 'ignore' });
	childProcess.execFileSync('git', ['commit', '-m', 'docs: update release notes'], {
		cwd: directory,
		stdio: 'ignore',
	});

	const output = runReleasePrepare(directory, ['--release-tag', 'v0.1.2', '--write']);
	const packageJson = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
	const packageLock = JSON.parse(
		fs.readFileSync(path.join(directory, 'package-lock.json'), 'utf8'),
	);
	const changelog = fs.readFileSync(path.join(directory, 'CHANGELOG.md'), 'utf8');

	assert.match(output, /Prepared release files for v0\.1\.2/);
	assert.equal(packageJson.version, '0.1.2');
	assert.equal(packageLock.version, '0.1.2');
	assert.equal(packageLock.packages[''].version, '0.1.2');
	assert.match(changelog, /^# Changelog\n\n## v0\.1\.2 - \d{4}-\d{2}-\d{2}/);
	assert.match(changelog, /### Documentation/);
	assert.match(changelog, /- update release notes/);
	assert.match(changelog, /## v0\.1\.1 - 2026-07-01/);
});

test('release prepare require-prepared rejects unprepared release files', () => {
	const directory = createGitPackageFixture('0.1.1');

	assert.throws(
		() => runReleasePrepare(directory, ['--release-tag', 'v0.1.2', '--require-prepared']),
		(error) => {
			assert.match(
				String(error.stderr),
				/release files must be prepared through a pull request before publishing v0\.1\.2/,
			);
			return true;
		},
	);
});

test('release prepare require-prepared accepts matching release commit', () => {
	const directory = createGitPackageFixture('0.1.2', {
		changelog: '# Changelog\n\n## v0.1.2 - 2026-07-03\n\n- Prepared release.\n',
		subject: 'chore(release): v0.1.2',
	});

	const output = runReleasePrepare(directory, ['--release-tag', 'v0.1.2', '--require-prepared']);

	assert.match(output, /Release files are already prepared for v0\.1\.2/);
});

test('release prepare require-prepared accepts non-package CI fixes after release commit', () => {
	const directory = createMergedReleaseFixture();
	mergePostReleaseChange(directory, {
		branch: 'release-ci-fix',
		subject: 'ci: update release preflight',
		mergeSubject: 'Merge pull request #5 from HustleOps/codex/fix-release-merge-preflight',
		files: {
			'.github/workflows/release.yml': 'name: Release\n',
		},
	});

	const output = runReleasePrepare(directory, ['--release-tag', 'v0.1.2', '--require-prepared']);

	assert.match(output, /Release files are already prepared for v0\.1\.2/);
});

test('release prepare require-prepared rejects package changes after release commit', () => {
	const directory = createMergedReleaseFixture();
	const packageJson = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
	packageJson.description = 'Changed after release prep';
	mergePostReleaseChange(directory, {
		branch: 'package-change',
		subject: 'docs: update package metadata',
		mergeSubject: 'Merge pull request #6 from HustleOps/codex/package-change',
		files: {
			'package.json': `${JSON.stringify(packageJson, null, '\t')}\n`,
		},
	});

	assert.throws(
		() => runReleasePrepare(directory, ['--release-tag', 'v0.1.2', '--require-prepared']),
		(error) => {
			assert.match(
				String(error.stderr),
				/current version already matches v0\.1\.2, but package-impacting files changed after the release commit:\n- package\.json/,
			);
			return true;
		},
	);
});

test('release prepare require-prepared accepts release commit merged through pull request', () => {
	const directory = createMergedReleaseFixture();

	const output = runReleasePrepare(directory, ['--release-tag', 'v0.1.2', '--require-prepared']);

	assert.match(output, /Release files are already prepared for v0\.1\.2/);
});
