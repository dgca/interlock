import {
  createTheme,
  Button,
  Input,
  InputWrapper,
  Textarea,
  Modal,
} from '@mantine/core';
import classes from './theme.module.css';

export const theme = createTheme({
  primaryColor: 'blue',
  primaryShade: 4,
  autoContrast: true,
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
  fontFamilyMonospace: 'SFMono-Regular, Consolas, monospace',
  defaultRadius: 'md',
  colors: {
    dark: [
      '#ececf2',
      '#c4c4cf',
      '#a0a0b0',
      '#7c7c8e',
      '#484853',
      '#33333d',
      '#27272f',
      '#1e1e24',
      '#17171b',
      '#141418',
    ],
    blue: [
      '#eef5ff',
      '#dceaff',
      '#b5d2ff',
      '#a8cbff',
      '#82b4ff',
      '#649df0',
      '#4884db',
      '#346cbd',
      '#285697',
      '#214575',
    ],
    pink: [
      '#fff0fa',
      '#fce0f3',
      '#f7c4e6',
      '#f0a1d3',
      '#e883c4',
      '#da66b3',
      '#bf4b97',
      '#9d397b',
      '#7c2e62',
      '#60264d',
    ],
  },
  components: {
    Button: Button.extend({
      defaultProps: { size: 'xs' },
      classNames: { label: classes.buttonLabel },
    }),
    Input: Input.extend({ classNames: { input: classes.input } }),
    InputWrapper: InputWrapper.extend({ classNames: { label: classes.label } }),
    Textarea: Textarea.extend({ defaultProps: { resize: 'vertical' } }),
    Modal: Modal.extend({
      defaultProps: {
        centered: true,
        padding: 'xl',
        overlayProps: { backgroundOpacity: 0.65, blur: 5 },
      },
      classNames: { content: classes.modal, title: classes.title },
    }),
  },
});
