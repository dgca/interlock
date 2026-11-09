import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const ui = resolve('packages/ui/src');
const designSystem = resolve(ui, 'design-system');
const files = readdirSync(ui, { recursive: true })
  .map(String)
  .filter((file) => /\.[jt]sx?$/.test(file));

it('keeps UI primitives behind the design-system entry point and independent of the app', () => {
  const violations: string[] = [];
  for (const file of files) {
    const absolute = resolve(ui, file);
    const inside = absolute.startsWith(`${designSystem}/`);
    const source = ts.createSourceFile(
      absolute,
      readFileSync(absolute, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const checkImport = (specifier: string) => {
      const target = specifier.startsWith('.')
        ? resolve(dirname(absolute), specifier)
        : specifier;
      const label = `${file}: ${specifier}`;
      if (!inside && specifier.startsWith('@mantine/core'))
        violations.push(`Use the design-system entry point: ${label}`);
      if (
        !inside &&
        target.startsWith(`${designSystem}/`) &&
        target !== resolve(designSystem, 'index')
      )
        violations.push(`Do not import private design-system files: ${label}`);
      if (
        inside &&
        ((specifier.startsWith('.') &&
          !target.startsWith(`${designSystem}/`)) ||
          specifier.startsWith('@interlock/'))
      )
        violations.push(`Design system must not depend on the app: ${label}`);
      if (
        inside &&
        absolute !== resolve(designSystem, 'index.ts') &&
        (target === designSystem || target === resolve(designSystem, 'index'))
      )
        violations.push(
          `Use relative internal modules, not the barrel: ${label}`,
        );
    };
    const visit = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        checkImport(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        checkImport(node.arguments[0].text);
      if (
        absolute === resolve(designSystem, 'index.ts') &&
        ts.isExportDeclaration(node) &&
        !node.exportClause
      )
        violations.push('Design-system exports must be explicitly curated');
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(violations).toEqual([]);
});
