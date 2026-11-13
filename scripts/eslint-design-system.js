// Local ESLint plugin that keeps application UI on the design system.
//
// The rules run on `packages/ui/src` outside `design-system/` (see the
// `interlock/design-system/*` blocks in eslint.config.js). TypeScript files
// use the regular ESLint parser; CSS files use the @eslint/css language, so a
// single `pnpm lint` run and a single eslint-suppressions.json baseline cover
// both. packages/ui/src/design-system/README.md documents the rules.

/** Documented outer heights for controls: segments and graph tools, standard controls, attached tabs. */
export const controlHeights = [32, 40, 44];

/** Inline `style` properties that only position or size an element. Everything else belongs in a CSS module. */
export const layoutStyleProperties = new Set([
  'position',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'display',
  'visibility',
  'boxSizing',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'inlineSize',
  'blockSize',
  'minInlineSize',
  'maxInlineSize',
  'minBlockSize',
  'maxBlockSize',
  'aspectRatio',
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'flexDirection',
  'flexWrap',
  'flexFlow',
  'order',
  'alignItems',
  'alignSelf',
  'alignContent',
  'justifyContent',
  'justifyItems',
  'justifySelf',
  'placeItems',
  'placeSelf',
  'placeContent',
  'gridArea',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridTemplateAreas',
  'gridColumn',
  'gridRow',
  'gridAutoFlow',
  'gridAutoColumns',
  'gridAutoRows',
  'overflow',
  'overflowX',
  'overflowY',
  'overflowWrap',
  'wordBreak',
  'whiteSpace',
  'transform',
  'transformOrigin',
  'pointerEvents',
]);

const hexColor =
  /(?:^|[^\w&#])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![\w-])/i;
const colorFunctionNames = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
]);
const colorFunction = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;

const isCss = (context) => context.filename.endsWith('.css');

const noMantineImport = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Import visual controls from the design-system barrel instead of Mantine.',
    },
    schema: [],
    messages: {
      mantine:
        "Import '{{source}}' controls and types from the design-system barrel (packages/ui/src/design-system/index.ts). Only @mantine/hooks may be imported directly.",
    },
  },
  create(context) {
    const check = (node) => {
      const source = node.source?.value;
      if (
        typeof source === 'string' &&
        (source === '@mantine' || source.startsWith('@mantine/')) &&
        source !== '@mantine/hooks' &&
        !source.startsWith('@mantine/hooks/')
      ) {
        context.report({
          node: node.source,
          messageId: 'mantine',
          data: { source },
        });
      }
    };
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};

const noRawColor = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hex, rgb(), hsl() and other raw color literals outside the design system.',
    },
    schema: [],
    messages: {
      color:
        'Raw color literal. Use a token from design-system/tokens.css (var(--…)) or the theme instead.',
    },
  },
  create(context) {
    if (isCss(context)) {
      return {
        Hash(node) {
          context.report({ node, messageId: 'color' });
        },
        Function(node) {
          if (colorFunctionNames.has(node.name.toLowerCase())) {
            context.report({ node, messageId: 'color' });
          }
        },
        // Custom property values stay unparsed.
        Raw(node) {
          if (hexColor.test(node.value) || colorFunction.test(node.value)) {
            context.report({ node, messageId: 'color' });
          }
        },
      };
    }
    const check = (node, text) => {
      if (
        typeof text === 'string' &&
        (hexColor.test(text) || colorFunction.test(text))
      ) {
        context.report({ node, messageId: 'color' });
      }
    };
    return {
      Literal(node) {
        if (node.parent?.type === 'ImportDeclaration') return;
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked);
      },
    };
  },
};

/** Collect object literals an expression can evaluate to. */
function objectLiterals(node) {
  if (!node) return [];
  switch (node.type) {
    case 'ObjectExpression':
      return [node];
    case 'ConditionalExpression':
      return [
        ...objectLiterals(node.consequent),
        ...objectLiterals(node.alternate),
      ];
    case 'LogicalExpression':
      return [...objectLiterals(node.left), ...objectLiterals(node.right)];
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'ParenthesizedExpression':
      return objectLiterals(node.expression);
    // Mantine style functions: style={(theme) => ({ ... })}
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return node.body.type === 'BlockStatement'
        ? returnedExpressions(node.body).flatMap(objectLiterals)
        : objectLiterals(node.body);
    default:
      return [];
  }
}

/** Arguments of the return statements of one function body, excluding nested functions. */
function returnedExpressions(node) {
  if (!node || typeof node.type !== 'string') return [];
  if (node.type === 'ReturnStatement')
    return node.argument ? [node.argument] : [];
  if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  ) {
    return [];
  }
  return Object.entries(node).flatMap(([key, value]) => {
    if (key === 'parent') return [];
    if (Array.isArray(value)) return value.flatMap(returnedExpressions);
    return value && typeof value === 'object' ? returnedExpressions(value) : [];
  });
}

function propertyName(property) {
  if (property.type !== 'Property') return undefined;
  const { key } = property;
  if (key.type === 'Identifier' && !property.computed) return key.name;
  // Plain and computed string keys: 'color' and ['color'].
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  if (key.type === 'TemplateLiteral' && key.expressions.length === 0)
    return key.quasis[0].value.cooked;
  return undefined;
}

function styleProperties(attribute) {
  if (
    attribute.name.type !== 'JSXIdentifier' ||
    attribute.name.name !== 'style' ||
    attribute.value?.type !== 'JSXExpressionContainer'
  ) {
    return [];
  }
  return objectLiterals(attribute.value.expression).flatMap((object) =>
    object.properties.flatMap((property) => {
      const name = propertyName(property);
      return name === undefined ? [] : [{ name, property }];
    }),
  );
}

const noInlineStyle = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Allow only layout properties in inline style objects; color, spacing, border, shadow and typography belong in CSS modules.',
    },
    schema: [],
    messages: {
      style:
        "Inline style property '{{name}}' is not layout-only. Move it to a CSS module that uses design tokens, or use a design-system control.",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        for (const { name, property } of styleProperties(node)) {
          if (name.startsWith('--') || layoutStyleProperties.has(name))
            continue;
          context.report({
            node: property,
            messageId: 'style',
            data: { name },
          });
        }
      },
    };
  },
};

// Resolved outer heights of Mantine size names, after the design-system theme
// maps xs, sm and md to --control-height for buttons and inputs.
const buttonSizes = {
  xs: 40,
  sm: 40,
  md: 40,
  lg: 50,
  xl: 60,
  'compact-xs': 22,
  'compact-sm': 26,
  'compact-md': 30,
  'compact-lg': 34,
  'compact-xl': 40,
};
const inputSizes = { xs: 40, sm: 40, md: 40, lg: 50, xl: 60 };
const actionIconSizes = {
  xs: 18,
  sm: 22,
  md: 28,
  lg: 34,
  xl: 44,
  'input-xs': 30,
  'input-sm': 36,
  'input-md': 42,
  'input-lg': 50,
  'input-xl': 60,
};
const controlSizes = {
  Button: buttonSizes,
  ActionIcon: actionIconSizes,
  Autocomplete: inputSizes,
  Input: inputSizes,
  InputBase: inputSizes,
  MultiSelect: inputSizes,
  NativeSelect: inputSizes,
  NumberInput: inputSizes,
  PasswordInput: inputSizes,
  Select: inputSizes,
  TagsInput: inputSizes,
  TextInput: inputSizes,
  SegmentedControl: {},
};
const heightProps = new Set(['h', 'mih', 'height']);
const heightStyleProperties = new Set([
  'height',
  'minHeight',
  'blockSize',
  'minBlockSize',
]);

/** Static value of a JSX attribute or property, if it is a literal. */
function literalValue(node) {
  if (!node) return undefined;
  if (node.type === 'JSXExpressionContainer')
    return literalValue(node.expression);
  if (node.type === 'Literal') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis[0].value.cooked;
  return undefined;
}

function pixels(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)(px)?\s*$/.exec(value);
  return match ? Number(match[1]) : undefined;
}

const controlSelector =
  /^(?:button|input|select|textarea)\b|\[role=['"]?button|\.[\w-]*(?:button|btn|input|field|select|control|search|segment|toggle)/i;

/** The compound selectors that a selector list styles: the last part of each complex selector. */
function selectorSubjects(prelude) {
  const subjects = [];
  let depth = 0;
  let part = '';
  let last = '';
  const flush = () => {
    if (part.trim()) last = part.trim();
    part = '';
  };
  for (const char of prelude) {
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (depth === 0 && char === ',') {
      flush();
      subjects.push(last);
      last = '';
    } else if (depth === 0 && /[\s>+~]/.test(char)) {
      flush();
    } else {
      part += char;
    }
  }
  flush();
  subjects.push(last);
  return subjects.filter(Boolean);
}
const cssHeightProperties = new Set([
  'height',
  'min-height',
  'block-size',
  'min-block-size',
]);
const mantineHeightVariable =
  /^--(?:button-height|input-height|ai-size)(?:-|$)/;

const controlHeight = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep control heights at the documented 32px, 40px or 44px sizes.',
    },
    schema: [],
    messages: {
      height:
        'Control height {{value}} contradicts the documented sizes (32px segments and graph tools, 40px standard controls via var(--control-height), 44px attached tabs). Use the shared control size or request a new control.',
    },
  },
  create(context) {
    const report = (node, height, value = `${height}px`) => {
      if (height !== undefined && !controlHeights.includes(height)) {
        context.report({ node, messageId: 'height', data: { value } });
      }
    };

    if (isCss(context)) {
      const selectors = [];
      const sourceCode = context.sourceCode;
      return {
        Rule(node) {
          selectors.push(sourceCode.getText(node.prelude));
        },
        'Rule:exit'() {
          selectors.pop();
        },
        Declaration(node) {
          const property = node.property.toLowerCase();
          const value = sourceCode.getText(node.value);
          if (mantineHeightVariable.test(property)) {
            const match = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(value);
            if (match) report(node, Number(match[1]), value.trim());
            return;
          }
          if (!cssHeightProperties.has(property)) return;
          const subjects = selectorSubjects(selectors.at(-1) ?? '');
          if (!subjects.some((subject) => controlSelector.test(subject)))
            return;
          const match = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(value);
          if (match) report(node, Number(match[1]), value.trim());
        },
      };
    }

    return {
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier') return;
        const sizes = controlSizes[node.name.name];
        if (!sizes) return;
        for (const attribute of node.attributes) {
          if (attribute.type !== 'JSXAttribute') continue;
          if (attribute.name.type !== 'JSXIdentifier') continue;
          const name = attribute.name.name;
          if (name === 'size') {
            const value = literalValue(attribute.value);
            const height =
              typeof value === 'string' && value in sizes
                ? sizes[value]
                : node.name.name === 'ActionIcon'
                  ? pixels(value)
                  : undefined;
            report(
              attribute,
              height,
              typeof value === 'string' && value in sizes
                ? `size "${value}" (${height}px)`
                : JSON.stringify(value),
            );
          } else if (heightProps.has(name)) {
            const value = literalValue(attribute.value);
            report(attribute, pixels(value), JSON.stringify(value));
          } else if (name === 'style') {
            for (const { name: key, property } of styleProperties(attribute)) {
              if (!heightStyleProperties.has(key)) continue;
              const value = literalValue(property.value);
              report(property, pixels(value), JSON.stringify(value));
            }
          }
        }
      },
    };
  },
};

export default {
  meta: { name: 'interlock-design-system' },
  rules: {
    'no-mantine-import': noMantineImport,
    'no-raw-color': noRawColor,
    'no-inline-style': noInlineStyle,
    'control-height': controlHeight,
  },
};
