import {
  ActionIcon,
  Alert,
  Divider,
  Badge,
  Button,
  Combobox,
  createTheme,
  Input,
  InputWrapper,
  Menu,
  Modal,
  SegmentedControl,
  Textarea,
  Tabs,
  Table,
  Tooltip,
} from '@mantine/core';
import classes from './theme.module.css';
import workspace from './PageLayout/WorkspacePage.module.css';

const lightColors: Record<string, { background: string; color: string }> = {
  green: { background: 'var(--completed-bg)', color: 'var(--completed-text)' },
  blue: { background: 'var(--running-bg)', color: 'var(--running-text)' },
  yellow: { background: 'var(--attention-bg)', color: 'var(--attention-text)' },
  orange: { background: 'var(--attention-bg)', color: 'var(--attention-text)' },
  red: {
    background: 'color-mix(in srgb, var(--error-copy) 12%, var(--inset))',
    color: 'var(--error-copy)',
  },
  gray: { background: 'var(--surface-hover)', color: 'var(--text-secondary)' },
  dark: { background: 'var(--surface-hover)', color: 'var(--text-secondary)' },
};

/** Standard controls are styled here so native Mantine composition stays intact. */
export const theme = createTheme({
  primaryColor: 'blue',
  primaryShade: 6,
  autoContrast: true,
  fontFamily:
    'IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
  fontFamilyMonospace: 'IBM Plex Mono, SFMono-Regular, Consolas, monospace',
  defaultRadius: 'sm',
  radius: { xs: '4px', sm: '6px', md: '9px', lg: '12px', xl: '16px' },
  fontSizes: { xs: '12px', sm: '14px', md: '15px', lg: '18px', xl: '20px' },
  headings: { fontWeight: '600' },
  colors: {
    dark: [
      '#F1F1F1',
      '#DEDEDE',
      '#B8B8B8',
      '#A6A6A6',
      '#555555',
      '#3A3A3A',
      '#333333',
      '#212121',
      '#1A1A1A',
      '#121212',
    ],
    blue: [
      '#EFF2FF',
      '#DCE3FF',
      '#BCCAFF',
      '#9CB1FF',
      '#88AEFF',
      '#6C8AFF',
      '#3F64F7',
      '#3155EB',
      '#2948C9',
      '#233DA6',
    ],
    pink: [
      '#FFF0FC',
      '#FBDCF5',
      '#F2BBE9',
      '#E99CDC',
      '#DE82CF',
      '#CF69BF',
      '#B451A3',
      '#943D86',
      '#77326C',
      '#612A59',
    ],
  },
  components: {
    Button: Button.extend({
      defaultProps: { size: 'sm' },
      classNames: (_theme, props) => ({
        root: [
          classes.button,
          !props.color && props.variant === 'subtle'
            ? classes.neutralButton
            : '',
        ].join(' '),
        label: classes.buttonLabel,
      }),
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: { size: 40, variant: 'subtle' },
      classNames: (_theme, props) => ({
        root: [
          classes.actionIcon,
          !props.color && props.variant === 'subtle'
            ? classes.neutralAction
            : '',
        ].join(' '),
      }),
    }),
    Input: Input.extend({
      classNames: { wrapper: classes.inputWrapper, input: classes.input },
    }),
    InputWrapper: InputWrapper.extend({
      classNames: {
        label: classes.label,
        description: classes.description,
        error: classes.error,
      },
    }),
    Textarea: Textarea.extend({ defaultProps: { resize: 'vertical' } }),
    SegmentedControl: SegmentedControl.extend({
      defaultProps: { withItemsBorders: false },
      classNames: {
        root: classes.segmented,
        label: classes.segmentLabel,
        indicator: classes.segmentIndicator,
      },
    }),
    Tabs: Tabs.extend({
      classNames: (_theme, props) =>
        props.orientation === 'vertical' || props.variant === 'pills'
          ? {}
          : { list: workspace.attachedList, tab: workspace.tab },
    }),
    Badge: Badge.extend({
      classNames: { root: classes.badge },
      vars: (_theme, props) => {
        const colors = lightColors[props.color ?? _theme.primaryColor];
        return {
          root:
            props.variant === 'light' && colors
              ? {
                  '--badge-bg': colors.background,
                  '--badge-color': colors.color,
                }
              : {},
        };
      },
    }),
    Alert: Alert.extend({
      classNames: {
        wrapper: classes.alertContent,
        body: classes.alertContent,
        message: classes.alertMessage,
      },
      vars: (_theme, props) => {
        const colors = lightColors[props.color ?? _theme.primaryColor];
        return {
          root:
            (!props.variant || props.variant === 'light') && colors
              ? {
                  '--alert-bg': colors.background,
                  '--alert-color': colors.color,
                }
              : {},
        };
      },
    }),
    Divider: Divider.extend({ classNames: { root: classes.divider } }),
    Table: Table.extend({
      vars: () => ({ table: { '--table-border-color': 'var(--border)' } }),
    }),
    Combobox: Combobox.extend({
      classNames: { dropdown: classes.dropdown, option: classes.option },
    }),
    Menu: Menu.extend({
      classNames: {
        dropdown: classes.dropdown,
        item: classes.menuItem,
        divider: classes.divider,
      },
    }),
    Tooltip: Tooltip.extend({ classNames: { tooltip: classes.tooltip } }),
    Modal: Modal.extend({
      defaultProps: {
        centered: true,
        padding: 'xl',
        overlayProps: { backgroundOpacity: 0.72 },
      },
      classNames: { content: classes.modal, title: classes.title },
    }),
  },
});
