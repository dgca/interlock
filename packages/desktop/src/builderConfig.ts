import { VERSION } from '@interlock/core/version';

export interface MacBuilderTarget {
  target: 'dmg' | 'zip';
  arch: ('arm64' | 'x64')[];
}

export interface DesktopBuilderConfig {
  appId: string;
  productName: string;
  buildVersion: string;
  extraMetadata: {
    version: string;
  };
  directories: {
    output: string;
    buildResources: string;
  };
  mac: {
    target: MacBuilderTarget[];
    category: string;
    icon: string;
    hardenedRuntime: boolean;
    notarize: boolean;
    entitlements: string;
    entitlementsInherit: string;
  };
  publish: {
    provider: 'github';
    owner: string;
    repo: string;
  }[];
  extraResources: {
    from: string;
    to: string;
  }[];
}

export function createDesktopBuilderConfig(
  version = VERSION,
): DesktopBuilderConfig {
  return {
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
      notarize: true,
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
}
