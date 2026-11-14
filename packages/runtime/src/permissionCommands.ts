import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { unsafeCommandHeads } from '@interlock/core';

/**
 * Conservative matching of shell commands against permission policy patterns.
 * Anything this parser does not fully understand is not matched, so the
 * harness asks a person as it would without a policy.
 */

type Word = { text: string; glob: boolean };
type Segment = { words: Word[]; targets: string[] };

/** Arguments that make a program run another program or write elsewhere. */
const unsafeArguments: Record<string, string[]> = {
  find: [
    '-exec',
    '-execdir',
    '-ok',
    '-okdir',
    '-delete',
    '-fprint',
    '-fprint0',
    '-fprintf',
    '-fls',
  ],
  rg: ['--pre', '--pre-glob'],
  git: [
    '-c',
    '-C',
    '--config-env',
    '--exec-path',
    '--upload-pack',
    '--ext-diff',
    '--git-dir',
    '--work-tree',
    '--namespace',
  ],
  tar: ['--to-command', '--use-compress-program', '-I', '--checkpoint-action'],
};
/** Options whose value names a file or directory the program writes. */
const outputOptions: Record<string, string[]> = {
  git: ['--output', '--output-directory', '-o'],
  sort: ['--output', '-o'],
};
const shells = new Set(['sh', 'bash', 'zsh']);

/** Split a script into simple commands, or undefined for unsupported syntax. */
function parseScript(script: string): Segment[] | undefined {
  const segments: Segment[] = [];
  let words: Word[] = [];
  let targets: string[] = [];
  let text = '';
  let inWord = false;
  let glob = false;
  let quoted = false;
  let redirect = false;
  // One plain brace list per word, such as docs/{intent,spec}.md.
  let brace: { at: number; options: string[] } | undefined;
  const endWord = () => {
    if (inWord) {
      const texts = brace
        ? brace.options.map(
            (option) =>
              text.slice(0, brace!.at) + option + text.slice(brace!.at),
          )
        : [text];
      if (redirect) {
        if (glob || brace) return false;
        targets.push(text);
        redirect = false;
      } else for (const t of texts) words.push({ text: t, glob });
    }
    text = '';
    brace = undefined;
    inWord = glob = quoted = false;
    return true;
  };
  const endSegment = () => {
    if (!endWord() || redirect) return false;
    if (words.length) segments.push({ words, targets });
    else if (targets.length) return false;
    words = [];
    targets = [];
    return true;
  };
  for (let i = 0; i < script.length; i++) {
    const c = script[i];
    const next = script[i + 1];
    if (c === "'") {
      const end = script.indexOf("'", i + 1);
      if (end < 0) return undefined;
      text += script.slice(i + 1, end);
      inWord = quoted = true;
      i = end;
    } else if (c === '"') {
      inWord = quoted = true;
      for (i++; ; i++) {
        if (i >= script.length) return undefined;
        const d = script[i];
        if (d === '"') break;
        if (d === '$' || d === '`') return undefined;
        if (d === '\\' && '$`"\\\n'.includes(script[i + 1] ?? '')) {
          if (script[i + 1] !== '\n') text += script[i + 1];
          i++;
        } else text += d;
      }
    } else if (c === '\\') {
      if (next === undefined) return undefined;
      if (next !== '\n') {
        text += next;
        inWord = quoted = true;
      }
      i++;
    } else if (c === ' ' || c === '\t') {
      if (!endWord()) return undefined;
    } else if (c === '\n' || c === ';') {
      if (!endSegment()) return undefined;
    } else if (c === '&') {
      if (next === '&') {
        if (!endSegment()) return undefined;
        i++;
      } else if (next === '>') {
        if (!endWord() || redirect) return undefined;
        redirect = true;
        i += script[i + 2] === '>' ? 2 : 1;
      } else return undefined;
    } else if (c === '|') {
      if (next === '&') return undefined;
      if (!endSegment()) return undefined;
      if (next === '|') i++;
    } else if (c === '>' || c === '<') {
      // A word of digits just before the operator names a file descriptor.
      if (inWord && !quoted && /^\d+$/.test(text)) {
        text = '';
        inWord = false;
      } else if (!endWord()) return undefined;
      if (redirect) return undefined;
      if (c === '<' && (next === '<' || next === '>')) return undefined;
      if (c === '>' && (next === '>' || next === '|')) i++;
      if (script[i + 1] === '&') {
        // Duplicating a descriptor (2>&1, >&-) names no file.
        const dup = /^&(\d+|-)/.exec(script.slice(i + 1));
        if (!dup) return undefined;
        i += dup[0].length;
        continue;
      }
      redirect = true;
    } else if (c === '{' && !brace) {
      const list = /^\{([\w./-]*(?:,[\w./-]*)+)\}/.exec(script.slice(i));
      const options = list?.[1].split(',');
      if (!options || options.some((o) => o.split('/').includes('..')))
        return undefined;
      brace = { at: text.length, options };
      inWord = true;
      i += list![0].length - 1;
    } else if ('$`(){}'.includes(c)) {
      return undefined;
    } else if (!inWord && (c === '#' || c === '~' || c === '=')) {
      // A comment, home directory or zsh command path.
      return undefined;
    } else if (c === '~' && /[=:]/.test(text.at(-1) ?? '')) {
      return undefined;
    } else {
      if ('*?['.includes(c)) glob = true;
      text += c;
      inWord = true;
    }
  }
  return endSegment() ? segments : undefined;
}

/** The script inside `zsh -lc '…'`, as Codex shows commands, or the command itself. */
function unwrapShell(command: string) {
  const parsed = parseScript(command);
  const words = parsed?.length === 1 ? parsed[0] : undefined;
  if (
    words?.targets.length === 0 &&
    words.words.length === 3 &&
    shells.has(basename(words.words[0].text)) &&
    ['-c', '-lc', '-cl'].includes(words.words[1].text) &&
    !words.words.some((w) => w.glob)
  )
    return words.words[2].text;
  return command;
}

/** The real path a command would reach, following links on the way. */
function physicalPath(path: string, cwd: string) {
  let current = isAbsolute(path) ? sep : cwd;
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    current = part === '..' ? dirname(current) : join(current, part);
    try {
      current = realpathSync(current);
    } catch {
      // A path that does not exist yet stays as written.
    }
  }
  return current;
}
const within = (path: string, dir: string) =>
  path === dir || path.startsWith(dir + sep);

/** Whether a path, resolved from cwd, stays inside the real workspace root. */
export function pathInside(path: string, cwd: string, root: string) {
  if (path === '/dev/null') return true;
  if (!path || path.startsWith('~')) return false;
  return within(physicalPath(path, cwd), root);
}

// Characters some file systems ignore in names, such as a zero-width joiner inside `.git`.
const ignorable = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
const isGitName = (part: string) =>
  part.replace(ignorable, '').toLowerCase() === '.git';

/** The repository directories a worktree's `.git` file or folder points at. */
function gitDirectories(root: string) {
  const dot = join(root, '.git');
  const dirs: string[] = [];
  try {
    if (lstatSync(dot).isDirectory()) dirs.push(realpathSync(dot));
    else {
      const match = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dot, 'utf8'));
      if (match) dirs.push(realpathSync(resolve(root, match[1])));
    }
    const common = join(dirs[0], 'commondir');
    if (dirs[0] && existsSync(common))
      dirs.push(
        realpathSync(resolve(dirs[0], readFileSync(common, 'utf8').trim())),
      );
  } catch {
    // No repository metadata: only the name check applies.
  }
  return dirs;
}

/**
 * Whether a path may be written: inside the workspace, never a `.git` entry in
 * any letter case, and never inside the repository's own Git directories.
 * Writing those lets later Git commands run configured programs.
 */
export function writablePath(path: string, cwd: string, root: string) {
  if (path === '/dev/null') return true;
  if (!pathInside(path, cwd, root)) return false;
  const real = physicalPath(path, cwd);
  if (
    path.split('/').some(isGitName) ||
    real.slice(root.length).split(sep).some(isGitName)
  )
    return false;
  return !gitDirectories(root).some((dir) => within(real, dir));
}

/** Option values and operands are all treated as paths that may be written. */
function argumentAllowed(word: Word, cwd: string, root: string) {
  if (word.glob) return false;
  if (!word.text) return true;
  if (!word.text.startsWith('-')) return writablePath(word.text, cwd, root);
  const equals = word.text.indexOf('=');
  const values = [equals > 0 ? word.text.slice(equals + 1) : ''];
  // Clustered short options can end in an attached value at any letter, as
  // in -vt.. or -uoout, so every suffix after the first letter is a path.
  if (!word.text.startsWith('--'))
    for (let k = 2; k < word.text.length; k++)
      values.push(word.text.slice(k).replace(/^=/, ''));
  return values.every((value) => !value || writablePath(value, cwd, root));
}

/** A denied option; a single-letter one matches anywhere in a short cluster. */
const deniedWord = (text: string, denied: string) =>
  text === denied ||
  text.startsWith(`${denied}=`) ||
  (/^-[A-Za-z]$/.test(denied) &&
    /^-[^-]/.test(text) &&
    text.slice(1).includes(denied[1]));

/**
 * Whether a command may run here: Git and the tools that call it find a
 * repository by walking up from the working directory. Between the cwd and
 * the workspace root (root excluded), no directory may look like a repository
 * (a HEAD file or a .git entry), so discovery always reaches the worktree's own.
 */
function onlyWorktreeRepository(cwd: string, root: string) {
  for (let dir = cwd; dir !== root && within(dir, root); dir = dirname(dir))
    if (existsSync(join(dir, 'HEAD')) || existsSync(join(dir, '.git')))
      return false;
  return true;
}

/** The pattern a simple command matches, or undefined. */
function segmentPattern(
  segment: Segment,
  patterns: string[][],
  cwd: string,
  root: string,
  canEdit: boolean,
) {
  const words = segment.words;
  const program = basename(words[0].text);
  // An assignment such as PATH=… before a program changes what runs.
  if (
    unsafeCommandHeads.has(program) ||
    words[0].glob ||
    words[0].text.includes('=')
  )
    return undefined;
  const denied = unsafeArguments[program] ?? [];
  if (words.some((w) => denied.some((d) => deniedWord(w.text, d))))
    return undefined;
  if (!segment.targets.every((path) => writablePath(path, cwd, root)))
    return undefined;
  // Writing a file through a redirection or an output option is an edit.
  if (
    !canEdit &&
    (segment.targets.some((path) => path !== '/dev/null') ||
      words.some((w) =>
        (outputOptions[program] ?? []).some((o) => deniedWord(w.text, o)),
      ))
  )
    return undefined;
  return patterns.find((pattern) => {
    const wildcard = pattern.at(-1) === '*';
    const fixed = wildcard ? pattern.slice(0, -1) : pattern;
    return (
      (wildcard
        ? words.length >= fixed.length
        : words.length === fixed.length) &&
      fixed.every((token, i) => !words[i].glob && words[i].text === token) &&
      words.slice(fixed.length).every((w) => argumentAllowed(w, cwd, root))
    );
  });
}

/**
 * The patterns that allow a script, when every simple command in it matches
 * one and every path it names stays inside the workspace and outside Git's
 * own files; otherwise undefined. `root` must be a real path.
 */
export function commandAllowed(
  command: string,
  cwd: string,
  root: string,
  patterns: string[],
  canEdit = false,
) {
  if (!patterns.length || !pathInside(cwd, sep, root)) return undefined;
  if (!onlyWorktreeRepository(physicalPath(cwd, sep), root)) return undefined;
  const segments = parseScript(unwrapShell(command));
  const split = patterns.map((p) => p.trim().split(/\s+/));
  const matched = segments?.map((segment) =>
    segmentPattern(segment, split, cwd, root, canEdit),
  );
  return matched?.length && matched.every(Boolean)
    ? [...new Set(matched.map((pattern) => pattern!.join(' ')))]
    : undefined;
}
