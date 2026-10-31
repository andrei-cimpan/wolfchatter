import net from "node:net";

export type ProxyMode =
  /** Pass bytes through to Postgres, after `delayMs`. */
  | "forward"
  /** Accept, then close straight away: the connection attempt fails. */
  | "refuse"
  /** Accept and never answer, like a host that drops packets. */
  | "hang";

export type TcpProxy = {
  /** The database URL with its host and port pointed at the proxy. */
  connectionString: string;
  mode: ProxyMode;
  delayMs: number;
  /** When each connection attempt arrived (Date.now()). */
  attempts: number[];
  /** Cuts every open connection, as a network drop or server restart would. */
  dropAll(): void;
  /** Stops passing bytes on open connections without closing them, like a NAT that forgot them. */
  freezeAll(): void;
  close(): Promise<void>;
};

// Sits between a client and Postgres so tests can fail, stall, or cut its connections without
// touching the database other tests use.
export async function startTcpProxy(databaseUrl: string): Promise<TcpProxy> {
  const target = new URL(databaseUrl);
  const sockets = new Set<net.Socket>();
  const pairs = new Set<[net.Socket, net.Socket]>();
  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  };

  const server = net.createServer((client) => {
    proxy.attempts.push(Date.now());
    track(client);
    if (proxy.mode === "refuse") return void client.destroy();
    if (proxy.mode === "hang") return;
    client.pause();
    setTimeout(() => {
      if (client.destroyed) return;
      const upstream = net.connect(Number(target.port || 5432), target.hostname);
      track(upstream);
      const pair: [net.Socket, net.Socket] = [client, upstream];
      pairs.add(pair);
      upstream.on("close", () => {
        pairs.delete(pair);
        client.destroy();
      });
      client.on("close", () => upstream.destroy());
      client.pipe(upstream).pipe(client);
      client.resume();
    }, proxy.delayMs);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  const proxied = new URL(databaseUrl);
  proxied.hostname = "127.0.0.1";
  proxied.port = String(port);

  const proxy: TcpProxy = {
    connectionString: proxied.toString(),
    mode: "forward",
    delayMs: 0,
    attempts: [],
    dropAll: () => sockets.forEach((socket) => socket.destroy()),
    freezeAll: () =>
      pairs.forEach(([client, upstream]) => {
        client.unpipe(upstream);
        upstream.unpipe(client);
        client.pause();
        upstream.pause();
      }),
    close: () => {
      proxy.dropAll();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
  return proxy;
}
