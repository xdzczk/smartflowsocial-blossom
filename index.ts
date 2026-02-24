import * as dotenv from 'dotenv';
import { getPublicKey } from 'nostr-tools';
import express from 'express';
import morgan from 'morgan';
import WebSocket from 'ws';
import cors from 'cors';

import Database from './sqlite/index.js';
import HandleEvent from './listener/HandleEvent.js';
import Exchange from './exchange/index.js';
import Listener from './listener/index.js';
import Routes from './routes/index.js';
import type { AppInstance } from './types.js';

export const start = async (): Promise<void> => {
  dotenv.config();

  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;

  const PORT = process.env.PORT ?? 5050;
  const app = express() as unknown as express.Application & AppInstance;

  app.use(morgan('tiny'));
  app.use(cors());

  app.db = new Database({ directory: process.env.DB_PATH });

  app.use('/', express.static('static'));

  app.use(
    '/',
    (req: express.Request, _res, next) => {
      (req as unknown as import('./types.js').AppRequest).app = app;
      next();
    },
    Routes()
  );

  app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);

    app.listener = new Listener(app);
    app.exchange = new Exchange();
    app.pubkey = getPublicKey(process.env.APP_SECRET_KEY ?? '');

    app.listener.on('event', HandleEvent);

    app.listener.createPool('zap_receipts', [
      {
        kinds: [9735],
        '#p': [app.pubkey],
      },
    ]);

    for (const url of (process.env.LISTENER_RELAYS ?? '').split(',')) {
      app.listener.connect(url);
    }
  });
};
