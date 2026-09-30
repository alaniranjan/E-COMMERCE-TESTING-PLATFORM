import { Router } from 'express';
import { testsRepo } from '../db/repositories.ts';

export const testsRouter = Router();

testsRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const test = Number.isInteger(id) ? testsRepo.get(id) : undefined;
  if (!test) return res.status(404).json({ error: 'Test result not found' });
  res.json(test);
});
