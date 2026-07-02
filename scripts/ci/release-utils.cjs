'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const CHANGELOG_SECTIONS = new Map([
	['feat', 'Features'],
	['fix', 'Fixes'],
	['perf', 'Performance'],
	['refactor', 'Refactoring'],
	['docs', 'Documentation'],
	['test', 'Tests'],
	['build', 'Build'],
	['ci', 'CI'],
	['style', 'Style'],
	['chore', 'Chores'],
]);

function parseVersion(version) {
	const match = STABLE_VERSION_PATTERN.exec(String(version ?? '').trim());
	if (!match) {
		throw new Error(`version must match X.Y.Z: ${version}`);
	}

	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		version: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
	};
}

function parseReleaseTag(tag) {
	const match = RELEASE_TAG_PATTERN.exec(String(tag ?? '').trim());
	if (!match) {
		throw new Error(`release_tag must match vX.Y.Z: ${tag}`);
	}

	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		version: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
	};
}

function normalizeTag(tag) {
	const raw = String(tag ?? '').trim();
	if (raw.startsWith('v')) {
		const parsed = parseReleaseTag(raw);
		return { tag: raw, version: parsed.version };
	}

	const parsed = parseVersion(raw);
	return { tag: raw, version: parsed.version };
}

function compareSemver(left, right) {
	const leftParsed = parseVersion(left);
	const rightParsed = parseVersion(right);

	for (const key of ['major', 'minor', 'patch']) {
		if (leftParsed[key] > rightParsed[key]) {
			return 1;
		}
		if (leftParsed[key] < rightParsed[key]) {
			return -1;
		}
	}

	return 0;
}

function selectPreviousTag(tags, requestedVersion) {
	const byVersion = new Map();

	for (const tag of tags) {
		let normalized;
		try {
			normalized = normalizeTag(tag);
		} catch {
			continue;
		}

		if (compareSemver(normalized.version, requestedVersion) >= 0) {
			continue;
		}

		const existing = byVersion.get(normalized.version);
		if (existing && existing !== normalized.tag) {
			throw new Error(
				`duplicate release tags for ${normalized.version}: ${existing}, ${normalized.tag}`,
			);
		}
		byVersion.set(normalized.version, normalized.tag);
	}

	const candidates = [...byVersion.entries()].sort(([leftVersion], [rightVersion]) =>
		compareSemver(rightVersion, leftVersion),
	);

	return candidates.length === 0 ? null : candidates[0][1];
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, '\t')}\n`);
}

function assertPackageVersionsAgree(rootDirectory) {
	const packageJson = readJson(path.join(rootDirectory, 'package.json'));
	const packageLock = readJson(path.join(rootDirectory, 'package-lock.json'));
	const rootPackage = packageLock.packages?.[''];

	if (packageJson.version !== packageLock.version) {
		throw new Error(
			`package.json version ${packageJson.version} does not match package-lock.json version ${packageLock.version}`,
		);
	}

	if (!rootPackage || packageJson.version !== rootPackage.version) {
		throw new Error(
			`package-lock.json packages[""] version ${rootPackage?.version ?? 'missing'} does not match package.json version ${packageJson.version}`,
		);
	}

	return packageJson.version;
}

function updatePackageVersion(rootDirectory, version) {
	parseVersion(version);

	const packageJsonPath = path.join(rootDirectory, 'package.json');
	const packageLockPath = path.join(rootDirectory, 'package-lock.json');
	const packageJson = readJson(packageJsonPath);
	const packageLock = readJson(packageLockPath);

	packageJson.version = version;
	packageLock.version = version;
	packageLock.packages[''].version = version;

	writeJson(packageJsonPath, packageJson);
	writeJson(packageLockPath, packageLock);
}

function parseConventionalSubject(subject) {
	const match =
		/^(?:revert: )?(?<type>build|chore|ci|docs|feat|fix|perf|refactor|style|test)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<description>.+)$/.exec(
			subject,
		);
	return match?.groups ?? null;
}

function formatChangelogLine(groups) {
	const suffix = groups.scope ? ` (\`${groups.scope}\`)` : '';
	const prefix = groups.breaking ? '**Breaking:** ' : '';
	return `- ${prefix}${groups.description}${suffix}`;
}

function generateChangelog(existingChangelog, releaseTag, releaseDate, subjects) {
	const sections = new Map();

	for (const subject of subjects) {
		const groups = parseConventionalSubject(subject);
		if (!groups || (groups.type === 'chore' && groups.scope === 'release')) {
			continue;
		}

		const section = CHANGELOG_SECTIONS.get(groups.type);
		if (!section) {
			continue;
		}

		const lines = sections.get(section) ?? [];
		lines.push(formatChangelogLine(groups));
		sections.set(section, lines);
	}

	const releaseLines = [`## ${releaseTag} - ${releaseDate}`, ''];
	for (const section of CHANGELOG_SECTIONS.values()) {
		const lines = sections.get(section);
		if (!lines || lines.length === 0) {
			continue;
		}
		releaseLines.push(`### ${section}`, '', ...lines, '');
	}

	if (releaseLines.length === 2) {
		releaseLines.push('- No user-facing changes.', '');
	}

	const normalizedExisting = String(existingChangelog ?? '').trim();
	const body = releaseLines.join('\n').trimEnd();
	if (normalizedExisting === '') {
		return `# Changelog\n\n${body}\n`;
	}

	const existingWithoutTitle = normalizedExisting.replace(/^# Changelog\s*/i, '').trim();
	return `# Changelog\n\n${body}\n\n${existingWithoutTitle}\n`;
}

module.exports = {
	assertPackageVersionsAgree,
	compareSemver,
	generateChangelog,
	parseReleaseTag,
	parseVersion,
	selectPreviousTag,
	updatePackageVersion,
};
