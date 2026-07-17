import { readFile } from 'node:fs/promises';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const [appJson, easJson, packageJson] = await Promise.all([
  readJson(new URL('../app.json', import.meta.url)),
  readJson(new URL('../eas.json', import.meta.url)),
  readJson(new URL('../package.json', import.meta.url)),
]);

const expo = appJson.expo ?? {};
const projectId = expo.extra?.eas?.projectId;
const expectedUpdateUrl = projectId ? `https://u.expo.dev/${projectId}` : undefined;
const errors = [];

const expect = (condition, message) => {
  if (!condition) errors.push(message);
};

expect(packageJson.dependencies?.['expo-updates'], 'expo-updates must be a production dependency');
expect(projectId, 'expo.extra.eas.projectId must be configured');
expect(expo.updates?.url === expectedUpdateUrl, `expo.updates.url must be ${expectedUpdateUrl}`);
expect(expo.runtimeVersion?.policy === 'appVersion', 'expo.runtimeVersion.policy must be appVersion');
expect(expo.version === packageJson.version, 'app.json and package.json versions must match');
expect(
  expo.updates?.requestHeaders?.['expo-channel-name'] === 'production',
  'Codemagic release builds must embed the production update channel'
);

for (const channel of ['development', 'preview', 'production']) {
  expect(
    easJson.build?.[channel]?.channel === channel,
    `eas.json build.${channel}.channel must be ${channel}`
  );
}

if (errors.length > 0) {
  console.error(`Invalid OTA configuration:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

console.log(`OTA configuration is valid (project ${projectId}, runtime ${expo.version}).`);
