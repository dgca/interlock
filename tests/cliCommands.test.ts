import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('routes every implemented command through the CLI entry point and advertises it in help', () => {
  const parse = (path: string) =>
    ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
  const commands: string[] = ['commands'];
  const visit = (node: ts.Node) => {
    if (ts.isSwitchStatement(node) && node.expression.getText() === 'command') {
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause) && ts.isStringLiteral(clause.expression))
          commands.push(clause.expression.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parse('packages/cli/src/commands.ts'));
  let known: string[] = [];
  const findKnown = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === 'known' &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      known = node.initializer.elements.map(
        (e) => (e as ts.StringLiteral).text,
      );
    }
    ts.forEachChild(node, findKnown);
  };
  findKnown(parse('packages/cli/src/bin.ts'));
  expect(known.sort()).toEqual(commands.sort());
  const help = execFileSync(
    process.execPath,
    ['--import', 'tsx', 'packages/cli/src/bin.ts', '--help'],
    { encoding: 'utf8' },
  );
  for (const command of commands)
    expect(help).toMatch(new RegExp(`\\b${command}\\b`));
});
