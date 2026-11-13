import css from '@eslint/css';
import { ESLint, Linter } from 'eslint';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const pluginUrl = new URL(
  '../scripts/eslint-design-system.js',
  import.meta.url,
);
const { default: designSystem } = (await import(pluginUrl.href)) as {
  default: ESLint.Plugin;
};

const rules = {
  'design-system/no-mantine-import': 'error',
  'design-system/no-raw-color': 'error',
  'design-system/no-inline-style': 'error',
  'design-system/control-height': 'error',
} as const;

const linter = new Linter();

function lintTsx(code: string) {
  return linter
    .verify(
      code,
      [
        {
          files: ['**/*.tsx'],
          plugins: { 'design-system': designSystem },
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          rules,
        },
      ],
      'component.tsx',
    )
    .map(({ ruleId, message }) => ({ ruleId, message }));
}

function lintCss(code: string) {
  return linter
    .verify(
      code,
      [
        {
          files: ['**/*.css'],
          plugins: { css, 'design-system': designSystem },
          language: 'css/css',
          languageOptions: { tolerant: true },
          rules: {
            'design-system/no-raw-color': 'error',
            'design-system/control-height': 'error',
          },
        },
      ],
      'component.module.css',
    )
    .map(({ ruleId, message }) => ({ ruleId, message }));
}

const ruleIds = (messages: { ruleId: string | null }[]) =>
  messages.map(({ ruleId }) => ruleId);

describe('design-system lint rules', () => {
  it('requires the design-system barrel instead of Mantine visual packages', () => {
    expect(
      ruleIds(
        lintTsx(`
          import { Button } from '@mantine/core';
          import type { MantineTheme } from '@mantine/core';
          export { Tooltip } from '@mantine/core';
          import { notifications } from '@mantine/notifications';
          const lazy = import('@mantine/dates');
        `),
      ),
    ).toEqual(Array(5).fill('design-system/no-mantine-import'));
    expect(
      lintTsx(`
        import { useMergedRef } from '@mantine/hooks';
        import { Button } from '../design-system';
      `),
    ).toEqual([]);
  });

  it('rejects raw color literals in TypeScript', () => {
    expect(
      ruleIds(
        lintTsx(`
          const a = '#fff';
          const b = 'rgb(0 0 0 / 40%)';
          const c = \`0 1px 2px hsla(0, 0%, 0%, 0.4)\`;
          const d = <Text c="#3F64F7" />;
        `),
      ),
    ).toEqual(Array(4).fill('design-system/no-raw-color'));
    expect(
      lintTsx(`
        const a = 'var(--accent)';
        const b = '#section';
        const c = 'color-mix(in srgb, var(--error-copy) 12%, var(--inset))';
      `),
    ).toEqual([]);
  });

  it('rejects raw color literals in CSS', () => {
    expect(
      ruleIds(
        lintCss(`
          .a { color: #fff; }
          .b { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4); }
          .c { --tint: hsl(220 90% 60%); }
        `),
      ),
    ).toEqual(Array(3).fill('design-system/no-raw-color'));
    expect(
      lintCss(`
        #panel .a { color: var(--text); background: var(--gradient-card); }
      `),
    ).toEqual([]);
  });

  it('allows only listed layout properties in inline styles', () => {
    expect(
      lintTsx(`
        const a = <div style={{ color: 'red', marginTop: 12, top: 4 }} />;
        const b = <div style={wide ? { padding: 0 } : undefined} />;
        const c = <div style={{ boxShadow: 'none' } as CSSProperties} />;
        const d = <div style={{ fontSize: 13, border: 0 }} />;
        const e = <div style={{ ['gap']: 8, [\`lineHeight\`]: 1.4 }} />;
        const f = <Box style={() => ({ background: 'var(--form)' })} />;
        const g = <Box style={(theme) => { if (theme) return { outline: 0 }; return {}; }} />;
      `),
    ).toEqual(
      [
        'color',
        'marginTop',
        'padding',
        'boxShadow',
        'fontSize',
        'border',
        'gap',
        'lineHeight',
        'background',
        'outline',
      ].map((name) => ({
        ruleId: 'design-system/no-inline-style',
        message: expect.stringContaining(`'${name}'`) as unknown,
      })),
    );
    expect(
      lintTsx(`
        const a = <div style={{ top, left: 32, width: 125, display: 'flex', overflowWrap: 'anywhere' }} />;
        const b = <col style={{ '--column-width': width } as CSSProperties} />;
        const c = <Edge style={style} />;
        const d = <div style={{ [key]: 1, ['width']: 2 }} />;
        const e = <Box style={() => ({ top: 0, width: '100%' })} />;
      `),
    ).toEqual([]);
  });

  it('rejects control heights outside the documented sizes in TypeScript', () => {
    expect(
      ruleIds(
        lintTsx(`
          const a = <ActionIcon size={30} />;
          const b = <ActionIcon size="md" />;
          const c = <Button size="compact-sm" />;
          const d = <TextInput size="lg" />;
          const e = <Button h={36} />;
          const f = <Select style={{ height: '48px' }} />;
        `),
      ),
    ).toEqual(Array(6).fill('design-system/control-height'));
    expect(
      lintTsx(`
        const a = <ActionIcon size={32} />;
        const b = <ActionIcon size="xl" />;
        const c = <Button size="sm" />;
        const d = <TextInput size="xs" h={40} />;
        const e = <Placeholder h={14} />;
        const f = <Badge size="lg" />;
      `),
    ).toEqual([]);
  });

  it('rejects control heights outside the documented sizes in CSS', () => {
    expect(
      ruleIds(
        lintCss(`
          .saveButton { height: 36px; }
          .row > button { min-height: 30px; }
          .searchField { block-size: 48px; }
          .compact { --button-height-sm: 28px; }
        `),
      ),
    ).toEqual(Array(4).fill('design-system/control-height'));
    expect(
      lintCss(`
        .saveButton { height: var(--control-height); }
        .tabs button { height: 44px; }
        .toolButton { height: 32px; }
        .saveButton svg { height: 16px; }
        .card { min-height: 100px; }
      `),
    ).toEqual([]);
  });

  it('applies to application UI but not to the design system itself', async () => {
    const eslint = new ESLint({
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      ruleFilter: ({ ruleId }) => ruleId.startsWith('design-system/'),
    });
    const lint = async (filePath: string) =>
      ruleIds(
        (
          await eslint.lintText('.a { color: #fff; }', {
            filePath,
            warnIgnored: false,
          })
        )[0]?.messages ?? [],
      );
    expect(await lint('packages/ui/src/features/example.module.css')).toEqual([
      'design-system/no-raw-color',
    ]);
    expect(
      await lint('packages/ui/src/design-system/example.module.css'),
    ).toEqual([]);
  });
});
