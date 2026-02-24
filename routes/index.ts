import express from 'express';
import Auth from './Auth.js';
import GetAccount from './GetAccount.js';
import GetCredit from './GetCredit.js';
import GetItem from './GetItem.js';
import GetList from './GetList.js';
import HeadItem from './HeadItem.js';
import PutUpload from './PutUpload.js';
import DeleteItem from './DeleteItem.js';

export default function Routes(): express.Router {
  const router = express.Router();

  router.get('/account', Auth as unknown as express.RequestHandler, GetAccount as unknown as express.RequestHandler);
  router.get('/account/credit', Auth as unknown as express.RequestHandler, GetCredit as unknown as express.RequestHandler);
  router.head('/:id', HeadItem as unknown as express.RequestHandler);
  router.get('/:id', GetItem as unknown as express.RequestHandler);
  router.get('/list/:pubkey', Auth as unknown as express.RequestHandler, GetList as unknown as express.RequestHandler);
  router.put('/upload', Auth as unknown as express.RequestHandler, PutUpload as unknown as express.RequestHandler);
  router.delete('/:hash', Auth as unknown as express.RequestHandler, DeleteItem as unknown as express.RequestHandler);

  router.get('*', (_req, res) => {
    res.status(404).send();
  });

  return router;
}
