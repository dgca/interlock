// Node queues this warning during module loading. Filter its diagnostic while
// forwarding all other warnings to the handlers installed by the host.
for (const listener of process.rawListeners('warning')) {
  process.removeListener('warning', listener as (warning: Error) => void);
  process.on('warning', (warning) => {
    if (
      warning.name === 'ExperimentalWarning' &&
      warning.message ===
        'SQLite is an experimental feature and might change at any time'
    )
      return;
    Reflect.apply(listener, process, [warning]);
  });
}
