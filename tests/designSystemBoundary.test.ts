import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const packages = resolve('packages');
const ui = resolve(packages, 'ui/src');
const designSystem = resolve(ui, 'design-system');
const designSystemIndex = resolve(designSystem, 'index.ts');
const server = resolve(packages, 'server');
const transport = resolve(server, 'src/transport.ts');

function walkSource(
  file: string,
  visit: (node: ts.Node, file: string) => void,
) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const walk = (node: ts.Node) => {
    visit(node, file);
    ts.forEachChild(node, walk);
  };
  walk(source);
}

function walkSources(
  directory: string,
  visit: (node: ts.Node, file: string) => void,
) {
  for (const entry of readdirSync(directory, { recursive: true }).map(String)) {
    if (/\.[jt]sx?$/.test(entry)) walkSource(resolve(directory, entry), visit);
  }
}

function moduleReference(node: ts.Node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier))
      return {
        specifier: node.moduleSpecifier.text,
        typeOnly: ts.isImportDeclaration(node)
          ? Boolean(node.importClause?.isTypeOnly)
          : node.isTypeOnly,
      };
  }
  if (
    ts.isImportTypeNode(node) &&
    ts.isLiteralTypeNode(node.argument) &&
    ts.isStringLiteralLike(node.argument.literal)
  )
    return { specifier: node.argument.literal.text, typeOnly: true };
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    node.moduleReference.expression &&
    ts.isStringLiteralLike(node.moduleReference.expression)
  )
    return {
      specifier: node.moduleReference.expression.text,
      typeOnly: node.isTypeOnly,
    };
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) &&
        node.expression.text === 'require')) &&
    node.arguments[0] &&
    ts.isStringLiteralLike(node.arguments[0])
  )
    return { specifier: node.arguments[0].text, typeOnly: false };
}

function inside(directory: string, target: string) {
  return target === directory || target.startsWith(`${directory}${sep}`);
}

function resolveImport(file: string, specifier: string) {
  return specifier.startsWith('.')
    ? resolve(dirname(file), specifier)
    : specifier;
}

it('keeps UI primitives behind the design-system entry point and independent of the app', () => {
  const violations: string[] = [];
  walkSources(ui, (node, file) => {
    if (
      file === designSystemIndex &&
      ts.isExportDeclaration(node) &&
      !node.exportClause
    )
      violations.push('Design-system exports must be explicitly curated');

    const reference = moduleReference(node);
    if (!reference) return;
    const { specifier } = reference;
    const target = resolveImport(file, specifier);
    const withinDesignSystem = inside(designSystem, file);
    const label = `${relative(ui, file)}: ${specifier}`;
    if (!withinDesignSystem && specifier.startsWith('@mantine/core'))
      violations.push(`Use the design-system entry point: ${label}`);
    if (
      !withinDesignSystem &&
      target.startsWith(`${designSystem}${sep}`) &&
      target !== resolve(designSystem, 'index')
    )
      violations.push(`Do not import private design-system files: ${label}`);
    if (
      withinDesignSystem &&
      ((specifier.startsWith('.') &&
        !target.startsWith(`${designSystem}${sep}`)) ||
        specifier.startsWith('@interlock/'))
    )
      violations.push(`Design system must not depend on the app: ${label}`);
    if (
      withinDesignSystem &&
      file !== designSystemIndex &&
      (target === designSystem || target === resolve(designSystem, 'index'))
    )
      violations.push(
        `Use relative internal modules, not the barrel: ${label}`,
      );
  });
  expect(violations).toEqual([]);
});

it('keeps core independent and storage imports on the public core entry points', () => {
  const violations: string[] = [];
  for (const name of ['core', 'storage']) {
    const directory = resolve(packages, name);
    walkSources(resolve(directory, 'src'), (node, file) => {
      const reference = moduleReference(node);
      if (!reference) return;
      const { specifier } = reference;
      if (
        name === 'storage' &&
        (specifier === '@interlock/core' ||
          specifier.startsWith('@interlock/core/'))
      )
        return;
      const target = resolveImport(file, specifier);
      if (
        specifier.startsWith('@interlock/') ||
        (inside(packages, target) && !inside(directory, target))
      )
        violations.push(`${relative(packages, file)}: ${specifier}`);
    });
  }
  expect(violations).toEqual([]);
});

it('keeps client router imports type-only and the shared transport module dependency-free', () => {
  const violations: string[] = [];
  walkSources(resolve(packages, 'client/src'), (node, file) => {
    const reference = moduleReference(node);
    if (!reference) return;
    const { specifier, typeOnly } = reference;
    if (
      specifier === '@interlock/server/transport' ||
      (specifier === '@interlock/server' && typeOnly)
    )
      return;
    if (
      specifier === '@interlock/server' ||
      specifier.startsWith('@interlock/server/') ||
      inside(server, resolveImport(file, specifier))
    )
      violations.push(`${relative(packages, file)}: ${specifier}`);
  });
  walkSource(transport, (node, file) => {
    const reference = moduleReference(node);
    if (reference)
      violations.push(`${relative(packages, file)}: ${reference.specifier}`);
  });
  expect(violations).toEqual([]);
});
