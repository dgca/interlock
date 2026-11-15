import rootPackage from '../../package.json' with { type: 'json' };

const version = rootPackage.version;

/** @type {import('electron-builder').Configuration} */
export default {
  appId: 'com.typeof.interlock',
  productName: 'Interlock',
  buildVersion: version,
  extraMetadata: {
    version,
  },
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  mac: {
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    category: 'public.app-category.developer-tools',
    icon: 'build/icon.icns',
    hardenedRuntime: true,
    notarize: Boolean(
      process.env.APPLE_ID &&
      process.env.APPLE_APP_SPECIFIC_PASSWORD &&
      process.env.APPLE_TEAM_ID,
    ),
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
  },
  publish: [
    {
      provider: 'github',
      owner: 'dgca',
      repo: 'interlock',
    },
  ],
  extraResources: [
    { from: '../../dist/ui', to: 'dist/ui' },
    { from: '../../dist/cli.js', to: 'dist/cli.js' },
    {
      from: '../../dist/licenses/claude-agent-sdk.md',
      to: 'dist/licenses/claude-agent-sdk.md',
    },
    { from: '../../LICENSE', to: 'LICENSE' },
    { from: 'bin/interlock', to: 'bin/interlock' },
  ],
};
