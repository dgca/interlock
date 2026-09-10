import { createServer } from 'node:net';

export function checkPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once('error', (error: NodeJS.ErrnoException) =>
      reject(
        new Error(
          error.code === 'EADDRINUSE'
            ? `Port ${port} is already in use at 127.0.0.1. Another Interlock instance may be running. Find the process with lsof -nP -iTCP:${port} -sTCP:LISTEN and stop that instance, or select --port with a different --db. If the process is suspended, resume it with kill -CONT <pid> so it can handle a pending termination signal.`
            : error.message,
          { cause: error },
        ),
      ),
    );
    listener.listen(port, '127.0.0.1', () =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
  });
}

export function startupError(error: unknown, database: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /database (?:is )?(?:locked|busy)|SQLITE_BUSY|SQLITE_LOCKED/i.test(message)
  )
    return new Error(
      `Cannot start Interlock using database ${database}. Another process may be using this database. Stop other Interlock instances before retrying. Use lsof ${JSON.stringify(database)} to find the process. If it is suspended, use kill -CONT <pid> to let it handle a pending termination signal. ${message}`,
      { cause: error },
    );
  return error instanceof Error ? error : new Error(message);
}
