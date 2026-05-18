import { createServer as createHttpsServer } from 'https';
import { createServer as createHttpServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { parse } from 'url';
import next from 'next';

const dev = true;
const hostname = '0.0.0.0';
const port = 3000;

const certFile = './192.168.10.138+2.pem';
const keyFile = './192.168.10.138+2-key.pem';

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  if (existsSync(certFile) && existsSync(keyFile)) {
    const httpsOptions = {
      cert: readFileSync(certFile),
      key: readFileSync(keyFile),
    };
    createHttpsServer(httpsOptions, (req, res) => {
      const parsedUrl = parse(req.url ?? '', true);
      handle(req, res, parsedUrl);
    }).listen(port, hostname, () => {
      console.log(`> Ready on https://localhost:${port} (HTTPS)`);
      console.log(`> Mobile: https://192.168.10.138:${port}`);
    });
  } else {
    createHttpServer((req, res) => {
      const parsedUrl = parse(req.url ?? '', true);
      handle(req, res, parsedUrl);
    }).listen(port, hostname, () => {
      console.log(`> Ready on http://localhost:${port} (HTTP — no certs found)`);
    });
  }
});
