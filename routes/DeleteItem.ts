import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Response } from 'express';
import R2Client from './R2Client.js';
import type { AppRequest } from '../types.js';
import type { ApiError } from '../types.js';

export default async function DeleteItem(req: AppRequest, res: Response): Promise<void> {
  try {
    if (req.blossom?.verb !== 'delete') {
      throw { code: 401, message: "Expected t tag value 'delete'" } as ApiError;
    }

    let sha256: string | undefined;

    for (const tag of req.blossom!.auth.tags) {
      if (tag[0] === 'x') {
        sha256 = tag[1];
        break;
      }
    }

    if (!sha256) {
      throw { code: 401, message: 'Missing x tag' } as ApiError;
    }

    const deleted = req.app.db.deleteBlob(sha256, {
      pubkey: req.blossom!.auth.pubkey,
    });

    if (deleted) {
      const client = R2Client();
      await client.send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: sha256,
        })
      );
    }

    res.send();
  } catch (err) {
    const e = err as ApiError;
    console.log(err);
    res.status(e.code ?? 500).json({ message: e.message ?? 'Unknown Error' });
  }
}
